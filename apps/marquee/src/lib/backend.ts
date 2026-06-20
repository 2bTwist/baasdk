import { createConvexBackend } from "@baas/adapter-convex";
import { createMemoryBackend } from "@baas/adapter-memory";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import type { Backend } from "@baas/core";
import { convexQueries, memoryQueries, supabaseQueries } from "./enrich";
import {
  convexRatingQuery,
  convexReviewMutations,
  convexReviewsQuery,
  memoryRatingQuery,
  memoryReviewMutations,
  memoryReviewsQuery,
  supabaseRatingQuery,
  supabaseReviewMutations,
  supabaseReviewsQuery,
} from "./reviews";
import type { MarqueeSchema } from "./schema";

/**
 * The backends Marquee can run on. `memory` is always available; `supabase` and
 * `convex` are available when their env (a live URL, plus the Supabase anon key)
 * is configured, which is what Phase 1 wires up.
 */
export type BackendKind = "memory" | "supabase" | "convex";

export interface BackendChoice {
  readonly kind: BackendKind;
  readonly label: string;
  /** CSS color token for the badge/switcher accent. */
  readonly color: string;
  /** Whether this backend can be selected in the current environment. */
  readonly available: boolean;
}

/** The neutral accent for the in-memory backend (the demo uses --blue). */
const MEMORY_COLOR = "var(--blue)";

const env = import.meta.env;

/** A backend is selectable only when the env it needs is present. */
const supabaseConfigured = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
const convexConfigured = Boolean(env.VITE_CONVEX_URL);

export const BACKENDS: readonly BackendChoice[] = [
  { kind: "memory", label: "Memory", color: MEMORY_COLOR, available: true },
  { kind: "supabase", label: "Supabase", color: "var(--sb)", available: supabaseConfigured },
  { kind: "convex", label: "Convex", color: "var(--cx)", available: convexConfigured },
];

/**
 * Build a fresh `Backend` for the given kind. The catalog CRUD uses the portable
 * `store` directly; the named queries (movieCredits/genreCounts) are wired per
 * backend here so `store.run(...)` is portable across all three.
 */
export function makeBackend(kind: BackendKind): Backend<MarqueeSchema> {
  switch (kind) {
    case "memory":
      return createMemoryBackend<MarqueeSchema>({
        queries: {
          ...memoryQueries,
          movieRating: memoryRatingQuery,
          movieReviews: memoryReviewsQuery,
        },
        mutations: memoryReviewMutations,
      });

    case "supabase": {
      const url = env.VITE_SUPABASE_URL;
      const key = env.VITE_SUPABASE_ANON_KEY;
      if (!url || !key) {
        throw new Error("Supabase backend needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      }
      return createSupabaseBackend<MarqueeSchema>({
        url,
        key,
        // Phase 4: posters live in this Storage bucket (created by the seed).
        bucket: "posters",
        queries: {
          ...supabaseQueries,
          movieRating: supabaseRatingQuery,
          movieReviews: supabaseReviewsQuery,
        },
        mutations: supabaseReviewMutations,
        // Phase 4: opt Supabase into live reviews. Any `realtime` entry flips
        // reactiveQueries to true; both rating + feed re-run when `reviews`
        // changes (requires the table in the supabase_realtime publication —
        // migration 0004). Convex needs no equivalent (it tracks read-sets).
        realtime: {
          movieRating: { tables: ["reviews"] },
          movieReviews: { tables: ["reviews"] },
        },
      });
    }

    case "convex": {
      const url = env.VITE_CONVEX_URL;
      if (!url) throw new Error("Convex backend needs VITE_CONVEX_URL.");
      return createConvexBackend<MarqueeSchema>({
        url,
        queries: {
          ...convexQueries,
          movieRating: convexRatingQuery,
          movieReviews: convexReviewsQuery,
        },
        mutations: convexReviewMutations,
      });
    }

    default: {
      const exhaustive: never = kind;
      throw new Error(`unknown backend kind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Resolve the initial backend kind from the optional env override, falling back
 * to the first available backend (memory always qualifies).
 */
export function initialBackendKind(): BackendKind {
  const fromEnv = env.VITE_BAAS_BACKEND;
  const match = BACKENDS.find((b) => b.kind === fromEnv && b.available);
  return match ? match.kind : "memory";
}
