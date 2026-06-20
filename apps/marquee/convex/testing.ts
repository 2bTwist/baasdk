/**
 * Test-only state reset for the data-layer integration suite, mirroring the
 * adapter conformance fixture's reset. Lives in the app's convex/ dir (this is a
 * private dev app, never published), and is the Convex equivalent of truncating
 * the Supabase tables before a run.
 */
import { type GenericDataModel, type GenericMutationCtx, mutationGeneric } from "convex/server";
import { type GenericId, v } from "convex/values";

export const reset = mutationGeneric({
  args: { tables: v.array(v.string()) },
  handler: async (ctx: GenericMutationCtx<GenericDataModel>, { tables }: { tables: string[] }) => {
    for (const table of tables) {
      for (const doc of await ctx.db.query(table).collect()) {
        await ctx.db.delete(table, doc._id as GenericId<string>);
      }
    }
  },
});
