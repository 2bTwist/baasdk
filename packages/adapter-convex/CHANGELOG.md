# @baas/adapter-convex

## 0.1.0

### Minor Changes

- b0ddc5c: Add the client-side Convex adapter (the `.` entry): `createConvexBackend` /
  `convexAdapter` with `ConvexDocumentStore` (named ops via FunctionReferences,
  direct CRUD + reactive `subscribe` via the deployed helpers), `ConvexAuth`
  (verify-only, `managesCredentials: false`, `forceRefreshToken` adapted), and
  `ConvexFileStore` (the upload-URL-then-POST dance). Passes the full conformance
  suite against a live deployment. The deployable helpers now normalize Convex's
  throw-on-missing/foreign-id into the portable contract (idempotent `remove`,
  `not_found` `patch`, `null` `get`).
- 6079e6e: Add `@baas/adapter-convex` with its deployable server helpers (the `./convex`
  entry): schemaless, table-name-first CRUD (`insert`/`get`/`list`/`patch`/
  `remove`), file storage (`generateUploadUrl`/`getFileUrl`/`deleteFile`), and an
  auth `whoami`, built on Convex's generic `queryGeneric`/`mutationGeneric`
  builders so they ship from npm with no codegen dependency. Proven hermetically
  with `convex-test`. The client-side adapter follows.
- e3abea8: Extend `list` with the `in` operator and field ordering.

  - **`in` operator**: `where: [["status", "in", ["open", "pending"]]]`. Maps to
    Supabase `.in()`, memory `Array.includes`, and an OR-of-eq expansion on Convex
    (which has no native `in`). `WhereCondition` is now a discriminated tuple union
    (`in` takes an array; the other six operators take a scalar).
  - **Field ordering**: `order` accepts `{ field, direction }` in addition to the
    bare `"asc"`/`"desc"` creation-order shorthand. Supabase and memory order by any
    field directly (keyset on `(field, pk)`). On Convex, field ordering uses a
    `by_<field>` index; ordering by an unindexed field returns an
    `unsupported_capability` error rather than silently falling back to creation
    order. Page size still defaults to 50, clamped to 200.

- 8d97270: Add a portable `list` primitive to `DocumentStore`: cursor-paginated,
  creation-ordered listing with a small filter set. `store.list(collection, { where,
order, limit, cursor })` returns `{ items, nextCursor }`, where each item carries a
  portable `_id`. Filters use six comparison operators (`eq/neq/gt/gte/lt/lte`,
  AND-combined); ordering is creation-order direction only (`asc`/`desc`); pagination
  is keyset/cursor (never offset). Implemented identically across memory, Supabase
  (keyset on a configurable `timestampColumn`, default `created_at`), and Convex
  (`.paginate()` over the deployed helper), and asserted by the conformance suite.

  Contract note: loop until `nextCursor` is `null`; a non-null cursor may yield an
  empty trailing page on a scan-based backend (Convex with a filter). Arbitrary-field
  sorting, `in`/text/array operators, joins, and aggregation remain out of scope via
  `native()`.

### Patch Changes

- Updated dependencies [e2d32fe]
- Updated dependencies [f59ded2]
- Updated dependencies [e3abea8]
- Updated dependencies [e367b83]
- Updated dependencies [8d97270]
  - @baas/core@0.1.0
