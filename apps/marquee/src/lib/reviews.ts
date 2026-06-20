import type { MemoryContext } from "@baas/adapter-memory";
import type { Backend, DocumentId } from "@baas/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anyApi, type FunctionReference } from "convex/server";
import type { MarqueeSchema, MovieRating, ReviewRow } from "./schema";

/**
 * Phase 3: the review WRITE path (own-only) + the avg-rating aggregation. Writes
 * are named MUTATIONS, not generic CRUD, because per-row policy is where backends
 * diverge:
 *  - Supabase: thin PostgREST calls on the USER's authed client; Row Level
 *    Security is the final arbiter (a cross-user edit hits 0 rows, surfaced as an
 *    explicit rejection here).
 *  - Convex: deployed mutations (convex/reviews.ts) checking ctx.auth.
 *  - Memory: no auth (open dev sandbox), a single synthetic dev user.
 * The actor identity is taken from the SESSION, never from args.
 */

// A reviews row as listed (reads stay on the portable store; reviews_select is open).
export interface Review {
  readonly movieId: string;
  readonly userId: string;
  readonly rating: number;
  readonly body: string;
}

const MEMORY_USER = "dev"; // memory-mode has no identity; one synthetic user.

// ---------------------------------------------------------------------------
// Supabase: PostgREST under RLS.
// ---------------------------------------------------------------------------

export const supabaseReviewMutations = {
  addReview: async (
    sb: SupabaseClient,
    { movieId, rating, body }: { movieId: string; rating: number; body: string },
  ): Promise<{ id: string }> => {
    const { data: u } = await sb.auth.getUser();
    const userId = u.user?.id;
    if (!userId) throw new Error("sign in required");
    // Upsert keeps one review per (user, movie); RLS still checks userId = auth.uid().
    const { data, error } = await sb
      .from("reviews")
      .upsert({ movieId, userId, rating, body }, { onConflict: "userId,movieId" })
      .select("id")
      .single();
    if (error) throw error;
    return { id: (data as { id: string }).id };
  },
  editReview: async (
    sb: SupabaseClient,
    { reviewId, rating, body }: { reviewId: string; rating: number; body: string },
  ): Promise<null> => {
    // RLS hides rows the caller does not own, so a cross-user edit matches 0 rows.
    const { data, error } = await sb
      .from("reviews")
      .update({ rating, body })
      .eq("id", reviewId)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("not authorized to edit this review");
    return null;
  },
  deleteReview: async (sb: SupabaseClient, { reviewId }: { reviewId: string }): Promise<null> => {
    const { data, error } = await sb.from("reviews").delete().eq("id", reviewId).select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("not authorized to delete this review");
    return null;
  },
};

export const supabaseRatingQuery = async (
  sb: SupabaseClient,
  { movieId }: { movieId: string },
): Promise<MovieRating> => {
  const { data, error } = await sb.from("reviews").select("rating").eq("movieId", movieId);
  if (error) throw error;
  const ratings = (data ?? []).map((r) => r.rating as number);
  const count = ratings.length;
  const avg = count === 0 ? 0 : ratings.reduce((s, r) => s + r, 0) / count;
  return { avg, count };
};

// Phase 4: the LIVE review feed as a named query (subscribe()-able). reviews_select
// is open under RLS, so this reads on the anon/authed client. Map PostgREST `id` to
// the portable `_id` the UI's own-only controls use.
export const supabaseReviewsQuery = async (
  sb: SupabaseClient,
  { movieId }: { movieId: string },
): Promise<ReviewRow[]> => {
  const { data, error } = await sb
    .from("reviews")
    .select("id, movieId, userId, rating, body")
    .eq("movieId", movieId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    _id: r.id as string,
    movieId: r.movieId as string,
    userId: r.userId as string,
    rating: r.rating as number,
    body: r.body as string,
  }));
};

// ---------------------------------------------------------------------------
// Convex: deployed mutations + query (ctx.auth enforced).
// ---------------------------------------------------------------------------

const convexReviewsApi = anyApi.reviews as unknown as {
  addReview: FunctionReference<"mutation">;
  editReview: FunctionReference<"mutation">;
  deleteReview: FunctionReference<"mutation">;
  movieRating: FunctionReference<"query">;
  movieReviews: FunctionReference<"query">;
};
export const convexReviewMutations = {
  addReview: convexReviewsApi.addReview,
  editReview: convexReviewsApi.editReview,
  deleteReview: convexReviewsApi.deleteReview,
};
export const convexRatingQuery = convexReviewsApi.movieRating;
export const convexReviewsQuery = convexReviewsApi.movieReviews;

// ---------------------------------------------------------------------------
// Memory: no auth (open dev sandbox), a single synthetic user.
// ---------------------------------------------------------------------------

interface MemReview extends Review {
  readonly _id: DocumentId;
}
export const memoryReviewMutations = {
  addReview: (
    ctx: MemoryContext,
    { movieId, rating, body }: { movieId: string; rating: number; body: string },
  ): { id: string } => {
    const existing = ctx
      .all<MemReview>("reviews")
      .find((r) => r.userId === MEMORY_USER && r.movieId === movieId);
    if (existing) {
      ctx.patch("reviews", existing._id, { rating, body });
      return { id: existing._id };
    }
    const id = ctx.insert("reviews", { movieId, userId: MEMORY_USER, rating, body });
    return { id };
  },
  editReview: (
    ctx: MemoryContext,
    { reviewId, rating, body }: { reviewId: string; rating: number; body: string },
  ): null => {
    ctx.patch("reviews", reviewId as DocumentId, { rating, body });
    return null;
  },
  deleteReview: (ctx: MemoryContext, { reviewId }: { reviewId: string }): null => {
    ctx.remove("reviews", reviewId as DocumentId);
    return null;
  },
};
export const memoryRatingQuery = (
  ctx: MemoryContext,
  { movieId }: { movieId: string },
): MovieRating => {
  const ratings = ctx
    .all<MemReview>("reviews")
    .filter((r) => r.movieId === movieId)
    .map((r) => r.rating);
  const count = ratings.length;
  const avg = count === 0 ? 0 : ratings.reduce((s, r) => s + r, 0) / count;
  return { avg, count };
};
export const memoryReviewsQuery = (
  ctx: MemoryContext,
  { movieId }: { movieId: string },
): ReviewRow[] =>
  ctx
    .all<MemReview>("reviews")
    .filter((r) => r.movieId === movieId)
    .map((r) => ({
      _id: r._id,
      movieId: r.movieId,
      userId: r.userId,
      rating: r.rating,
      body: r.body,
    }));

// ---------------------------------------------------------------------------
// UI-facing data functions (throw-free Outcome).
// ---------------------------------------------------------------------------

export type Outcome<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly message: string };

export async function addReview(
  backend: Backend<MarqueeSchema>,
  movieId: string,
  rating: number,
  body: string,
): Promise<Outcome<{ id: string }>> {
  const r = await backend.store.mutate("addReview", { movieId, rating, body });
  return r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
}

export async function editReview(
  backend: Backend<MarqueeSchema>,
  reviewId: string,
  rating: number,
  body: string,
): Promise<Outcome<null>> {
  const r = await backend.store.mutate("editReview", { reviewId, rating, body });
  return r.ok ? { ok: true, data: null } : { ok: false, message: r.error.message };
}

export async function deleteReview(
  backend: Backend<MarqueeSchema>,
  reviewId: string,
): Promise<Outcome<null>> {
  const r = await backend.store.mutate("deleteReview", { reviewId });
  return r.ok ? { ok: true, data: null } : { ok: false, message: r.error.message };
}

export async function getMovieRating(
  backend: Backend<MarqueeSchema>,
  movieId: string,
): Promise<Outcome<MovieRating>> {
  const r = await backend.store.run("movieRating", { movieId });
  return r.ok ? { ok: true, data: r.data } : { ok: false, message: r.error.message };
}

/** List a movie's reviews via the portable store (reads are open under RLS). */
export async function listReviews(
  backend: Backend<MarqueeSchema>,
  movieId: string,
): Promise<Outcome<ReadonlyArray<Review & { _id: DocumentId }>>> {
  const r = await backend.store.list<Review & { _id: DocumentId }>("reviews", {
    where: [["movieId", "eq", movieId]],
    limit: 200,
  });
  return r.ok ? { ok: true, data: r.data.items } : { ok: false, message: r.error.message };
}
