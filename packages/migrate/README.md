# @baas/migrate

One-time **data cutover** between any two `@baas/core` Backends. It pages the
source with `list()`, re-inserts each row into the target with `insert()`, and
(optionally) remaps relations with `patch()`. Built entirely on the core port, so
it works against any adapter pair: Supabase to Convex, Convex to Supabase, or
either to/from the in-memory adapter.

```ts
import { migrate } from "@baas/migrate";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import { createConvexBackend } from "@baas/adapter-convex";

const report = await migrate(source, target, {
  collections: ["users", "posts"],
  relations: { posts: { authorId: "users" } }, // posts.authorId points at users
  stripFields: ["id", "created_at"],           // drop a Supabase source's own columns
  onProgress: (e) => console.log(e.phase, e.collection, e.done),
});

if (!report.ok) {
  console.error("aborted in", report.error?.collection, report.error?.error.message);
} else {
  console.log(report.collections); // { users: { copied, skipped, relinked }, ... }
}
```

## How it works

1. **Resume index.** Before copying a collection, the target is scanned and every
   existing row's `migratedFrom` value is indexed, so an interrupted run resumes
   without duplicating. On a fresh target this is one empty page; on a re-run it
   pages the whole target collection (cost scales with rows already migrated).
2. **Copy pass.** Each source collection is paged to exhaustion. Every row is
   re-inserted with backend system fields (`_id`, `_creationTime`) and any
   `stripFields` removed, and stamped `migratedFrom: <oldSourceId>`. The target
   re-mints its own id; `oldId → newId` is recorded in `report.idMap`.
3. **Relink pass** (only if `relations` is given). Each collection with declared
   relations is re-paged; every FK field is rewritten from the old source id to
   the target's new id via the id map, with `patch()`.

It is **fail-fast**: the first `list`/`insert`/`patch` error stops the run and
returns `{ ok: false, error, ... }` with the partial `idMap` intact (never throws
on a backend error). Re-running resumes from where it stopped.

## What it is NOT

- **Not a live toggle / sync.** After a migration the target is the source of
  truth and the origin is stale. Continuous "one dataset in both backends" is the
  sync-engine problem and is deliberately out of scope.
- **Not atomic across backends.** Two systems cannot share one transaction; a
  mid-run failure leaves a partial copy. Resume (via `migratedFrom`) mitigates
  this; full cross-backend atomicity is impossible.
- **Not a schema/DDL tool.** It copies *data* into collections that already exist
  on the target. Create the target's tables/columns first.
- **IDs change by design.** External references that embed an old primary key must
  be remapped by the caller (the relink pass handles in-dataset FKs).
- **Values are copied verbatim.** Non-trivial schemas with type/precision drift
  (Postgres numeric vs JS number, timestamps) need per-field coercion this does
  not perform.

## Target requirements

The target must accept the inserted payload: the `migratedFrom` marker column
and the copied non-system columns must exist (or the target must be schemaless,
like the in-memory adapter or a Convex table with `schemaValidation: false`). A
Supabase target needs a `migratedFrom` column on each migrated table for resume
to work.

`migratedFrom` is **reserved** and managed by migrate: any value a source row
carries under that name is dropped and replaced with this run's source id (so a
chained re-migration re-stamps fresh lineage rather than carrying stale ids). The
name deliberately has no leading underscore, because Convex rejects any user field
starting with `_`, so an underscore marker would make Convex unusable as a target.
A source row whose `_id` is missing or non-scalar aborts the run with a
`validation` error rather than silently corrupting the id map.

## Dry run

`dryRunMigrate(source, target, opts)` projects a cutover **without writing
anything**. It reads the source and the target's resume index and returns a
`MigratePlan`: per collection, how many rows would be copied vs skipped, plus the
first `validation` issue (a row with no usable `_id`, or one over `maxValueBytes`)
that the real run would fail-fast on — using the **same** checks `migrate()` runs.

```ts
import { dryRunMigrate, migrate } from "@baas/migrate";

const plan = await dryRunMigrate(source, target, opts);
if (!plan.ok) throw new Error(`migration would abort: ${plan.error?.error.message}`);
console.log(plan.collections); // { users: { total, toCopy, toSkip }, ... }
await migrate(source, target, opts); // commit for real
```

It is reads-only, so honest about what it can and cannot tell you: a dry run does
**not** project the relink pass (relinking needs ids the target mints during the
real copy) and does **not** exercise the read-after-write precondition (nothing is
inserted, so a read-filtered target only surfaces on the real run's first insert).

## Size and scan bounds (Convex limits)

Convex caps a single mutation at **16 MiB written / 32,000 documents scanned /
4,096 index ranges**, and a single value at **~1 MiB**. migrate stays within them:

- **Reads page small.** Both the copy scan and the resume-index scan page through
  `list()`, whose page size is clamped to **≤ 200**, well under the 32k
  docs-scanned limit. Each page is its own query, so an arbitrarily large source or
  target collection is migrated in bounded pages, never one giant scan.
- **Writes are per row.** Each row is inserted on its own (one mutation per row),
  so the 16 MiB-per-mutation limit only bites if a single row exceeds it. To catch
  that early with a clear error rather than a provider-specific mid-insert
  rejection, set **`maxValueBytes`** (opt-in): a row whose copied payload
  serializes to more than that many UTF-8 bytes aborts with a `validation` error
  before the insert. `maxValueBytes: 1_000_000` is a sensible bound for a Convex
  target. It is off by default, so the abstraction bakes in no backend's limit.

## Preconditions

### Supabase target: use a service-role key (full read + write)

Construct the Supabase target backend with the **service-role key** (which
bypasses RLS), or with a key whose RLS policies grant the migrating role **both
insert and select** on every target table. The reason is asymmetric:

- An insert that RLS **denies** fails loudly — the run stops fail-fast with that
  error, so you notice immediately.
- A select that RLS **denies** does NOT error — Supabase returns an empty result.
  That is the dangerous case: migrate's resume scan would see an empty target and,
  on a re-run, re-copy everything (duplicates). To stop this silent footgun,
  migrate performs a **read-after-write check**: after the first row it copies
  into each collection, it reads that row back, and aborts with a `validation`
  error if the row is invisible ("inserted a row but could not read it back").
  So a misconfigured target fails on the first row, not after duplicating later.

migrate stays provider-agnostic — it never inspects RLS, it only asserts the
portable invariant "what I just wrote, I can read back" — but Supabase reached
without a service-role key is the case this protects you from.

### Convex target: ids are re-minted, so the id map is mandatory

A Convex target regenerates its own `_id` for every inserted row (system fields
are reserved), so migrate **never preserves source ids** into Convex (or any
target — the target always re-mints). The old-to-new mapping lives only in
`report.idMap`. In-dataset foreign keys are remapped by the relink pass
(`relations`); any reference that lives OUTSIDE the migrated dataset and embeds an
old id (an external service, a cached URL, a client's stored id) must be remapped
by you using `report.idMap`. Never promise id stability across a migration.

## Tests

The contract is proven memory → memory in `test/migrate.test.ts` (the in-memory
adapter is the fast, fully-portable double): flat copy, `stripFields`, progress,
relation relink, dangling-FK handling, idempotent resume, multi-page batching,
and fail-fast with a partial id map. The live Supabase → Convex cutover is a
manual smoke via the playground's "Migrate" button.
