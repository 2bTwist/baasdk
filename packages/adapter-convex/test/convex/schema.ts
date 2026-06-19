/**
 * Test-app schema. Defines the conformance `items` table with indexes so the
 * `list` custom-field-ordering tests can `withIndex("by_n")` / `by_tag`.
 *
 * `schemaValidation: false` keeps the rest of the app SCHEMALESS: the generic
 * CRUD helpers operate on dynamic table names (todos, notes) that are NOT declared
 * here, which is only allowed when schema validation is off.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema(
  {
    items: defineTable({
      n: v.number(),
      tag: v.string(),
      nilable: v.union(v.string(), v.null()),
      flag: v.boolean(),
    })
      .index("by_n", ["n"])
      .index("by_tag", ["tag"]),
  },
  { schemaValidation: false },
);
