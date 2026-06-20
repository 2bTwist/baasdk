# @baas/adapter-supabase

## 0.1.0

### Minor Changes

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

- f59ded2: Add the Supabase adapter (PostgREST document store, Supabase Auth credential
  management, Supabase Storage), passing the conformance suite 15/15 against a live
  local stack.
- c33fc22: Realtime watches can now be filtered. A `realtime` watch entry accepts
  `{ table, filter }` (a Supabase Realtime filter string like `"room_id=eq.42"`)
  in place of a bare table name, narrowing the subscription to matching rows to cut
  fan-out on high-write tables. Bare table names still watch the whole table (the
  safe default). Filters are unsafe for columns whose value changes after insert (a
  row leaving the filtered set fires no event), so they are opt-in and documented
  for append-mostly tables.
- 81039a5: Add opt-in live `subscribe()` via a `realtime` watch map. Declaring
  `realtime: { <query>: { tables: [...] } }` flips `reactiveQueries` on and makes
  `subscribe()` deliver live updates: a change to a watched table re-runs the query
  and delivers the full fresh result (the same shape Convex delivers), coalesced
  over a short debounce. Channel failures and subscribing to a query with no
  declared watch surface as loud error `Result`s rather than silently degrading to
  one-shot. Requires the watched tables in the `supabase_realtime` publication. The
  default (no `realtime` config) is unchanged: `reactiveQueries: false`, one-shot.

### Patch Changes

- d2b2887: `patch()` of a non-existent id now returns `err(not_found)` instead of silently succeeding, matching the portable conformance contract. PostgREST reports no error for an update that affects 0 rows, so the adapter now adds `.select(pk)` and treats an empty result as `not_found`. `remove()` remains an idempotent no-op. (Caveat: under RLS, an update permitted but a select denied would also surface as `not_found`.)
- 4f62837: Map more Postgres SQLSTATE codes to the portable error taxonomy so a condition
  surfaces as the same `ErrorCode` it does on the other adapters. Notably **`42501`
  (insufficient_privilege, the SQLSTATE an RLS denial reaches the client as) now maps
  to `unauthorized`** instead of falling through to `unknown`; also `23503`
  (foreign_key_violation) -> `conflict`, and `23502`/`23514`/`22P02`
  (not_null / check / invalid_text_representation) -> `validation`. The normalizer
  moved to `src/errors.ts` (internal, not part of the public surface) and is now
  unit-tested against the full mapping table; the Convex normalizer gained matching
  unit tests for parity.
- e367b83: Internal: type-aware lint (typescript-eslint strictTypeChecked) cleanups. Remove unnecessary type assertions and a redundant boolean comparison surfaced by the new lint pass. No behavior or public API change.
- 53b4933: Fix: `store.get()` now surfaces the portable `_id` like `store.list()` does. Previously `get()` returned the raw PostgREST row keyed only by the primary-key column, so a fetched document had no `_id` (an inconsistency with `list()`, and with the Convex adapter whose documents carry `_id` natively). A document fetched via `get()` can now be passed straight to `patch()`/`remove()`. Found by the Marquee dogfood.
- 9c2406f: Fix: `subscribe()` and `files.upload()` no longer crash in a non-secure browser context. Both used `crypto.randomUUID()` (for the Realtime channel name and the default Storage path), but `crypto.randomUUID` is defined ONLY in secure contexts (https, or http on `localhost`). On a plain-http origin such as a LAN-IP dev server (`http://192.168.x.x`) or any non-https deployment it is `undefined`, so opening a live subscription threw `TypeError: crypto.randomUUID is not a function` and unmounted the React tree. Both now use an internal id helper that prefers `crypto.randomUUID()` and falls back to a time + counter + `Math.random()` id when it is unavailable. Found by the Marquee dogfood (the realtime UI smoke over a LAN IP).
- 2260831: `signUp()` now detects a duplicate registration reliably. It maps by the stable `error.code === "user_already_exists"` instead of regex-matching the (localized, version-dependent) error message, and it surfaces the enumeration-protection obfuscated success (a user with an empty `identities` array and no session, returned when email confirmation is ON) as `conflict` rather than a misleading `ok(null)`. A genuine confirmation-pending signup (one identity, no session) is still `ok(null)`.
- Updated dependencies [e2d32fe]
- Updated dependencies [f59ded2]
- Updated dependencies [e3abea8]
- Updated dependencies [e367b83]
- Updated dependencies [8d97270]
  - @baas/core@0.1.0
