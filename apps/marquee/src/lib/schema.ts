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

/** A named query that takes no arguments. */
type NoArgs = Record<string, never>;

export interface MarqueeSchema extends StoreSchema {
  readonly queries: {
    readonly movieCredits: {
      readonly args: { readonly movieId: string };
      readonly result: CastMember[];
    };
    readonly genreCounts: { readonly args: NoArgs; readonly result: GenreCount[] };
  };
  readonly mutations: NoArgs;
}
