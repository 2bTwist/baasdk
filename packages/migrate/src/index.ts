/**
 * `@baas/migrate`: one-time portable data cutover between two Backends.
 *
 * This is the honest upgrade of "lock-in insurance": instead of a survivable
 * rewrite, a one-command move of every row from a source Backend to a target
 * Backend, built ENTIRELY on the core port (`list` to page the source, `insert`
 * to re-mint each row on the target, `patch` to relink relations). It imports no
 * provider SDK and works against any adapter, including the in-memory one, which
 * is the fast test double the suite migrates to and from.
 *
 * What it is NOT (declared up front, because the honesty is the product):
 *  - NOT a live toggle / sync. After a migration the TARGET is the source of
 *    truth and the origin is stale. Continuous "one dataset in both" is the
 *    sync-engine problem and deliberately out of scope (see the research doc).
 *  - NOT atomic across backends. Two systems cannot share one transaction, so a
 *    mid-run failure leaves a partial copy. The run is fail-fast and resumable:
 *    every re-minted row is stamped with `_migratedFrom: <oldId>`, so a re-run
 *    skips what already landed (mirrors `@get-convex/migrations`).
 *  - NOT a schema/DDL tool. It copies DATA into collections that already exist on
 *    the target; create the target's tables/columns first.
 *
 * IDs change by design (the target re-mints its own), so external references that
 * embed an old primary key must be remapped by the caller. Values are copied
 * verbatim; non-trivial schemas with type/precision drift (Postgres numeric vs JS
 * number, timestamps) need per-field coercion that v1 does not perform.
 */

import type { BackendError, Cursor, DocumentId, DocumentStore, ListPage, Result } from "@baas/core";

/**
 * The slice of a `Backend` a migration touches. Typed structurally so any
 * `Backend<S>`, regardless of its named-operation schema, is accepted: `list`,
 * `insert`, and `patch` do not reference the schema generic, so this `Pick`
 * sidesteps generic variance. Pass a whole `Backend`; only `.store` is read.
 */
export type MigrateEndpoint = {
  readonly store: Pick<DocumentStore, "list" | "insert" | "patch">;
};

export interface MigrateOptions {
  /**
   * Collections/tables to copy. Order does not matter for correctness: relations
   * are resolved in a second pass once every collection's id map is complete.
   */
  readonly collections: readonly string[];
  /**
   * Foreign-key remap config: `relations[collection][field] = targetCollection`.
   * Opt-in; omit for a flat copy. v1 remaps a single id-valued FK field (the field
   * holds one document id pointing at `targetCollection`). An FK value with no
   * mapping (dangling or null) is left as the copied value, never silently nulled.
   */
  readonly relations?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Page size for `source.list()`. Default 100; `list()` clamps to [1, 200]. */
  readonly batchSize?: number;
  /**
   * Extra fields to drop before re-inserting, on top of the always-stripped
   * backend system fields (`_id`, `_creationTime`). Use this for an adapter-named
   * primary key or timestamp that `list()` surfaces as a regular column (e.g. a
   * Supabase source's `"id"` / `"created_at"`), which the target re-mints itself.
   */
  readonly stripFields?: readonly string[];
  /** Called after each row is copied or relinked, for progress reporting. */
  readonly onProgress?: (event: MigrateProgress) => void;
}

export interface MigrateProgress {
  readonly phase: "copy" | "relink";
  readonly collection: string;
  /** Rows processed so far in this collection during this phase. */
  readonly done: number;
}

export interface CollectionReport {
  /** Rows freshly inserted into the target. */
  readonly copied: number;
  /** Rows already present on the target (matched by `_migratedFrom`) and skipped. */
  readonly skipped: number;
  /** Foreign-key fields rewritten in the relink pass. */
  readonly relinked: number;
}

export interface MigrateError {
  readonly collection: string;
  readonly phase: "copy" | "relink";
  /** The source document id being processed when the error occurred, if known. */
  readonly oldId?: string;
  readonly error: BackendError;
}

export interface MigrateReport {
  readonly ok: boolean;
  readonly collections: Readonly<Record<string, CollectionReport>>;
  /**
   * `oldId -> newId` per collection. Exposed even when `ok` is false so a failed,
   * partial run is debuggable and the next attempt can be reasoned about (the
   * re-run skips what is already mapped on the target).
   */
  readonly idMap: Readonly<Record<string, ReadonlyMap<string, string>>>;
  /** Set iff `ok` is false: the first error, which aborted the run (fail-fast). */
  readonly error?: MigrateError;
}

/**
 * Stamped on every re-minted row so a re-run is idempotent (resume marker).
 * RESERVED: migrate owns this field. A source value under this name is dropped
 * before insert and replaced with the current run's source id.
 */
const MARKER = "_migratedFrom";
/** Backend system fields never carried across; the target re-mints its own. */
const SYSTEM_FIELDS = ["_id", "_creationTime"] as const;
const DEFAULT_BATCH = 100;

/** Internal fail-fast signal: carries the structured error to the top-level catch. */
class MigrateAbort extends Error {
  constructor(readonly info: MigrateError) {
    super(info.error.message);
    this.name = "MigrateAbort";
  }
}

type Row = Record<string, unknown>;

/** Consume a `Result`, returning its data or aborting the migration fail-fast. */
function unwrap<T>(result: Result<T>, ctx: Omit<MigrateError, "error">): T {
  if (!result.ok) throw new MigrateAbort({ ...ctx, error: result.error });
  return result.data;
}

/**
 * Page a collection to exhaustion, invoking `onPage` with each page's rows.
 * Loops until `nextCursor` is null, and never treats a full page as the last, since
 * a scanning backend can report "more to scan" after the final match.
 */
async function eachPage(
  store: MigrateEndpoint["store"],
  collection: string,
  batchSize: number,
  ctx: Omit<MigrateError, "error">,
  onPage: (rows: readonly Row[]) => Promise<void>,
): Promise<void> {
  let cursor: Cursor | null = null;
  do {
    const page: ListPage<Row> = unwrap(
      await store.list<Row>(collection, { limit: batchSize, cursor }),
      ctx,
    );
    await onPage(page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
}

/**
 * Scan the TARGET collection and index `_migratedFrom -> _id`, so an interrupted
 * run resumes without duplicating. One empty page on a fresh target; on a re-run
 * it pages the whole target collection (cost is O(rows already migrated)).
 */
async function buildResumeIndex(
  store: MigrateEndpoint["store"],
  collection: string,
  batchSize: number,
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  await eachPage(store, collection, batchSize, { collection, phase: "copy" }, async (rows) => {
    for (const row of rows) {
      const from = row[MARKER];
      const id = row._id;
      if (typeof from === "string" && typeof id === "string") index.set(from, id);
    }
  });
  return index;
}

/**
 * One-time data cutover from `source` to `target`. See the module docstring for
 * the contract and its honest limits. Returns a `MigrateReport`; on the first
 * `list`/`insert`/`patch` error it stops and returns `{ ok: false, error, ... }`
 * with the partial id map intact, never throwing on a backend error.
 */
export async function migrate(
  source: MigrateEndpoint,
  target: MigrateEndpoint,
  opts: MigrateOptions,
): Promise<MigrateReport> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  // MARKER is reserved and migrate-owned: drop any value the source carries under
  // it (e.g. stale lineage from a prior migration) so this run stamps fresh.
  const strip = new Set<string>([...SYSTEM_FIELDS, MARKER, ...(opts.stripFields ?? [])]);
  const idMap: Record<string, Map<string, string>> = {};
  const collections: Record<string, CollectionReport> = {};
  // Mutable accumulators kept beside the readonly report shape callers see.
  const counts: Record<string, { copied: number; skipped: number; relinked: number }> = {};

  try {
    // Pass 1: copy every collection, building each `oldId -> newId` map.
    for (const collection of opts.collections) {
      const map = new Map<string, string>();
      const count = { copied: 0, skipped: 0, relinked: 0 };
      idMap[collection] = map;
      counts[collection] = count;
      collections[collection] = count;

      const resume = await buildResumeIndex(target.store, collection, batchSize);
      let done = 0;
      await eachPage(
        source.store,
        collection,
        batchSize,
        { collection, phase: "copy" },
        async (rows) => {
          for (const row of rows) {
            // Every listed item must carry a portable scalar `_id` (the core
            // contract). Fail fast on a misbehaving source rather than letting a
            // missing id collapse to the string "undefined" and silently corrupt
            // the idMap (every such row would overwrite the same key).
            const rawId = row._id;
            if (typeof rawId !== "string" && typeof rawId !== "number") {
              throw new MigrateAbort({
                collection,
                phase: "copy",
                error: {
                  code: "validation",
                  message: `row in "${collection}" has no usable _id; every listed item must carry a portable _id`,
                },
              });
            }
            const oldId = String(rawId);
            const existing = resume.get(oldId);
            if (existing !== undefined) {
              map.set(oldId, existing);
              count.skipped++;
            } else {
              const payload: Row = {};
              for (const [key, value] of Object.entries(row)) {
                if (!strip.has(key)) payload[key] = value;
              }
              payload[MARKER] = oldId;
              const newId = unwrap(await target.store.insert(collection, payload), {
                collection,
                phase: "copy",
                oldId,
              });
              map.set(oldId, String(newId));
              count.copied++;
            }
            done++;
            opts.onProgress?.({ phase: "copy", collection, done });
          }
        },
      );
    }

    // Pass 2: relink foreign keys, now that every id map is complete.
    if (opts.relations) {
      for (const [collection, fields] of Object.entries(opts.relations)) {
        const map = idMap[collection];
        const count = counts[collection];
        if (!map || !count) continue; // relation on a collection not in `collections`
        let done = 0;
        await eachPage(
          source.store,
          collection,
          batchSize,
          { collection, phase: "relink" },
          async (rows) => {
            for (const row of rows) {
              const newId = map.get(String(row._id));
              if (newId === undefined) continue;
              const patch: Row = {};
              for (const [field, targetCollection] of Object.entries(fields)) {
                const oldFk = row[field];
                // FKs are scalar ids; a non-scalar (object/array/null) is not a
                // remappable reference, so leave it as the copied value.
                if (typeof oldFk !== "string" && typeof oldFk !== "number") continue;
                const mapped = idMap[targetCollection]?.get(String(oldFk));
                if (mapped !== undefined) patch[field] = mapped;
              }
              const rewritten = Object.keys(patch).length;
              if (rewritten > 0) {
                unwrap(await target.store.patch(collection, newId as DocumentId, patch), {
                  collection,
                  phase: "relink",
                  oldId: String(row._id),
                });
                count.relinked += rewritten;
              }
              done++;
              opts.onProgress?.({ phase: "relink", collection, done });
            }
          },
        );
      }
    }

    return { ok: true, collections, idMap };
  } catch (e) {
    if (e instanceof MigrateAbort) return { ok: false, error: e.info, collections, idMap };
    throw e;
  }
}
