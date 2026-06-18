/**
 * Real named operations, used to test the CLIENT-side mapping end-to-end:
 *  - dynamic dispatch by string (via `anyApi.todos.listTodos`)
 *  - reactivity (`onUpdate` should fire again after `addTodo`)
 *
 * These map to the core's `store.run` / `store.subscribe` / `store.mutate`.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listTodos = query({
  args: {},
  handler: async (ctx) => ctx.db.query("todos").collect(),
});

export const addTodo = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => ctx.db.insert("todos", { title, done: false }),
});
