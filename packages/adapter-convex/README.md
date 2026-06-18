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
| `insert` / `get` / `list` / `patch` / `remove` | `ctx.db.*` (table-name-first) | `DocumentStore` direct CRUD |
| `whoami` | `ctx.auth.getUserIdentity()` | `AuthProvider.getIdentity` |
| `generateUploadUrl` / `getFileUrl` / `deleteFile` | `ctx.storage.*` | `FileStore` |

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
against a real deployment and self-skips when `CONVEX_URL` is absent, added with
the client adapter.
