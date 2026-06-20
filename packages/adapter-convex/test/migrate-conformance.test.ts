/**
 * Runs the migrate cross-backend suite against a LIVE Convex deployment, memory
 * <-> Convex in both directions. This is the run that would have caught the
 * original `_migratedFrom` bug: the memory -> Convex direction inserts the
 * lineage marker into a real Convex backend, which rejects `_`-prefixed user
 * fields, so a regression there fails loudly instead of shipping green.
 *
 * Self-skips when `CONVEX_URL` is absent (no deployment). To run it:
 *
 *   cd packages/adapter-convex
 *   npx convex dev            # local deployment
 *   CONVEX_URL=http://127.0.0.1:3210 \
 *     pnpm exec vitest run packages/adapter-convex/test/migrate-conformance.test.ts
 */

import { runMigrateConformanceSuite } from "@baas/migrate-conformance";
import { describe, it } from "vitest";
import { convexAvailable, makeConvexMigrateBackend } from "./fixture.js";

if (convexAvailable) {
  runMigrateConformanceSuite("adapter-convex (live)", makeConvexMigrateBackend);
} else {
  describe("migrate conformance: adapter-convex (live)", () => {
    it.skip("needs CONVEX_URL and a running deployment", () => {});
  });
}
