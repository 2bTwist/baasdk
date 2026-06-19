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

## What it is NOT (the honesty is the point)

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

## Tests

The contract is proven memory → memory in `test/migrate.test.ts` (the in-memory
adapter is the fast, fully-portable double): flat copy, `stripFields`, progress,
relation relink, dangling-FK handling, idempotent resume, multi-page batching,
and fail-fast with a partial id map. The live Supabase → Convex cutover is a
manual smoke via the playground's "Migrate" button.
