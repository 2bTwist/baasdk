/**
 * `@baas/adapter-supabase` — the first real adapter.
 *
 * Mapping to `@baas/core`:
 *  - DocumentStore: direct CRUD → PostgREST (`from(table).select/insert/update/
 *    delete`). Named operations (`run`/`mutate`) are app-supplied functions over
 *    the Supabase client, mirroring the in-memory adapter's config model — a
 *    portable calling convention with a per-backend implementation, since this
 *    is where backends genuinely diverge.
 *  - AuthProvider + CredentialAuth → Supabase Auth (it manages credentials, so
 *    `managesCredentials: true` and the credential extension is present).
 *  - FileStore → Supabase Storage (FileHandle encodes bucket + path).
 *
 * Declared capabilities encode Supabase's real divergences: no client-side
 * transactions, Realtime is opt-in so the base adapter is one-shot,
 * joins/aggregations available via native().
 */

import {
  type Adapter,
  type AnySchema,
  type AuthProvider,
  type Backend,
  type BackendError,
  type Capabilities,
  type CredentialAuth,
  type DocumentId,
  type DocumentStore,
  type ErrorCode,
  err,
  type FileHandle,
  type FileStore,
  type Identity,
  type OAuthOptions,
  type OAuthResult,
  ok,
  type Result,
  type Session,
  type StoreSchema,
  type TokenFetcher,
  type Unsubscribe,
  type UploadOptions,
} from "@baas/core";
import type { Provider, SupabaseClient, Session as SupabaseSession } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Error normalization — PostgREST / Auth / Storage errors into BackendError.
// ---------------------------------------------------------------------------

const toBackendError = (e: unknown): BackendError => {
  const x = e as { message?: string; code?: string; status?: number } | null;
  let code: ErrorCode = "unknown";
  if (x?.code === "PGRST116")
    code = "not_found"; // no rows where one expected
  else if (x?.code === "23505")
    code = "conflict"; // unique violation
  else if (x?.status === 401 || x?.status === 403) code = "unauthorized";
  else if (x?.status === 404) code = "not_found";
  return { code, message: x?.message ?? String(e), cause: e };
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type SupabaseQueryFn<Args, Res> = (sb: SupabaseClient, args: Args) => Promise<Res>;
export type SupabaseMutationFn<Args, Res> = (sb: SupabaseClient, args: Args) => Promise<Res>;

export interface SupabaseConfig<S extends StoreSchema = AnySchema> {
  /** Provide a ready client, or `url` + `key` to construct one. */
  readonly client?: SupabaseClient;
  readonly url?: string;
  readonly key?: string;
  /** Primary-key column used by direct CRUD. Default `"id"`. */
  readonly primaryKey?: string;
  /** Default Storage bucket for the FileStore. */
  readonly bucket?: string;
  readonly queries: {
    [K in keyof S["queries"]]: SupabaseQueryFn<S["queries"][K]["args"], S["queries"][K]["result"]>;
  };
  readonly mutations: {
    [K in keyof S["mutations"]]: SupabaseMutationFn<
      S["mutations"][K]["args"],
      S["mutations"][K]["result"]
    >;
  };
  readonly capabilities?: Partial<Capabilities>;
}

const SUPABASE_CAPABILITIES: Capabilities = {
  multiDocumentTransactions: false, // supabase-js has no client-side transaction
  reactiveQueries: false, // Realtime is opt-in per table; base adapter is one-shot
  serverSideJoins: true, // PostgREST embedded resources (via native())
  aggregations: true, // via native()
  efficientFilterRequiresIndex: false,
  managesCredentials: true, // Supabase Auth
  fileStorage: true,
};

// ---------------------------------------------------------------------------
// DocumentStore
// ---------------------------------------------------------------------------

type QueryName<S extends StoreSchema> = keyof S["queries"] & string;
type MutationName<S extends StoreSchema> = keyof S["mutations"] & string;

class SupabaseDocumentStore<S extends StoreSchema> implements DocumentStore<S> {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly config: SupabaseConfig<S>,
    readonly capabilities: Capabilities,
    private readonly pk: string,
  ) {}

  async run<K extends QueryName<S>>(
    operation: K,
    args: S["queries"][K]["args"],
  ): Promise<Result<S["queries"][K]["result"]>> {
    const fn = this.config.queries[operation];
    if (!fn) return err({ code: "not_found", message: `unknown query "${operation}"` });
    try {
      return ok(await fn(this.sb, args));
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  subscribe<K extends QueryName<S>>(
    operation: K,
    args: S["queries"][K]["args"],
    onChange: (result: Result<S["queries"][K]["result"]>) => void,
  ): Unsubscribe {
    const fn = this.config.queries[operation];
    // Base adapter is one-shot (reactiveQueries: false): deliver the current
    // result once. A Realtime-backed variant would subscribe to table changes
    // here and re-emit, flipping the capability to true.
    void (async () => {
      if (!fn) {
        onChange(err({ code: "not_found", message: `unknown query "${operation}"` }));
        return;
      }
      try {
        onChange(ok(await fn(this.sb, args)));
      } catch (e) {
        onChange(err(toBackendError(e)));
      }
    })();
    return () => {};
  }

  async mutate<K extends MutationName<S>>(
    operation: K,
    args: S["mutations"][K]["args"],
  ): Promise<Result<S["mutations"][K]["result"]>> {
    const fn = this.config.mutations[operation];
    if (!fn) return err({ code: "not_found", message: `unknown mutation "${operation}"` });
    try {
      return ok(await fn(this.sb, args));
    } catch (e) {
      return err(toBackendError(e));
    }
  }

  async get<T = unknown>(collection: string, id: DocumentId): Promise<Result<T | null>> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the untyped Supabase client returns `any` rows; the row shape is the caller's `T`.
    const { data, error } = await this.sb
      .from(collection)
      .select("*")
      .eq(this.pk, id)
      .maybeSingle();
    if (error) return err(toBackendError(error));
    return ok((data as T | null) ?? null);
  }

  async insert<T = Record<string, unknown>>(
    collection: string,
    value: T,
  ): Promise<Result<DocumentId>> {
    const { data, error } = await this.sb
      .from(collection)
      .insert(value as Record<string, unknown>)
      .select(this.pk)
      .single();
    if (error) return err(toBackendError(error));
    // A dynamic `.select(<string>)` widens supabase-js's data type; route the
    // cast through `unknown` to read the primary-key column back out.
    const row = data as unknown as Record<string, unknown>;
    return ok(String(row[this.pk]) as DocumentId);
  }

  async patch<T = Record<string, unknown>>(
    collection: string,
    id: DocumentId,
    value: Partial<T>,
  ): Promise<Result<void>> {
    // `.select(pk)` makes PostgREST return the affected rows, so 0 rows means the
    // document did not exist: patch requires an existing target, so report
    // not_found (the portable contract; remove() stays idempotent). Caveat: under
    // RLS, an update permitted but a select denied would also yield 0 rows here.
    const { data, error } = await this.sb
      .from(collection)
      .update(value as Record<string, unknown>)
      .eq(this.pk, id)
      .select(this.pk);
    if (error) return err(toBackendError(error));
    if (!data || data.length === 0) {
      return err({ code: "not_found", message: `no document ${id} in "${collection}"` });
    }
    return ok(undefined);
  }

  async remove(collection: string, id: DocumentId): Promise<Result<void>> {
    const { error } = await this.sb.from(collection).delete().eq(this.pk, id);
    if (error) return err(toBackendError(error));
    return ok(undefined);
  }

  native(): SupabaseClient {
    return this.sb;
  }
}

// ---------------------------------------------------------------------------
// AuthProvider (+ credential management)
// ---------------------------------------------------------------------------

class SupabaseAuth implements AuthProvider, CredentialAuth {
  readonly capabilities: Pick<Capabilities, "managesCredentials">;

  constructor(
    private readonly sb: SupabaseClient,
    managesCredentials: boolean,
  ) {
    this.capabilities = { managesCredentials };
  }

  // Supabase owns its session lifecycle (cookies / refresh). The external
  // token-fetcher path that the Convex-style "verify-only" model needs has no
  // job here, so these are intentional no-ops for the base adapter.
  setToken(_fetcher: TokenFetcher): void {}
  clearToken(): void {}

  private mapSession(s: SupabaseSession): Session {
    const identity: Identity = {
      subject: s.user.id,
      ...(s.user.email ? { email: s.user.email } : {}),
      claims: s.user.user_metadata ?? {},
    };
    return {
      identity,
      token: s.access_token,
      ...(s.expires_at ? { expiresAt: s.expires_at * 1000 } : {}),
    };
  }

  async getIdentity(): Promise<Result<Identity | null>> {
    const { data } = await this.sb.auth.getUser();
    const user = data.user;
    if (!user) return ok(null);
    return ok({
      subject: user.id,
      ...(user.email ? { email: user.email } : {}),
      claims: user.user_metadata ?? {},
    });
  }

  async getSession(): Promise<Result<Session | null>> {
    const { data } = await this.sb.auth.getSession();
    return ok(data.session ? this.mapSession(data.session) : null);
  }

  onAuthStateChange(callback: (session: Session | null) => void): Unsubscribe {
    // Supabase emits INITIAL_SESSION immediately (asynchronously), satisfying
    // the "delivers current state" contract without a manual first call.
    const { data } = this.sb.auth.onAuthStateChange((_event, session) => {
      callback(session ? this.mapSession(session) : null);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }

  async signUp(email: string, password: string): Promise<Result<Session | null>> {
    const { data, error } = await this.sb.auth.signUp({ email, password });
    if (error) {
      // Map by the stable error code, not the human message (which is localized
      // and version-dependent). `user_already_exists` is the duplicate-signup
      // signal when email confirmation is OFF (observed: HTTP 422).
      const code: ErrorCode =
        (error as { code?: string }).code === "user_already_exists" ? "conflict" : "validation";
      return err({ code, message: error.message, cause: error });
    }
    // With email confirmation ON, Supabase hides a duplicate signup behind an
    // obfuscated success to prevent user enumeration: a user with an EMPTY
    // identities array and no session, and no error. Surface that as a conflict
    // rather than a misleading ok(null). A genuine confirmation-pending signup
    // has exactly one identity, so it is not misclassified here.
    if (data.user && data.user.identities?.length === 0 && !data.session) {
      return err({ code: "conflict", message: "user already registered" });
    }
    return ok(data.session ? this.mapSession(data.session) : null);
  }

  async signInWithPassword(email: string, password: string): Promise<Result<Session>> {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return err({
        code: "unauthorized",
        message: error?.message ?? "sign-in failed",
        cause: error,
      });
    }
    return ok(this.mapSession(data.session));
  }

  async signInWithOAuth(provider: string, options?: OAuthOptions): Promise<Result<OAuthResult>> {
    const { data, error } = await this.sb.auth.signInWithOAuth({
      // The port accepts an open provider string; Supabase types it as a union.
      provider: provider as Provider,
      options: {
        ...(options?.redirectTo ? { redirectTo: options.redirectTo } : {}),
        ...(options?.scopes ? { scopes: options.scopes.join(" ") } : {}),
        skipBrowserRedirect: true,
      },
    });
    if (error) return err(toBackendError(error));
    return ok(data.url ? { url: data.url } : {});
  }

  async signInWithOtp(channel: { email: string } | { phone: string }): Promise<Result<void>> {
    const { error } = await this.sb.auth.signInWithOtp(channel);
    if (error) return err(toBackendError(error));
    return ok(undefined);
  }

  async signOut(): Promise<Result<void>> {
    const { error } = await this.sb.auth.signOut();
    if (error) return err(toBackendError(error));
    return ok(undefined);
  }

  native(): SupabaseClient["auth"] {
    return this.sb.auth;
  }
}

// ---------------------------------------------------------------------------
// FileStore — Supabase Storage. FileHandle encodes `bucket::path`.
// ---------------------------------------------------------------------------

const HANDLE_SEP = "::";
const encodeHandle = (bucket: string, path: string): FileHandle =>
  `${bucket}${HANDLE_SEP}${path}` as FileHandle;
const decodeHandle = (handle: FileHandle): { bucket: string; path: string } => {
  const idx = handle.indexOf(HANDLE_SEP);
  return { bucket: handle.slice(0, idx), path: handle.slice(idx + HANDLE_SEP.length) };
};

class SupabaseFileStore implements FileStore {
  readonly capabilities: Pick<Capabilities, "fileStorage">;

  constructor(
    private readonly sb: SupabaseClient,
    private readonly defaultBucket: string,
    enabled: boolean,
  ) {
    this.capabilities = { fileStorage: enabled };
  }

  async upload(data: Blob | ArrayBuffer, options?: UploadOptions): Promise<Result<FileHandle>> {
    const bucket = (options?.providerOptions?.bucket as string | undefined) ?? this.defaultBucket;
    const path = options?.path ?? crypto.randomUUID();
    const { data: res, error } = await this.sb.storage.from(bucket).upload(path, data, {
      ...(options?.contentType ? { contentType: options.contentType } : {}),
      upsert: true,
    });
    if (error) return err(toBackendError(error));
    return ok(encodeHandle(bucket, res.path));
  }

  async getUrl(
    handle: FileHandle,
    options?: { expiresInSeconds?: number },
  ): Promise<Result<string | null>> {
    const { bucket, path } = decodeHandle(handle);
    // Signed URL verifies the object exists, so a removed file yields null.
    const { data, error } = await this.sb.storage
      .from(bucket)
      .createSignedUrl(path, options?.expiresInSeconds ?? 3600);
    if (error || !data) return ok(null);
    return ok(data.signedUrl);
  }

  async download(handle: FileHandle): Promise<Result<Blob>> {
    const { bucket, path } = decodeHandle(handle);
    const { data, error } = await this.sb.storage.from(bucket).download(path);
    if (error || !data) {
      return err(
        error ? toBackendError(error) : { code: "not_found", message: `no file ${handle}` },
      );
    }
    return ok(data);
  }

  async remove(handle: FileHandle): Promise<Result<void>> {
    const { bucket, path } = decodeHandle(handle);
    const { error } = await this.sb.storage.from(bucket).remove([path]);
    if (error) return err(toBackendError(error));
    return ok(undefined);
  }

  native(): SupabaseClient["storage"] {
    return this.sb.storage;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function resolveClient(config: SupabaseConfig<StoreSchema>): SupabaseClient {
  if (config.client) return config.client;
  if (!config.url || !config.key) {
    throw new Error("SupabaseConfig requires either `client`, or both `url` and `key`.");
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- createClient's default generics differ from the bare SupabaseClient alias; this is supabase-js's own typing.
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createSupabaseBackend<S extends StoreSchema = AnySchema>(
  config: SupabaseConfig<S>,
): Backend<S> {
  const sb = resolveClient(config);
  const capabilities: Capabilities = { ...SUPABASE_CAPABILITIES, ...config.capabilities };
  const pk = config.primaryKey ?? "id";
  const bucket = config.bucket ?? "conformance";
  return {
    capabilities,
    store: new SupabaseDocumentStore<S>(sb, config, capabilities, pk),
    auth: new SupabaseAuth(sb, capabilities.managesCredentials),
    files: new SupabaseFileStore(sb, bucket, capabilities.fileStorage),
  };
}

/** `Adapter`-typed entry point for symmetry with the other adapters. */
export const supabaseAdapter: Adapter<SupabaseConfig> = (config) => createSupabaseBackend(config);
