import { createMemoryBackend } from "@baas/adapter-memory";
import type { Backend } from "@baas/core";

/**
 * The backends Marquee can run on. `memory` is wired live in Phase 0; the
 * Supabase and Convex branches are stubbed and land in Phase 1.
 */
export type BackendKind = "memory" | "supabase" | "convex";

export interface BackendChoice {
  readonly kind: BackendKind;
  readonly label: string;
  /** CSS color token for the badge/switcher accent. */
  readonly color: string;
  /** Whether this backend can be selected today. */
  readonly available: boolean;
}

/** The neutral accent for the in-memory backend (the demo uses --blue). */
const MEMORY_COLOR = "var(--blue)";

export const BACKENDS: readonly BackendChoice[] = [
  { kind: "memory", label: "Memory", color: MEMORY_COLOR, available: true },
  { kind: "supabase", label: "Supabase", color: "var(--sb)", available: false },
  { kind: "convex", label: "Convex", color: "var(--cx)", available: false },
];

/**
 * Build a fresh `Backend` for the given kind.
 *
 * Phase 0 drives the portable `store` directly (insert/list/get/...), so the
 * memory backend is configured with no named queries or mutations.
 */
export function makeBackend(kind: BackendKind): Backend {
  switch (kind) {
    case "memory":
      return createMemoryBackend({ queries: {}, mutations: {} });

    case "supabase":
      // TODO Phase 1: build the Supabase backend from VITE_SUPABASE_URL /
      // VITE_SUPABASE_ANON_KEY via @baas/adapter-supabase.
      throw new Error("Supabase backend is wired in Phase 1.");

    case "convex":
      // TODO Phase 1: build the Convex backend from VITE_CONVEX_URL via
      // @baas/adapter-convex.
      throw new Error("Convex backend is wired in Phase 1.");

    default: {
      const exhaustive: never = kind;
      throw new Error(`unknown backend kind: ${String(exhaustive)}`);
    }
  }
}

/** Resolve the initial backend kind from the optional env override. */
export function initialBackendKind(): BackendKind {
  const fromEnv = import.meta.env.VITE_BAAS_BACKEND;
  const match = BACKENDS.find((b) => b.kind === fromEnv && b.available);
  return match ? match.kind : "memory";
}
