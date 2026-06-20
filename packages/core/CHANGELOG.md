# @baas/core

## 0.1.0

### Minor Changes

- e2d32fe: Add `CAPABILITY_KEYS`, the runtime list of every `Capabilities` key, kept exhaustive against the interface by a type-level test (`as const` literal tuple). It is a trustworthy source of truth for iterating capabilities, used by the conformance suite's new capability-coverage meta-test to guard against a newly added flag silently going untested.
- f59ded2: Initial port layer (`@baas/core`) and in-memory reference adapter
  (`@baas/adapter-memory`), validated against the parameterized conformance suite.
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

- e367b83: Internal: type-aware lint (typescript-eslint strictTypeChecked) cleanups. Remove unnecessary type assertions and a redundant boolean comparison surfaced by the new lint pass. No behavior or public API change.
