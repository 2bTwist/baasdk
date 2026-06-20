/**
 * Runs the migrate cross-backend suite against a LIVE local Supabase stack,
 * memory <-> Supabase in both directions. This is the automated coverage migrate
 * never had: a real insert into Supabase as the migration target, and a real
 * paged read out of it as the source.
 *
 * Skips itself (rather than failing) when the stack credentials are absent, so
 * `pnpm test` stays green on machines without Docker/Supabase. To run it:
 *
 *   cd packages/adapter-supabase
 *   supabase start
 *   export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...   # from `supabase status`
 *   pnpm exec vitest run packages/adapter-supabase/test/migrate-conformance.test.ts
 */

import { runMigrateConformanceSuite } from "@baas/migrate-conformance";
import { describe, it } from "vitest";
import { makeSupabaseMigrateBackend, supabaseAvailable } from "./fixture.js";

if (supabaseAvailable) {
  runMigrateConformanceSuite("adapter-supabase (live)", makeSupabaseMigrateBackend);
} else {
  describe("migrate conformance: adapter-supabase (live)", () => {
    it.skip("needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and a running stack", () => {});
  });
}
