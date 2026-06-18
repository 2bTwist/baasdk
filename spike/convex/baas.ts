/**
 * The generic, schemaless CRUD helpers — the load-bearing experiment for
 * `@baas/adapter-convex`.
 *
 * The core port exposes `store.insert(collection, value)` etc. Convex has no
 * client-side `ctx.db`, so the adapter must deploy server functions like these
 * and call them from the client. The question this spike answers:
 *
 *   Does `ctx.db.insert(<runtime-variable string>, doc)` work with NO schema.ts?
 *
 * If yes, the adapter's direct-CRUD primitives are implementable generically
 * (one deployed helper set per app, any number of collections). If no, the
 * adapter would need per-collection codegen — materially heavier.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// `collection` / `id` are dynamic strings. In schemaless mode the data model is
// `AnyDataModel`, whose table names are `string`, so these typecheck; the `as`
// casts only document intent. The runtime behavior is what we're testing.

export const insert = mutation({
  args: { collection: v.string(), value: v.any() },
  handler: async (ctx, { collection, value }) => {
    // biome-ignore lint/suspicious/noExplicitAny: schemaless dynamic table name
    return await ctx.db.insert(collection as any, value);
  },
});

export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    // A Convex Id encodes its table, so `get` needs only the id; the port's
    // `collection` arg is redundant here (a noted divergence, not a blocker).
    // biome-ignore lint/suspicious/noExplicitAny: opaque id cast
    return await ctx.db.get(id as any);
  },
});

export const list = query({
  args: { collection: v.string() },
  handler: async (ctx, { collection }) => {
    // biome-ignore lint/suspicious/noExplicitAny: schemaless dynamic table name
    return await ctx.db.query(collection as any).collect();
  },
});

export const patch = mutation({
  args: { id: v.string(), value: v.any() },
  handler: async (ctx, { id, value }) => {
    // biome-ignore lint/suspicious/noExplicitAny: opaque id cast
    await ctx.db.patch(id as any, value);
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    // biome-ignore lint/suspicious/noExplicitAny: opaque id cast
    await ctx.db.delete(id as any);
  },
});
