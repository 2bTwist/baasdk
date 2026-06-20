import type { StoreSchema } from "@baas/core";

/**
 * Marquee's NAMED-operation schema (Phase 2). Joins and aggregation are
 * deliberately absent from the portable core port; they are reached through
 * named operations whose calling convention is portable but whose implementation
 * diverges per backend (Supabase: a server-side PostgREST embed + a SQL view;
 * Convex: ref-following + a scan). Both implementations return these identical
 * shapes, so `store.run(...)` is portable and the UI declares the divergence via
 * the `serverSideJoins` / `aggregations` capability flags.
 */

/** One cast/crew credit on the detail page (a row of the movie<->people join). */
export interface CastMember {
  readonly name: string;
  /** "director" | "actor". */
  readonly role: string;
  readonly character: string;
  readonly billing: number;
}

/** A movie count for one primary-genre slug (one row of the group-by aggregation). */
export interface GenreCount {
  readonly slug: string;
  readonly count: number;
}

/** Average rating + count for a movie (the aggregation deferred from Phase 2). */
export interface MovieRating {
  readonly avg: number;
  readonly count: number;
}

/** A named query that takes no arguments. */
type NoArgs = Record<string, never>;

/**
 * Phase 3 adds the security-sensitive WRITE path as named MUTATIONS (own-only
 * reviews), kept off the generic portable CRUD on purpose: the generic store is
 * the admin/seed primitive, while real per-row policy is where backends diverge,
 * so it rides the named-operation seam (Supabase under RLS; Convex via ctx.auth).
 * The actor's identity is NEVER taken from these args; it is derived from the
 * authenticated session (auth.uid() / ctx.auth.subject).
 */
export interface MarqueeSchema extends StoreSchema {
  readonly queries: {
    readonly movieCredits: {
      readonly args: { readonly movieId: string };
      readonly result: CastMember[];
    };
    readonly genreCounts: { readonly args: NoArgs; readonly result: GenreCount[] };
    readonly movieRating: {
      readonly args: { readonly movieId: string };
      readonly result: MovieRating;
    };
  };
  readonly mutations: {
    readonly addReview: {
      readonly args: { readonly movieId: string; readonly rating: number; readonly body: string };
      readonly result: { readonly id: string };
    };
    readonly editReview: {
      readonly args: { readonly reviewId: string; readonly rating: number; readonly body: string };
      readonly result: null;
    };
    readonly deleteReview: {
      readonly args: { readonly reviewId: string };
      readonly result: null;
    };
  };
}
