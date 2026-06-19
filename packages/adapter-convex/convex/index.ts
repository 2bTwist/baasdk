/**
 * `@baas/adapter-convex/convex`, the DEPLOYABLE server helpers.
 *
 * These run as the CONSUMING APP's own Convex functions, NOT as a Convex
 * Component. A Component is sandboxed and cannot read the host app's tables, so
 * it is the wrong vehicle for generic CRUD over those tables (see the build plan
 * §7.1). Instead the app adds one file:
 *
 *   // convex/baas.ts
 *   export * from "@baas/adapter-convex/convex";
 *
 * `npx convex dev` then deploys these with full app-table access, callable from
 * the client as `anyApi.baas.insert`, etc. The client-side adapter dispatches to
 * them to implement the core DocumentStore CRUD primitives, the FileStore, and
 * the AuthProvider identity lookup.
 *
 * Built on the GENERIC builders (`queryGeneric`/`mutationGeneric` from
 * `convex/server`) so they depend on no `_generated` codegen and ship from npm.
 * In schemaless mode the data model is `AnyDataModel`, so dynamic table names
 * typecheck without casts; an opaque document id is the one place a cast is
 * unavoidable, a `v.string()` arg is a plain `string`, but `ctx.db` wants a
 * branded `GenericId`.
 */

import {
  type FilterBuilder,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericTableInfo,
  mutationGeneric,
  paginationOptsValidator,
  queryGeneric,
} from "convex/server";
import { ConvexError, type GenericId, v } from "convex/values";

/**
 * Whether an opaque id resolves to a live doc. A non-matching id (foreign table
 * or malformed) makes `ctx.db.get` throw; treat that as absent so callers get a
 * deterministic boolean instead of an exception.
 */
async function exists(
  ctx: GenericMutationCtx<GenericDataModel>,
  collection: string,
  id: string,
): Promise<boolean> {
  try {
    return (await ctx.db.get(collection, id as GenericId<string>)) !== null;
  } catch {
    return false;
  }
}

/**
 * Convex auto-manages `_id` and `_creationTime`; the db rejects them as input on
 * insert and patch. Strip them so a doc that was fetched and is written back
 * round-trips cleanly. (`_id`/`_creationTime` are unused by design, the `^_`
 * lint convention marks that.)
 */
function stripSystemFields(value: Record<string, unknown>): Record<string, unknown> {
  const { _id, _creationTime, ...rest } = value;
  return rest;
}

// ---------------------------------------------------------------------------
// Direct CRUD, the table-name-FIRST `ctx.db` API (convex v1.31+). The spike's
// single-arg form (`ctx.db.get(id)`) is the deprecated shape.
// ---------------------------------------------------------------------------

export const insert = mutationGeneric({
  args: { collection: v.string(), value: v.any() },
  handler: async (ctx, { collection, value }) =>
    await ctx.db.insert(collection, stripSystemFields(value)),
});

export const get = queryGeneric({
  args: { collection: v.string(), id: v.string() },
  handler: async (ctx, { collection, id }) => {
    try {
      return await ctx.db.get(collection, id as GenericId<string>);
    } catch {
      // `ctx.db.get` throws when the id belongs to a DIFFERENT table (or is
      // malformed); a removed same-table id already returns null. The portable
      // contract is "a misused opaque id is absent (null), never a throw," so
      // collapse it. NOTE this is intentionally MORE lenient than the SQL adapter
      // (whose `get` would surface a malformed-id DB error); the divergence is
      // deliberate and the catch is scoped to this single `ctx.db.get` call.
      return null;
    }
  },
});

type ConvexScalar = string | number | boolean | null;

/** Translate one portable filter condition onto a Convex filter expression. */
const applyConvexOp = (
  b: FilterBuilder<GenericTableInfo>,
  field: string,
  op: string,
  value: ConvexScalar | ReadonlyArray<ConvexScalar>,
) => {
  if (op === "in") {
    // Convex has no native `in`; expand to an OR of equalities. null is dropped
    // (use eq/null) to match SQL `IN` and the other adapters. An empty set matches
    // nothing (field < field is always false).
    const arr = (Array.isArray(value) ? (value as ReadonlyArray<ConvexScalar>) : []).filter(
      (x) => x !== null,
    );
    return arr.length > 0
      ? b.or(...arr.map((x) => b.eq(b.field(field), x)))
      : b.lt(b.field(field), b.field(field));
  }
  const f = b.field(field);
  const v = value as ConvexScalar;
  switch (op) {
    case "neq":
      return b.neq(f, v);
    case "gt":
      return b.gt(f, v);
    case "gte":
      return b.gte(f, v);
    case "lt":
      return b.lt(f, v);
    case "lte":
      return b.lte(f, v);
    default:
      return b.eq(f, v); // "eq"
  }
};

const SCALAR = v.union(v.string(), v.float64(), v.boolean(), v.null());

/**
 * Portable `list`: filtered, cursor-paginated, ordered by creation (`_creationTime`)
 * or by a field. Field ordering uses a `by_<field>` index; a missing index is a
 * capability gap surfaced as `unsupported_capability` (Supabase/memory order by any
 * field directly). Convex docs already carry `_id`. With no `paginationOpts` it
 * collects all. `.filter()` scans without an index; see `efficientFilterRequiresIndex`.
 */
export const list = queryGeneric({
  args: {
    collection: v.string(),
    where: v.optional(
      v.array(
        v.object({ field: v.string(), op: v.string(), value: v.union(SCALAR, v.array(SCALAR)) }),
      ),
    ),
    order: v.optional(v.object({ field: v.union(v.string(), v.null()), dir: v.string() })),
    paginationOpts: v.optional(paginationOptsValidator),
  },
  handler: async (ctx, { collection, where, order, paginationOpts }) => {
    const dir = order?.dir === "desc" ? "desc" : "asc";
    const field = order?.field ?? null;
    const buildOrdered = () => {
      const q = field
        ? ctx.db.query(collection).withIndex(`by_${field}`)
        : ctx.db.query(collection);
      const filtered =
        where && where.length > 0
          ? q.filter((b) => b.and(...where.map((c) => applyConvexOp(b, c.field, c.op, c.value))))
          : q;
      return filtered.order(dir);
    };
    try {
      const ordered = buildOrdered();
      return paginationOpts ? await ordered.paginate(paginationOpts) : await ordered.collect();
    } catch (e) {
      // A missing by_<field> index throws at execution; map ONLY index-related
      // errors so an unrelated failure in a field-ordered query keeps its real
      // error instead of being mislabeled as a missing index.
      if (field && /index/i.test(String(e instanceof Error ? e.message : e))) {
        throw new ConvexError({
          code: "unsupported_capability",
          message: `list order by "${field}" requires a by_${field} index on "${collection}"`,
        });
      }
      throw e;
    }
  },
});

export const patch = mutationGeneric({
  args: { collection: v.string(), id: v.string(), value: v.any() },
  handler: async (ctx, { collection, id, value }) => {
    // patch() requires an existing target. Probe first so a missing id is a
    // DETERMINISTIC not_found, carried in `ConvexError.data`, the channel that
    // survives Convex's production error scrubbing (a plain throw is hidden from
    // the client). Bare `ctx.db.patch` would throw an opaque, scrubbed error.
    if (!(await exists(ctx, collection, id))) {
      throw new ConvexError({ code: "not_found" });
    }
    // Shallow merge, maps to the port's `Partial<T>`. NEVER `replace` (full overwrite).
    await ctx.db.patch(collection, id as GenericId<string>, stripSystemFields(value));
  },
});

export const remove = mutationGeneric({
  args: { collection: v.string(), id: v.string() },
  handler: async (ctx, { collection, id }) => {
    // Idempotent: deleting a missing id is a no-op, not a throw (bare
    // `ctx.db.delete` throws "Delete on non-existent doc"). Probe first so a
    // genuine delete failure on an EXISTING doc still propagates.
    if (await exists(ctx, collection, id)) {
      await ctx.db.delete(collection, id as GenericId<string>);
    }
  },
});

// ---------------------------------------------------------------------------
// Auth, vanilla Convex only VERIFIES an external JWT; there is no client method
// returning the parsed identity, so the adapter reads it through this query.
// ---------------------------------------------------------------------------

export const whoami = queryGeneric({
  args: {},
  handler: async (ctx) => await ctx.auth.getUserIdentity(),
});

// ---------------------------------------------------------------------------
// File storage, server-side, so the upload/url/delete steps are deployed too.
// ---------------------------------------------------------------------------

export const generateUploadUrl = mutationGeneric({
  args: {},
  // Short-lived; the client must POST the file immediately after.
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const getFileUrl = queryGeneric({
  args: { storageId: v.id("_storage") },
  // Returns null once the file is deleted (a stable URL that then 404s, not a
  // custom-expiry signed URL, the adapter declares that divergence).
  handler: async (ctx, { storageId }) => await ctx.storage.getUrl(storageId),
});

export const deleteFile = mutationGeneric({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    await ctx.storage.delete(storageId);
  },
});

// NOTE: there is deliberately NO published reset/truncate helper. A destructive
// "delete every row" mutation must never ship in the app-facing surface (a
// consumer's `export *` would expose it). The conformance fixture defines its
// own reset in the TEST app (test/convex/), never here.
