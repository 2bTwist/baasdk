# @baas/adapter-convex

The Convex adapter for [`@baas/core`](../core). Convex is the second real backend
and the proof the portable contract is not Supabase-shaped: it diverges hard
(server-only `ctx.db`, native reactivity, JWT-verify-only auth, an
upload-URL-then-POST file dance), and the same conformance suite must still pass.

> **Status: in progress (milestone M2).** This first slice ships the *deployable
> server helpers* (the `./convex` entry) plus hermetic `convex-test` coverage.
> The client-side adapter (`createConvexBackend`, the `.` entry) lands next.

## Why deployable helpers (and not a Convex Component)

Convex has no client-side `ctx.db`: all data access goes through functions
*deployed into the app*. A Convex **Component** can't do generic CRUD here
either: components are sandboxed and cannot read the host app's tables. So the adapter
ships its server helpers as the app's **own** functions. A consumer adds one file:

```ts
// convex/baas.ts
export * from "@baas/adapter-convex/convex";
```

`npx convex dev` deploys them with full app-table access, callable from the
client as `anyApi.baas.insert`, etc. The helpers are built on the generic
`queryGeneric`/`mutationGeneric` builders, so they need no `_generated` codegen
and upgrade through `pnpm`.

| Helper | Convex primitive | Port use |
|--------|------------------|----------|
| `insert` / `get` / `patch` / `remove` | `ctx.db.*` (table-name-first) | `DocumentStore` direct CRUD |
| `list` | `ctx.db.query().withIndex?().filter().order().paginate()` | `DocumentStore.list` (filtered, ordered, cursor-paginated) |
| `whoami` | `ctx.auth.getUserIdentity()` | `AuthProvider.getIdentity` |
| `generateUploadUrl` / `getFileUrl` / `deleteFile` | `ctx.storage.*` | `FileStore` |

`list` orders by `_creationTime` by default. Ordering by a field
(`list(c, { order: { field } })`) uses a `by_<field>` index, so the field must be
indexed in your `schema.ts`; ordering by an unindexed field returns an
`unsupported_capability` error rather than silently falling back.

## Security: these are PUBLIC, generic functions

Read this before deploying. Every helper is a **public** Convex function, so,
exactly like any public function in a Convex app, it is callable by anyone who
has the deployment URL. The difference from a normal app's functions is that
these are **generic over any table**: a caller can `insert`/`patch`/`remove` rows
in any collection and `deleteFile` any storage id. Convex *verifies* a caller's
JWT but these helpers do not *authorize* the call, by design, since vanilla
Convex's model is "the app owns authorization" (`managesCredentials: false`).

So: **authorization is your responsibility.** If your app's data is not meant to
be world-writable, gate these behind your own auth, do not re-export the ones you
do not use, or wrap them. The adapter does not hide this (design principle: name
the leaks you cannot close). An auth-gated variant (helpers that assert
`ctx.auth.getUserIdentity()`, or that wrap an app-supplied authorization check)
is a planned option, not yet shipped.

There is deliberately no published reset/truncate helper for the same reason: a
"delete every row" mutation must never reach the app surface.

## Capabilities (declared by the client adapter)

`multiDocumentTransactions: true` (every mutation is a transaction),
`reactiveQueries: true` (native `onUpdate`), `serverSideJoins: false`,
`aggregations: false`, `efficientFilterRequiresIndex: true` (a `.filter()`
without `.withIndex()` is a scan), `managesCredentials: false` (vanilla Convex
verifies an external JWT; it runs no sign-in flows), `fileStorage: true`.

## Testing

The deployable helpers are proven hermetically with
[`convex-test`](https://www.npmjs.com/package/convex-test) (no login, no
deployment) against the test app in `test/convex/`. Live conformance (the only
way to cover reactivity, real auth wiring, and the upload HTTP dance) runs
against a real deployment and self-skips when `CONVEX_URL` is absent.

Locally, `npx convex dev` (in this package) starts a local backend and writes
`CONVEX_URL` to `.env.local`; then `CONVEX_URL=http://127.0.0.1:3210 pnpm vitest
run packages/adapter-convex` runs it.

**CI runs this on every commit.** The `convex-conformance` job boots a
[self-hosted Convex backend](https://github.com/get-convex/convex-backend) in
Docker (SQLite, no login), `convex deploy`s `test/convex/`, and runs the live
suite, so reactivity + auth + the upload dance are proven per-commit against a
real backend.
