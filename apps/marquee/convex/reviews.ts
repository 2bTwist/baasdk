/**
 * Phase 3: the Convex half of own-only review security. These deployed mutations
 * enforce policy with `ctx.auth.getUserIdentity()` (the verified shared-issuer
 * subject); a throw rolls back the transaction. The actor's identity is NEVER
 * taken from args, only from the verified session, so a client cannot act as
 * someone else. `movieRating` is the avg/count aggregation deferred from Phase 2
 * (a scan, the `aggregations: false` cost).
 *
 * The Supabase half is the same contract enforced by RLS (see src/lib/reviews.ts).
 */
import {
  type GenericDataModel,
  type GenericId,
  type GenericMutationCtx,
  mutationGeneric,
  type QueryCtx,
  queryGeneric,
} from "convex/server";
import { ConvexError, v } from "convex/values";

interface ReviewDoc {
  readonly _id: GenericId<string>;
  readonly movieId: string;
  readonly userId: string;
  readonly rating: number;
  readonly body: string;
}

/** The verified caller subject, or a deterministic `unauthorized` if signed out. */
async function requireSubject(
  ctx: GenericMutationCtx<GenericDataModel> | QueryCtx<GenericDataModel>,
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "unauthorized", message: "sign in required" });
  return identity.subject;
}

/** Fetch a review by opaque id, treating a foreign/malformed id as absent (not a throw). */
async function getReview(
  ctx: GenericMutationCtx<GenericDataModel>,
  id: string,
): Promise<ReviewDoc | null> {
  try {
    return (await ctx.db.get("reviews", id as GenericId<string>)) as ReviewDoc | null;
  } catch {
    return null;
  }
}

function assertRating(rating: number): void {
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new ConvexError({ code: "validation", message: "rating must be 1-5" });
  }
}

export const addReview = mutationGeneric({
  args: { movieId: v.string(), rating: v.number(), body: v.string() },
  handler: async (ctx, { movieId, rating, body }) => {
    const userId = await requireSubject(ctx);
    assertRating(rating);
    // One review per user per movie: an add on an existing pair updates it.
    const existing = (
      await ctx.db
        .query("reviews")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect()
    ).find((r) => (r as ReviewDoc).movieId === movieId) as ReviewDoc | undefined;
    if (existing) {
      await ctx.db.patch("reviews", existing._id, { rating, body });
      return { id: existing._id as string };
    }
    const id = await ctx.db.insert("reviews", { movieId, userId, rating, body });
    return { id: id as string };
  },
});

export const editReview = mutationGeneric({
  args: { reviewId: v.string(), rating: v.number(), body: v.string() },
  handler: async (ctx, { reviewId, rating, body }) => {
    const userId = await requireSubject(ctx);
    assertRating(rating);
    const review = await getReview(ctx, reviewId);
    if (!review) throw new ConvexError({ code: "not_found", message: "review not found" });
    if (review.userId !== userId) {
      throw new ConvexError({ code: "unauthorized", message: "not your review" });
    }
    await ctx.db.patch("reviews", reviewId as GenericId<string>, { rating, body });
    return null;
  },
});

export const deleteReview = mutationGeneric({
  args: { reviewId: v.string() },
  handler: async (ctx, { reviewId }) => {
    const userId = await requireSubject(ctx);
    const review = await getReview(ctx, reviewId);
    // Idempotent on an already-absent review, but a present-and-foreign review is
    // an explicit unauthorized (never a silent success on someone else's row).
    if (!review) return null;
    if (review.userId !== userId) {
      throw new ConvexError({ code: "unauthorized", message: "not your review" });
    }
    await ctx.db.delete("reviews", reviewId as GenericId<string>);
    return null;
  },
});

export const movieRating = queryGeneric({
  args: { movieId: v.string() },
  handler: async (ctx, { movieId }) => {
    const reviews = (await ctx.db
      .query("reviews")
      .withIndex("by_movieId", (q) => q.eq("movieId", movieId))
      .collect()) as ReviewDoc[];
    const count = reviews.length;
    const avg = count === 0 ? 0 : reviews.reduce((s, r) => s + r.rating, 0) / count;
    return { avg, count };
  },
});
