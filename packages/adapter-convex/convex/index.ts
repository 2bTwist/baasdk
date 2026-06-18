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

import { mutationGeneric, queryGeneric } from "convex/server";
import { type GenericId, v } from "convex/values";

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
  handler: async (ctx, { collection, id }) => await ctx.db.get(collection, id as GenericId<string>),
});

export const list = queryGeneric({
  args: { collection: v.string() },
  handler: async (ctx, { collection }) => await ctx.db.query(collection).collect(),
});

export const patch = mutationGeneric({
  args: { collection: v.string(), id: v.string(), value: v.any() },
  handler: async (ctx, { collection, id, value }) => {
    // Shallow merge, maps to the port's `Partial<T>`. NEVER `replace` (full overwrite).
    await ctx.db.patch(collection, id as GenericId<string>, stripSystemFields(value));
  },
});

export const remove = mutationGeneric({
  args: { collection: v.string(), id: v.string() },
  handler: async (ctx, { collection, id }) => {
    await ctx.db.delete(collection, id as GenericId<string>);
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
