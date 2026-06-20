/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Initial backend: `memory` | `supabase` | `convex`. */
  readonly VITE_BAAS_BACKEND?: string;
  /** Live Supabase: REST URL + anon key (Phase 1). */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Live Convex deployment URL (Phase 1). Convex's CLI writes this to .env.local. */
  readonly VITE_CONVEX_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
