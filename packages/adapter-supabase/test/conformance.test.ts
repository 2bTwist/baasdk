/**
 * Runs the single conformance suite against a LIVE local Supabase stack.
 *
 * Skips itself (rather than failing) when the stack credentials are absent, so
 * `pnpm test` stays green on machines without Docker/Supabase. To run it:
 *
 *   cd packages/adapter-supabase
 *   supabase start
 *   export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...   # from `supabase status`
 *   pnpm test
 */

import { runConformanceSuite } from "@baas/conformance";
import { describe, it } from "vitest";
import { makeSupabaseConformanceBackend, supabaseAvailable } from "./fixture.js";

if (supabaseAvailable) {
  runConformanceSuite("adapter-supabase (live)", makeSupabaseConformanceBackend);
} else {
  describe("adapter-supabase (live)", () => {
    it.skip("needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and a running stack", () => {});
  });
}
