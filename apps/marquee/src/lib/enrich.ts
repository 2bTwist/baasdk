import type { MemoryContext } from "@baas/adapter-memory";
import type { Backend, DocumentId } from "@baas/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anyApi, type FunctionReference } from "convex/server";
import type { CastMember, GenreCount, MarqueeSchema } from "./schema";

/**
 * Phase 2: the join + aggregation layer. The portable core port deliberately
 * excludes joins/aggregation; they are reached through NAMED operations whose
 * calling convention is portable (`store.run`) but whose implementation diverges
 * per backend. This module holds both halves:
 *
 *  1. The per-backend query IMPLEMENTATIONS (the maps `makeBackend` wires in).
 *     Supabase joins/aggregates server-side (PostgREST embed + SQL view); Convex
 *     and memory follow refs and scan. Same shapes, different mechanisms, declared
 *     by the `serverSideJoins` / `aggregations` capability flags.
 *  2. The UI-facing DATA functions (`getMovieCredits` / `getGenreCounts`) that
 *     call `store.run` and flatten the `Result` to a renderable `Outcome`.
 *
 * Kept free of `import.meta.env` so the live tests can import the impl maps to
 * build typed backends directly.
 */

// ---------------------------------------------------------------------------
// Per-backend implementations
// ---------------------------------------------------------------------------

/** Supabase: a real server-side PostgREST embed + a SQL-view read. */
export const supabaseQueries = {
  movieCredits: async (
    sb: SupabaseClient,
    { movieId }: { movieId: string },
  ): Promise<CastMember[]> => {
    const { data, error } = await sb
      .from("credits")
      .select("role, character, billing, people(name)")
      .eq("movieId", movieId)
      .order("billing", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => {
      // PostgREST embeds a to-one FK as a single object, but supabase-js types
      // every embed as an array; normalize both shapes.
      const embedded = r.people as unknown;
      const person = (Array.isArray(embedded) ? embedded[0] : embedded) as
        | { name: string }
        | null
        | undefined;
      return {
        name: person?.name ?? "Unknown",
        role: r.role as string,
        character: r.character as string,
        billing: r.billing as number,
      };
    });
  },
  genreCounts: async (sb: SupabaseClient): Promise<GenreCount[]> => {
    const { data, error } = await sb.from("genre_counts").select("slug, total");
    if (error) throw error;
    return (data ?? []).map((r) => ({ slug: r.slug as string, count: r.total as number }));
  },
};

/** Convex: the deployed `convex/marquee.ts` query functions (ref-follow + scan). */
const convexApi = anyApi.marquee as unknown as {
  movieCredits: FunctionReference<"query">;
  genreCounts: FunctionReference<"query">;
};
export const convexQueries = {
  movieCredits: convexApi.movieCredits,
  genreCounts: convexApi.genreCounts,
};

/** Memory: the same join/aggregation over the in-memory store (third-backend parity). */
interface CreditRow {
  readonly movieId: string;
  readonly personId: string;
  readonly role: string;
  readonly character: string;
  readonly billing: number;
}
export const memoryQueries = {
  movieCredits: (ctx: MemoryContext, { movieId }: { movieId: string }): CastMember[] => {
    const credits = ctx
      .all<CreditRow>("credits")
      .filter((c) => c.movieId === movieId)
      .sort((a, b) => a.billing - b.billing);
    return credits.map((c) => {
      const person = ctx.get<{ name: string }>("people", c.personId as DocumentId);
      return {
        name: person?.name ?? "Unknown",
        role: c.role,
        character: c.character,
        billing: c.billing,
      };
    });
  },
  genreCounts: (ctx: MemoryContext): GenreCount[] => {
    const counts = new Map<string, number>();
    for (const m of ctx.all<{ primaryGenre: string }>("movies")) {
      counts.set(m.primaryGenre, (counts.get(m.primaryGenre) ?? 0) + 1);
    }
    return [...counts.entries()].map(([slug, count]) => ({ slug, count }));
  },
};

// ---------------------------------------------------------------------------
// UI-facing data functions
// ---------------------------------------------------------------------------

/** Throw-free outcome the UI renders directly (mirrors movies.ts `Outcome`). */
export type Outcome<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly message: string };

/** The ordered cast/crew for a movie, via the per-backend `movieCredits` join. */
export async function getMovieCredits(
  backend: Backend<MarqueeSchema>,
  movieId: string,
): Promise<Outcome<CastMember[]>> {
  const result = await backend.store.run("movieCredits", { movieId });
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true, data: result.data };
}

/** Movie count per primary genre, via the per-backend `genreCounts` aggregation. */
export async function getGenreCounts(
  backend: Backend<MarqueeSchema>,
): Promise<Outcome<GenreCount[]>> {
  const result = await backend.store.run("genreCounts", {});
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true, data: result.data };
}

/** Whether this backend does the credits join server-side (Supabase) or by hand. */
export function joinsServerSide(backend: Backend<MarqueeSchema>): boolean {
  return backend.capabilities.serverSideJoins;
}

/** Whether this backend aggregates server-side (Supabase) or by scanning. */
export function aggregatesServerSide(backend: Backend<MarqueeSchema>): boolean {
  return backend.capabilities.aggregations;
}
