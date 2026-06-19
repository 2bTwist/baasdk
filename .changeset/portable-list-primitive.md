---
"@baas/core": minor
"@baas/adapter-memory": minor
"@baas/adapter-supabase": minor
"@baas/adapter-convex": minor
---

Add a portable `list` primitive to `DocumentStore`: cursor-paginated,
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
