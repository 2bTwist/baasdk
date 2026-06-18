/**
 * `@baas/core` — the port layer.
 *
 * This module contains ONLY interfaces, types, capability descriptors, and pure
 * type guards. It imports no backend SDK and ships no implementation. Every
 * adapter implements these contracts; the conformance suite asserts both the
 * runtime and the type behavior defined here.
 *
 * Design stance, grounded in the Convex and Supabase docs:
 *  - The read primitive is "invoke a NAMED operation," not "build a query
 *    client-side" — because no Convex client exposes client-side table access;
 *    they all call deployed functions via a generated `api` object. Designing
 *    against the most constrained backend keeps the contract implementable
 *    everywhere.
 *  - Divergences are DECLARED via `Capabilities`, never silent.
 *  - Every port exposes `native()` as the honest escape hatch.
 *  - Joins, aggregation, and SQL are deliberately OUT of the core contract;
 *    reach them through `native()`.
 */

// ---------------------------------------------------------------------------
// Branded opaque handles
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

/**
 * Opaque document identifier. A Convex `_id` or a Supabase primary key, never
 * to be constructed by hand — only returned by the store and passed back in.
 */
export type DocumentId = Brand<string, "DocumentId">;

/**
 * Opaque file handle. A Convex storage id, or an encoded bucket+path on
 * Supabase. Treated as opaque by callers.
 */
export type FileHandle = Brand<string, "FileHandle">;

// ---------------------------------------------------------------------------
// Result type — normalizes Supabase's `{ data, error }` and Convex's
// throw-on-error into ONE shape so callers handle errors uniformly.
// ---------------------------------------------------------------------------

export type ErrorCode =
  | "not_found"
  | "unauthorized"
  | "conflict"
  | "validation"
  | "unsupported_capability" // adapter declared this capability false
  | "network"
  | "unknown";

export interface BackendError {
  readonly code: ErrorCode;
  readonly message: string;
  /** The original provider error, reachable for debugging. Never inspected by core. */
  readonly cause?: unknown;
}

export type Result<T, E extends BackendError = BackendError> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: E };

/** Pure constructors / guards — no backend dependency, safe to live in core. */
export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const err = (error: BackendError): Result<never> => ({ ok: false, error });
export const isOk = <T, E extends BackendError>(r: Result<T, E>): r is { ok: true; data: T } =>
  r.ok;

// ---------------------------------------------------------------------------
// Capability descriptor — every Backend declares what it can do.
// Each flag is justified by a concrete doc-level divergence between Convex and
// Supabase. Callers branch on these; the conformance suite reads them to decide
// which behaviors to assert per adapter.
// ---------------------------------------------------------------------------

export interface Capabilities {
  /** All writes in a single mutation commit together or none do.
   *  Convex: true (mutations are transactions). supabase-js: false (no client tx). */
  readonly multiDocumentTransactions: boolean;

  /** `subscribe()` delivers LIVE updates, not just an initial value.
   *  Convex: true (native). Supabase: opt-in, per-table; false unless enabled. */
  readonly reactiveQueries: boolean;

  /** Server-side joins / nested selects are available (via native()).
   *  Supabase: true (PostgREST). Convex: false (follow refs manually). */
  readonly serverSideJoins: boolean;

  /** Aggregations / group-by are available (via native()).
   *  Supabase: true. Convex: false. */
  readonly aggregations: boolean;

  /** Filtering on a non-indexed field is a full scan rather than efficient.
   *  Convex: true (filter without index scans). Supabase: false (PostgREST/DB). */
  readonly efficientFilterRequiresIndex: boolean;

  /** The auth provider manages credentials (password / OAuth / OTP sign-in),
   *  not just token verification. Supabase: true. Vanilla Convex: false
   *  (delegates to an external provider; only verifies a JWT). */
  readonly managesCredentials: boolean;

  /** A FileStore is available. */
  readonly fileStorage: boolean;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Cancels a subscription. Modeled as a callable; adapters may also attach
 * properties (Convex's Unsubscribe is both), which callers can ignore.
 */
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// DocumentStore — named-operations model (the resolved fork: Option A).
//
// An app describes its backend surface as a StoreSchema: a set of named READ
// operations (queries) and named WRITE operations (mutations), each with arg
// and result types. This maps 1:1 onto Convex deployed query/mutation
// functions and preserves end-to-end types; the Supabase adapter IMPLEMENTS
// each named operation as a PostgREST query or rpc.
// ---------------------------------------------------------------------------

export interface OperationSpec {
  readonly args: unknown;
  readonly result: unknown;
}

export interface StoreSchema {
  readonly queries: Record<string, OperationSpec>;
  readonly mutations: Record<string, OperationSpec>;
}

/** Convenience default for stores declared without a typed schema. */
export interface AnySchema extends StoreSchema {
  readonly queries: Record<string, OperationSpec>;
  readonly mutations: Record<string, OperationSpec>;
}

type QueryName<S extends StoreSchema> = keyof S["queries"] & string;
type MutationName<S extends StoreSchema> = keyof S["mutations"] & string;

export interface DocumentStore<S extends StoreSchema = AnySchema> {
  readonly capabilities: Capabilities;

  /** Invoke a named read operation once (non-reactive). */
  run<K extends QueryName<S>>(
    operation: K,
    args: S["queries"][K]["args"],
  ): Promise<Result<S["queries"][K]["result"]>>;

  /**
   * Subscribe to a named read operation.
   *
   * Contract: `onChange` is ALWAYS called once with the current result.
   * Whether it fires again on data changes is governed by
   * `capabilities.reactiveQueries`. Adapters that cannot deliver live updates
   * still satisfy the one-shot delivery, so callers get a consistent shape.
   */
  subscribe<K extends QueryName<S>>(
    operation: K,
    args: S["queries"][K]["args"],
    onChange: (result: Result<S["queries"][K]["result"]>) => void,
  ): Unsubscribe;

  /** Invoke a named write operation. Transactional iff
   *  `capabilities.multiDocumentTransactions`. */
  mutate<K extends MutationName<S>>(
    operation: K,
    args: S["mutations"][K]["args"],
  ): Promise<Result<S["mutations"][K]["result"]>>;

  /**
   * Direct document access by id — the portable CRUD primitives.
   *
   * Note the Convex asymmetry: these are trivial on Supabase but on Convex
   * require the adapter to deploy a small set of generic helper functions,
   * because `ctx.db` is server-side only. That cost is borne by the adapter,
   * not the contract.
   */
  get<T = unknown>(collection: string, id: DocumentId): Promise<Result<T | null>>;
  insert<T = Record<string, unknown>>(collection: string, value: T): Promise<Result<DocumentId>>;
  patch<T = Record<string, unknown>>(
    collection: string,
    id: DocumentId,
    value: Partial<T>,
  ): Promise<Result<void>>;
  remove(collection: string, id: DocumentId): Promise<Result<void>>;

  /** Escape hatch: the underlying provider client, typed per adapter. */
  native(): unknown;
}

// ---------------------------------------------------------------------------
// AuthProvider — the narrow portable core is "verify who the user is."
// Credential management (sign-in flows) is a capability-gated EXTENSION,
// because vanilla Convex has no native equivalent (it consumes an external JWT).
// ---------------------------------------------------------------------------

export interface Identity {
  /** Stable user id (Convex `subject` / Supabase user id). */
  readonly subject: string;
  readonly issuer?: string;
  readonly email?: string;
  /** Remaining provider claims, untouched by core. */
  readonly claims: Readonly<Record<string, unknown>>;
}

export interface Session {
  readonly identity: Identity;
  /** The access token / JWT in effect. */
  readonly token: string;
  /** Unix ms expiry, if known. */
  readonly expiresAt?: number;
}

/**
 * Returns a JWT (or null when unavailable, e.g. revoked rights). Mirrors
 * Convex's `setAuth` fetcher; the Supabase adapter wires its own session token.
 */
export type TokenFetcher = (opts: { forceRefresh: boolean }) => Promise<string | null>;

export interface AuthProvider {
  readonly capabilities: Pick<Capabilities, "managesCredentials">;

  /** Supply/refresh the token used to authenticate requests. */
  setToken(fetcher: TokenFetcher): void;
  clearToken(): void;

  getIdentity(): Promise<Result<Identity | null>>;
  getSession(): Promise<Result<Session | null>>;

  /** Fires whenever the session changes. Initial call delivers current state. */
  onAuthStateChange(callback: (session: Session | null) => void): Unsubscribe;

  native(): unknown;
}

export interface OAuthOptions {
  readonly redirectTo?: string;
  readonly scopes?: readonly string[];
}

export interface OAuthResult {
  /** URL to redirect the user to, when the flow is redirect-based. */
  readonly url?: string;
  readonly session?: Session;
}

/**
 * Credential management extension. Only present when
 * `capabilities.managesCredentials` is true (Supabase). Use `supportsCredentials`
 * to narrow.
 */
export interface CredentialAuth {
  signInWithPassword(email: string, password: string): Promise<Result<Session>>;
  signInWithOAuth(provider: string, options?: OAuthOptions): Promise<Result<OAuthResult>>;
  signInWithOtp(channel: { email: string } | { phone: string }): Promise<Result<void>>;
  signUp(email: string, password: string): Promise<Result<Session | null>>;
  signOut(): Promise<Result<void>>;
}

export const supportsCredentials = (auth: AuthProvider): auth is AuthProvider & CredentialAuth =>
  auth.capabilities.managesCredentials === true &&
  typeof (auth as Partial<CredentialAuth>).signInWithPassword === "function";

// ---------------------------------------------------------------------------
// FileStore — opaque-handle model bridging Supabase buckets/paths and Convex
// storage ids. Convex's adapter wraps the generate-URL-then-POST upload dance
// inside `upload`.
// ---------------------------------------------------------------------------

export interface UploadOptions {
  readonly contentType?: string;
  /** Optional logical path/key. Maps to a Supabase bucket path; advisory on Convex. */
  readonly path?: string;
  /** Provider-specific knobs (e.g. Supabase bucket, upsert). Adapter-interpreted. */
  readonly providerOptions?: Readonly<Record<string, unknown>>;
}

export interface FileStore {
  readonly capabilities: Pick<Capabilities, "fileStorage">;

  upload(data: Blob | ArrayBuffer, options?: UploadOptions): Promise<Result<FileHandle>>;
  /** Time-limited or public URL to fetch the file; null if it no longer exists. */
  getUrl(
    handle: FileHandle,
    options?: { expiresInSeconds?: number },
  ): Promise<Result<string | null>>;
  download(handle: FileHandle): Promise<Result<Blob>>;
  remove(handle: FileHandle): Promise<Result<void>>;

  native(): unknown;
}

// ---------------------------------------------------------------------------
// Backend — the assembled surface an adapter produces, and the adapter factory.
// ---------------------------------------------------------------------------

export interface Backend<S extends StoreSchema = AnySchema> {
  readonly capabilities: Capabilities;
  readonly store: DocumentStore<S>;
  readonly auth: AuthProvider;
  readonly files: FileStore;
}

/**
 * The single thing an adapter package exports: a factory turning provider
 * config into a Backend. Each adapter is its own independently-versioned
 * package depending on this `core`.
 */
export type Adapter<Config = unknown, S extends StoreSchema = AnySchema> = (
  config: Config,
) => Backend<S>;

// ---------------------------------------------------------------------------
// Capability type guards — pure, belong in core; used by callers and by the
// conformance suite to gate assertions.
// ---------------------------------------------------------------------------

export const supportsReactivity = (b: Pick<Backend, "capabilities">): boolean =>
  b.capabilities.reactiveQueries;

export const supportsTransactions = (b: Pick<Backend, "capabilities">): boolean =>
  b.capabilities.multiDocumentTransactions;
