/**
 * Phase 2: Marquee's app-specific NAMED queries, the Convex side of the
 * join + aggregation story. The core port keeps joins/aggregation out of the
 * portable surface on purpose; you reach them through named operations with a
 * per-backend implementation. This file is that implementation for Convex:
 *
 *  - `movieCredits` FOLLOWS REFS by hand (credits by_movieId index, then a
 *    point-get per person), because Convex declares `serverSideJoins: false`.
 *  - `genreCounts` SCANS the movies table and tallies, because Convex declares
 *    `aggregations: false`. At Phase 1/2 seed sizes this is fine; at Phase 5
 *    scale the scan is exactly the divergence the capability flag warns about.
 *
 * The Supabase implementation of the same two named queries is a real
 * server-side PostgREST embed + a SQL view (see src/lib/backend.ts). Both return
 * the identical shape, so the app's `store.run(...)` calls are portable.
 *
 * Generic builders (no _generated dependency), matching the adapter's helpers.
 */
import { type GenericId, queryGeneric } from "convex/server";
import { v } from "convex/values";

interface PersonDoc {
  readonly name: string;
}

/** Ordered cast/crew for a movie, resolved by following credit refs to people. */
export const movieCredits = queryGeneric({
  args: { movieId: v.string() },
  handler: async (ctx, { movieId }) => {
    const credits = await ctx.db
      .query("credits")
      .withIndex("by_movieId", (q) => q.eq("movieId", movieId))
      .collect();
    // Sort by billing client-side (small per-movie set); director(s) first via billing.
    credits.sort((a, b) => (a.billing as number) - (b.billing as number));
    const out: Array<{ name: string; role: string; character: string; billing: number }> = [];
    for (const c of credits) {
      const person = (await ctx.db.get(
        "people",
        c.personId as GenericId<string>,
      )) as PersonDoc | null;
      out.push({
        name: person?.name ?? "Unknown",
        role: c.role as string,
        character: c.character as string,
        billing: c.billing as number,
      });
    }
    return out;
  },
});

/** Movie count per primary-genre slug, computed by scanning movies (no index aggregate). */
export const genreCounts = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const counts = new Map<string, number>();
    for (const m of await ctx.db.query("movies").collect()) {
      const slug = m.primaryGenre as string;
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return [...counts.entries()].map(([slug, count]) => ({ slug, count }));
  },
});
