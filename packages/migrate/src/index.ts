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
 *    every re-minted row is stamped with `migratedFrom: <oldId>`, so a re-run
 *    skips what already landed (mirrors `@get-convex/migrations`).
 *  - NOT a schema/DDL tool. It copies DATA into collections that already exist on
 *    the target; create the target's tables/columns first. A STRICT-SCHEMA target
 *    (Postgres/Supabase) additionally needs a nullable `migratedFrom` text column
 *    on every migrated table — the resume marker is stamped on each row and read
 *    back to resume, and it is NOT part of the source schema, so it is easy to
 *    miss. A schemaless target (Convex) accepts the field with no setup. Without
 *    it, the first insert fails ("Could not find the 'migratedFrom' column …").
 *  - The two-pass copy inserts each row's foreign keys with the SOURCE id first,
 *    then rewrites them to the target's id in the relink pass. So on a strict
 *    relational target the FK columns must be PERMISSIVE during the copy — a plain
 *    `text` column with NO foreign-key constraint. A `uuid`-typed or FK-constrained
 *    column rejects the transient source id before relink can fix it ("invalid
 *    input syntax for type uuid", or a constraint violation). A schemaless target
 *    (Convex) has neither problem. Both limits are inherent to copy-then-relink and
 *    were surfaced by the Marquee dogfood's reverse Convex->Supabase cutover.
 *    NOTE the resulting tension on Postgres: a FK constraint is exactly what
 *    PostgREST needs to resolve a server-side embedded join (the `serverSideJoins`
 *    capability), yet it is what blocks the same table from being a migration
 *    TARGET. A schema tuned for native joins is not automatically a clean migration
 *    target; reconcile per table (e.g. a permissive join table vs a constrained
 *    one), or migrate INTO the schemaless backend, which the forward direction does.
 *
 * IDs change by design (the target re-mints its own), so external references that
 * embed an old primary key must be remapped by the caller. Values are copied
 * verbatim; non-trivial schemas with type/precision drift (Postgres numeric vs JS
 * number, timestamps) need per-field coercion that v1 does not perform.
 *
 * Preconditions (see the README for the full version): a Supabase target needs a
 * service-role key (or RLS policies granting read + write), because a read denied
 * by RLS returns empty rather than erroring and would silently break resume.
 * migrate guards this portably with a read-after-write check on the first row it
 * copies into each collection: if the row cannot be read back, it aborts with a
 * `validation` error rather than risking duplicates on a later re-run.
 *
 * `dryRunMigrate()` projects a cutover WITHOUT writing: it reports per-collection
 * how many rows would be copied vs skipped and the first validation/size issue a
 * real run would abort on, so a caller can sanity-check before committing.
 */

import type { BackendError, Cursor, DocumentId, DocumentStore, ListPage, Result } from "@baas/core";

/**
 * The slice of a `Backend` a migration touches. Typed structurally so any
 * `Backend<S>`, regardless of its named-operation schema, is accepted: `list`,
 * `insert`, `patch`, and `get` do not reference the schema generic, so this
 * `Pick` sidesteps generic variance. Pass a whole `Backend`; only `.store` is
 * read. (`get` is used by the read-after-write precondition check below.)
 */
export type MigrateEndpoint = {
  readonly store: Pick<DocumentStore, "list" | "insert" | "patch" | "get">;
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
   * Reject any row whose copied payload serializes to more than this many UTF-8
   * bytes, BEFORE inserting it, with a `validation` error that names the row and
   * its size. Opt-in (off by default, so the abstraction bakes in no backend's
   * limit). Set it when the target enforces a per-document/per-value size cap and
   * you want a clear, early failure instead of a provider-specific error
   * mid-insert: a **Convex** target caps a single value at ~1 MiB and a single
   * mutation at 16 MiB, so `maxValueBytes: 1_000_000` is a sensible bound there.
   * Size is measured portably (UTF-8 length of `JSON.stringify(payload)`), a
   * conservative proxy for the encoded document size.
   */
  readonly maxValueBytes?: number;
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
  /** Rows already present on the target (matched by `migratedFrom`) and skipped. */
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
 *
 * Deliberately has NO leading underscore: Convex rejects any user field starting
 * with `_` ("only allowed for system fields like `_id`"), so an underscore marker
 * would make Convex unusable as a migration target. A plain name is portable
 * across Convex, Supabase, and the in-memory adapter.
 */
const MARKER = "migratedFrom";
/** Backend system fields never carried across; the target re-mints its own. */
const SYSTEM_FIELDS = ["_id", "_creationTime"] as const;
const DEFAULT_BATCH = 100;

/**
 * UTF-8 byte length of a value's JSON encoding, or `null` if the value cannot be
 * serialized to measure. Used by the opt-in `maxValueBytes` guard as a portable,
 * conservative proxy for the encoded document size. `TextEncoder` works in both
 * Node and the browser (the demo runs migrate in the browser), unlike `Buffer`.
 *
 * `JSON.stringify` throws on a `bigint`, but a `bigint` is a legitimate value (a
 * Convex `int64`), so measure it as its decimal string rather than rejecting it:
 * a conservative over-estimate that never throws. A value that STILL cannot
 * serialize (a circular reference) returns `null`, and the caller skips the size
 * check for that row rather than crashing or rejecting a possibly-valid value —
 * such a value would be caught by the backend's own insert error if unstorable.
 */
const ENCODER = new TextEncoder();
function byteLength(value: unknown): number | null {
  try {
    const json = JSON.stringify(value, (_k: string, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    return ENCODER.encode(json).length;
  } catch {
    return null;
  }
}

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
 * The portable scalar `_id` every listed row must carry (the core contract), as a
 * string, or a fail-fast `validation` abort. Shared by the real copy and the dry
 * run so the projected outcome can never drift from what the real run validates.
 */
function requireOldId(row: Row, collection: string): string {
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
  return String(rawId);
}

/**
 * Build the target payload for a row: strip system/reserved/opted-out fields,
 * stamp the lineage marker, and (if `maxValueBytes` is set) fail-fast on an
 * oversized payload. Shared by the real copy and the dry run, so a plan's
 * size/shape validation is exactly what the real insert would face.
 */
function buildCheckedPayload(
  row: Row,
  oldId: string,
  collection: string,
  strip: ReadonlySet<string>,
  maxValueBytes: number | undefined,
): Row {
  const payload: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (!strip.has(key)) payload[key] = value;
  }
  payload[MARKER] = oldId;
  // Byte-bound guard (opt-in): reject an oversized payload up front with an
  // actionable error, rather than letting a size-capped target (Convex: ~1
  // MiB/value, 16 MiB/mutation) reject it mid-insert with a provider-specific
  // message. Portable: the size is the UTF-8 length of the JSON encoding.
  if (maxValueBytes !== undefined) {
    const bytes = byteLength(payload);
    if (bytes !== null && bytes > maxValueBytes) {
      throw new MigrateAbort({
        collection,
        phase: "copy",
        oldId,
        error: {
          code: "validation",
          message: `row "${oldId}" in "${collection}" serializes to ${bytes} bytes, over the configured maxValueBytes (${maxValueBytes}); shrink or split the value before migrating (a Convex target caps a single value at ~1 MiB and a mutation at 16 MiB)`,
        },
      });
    }
  }
  return payload;
}

/** The fields stripped from every row, given the caller's `stripFields`. */
const stripSet = (stripFields: readonly string[] | undefined): ReadonlySet<string> =>
  new Set<string>([...SYSTEM_FIELDS, MARKER, ...(stripFields ?? [])]);

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
 * Scan the TARGET collection and index `migratedFrom -> _id`, so an interrupted
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
  const maxValueBytes = opts.maxValueBytes;
  // MARKER is reserved and migrate-owned: drop any value the source carries under
  // it (e.g. stale lineage from a prior migration) so this run stamps fresh.
  const strip = stripSet(opts.stripFields);
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
      // Read-after-write precondition SENTINEL: checked once per collection on the
      // first freshly-copied row (not every row — that would double the read cost).
      // If that row inserts ok but cannot be read back, the target is silently
      // filtering reads (the canonical case: a Supabase target reached with a
      // non-service-role key, where RLS permits the insert but denies the select).
      // That breaks resume catastrophically: `buildResumeIndex` would see an empty
      // target on the NEXT run and re-copy everything, so abort loudly NOW with an
      // actionable error rather than duplicating later. One healthy row is a strong
      // signal the target is readable; it is a precondition probe, not a per-row
      // guarantee. migrate stays provider-agnostic: it never names RLS at the port,
      // it only asserts the portable invariant "what I just wrote, I can read back".
      let readBackChecked = false;
      await eachPage(
        source.store,
        collection,
        batchSize,
        { collection, phase: "copy" },
        async (rows) => {
          for (const row of rows) {
            const oldId = requireOldId(row, collection);
            const existing = resume.get(oldId);
            if (existing !== undefined) {
              map.set(oldId, existing);
              count.skipped++;
            } else {
              const payload = buildCheckedPayload(row, oldId, collection, strip, maxValueBytes);
              const newId = unwrap(await target.store.insert(collection, payload), {
                collection,
                phase: "copy",
                oldId,
              });
              map.set(oldId, String(newId));
              count.copied++;
              if (!readBackChecked) {
                readBackChecked = true;
                const wrote = unwrap(await target.store.get(collection, newId), {
                  collection,
                  phase: "copy",
                  oldId,
                });
                if (wrote === null) {
                  throw new MigrateAbort({
                    collection,
                    phase: "copy",
                    oldId,
                    error: {
                      code: "validation",
                      message: `inserted a row into "${collection}" but could not read it back; the target is filtering reads (e.g. a Supabase target reached without a service-role key, where RLS allows the insert but denies the select). Resume and idempotency require read access — use a service-role key or grant the migrating role read access on the target tables`,
                    },
                  });
                }
              }
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

export interface MigratePlanCollection {
  /** Source rows scanned in this collection. */
  readonly total: number;
  /** Rows that would be inserted (not already on the target). */
  readonly toCopy: number;
  /** Rows already on the target (matched by `migratedFrom`) that would be skipped. */
  readonly toSkip: number;
}

export interface MigratePlan {
  /** False iff the run WOULD abort: `error` is the first issue it would hit. */
  readonly ok: boolean;
  readonly collections: Readonly<Record<string, MigratePlanCollection>>;
  /**
   * Set iff `ok` is false: the first `validation` issue (a row with no usable
   * `_id`, or a payload over `maxValueBytes`) that would fail-fast the real run,
   * using the SAME checks the real copy runs.
   */
  readonly error?: MigrateError;
}

/**
 * Project a migration WITHOUT writing anything: read the source and the target's
 * resume index and report, per collection, how many rows would be copied vs
 * skipped, plus the first validation/size issue a real run would abort on. Use it
 * to sanity-check a cutover before committing (counts look right? any oversized or
 * malformed row?). Reads only — the target is never mutated.
 *
 * Limits, stated honestly: a dry run CANNOT project the relink pass (it depends on
 * ids the target mints during the real copy) and CANNOT exercise the
 * read-after-write precondition (nothing is inserted, so a read-filtered target is
 * only caught by the real run's first insert). It validates `_id`s, size bounds,
 * and that both source and target are listable.
 */
export async function dryRunMigrate(
  source: MigrateEndpoint,
  target: MigrateEndpoint,
  opts: MigrateOptions,
): Promise<MigratePlan> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH;
  const maxValueBytes = opts.maxValueBytes;
  const strip = stripSet(opts.stripFields);
  const collections: Record<string, { total: number; toCopy: number; toSkip: number }> = {};

  try {
    for (const collection of opts.collections) {
      const counts = { total: 0, toCopy: 0, toSkip: 0 };
      collections[collection] = counts;
      const resume = await buildResumeIndex(target.store, collection, batchSize);
      await eachPage(
        source.store,
        collection,
        batchSize,
        { collection, phase: "copy" },
        async (rows) => {
          for (const row of rows) {
            counts.total++;
            const oldId = requireOldId(row, collection);
            if (resume.get(oldId) !== undefined) {
              counts.toSkip++;
            } else {
              // Run the same shape/size validation the real copy would, then
              // discard the payload — nothing is written in a dry run.
              buildCheckedPayload(row, oldId, collection, strip, maxValueBytes);
              counts.toCopy++;
            }
          }
        },
      );
    }
    return { ok: true, collections };
  } catch (e) {
    if (e instanceof MigrateAbort) return { ok: false, collections, error: e.info };
    throw e;
  }
}
