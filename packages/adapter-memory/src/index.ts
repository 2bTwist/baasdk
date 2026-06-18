/**
 * `@baas/adapter-memory` — the in-memory reference adapter.
 *
 * This is built ALONGSIDE the conformance suite: it is the executable spec and
 * the test fixture, and it lets a demo app exist before any real provider is
 * touched. It implements the full `Backend` contract from
 * `@baas/core` and is designed to declare — and honestly satisfy — a rich set
 * of capabilities (transactions, reactive queries, credential management, file
 * storage), so the conformance suite actually exercises every gated branch.
 *
 * Everything here is process-local and synchronous under the hood; the async
 * `Result`-returning surface exists purely to match the port contract.
 */

import {
  type Adapter,
  type AnySchema,
  type AuthProvider,
  type Backend,
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

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Carries a `core` ErrorCode through a throw so operation fns can signal one. */
export class MemoryError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MemoryError";
  }
}

const toErr = (e: unknown): Result<never> => {
  if (e instanceof MemoryError) return err({ code: e.code, message: e.message, cause: e });
  if (e instanceof Error) return err({ code: "unknown", message: e.message, cause: e });
  return err({ code: "unknown", message: String(e), cause: e });
};

// ---------------------------------------------------------------------------
// The in-memory database + the context handed to operation functions.
// ---------------------------------------------------------------------------

type Record_ = Record<string, unknown>;

/** The handle an operation function uses to read and write documents. */
export interface MemoryContext {
  all<T = Record_>(collection: string): T[];
  get<T = Record_>(collection: string, id: DocumentId): T | null;
  insert(collection: string, value: Record_): DocumentId;
  patch(collection: string, id: DocumentId, value: Record_): void;
  remove(collection: string, id: DocumentId): void;
}

interface Snapshot {
  collections: Map<string, Map<DocumentId, Record_>>;
  counter: number;
}

/** Strip the synthetic `_id` so it is never persisted into the stored value. */
const withoutId = (value: Record_): Record_ => {
  const copy: Record_ = { ...value };
  delete copy._id;
  return copy;
};

class Database implements MemoryContext {
  private collections = new Map<string, Map<DocumentId, Record_>>();
  private counter = 0;
  /** Subscribers re-run their query when notified. */
  readonly listeners = new Set<() => void>();

  private bucket(collection: string): Map<DocumentId, Record_> {
    let c = this.collections.get(collection);
    if (!c) {
      c = new Map();
      this.collections.set(collection, c);
    }
    return c;
  }

  all<T = Record_>(collection: string): T[] {
    const c = this.collections.get(collection);
    if (!c) return [];
    return [...c.entries()].map(([id, value]) => ({ _id: id, ...value }) as T);
  }

  get<T = Record_>(collection: string, id: DocumentId): T | null {
    const value = this.collections.get(collection)?.get(id);
    return value ? ({ _id: id, ...value } as T) : null;
  }

  insert(collection: string, value: Record_): DocumentId {
    const id = `${collection}:${++this.counter}` as DocumentId;
    this.bucket(collection).set(id, withoutId(value));
    return id;
  }

  patch(collection: string, id: DocumentId, value: Record_): void {
    const existing = this.collections.get(collection)?.get(id);
    if (!existing) throw new MemoryError("not_found", `no document ${id} in "${collection}"`);
    this.bucket(collection).set(id, { ...existing, ...withoutId(value) });
  }

  remove(collection: string, id: DocumentId): void {
    const c = this.collections.get(collection);
    if (!c?.has(id)) throw new MemoryError("not_found", `no document ${id} in "${collection}"`);
    c.delete(id);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }

  snapshot(): Snapshot {
    const collections = new Map<string, Map<DocumentId, Record_>>();
    for (const [name, bucket] of this.collections) {
      collections.set(name, new Map([...bucket].map(([id, v]) => [id, { ...v }])));
    }
    return { collections, counter: this.counter };
  }

  restore(s: Snapshot): void {
    this.collections = s.collections;
    this.counter = s.counter;
  }
}

// ---------------------------------------------------------------------------
// Operation function shapes — what a config supplies per named operation.
// ---------------------------------------------------------------------------

export type QueryFn<Args, Res> = (ctx: MemoryContext, args: Args) => Res | Promise<Res>;
export type MutationFn<Args, Res> = (ctx: MemoryContext, args: Args) => Res | Promise<Res>;

export interface MemoryConfig<S extends StoreSchema = AnySchema> {
  readonly queries: {
    [K in keyof S["queries"]]: QueryFn<S["queries"][K]["args"], S["queries"][K]["result"]>;
  };
  readonly mutations: {
    [K in keyof S["mutations"]]: MutationFn<S["mutations"][K]["args"], S["mutations"][K]["result"]>;
  };
  /** Override declared capabilities, e.g. to model a non-reactive backend in tests. */
  readonly capabilities?: Partial<Capabilities>;
}

const DEFAULT_CAPABILITIES: Capabilities = {
  multiDocumentTransactions: true,
  reactiveQueries: true,
  serverSideJoins: false,
  aggregations: false,
  efficientFilterRequiresIndex: false,
  managesCredentials: true,
  fileStorage: true,
};

// ---------------------------------------------------------------------------
// DocumentStore
// ---------------------------------------------------------------------------

type QueryName<S extends StoreSchema> = keyof S["queries"] & string;
type MutationName<S extends StoreSchema> = keyof S["mutations"] & string;

class MemoryDocumentStore<S extends StoreSchema> implements DocumentStore<S> {
  constructor(
    private readonly db: Database,
    private readonly config: MemoryConfig<S>,
    readonly capabilities: Capabilities,
  ) {}

  async run<K extends QueryName<S>>(
    operation: K,
    args: S["queries"][K]["args"],
  ): Promise<Result<S["queries"][K]["result"]>> {
    const fn = this.config.queries[operation];
    if (!fn) return err({ code: "not_found", message: `unknown query "${operation}"` });
    try {
      return ok(await fn(this.db, args));
    } catch (e) {
      return toErr(e);
    }
  }

  subscribe<K extends QueryName<S>>(
    operation: K,
    args: S["queries"][K]["args"],
    onChange: (result: Result<S["queries"][K]["result"]>) => void,
  ): Unsubscribe {
    const fn = this.config.queries[operation];
    const emit = async (): Promise<void> => {
      if (!fn) {
        onChange(err({ code: "not_found", message: `unknown query "${operation}"` }));
        return;
      }
      try {
        onChange(ok(await fn(this.db, args)));
      } catch (e) {
        onChange(toErr(e));
      }
    };

    void emit(); // contract: always deliver once

    if (!this.capabilities.reactiveQueries) return () => {};

    const listener = (): void => {
      void emit();
    };
    this.db.listeners.add(listener);
    return () => {
      this.db.listeners.delete(listener);
    };
  }

  async mutate<K extends MutationName<S>>(
    operation: K,
    args: S["mutations"][K]["args"],
  ): Promise<Result<S["mutations"][K]["result"]>> {
    const fn = this.config.mutations[operation];
    if (!fn) return err({ code: "not_found", message: `unknown mutation "${operation}"` });

    // Transactional iff declared: snapshot before, roll back on throw.
    const snapshot = this.capabilities.multiDocumentTransactions ? this.db.snapshot() : null;
    try {
      const data = await fn(this.db, args);
      this.db.notify();
      return ok(data);
    } catch (e) {
      if (snapshot) this.db.restore(snapshot);
      return toErr(e);
    }
  }

  async get<T = unknown>(collection: string, id: DocumentId): Promise<Result<T | null>> {
    try {
      return ok(this.db.get<T>(collection, id));
    } catch (e) {
      return toErr(e);
    }
  }

  async insert<T = Record_>(collection: string, value: T): Promise<Result<DocumentId>> {
    try {
      const id = this.db.insert(collection, value as Record_);
      this.db.notify();
      return ok(id);
    } catch (e) {
      return toErr(e);
    }
  }

  async patch<T = Record_>(
    collection: string,
    id: DocumentId,
    value: Partial<T>,
  ): Promise<Result<void>> {
    try {
      this.db.patch(collection, id, value);
      this.db.notify();
      return ok(undefined);
    } catch (e) {
      return toErr(e);
    }
  }

  async remove(collection: string, id: DocumentId): Promise<Result<void>> {
    try {
      this.db.remove(collection, id);
      this.db.notify();
      return ok(undefined);
    } catch (e) {
      return toErr(e);
    }
  }

  native(): Database {
    return this.db;
  }
}

// ---------------------------------------------------------------------------
// AuthProvider (+ credential management extension)
// ---------------------------------------------------------------------------

interface MemoryUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly claims: Record<string, unknown>;
}

class MemoryAuth implements AuthProvider, CredentialAuth {
  readonly capabilities: Pick<Capabilities, "managesCredentials">;
  private readonly users = new Map<string, MemoryUser>();
  private readonly listeners = new Set<(session: Session | null) => void>();
  private session: Session | null = null;
  private userCounter = 0;
  private tokenCounter = 0;

  constructor(managesCredentials: boolean) {
    this.capabilities = { managesCredentials };
  }

  // The in-memory adapter manages its own sessions via the credential flows
  // below, so an externally supplied token fetcher has nothing to drive here.
  // A real "verify-only" adapter (e.g. vanilla Convex) would retain and call it.
  setToken(_fetcher: TokenFetcher): void {}

  clearToken(): void {}

  async getIdentity(): Promise<Result<Identity | null>> {
    return ok(this.session?.identity ?? null);
  }

  async getSession(): Promise<Result<Session | null>> {
    return ok(this.session);
  }

  onAuthStateChange(callback: (session: Session | null) => void): Unsubscribe {
    this.listeners.add(callback);
    callback(this.session); // initial delivery
    return () => {
      this.listeners.delete(callback);
    };
  }

  private setSession(session: Session | null): void {
    this.session = session;
    for (const listener of this.listeners) listener(session);
  }

  private makeSession(subject: string, email: string): Session {
    const identity: Identity = { subject, email, claims: {} };
    return {
      identity,
      token: `memtok.${subject}.${++this.tokenCounter}`,
      expiresAt: Date.now() + 3_600_000,
    };
  }

  async signUp(email: string, password: string): Promise<Result<Session | null>> {
    if (this.users.has(email)) return err({ code: "conflict", message: "user already exists" });
    const id = `user:${++this.userCounter}`;
    this.users.set(email, { id, email, password, claims: {} });
    const session = this.makeSession(id, email);
    this.setSession(session);
    return ok(session);
  }

  async signInWithPassword(email: string, password: string): Promise<Result<Session>> {
    const user = this.users.get(email);
    if (!user || user.password !== password) {
      return err({ code: "unauthorized", message: "invalid email or password" });
    }
    const session = this.makeSession(user.id, email);
    this.setSession(session);
    return ok(session);
  }

  async signInWithOAuth(provider: string, _options?: OAuthOptions): Promise<Result<OAuthResult>> {
    // In-memory: no real redirect; hand back a stub URL.
    return ok({ url: `memory://oauth/${provider}` });
  }

  async signInWithOtp(_channel: { email: string } | { phone: string }): Promise<Result<void>> {
    return ok(undefined);
  }

  async signOut(): Promise<Result<void>> {
    this.setSession(null);
    return ok(undefined);
  }

  native(): this {
    return this;
  }
}

// ---------------------------------------------------------------------------
// FileStore
// ---------------------------------------------------------------------------

interface StoredFile {
  readonly data: Blob;
  readonly contentType?: string;
  readonly path?: string;
}

class MemoryFileStore implements FileStore {
  readonly capabilities: Pick<Capabilities, "fileStorage">;
  private readonly files = new Map<FileHandle, StoredFile>();
  private counter = 0;

  constructor(enabled: boolean) {
    this.capabilities = { fileStorage: enabled };
  }

  async upload(data: Blob | ArrayBuffer, options?: UploadOptions): Promise<Result<FileHandle>> {
    const blob =
      data instanceof Blob
        ? data
        : new Blob([data], options?.contentType ? { type: options.contentType } : {});
    const handle = `file:${++this.counter}` as FileHandle;
    const stored: StoredFile = {
      data: blob,
      ...(options?.contentType ? { contentType: options.contentType } : {}),
      ...(options?.path ? { path: options.path } : {}),
    };
    this.files.set(handle, stored);
    return ok(handle);
  }

  async getUrl(
    handle: FileHandle,
    _options?: { expiresInSeconds?: number },
  ): Promise<Result<string | null>> {
    return ok(this.files.has(handle) ? `memory://files/${handle}` : null);
  }

  async download(handle: FileHandle): Promise<Result<Blob>> {
    const file = this.files.get(handle);
    if (!file) return err({ code: "not_found", message: `no file ${handle}` });
    return ok(file.data);
  }

  async remove(handle: FileHandle): Promise<Result<void>> {
    this.files.delete(handle);
    return ok(undefined);
  }

  native(): Map<FileHandle, StoredFile> {
    return this.files;
  }
}

// ---------------------------------------------------------------------------
// The factory — the single export an adapter package provides.
// ---------------------------------------------------------------------------

export function createMemoryBackend<S extends StoreSchema = AnySchema>(
  config: MemoryConfig<S>,
): Backend<S> {
  const capabilities: Capabilities = { ...DEFAULT_CAPABILITIES, ...config.capabilities };
  const db = new Database();
  return {
    capabilities,
    store: new MemoryDocumentStore<S>(db, config, capabilities),
    auth: new MemoryAuth(capabilities.managesCredentials),
    files: new MemoryFileStore(capabilities.fileStorage),
  };
}

/** `Adapter`-typed entry point for symmetry with real adapters. */
export const memoryAdapter: Adapter<MemoryConfig> = (config) => createMemoryBackend(config);
