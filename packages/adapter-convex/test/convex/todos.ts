/**
 * The test app's named operations, the Convex equivalent of the Supabase
 * fixture's `queries`/`mutations`. They return the canonical `ConformanceSchema`
 * `Todo` shape (`{ _id, title, done }`) so `store.run`/`store.mutate` map 1:1.
 *
 * `toggleTodo` (missing id) and `addThenFail` throw `ConvexError({ code })` so the
 * adapter maps them deterministically; `addThenFail` inserts THEN throws to probe
 * transaction rollback (a Convex mutation is a transaction).
 */

import { mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, type GenericId, v } from "convex/values";

export const listTodos = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("todos").collect();
    return docs.map((d) => ({ _id: d._id, title: d.title, done: d.done }));
  },
});

export const getTodo = queryGeneric({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const d = await ctx.db.get("todos", id as GenericId<"todos">);
    return d ? { _id: d._id, title: d.title, done: d.done } : null;
  },
});

export const addTodo = mutationGeneric({
  args: { title: v.string() },
  handler: async (ctx, { title }) => await ctx.db.insert("todos", { title, done: false }),
});

export const toggleTodo = mutationGeneric({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const d = await ctx.db.get("todos", id as GenericId<"todos">);
    if (!d) throw new ConvexError({ code: "not_found" });
    await ctx.db.patch("todos", id as GenericId<"todos">, { done: !d.done });
  },
});

export const addThenFail = mutationGeneric({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    await ctx.db.insert("todos", { title, done: false });
    // Throw AFTER inserting: on a transactional backend the insert rolls back.
    throw new ConvexError({ code: "unknown" });
  },
});
