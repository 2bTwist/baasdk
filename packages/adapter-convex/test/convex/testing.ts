/**
 * Test-only state reset, the Convex equivalent of the Supabase fixture's
 * truncate-on-construct. Deliberately NOT part of the published `./convex`
 * surface (a destructive "delete every row" mutation must never ship to apps);
 * it lives in the TEST app and the fixture calls it before each construction.
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
