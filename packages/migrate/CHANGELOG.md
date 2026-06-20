# @baas/migrate

## 0.1.0

### Minor Changes

- 92cacd4: Add `dryRunMigrate(source, target, opts)`: project a cutover WITHOUT writing
  anything. It reads the source and the target's resume index and returns a
  `MigratePlan` — per collection, how many rows would be copied vs skipped — plus
  the first `validation` issue (missing `_id`, or a payload over `maxValueBytes`)
  the real run would fail-fast on, computed with the SAME per-row checks `migrate()`
  uses (extracted into shared helpers so the preview can't drift from reality). It
  is reads-only and honest about its limits: it does not project the relink pass
  (relinking needs ids the target mints during the real copy) nor exercise the
  read-after-write precondition (nothing is inserted). New exports: `dryRunMigrate`,
  `MigratePlan`, `MigratePlanCollection`.
- d431e7d: New package `@baas/migrate`: a one-time portable data cutover between any two
  Backends, built on the core `list`/`insert`/`patch` primitives (no provider SDK).
  `migrate(source, target, { collections, relations?, stripFields?, batchSize?,
onProgress? })` pages the source, re-inserts each row into the target (stamping
  `migratedFrom: <oldId>` and stripping backend system fields), and optionally
  remaps foreign keys to the target's re-minted ids in a second pass. It is
  idempotent/resumable (re-runs skip rows already stamped on the target) and
  fail-fast (the first backend error stops the run and is returned with the partial
  `idMap` intact, never thrown). Proven memory → memory in the test suite; the live
  Supabase → Convex cutover is a manual smoke. Explicitly NOT live sync, NOT atomic
  across backends, and NOT a schema/DDL tool, a deliberate cutover documented as
  such.
- e6e7554: Add an opt-in `maxValueBytes` option and document migrate's size/scan bounds
  against Convex's hard limits (16 MiB/mutation, 32k docs scanned, ~1 MiB/value).
  When set, a row whose copied payload serializes to more than `maxValueBytes`
  UTF-8 bytes aborts with a clear `validation` error BEFORE the insert, instead of
  letting a size-capped target reject it with a provider-specific message
  mid-insert; `maxValueBytes: 1_000_000` is a sensible bound for a Convex target.
  Off by default, so the abstraction bakes in no backend's limit. Size is measured
  portably (UTF-8 length of the JSON encoding via `TextEncoder`, so it works in the
  browser too); a `bigint` (a legitimate Convex `int64`) is measured as its decimal
  string rather than throwing, and a value that still cannot serialize (a circular
  reference) skips the check rather than crashing the run. The README gains a
  "Size and scan bounds" section noting that
  reads page at ≤ 200 rows (under the 32k docs-scanned limit) and writes are one
  mutation per row.

### Patch Changes

- 5cd6692: Fix: use a portable resume marker `migratedFrom` (no leading underscore) instead
  of `_migratedFrom`. Convex rejects any user field whose name starts with `_`
  ("only allowed for system fields like `_id`"), so the old marker made Convex
  unusable as a migration target. The new name is accepted by Convex, Supabase, and
  the in-memory adapter alike. Caught by driving a real Supabase -> Convex cutover
  against live stacks (the memory -> memory suite could not surface it); a guard test
  now asserts the marker carries no leading underscore.
- a813527: Enforce the read-after-write precondition and document migration preconditions.
  After the first row it copies into each collection, `migrate()` now reads that
  row back and aborts with a `validation` error if it is invisible ("inserted a row
  but could not read it back"). This converts a silent footgun into a loud, early
  failure: a Supabase target reached without a service-role key can have RLS that
  allows the insert but denies the select, in which case the resume scan would
  silently see an empty target and re-copy everything (duplicates) on a re-run. The
  check is portable (it asserts only "what I just wrote, I can read back" and never
  inspects RLS) and costs one extra read per collection.

  `MigrateEndpoint` now requires `get` on its `store` (alongside `list`/`insert`/
  `patch`); any whole `Backend` already satisfies this. The README gains a
  Preconditions section: Supabase targets need a service-role key (or RLS granting
  read + write); Convex targets re-mint `_id`, so `report.idMap` is the only
  old-to-new link and id stability is never promised.

- 5fec07e: Docs: spell out two requirements a STRICT-SCHEMA target (Postgres/Supabase) has that a schemaless target (Convex) does not, both surfaced by the Marquee dogfood's reverse Convex->Supabase cutover. (1) Every migrated table needs a nullable `migratedFrom` text column — the resume marker is stamped on each row and read back to resume, and it is NOT part of the source schema, so it is easy to miss; without it the first insert fails with "Could not find the 'migratedFrom' column …". (2) The two-pass copy inserts each row's foreign keys with the source id first and rewrites them in the relink pass, so FK columns on a relational target must be permissive during the copy (plain `text`, no FK constraint); a `uuid`-typed or FK-constrained column rejects the transient source id before relink can fix it. Both are inherent to copy-then-relink. The docstring also notes the resulting tension on Postgres: a FK constraint is what PostgREST needs for a server-side embedded join (the `serverSideJoins` capability) but is exactly what blocks the same table from being a migration target, so a schema tuned for native joins is not automatically a clean migration target. Documented in the module docstring.
- Updated dependencies [e2d32fe]
- Updated dependencies [f59ded2]
- Updated dependencies [e3abea8]
- Updated dependencies [e367b83]
- Updated dependencies [8d97270]
  - @baas/core@0.1.0
