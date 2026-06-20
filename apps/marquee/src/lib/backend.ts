import { createConvexBackend } from "@baas/adapter-convex";
import { createMemoryBackend } from "@baas/adapter-memory";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import type { Backend } from "@baas/core";

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
 * Build a fresh `Backend` for the given kind.
 *
 * Marquee drives the portable `store` directly (insert/list/get/patch/remove),
 * so every backend is configured with no named queries or mutations. The same
 * movie/genre objects round-trip through the identical port on all three.
 */
export function makeBackend(kind: BackendKind): Backend {
  switch (kind) {
    case "memory":
      return createMemoryBackend({ queries: {}, mutations: {} });

    case "supabase": {
      const url = env.VITE_SUPABASE_URL;
      const key = env.VITE_SUPABASE_ANON_KEY;
      if (!url || !key) {
        throw new Error("Supabase backend needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      }
      return createSupabaseBackend({ url, key, queries: {}, mutations: {} });
    }

    case "convex": {
      const url = env.VITE_CONVEX_URL;
      if (!url) throw new Error("Convex backend needs VITE_CONVEX_URL.");
      return createConvexBackend({ url, queries: {}, mutations: {} });
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
