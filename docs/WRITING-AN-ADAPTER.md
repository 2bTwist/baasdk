# Writing an adapter

This is the end-to-end guide to adding a backend to baasdk. The short version
lives in [CONTRIBUTING.md](../CONTRIBUTING.md#adding-an-adapter); this is the long
version, with the contract spelled out.

An adapter is one package that turns a provider's SDK into the four ports in
`@baas/core` and **passes the conformance suite**. That last clause is the whole
job: an adapter is done when the suite passes, not when it compiles. The suite is
the executable spec, so this guide is mostly "here is what the suite will check,
and here is how each reference adapter satisfies it."

Two implementations are worth reading alongside this page. Both run the suite in
CI on every commit, so they are guaranteed-correct worked examples, not prose
that can drift:

- **`packages/adapter-memory`** is the reference adapter. It is process-local and
  synchronous, so it shows the contract with no provider noise. Read it first.
- **`packages/adapter-supabase`** is a real adapter (PostgREST / Auth / Storage)
  and shows what changes when the backend is a network service.

## The mental model

Four ideas explain every contract below.

1. **Named operations, not a query builder.** An app declares its surface as a
   `StoreSchema`: named reads (`queries`) and named writes (`mutations`), each
   with arg and result types. The caller invokes `store.run("listTodos", {})`,
   never a client-side query. This maps 1:1 onto Convex deployed functions and is
   implementable everywhere, which is why it is the contract. Alongside the named
   operations, the store also exposes portable by-id CRUD (`get` / `insert` /
   `patch` / `remove`).
2. **Errors are values.** Every port method returns a `Result<T>`, either
   `{ ok: true, data }` or `{ ok: false, error }`. Provider errors are converted
   to a `BackendError` at the boundary and returned; they must never throw across
   a port method. This is enforced: a `Result` that is ignored is a lint error
   (`must-use-result`), and `core` itself may not contain a `throw`.
3. **Divergence is declared, never silent.** Anything your backend cannot do is a
   `false` in its `Capabilities` descriptor. The suite reads those flags and
   asserts a behavior only when you claim it. A capability you cannot honor is a
   `false`, not a half-working method.
4. **`native()` is the honest escape hatch.** Joins, aggregations, SQL, and
   provider-specific power are deliberately out of the core contract. Each port
   exposes `native()` returning the underlying client, typed per adapter, so
   callers reach that power explicitly rather than having it smuggled into the
   abstraction.

## The four contracts

Every adapter assembles a `Backend<S>` (see `@baas/core`):

```ts
interface Backend<S extends StoreSchema> {
  readonly capabilities: Capabilities;
  readonly store: DocumentStore<S>; // named ops + by-id CRUD + subscribe
  readonly auth: AuthProvider; // verify identity; sign-in is capability-gated
  readonly files: FileStore; // capability-gated
}
```

A single factory `(config) => Backend<S>` is the only thing the package exports
to callers. The full interface definitions are in `packages/core/src/index.ts`;
that file is the source of truth for every signature referenced below.

## Step 0: scaffold the package

Copy the shape of an existing adapter package (`package.json`, `tsconfig.json`,
`tsup.config.ts`). The constraints that matter:

- The package depends on `@baas/core` and your provider SDK, and on **nothing
  else in the workspace**. Adapters may not import each other or `core`'s
  siblings; dependency-cruiser enforces this (`adapters-only-core`), and the rule
  covers `test/` too, so an adapter's tests cannot import a sibling adapter
  either.
- ESM-only, built with tsup. Public signatures must be explicit enough for
  `isolatedDeclarations` (no inferred exported types).

## Step 1: the error boundary

Write one function that maps anything the provider can throw or return-as-error
into a `BackendError`. Every port method funnels through it. The `ErrorCode` set
is fixed in `core`: `not_found`, `unauthorized`, `conflict`, `validation`,
`unsupported_capability`, `network`, `unknown`.

The memory adapter throws a small typed `MemoryError` internally and converts at
the edge. The Supabase adapter maps PostgREST/Auth codes
(`packages/adapter-supabase/src/index.ts`, `toBackendError`):

```ts
const toBackendError = (e: unknown): BackendError => {
  const x = e as { message?: string; code?: string; status?: number } | null;
  let code: ErrorCode = "unknown";
  if (x?.code === "PGRST116") code = "not_found"; // no rows where one expected
  else if (x?.code === "23505") code = "conflict"; // unique violation
  else if (x?.status === 401 || x?.status === 403) code = "unauthorized";
  else if (x?.status === 404) code = "not_found";
  return { code, message: x?.message ?? String(e), cause: e };
};
```

Then every method is `try { return ok(...) } catch (e) { return err(toBackendError(e)) }`.
Keep the original provider error in `cause` so debugging is not lossy; `core`
never inspects it.

> A backend-specific wrinkle worth knowing: some providers scrub thrown error
> text in production. Convex does, so its adapter routes structured codes through
> `ConvexError.data` (the one payload Convex preserves) rather than parsing
> messages. See `packages/adapter-convex/src/errors.ts`. The lesson generalizes:
> find the channel your provider does not strip, and put the code there.

## Step 2: `DocumentStore`

This is the largest port. Implement `run`, `subscribe`, `mutate`, the four by-id
CRUD methods, and `native()`. The suite
(`packages/conformance/src/index.ts`) pins these behaviors:

| Behavior the suite asserts | What your adapter must do |
|---|---|
| `run` on a fresh backend returns `[]` | a missing collection reads as empty, not an error |
| `mutate` persists; `run` reflects it | writes are visible to subsequent reads |
| a mutation reads back its own writes | within one mutation, reads see prior writes in it |
| `get` of a valid-but-removed id returns `ok(null)` | absent doc is `null`, not an error |
| `insert`/`get`/`patch`/`remove` round-trip | by-id CRUD works for an arbitrary collection |
| `remove` of an absent id is **idempotent** (`ok`) | removing reaches a desired end state, so it succeeds |
| `patch` of an absent id is `err(not_found)` | patch requires an existing target; report it, do not no-op |
| unknown operation name → **error `Result`, never a throw** | look the op up; return `err` if absent |
| unicode / astral / combining-mark payloads round-trip intact | no lossy encoding |

Two contract points trip people up:

- **`remove` is idempotent but `patch` is not.** Removing an already-absent id is
  `ok` (the end state is "gone"); patching an absent id is `err(not_found)` (there
  is nothing to patch). The memory adapter encodes exactly this asymmetry.
- **Never fabricate a `DocumentId`.** It is a branded opaque type. The suite
  itself never constructs one; it inserts, then removes, to get "a valid id that
  no longer resolves." Your adapter should likewise only ever return ids the
  backend produced.

### `subscribe`

The contract is: `onChange` is **always** called at least once with the current
result. Whether it fires again on later changes is governed by
`capabilities.reactiveQueries`.

- A reactive backend (Convex, or Supabase with Realtime wired) pushes updates;
  the suite asserts a later mutation produces a new delivery.
- A non-reactive backend delivers once and never again; the suite asserts the
  opposite, that a later mutation produces **no** further delivery.

So even a backend with no live-query support implements `subscribe`: run the
query once, deliver the `Result`, and return an `Unsubscribe`. The one-shot
delivery is mandatory; the live updates are the capability. The suite also checks
that unsubscribing (even synchronously, before the first delivery settles) never
produces an extra delivery, and that an unknown operation is delivered as an
error `Result`, not thrown.

## Step 3: `AuthProvider`

The portable core of auth is narrow on purpose: "verify who the user is."
Required on every adapter, regardless of capabilities:

- `setToken(fetcher)` / `clearToken()` to supply or drop the JWT in effect.
- `getIdentity()` / `getSession()` returning `ok(null)` when signed out.
- `onAuthStateChange(cb)` which **delivers the current state once** on subscribe
  (mirroring `subscribe`'s one-shot guarantee), then on every change.
- `native()`.

**Credential management is a capability-gated extension.** Sign-in flows
(`signInWithPassword`, `signUp`, `signInWithOAuth`, `signInWithOtp`, `signOut`)
live in the `CredentialAuth` interface and exist only when
`capabilities.managesCredentials` is true. Vanilla Convex verifies an external
JWT and has no native equivalent, so its adapter declares this `false`; Supabase
declares it `true`. Callers narrow with the `supportsCredentials(auth)` guard
from `core` before reaching for those methods.

When you do implement credentials, the suite is specific about error codes: a
duplicate signup is `err(conflict)` (even if the provider hides it behind
enumeration protection, you must surface it), and a wrong password is
`err(unauthorized)`, never a throw. See the `AuthProvider` block in the suite.

## Step 4: `FileStore`

Entirely capability-gated by `fileStorage`. If your backend has no storage,
declare `false` and the suite skips the file round-trip (it still checks that the
flag and `files.capabilities.fileStorage` agree). If you declare `true`, the
suite runs `upload` → `getUrl` → `download` → `remove` and expects `getUrl` on a
removed handle to return `ok(null)`. `FileHandle` is opaque like `DocumentId`;
Supabase encodes `bucket + path` into it, Convex uses a storage id. Callers treat
it as a token.

## Step 5: declare honest `Capabilities`

Seven flags, each a boolean, each justified by a real divergence between backends.
Declare a static descriptor and let config override it (some adapters model a
downgraded backend for testing). The Supabase descriptor, with the reasoning that
should accompany every flag:

```ts
const SUPABASE_CAPABILITIES: Capabilities = {
  multiDocumentTransactions: false, // supabase-js has no client-side transaction
  reactiveQueries: false, // Realtime is opt-in per table; base adapter is one-shot
  serverSideJoins: true, // PostgREST embedded resources (via native())
  aggregations: true, // via native()
  efficientFilterRequiresIndex: false,
  managesCredentials: true, // Supabase Auth
  fileStorage: true,
};
```

The honesty rule: a flag is `true` only if your adapter genuinely delivers that
behavior through the portable surface. `serverSideJoins` and `aggregations` are
`true` for Supabase because the power exists, but it is reached via `native()`,
not the core contract; they are descriptor-only signals to callers, not behaviors
the suite exercises portably.

The suite has an anti-rot guard you should understand: every capability must be
**accounted for**, either behaviorally gated (the suite branches on it) or
explicitly marked descriptor-only. If `core` gains a new flag and nobody
classifies it, the `capabilities` block in the suite fails. So a new capability
cannot silently go untested.

## Step 6: assemble the factory

The factory resolves config, merges capability overrides, and returns the
`Backend`. From the Supabase adapter:

```ts
export function createSupabaseBackend<S extends StoreSchema = AnySchema>(
  config: SupabaseConfig<S>,
): Backend<S> {
  const sb = resolveClient(config);
  const capabilities: Capabilities = { ...SUPABASE_CAPABILITIES, ...config.capabilities };
  return {
    capabilities,
    store: new SupabaseDocumentStore<S>(sb, config, capabilities, config.primaryKey ?? "id"),
    auth: new SupabaseAuth(sb, capabilities.managesCredentials),
    files: new SupabaseFileStore(sb, config.bucket ?? "conformance", capabilities.fileStorage),
  };
}
```

Also export the `Adapter<Config>` form (`(config) => Backend`) so the package has
the uniform factory signature `core` declares.

## Step 7: wire the schema and run the suite

The suite fixes one canonical `ConformanceSchema` (a tiny todos surface with
`listTodos`, `getTodo`, `addTodo`, `toggleTodo`, and `addThenFail` for probing
rollback). You provide a `makeBackend` constructor that wires THAT schema to your
backend, and the suite runs unchanged. The template is
`packages/adapter-memory/test/fixture.ts`:

```ts
export function makeMemoryConformanceBackend(
  capabilities?: Partial<Capabilities>,
): Backend<ConformanceSchema> {
  return createMemoryBackend<ConformanceSchema>({
    ...(capabilities ? { capabilities } : {}),
    queries: {
      listTodos: (ctx) => ctx.all<Todo>("todos"),
      getTodo: (ctx, { id }) => ctx.get<Todo>("todos", id),
    },
    mutations: {
      addTodo: (ctx, { title }) => ctx.insert("todos", { title, done: false }),
      toggleTodo: (ctx, { id }) => {
        /* read, then patch the flip */
      },
      addThenFail: (ctx, { title }) => {
        ctx.insert("todos", { title, done: false });
        throw new Error("intentional failure — probes transaction rollback");
      },
    },
  });
}
```

Then hand that constructor to the suite:

```ts
import { runConformanceSuite } from "@baas/conformance";

runConformanceSuite("adapter-mybackend", () => makeMyConformanceBackend());
```

`MakeBackend` may be async and must return a **fresh, empty** backend each call.
A network-backed adapter resets persistent state here (truncate tables, clear
buckets) so each test starts clean; the memory adapter just constructs a new
instance. Run the full matrix at least twice, once with full capabilities and
once with capabilities downgraded to `false`, to prove the gates flip behavior
rather than your adapter quietly doing the same thing either way (see
`packages/adapter-memory/test/conformance.test.ts`).

A real adapter should run the suite against a **real** backend, not a mock. The
Supabase and Convex adapters do this in CI against a live local stack on every
commit; that is what makes "portable" a verified claim rather than an assertion.

## Definition of done

- The conformance suite passes against your adapter, in both the full-capability
  and downgraded-capability configurations.
- `pnpm verify` is green: Biome (zero warnings), boundaries, type-aware lint
  (including `must-use-result`), typecheck, build, tests. See the gate table in
  [CONTRIBUTING.md](../CONTRIBUTING.md#the-gates).
- Capabilities are honest: every `true` is a behavior you actually deliver
  through the portable surface; everything else is `false` with `native()` as the
  escape hatch.
- A changeset accompanies the new package (`pnpm changeset`).

An adapter that compiles but skips a suite assertion has not added a backend; it
has added a backend-shaped object. The suite is the line.
