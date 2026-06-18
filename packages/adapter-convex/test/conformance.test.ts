/**
 * Runs the single conformance suite against a LIVE Convex deployment.
 *
 * Skips itself (rather than failing) when `CONVEX_URL` is absent, so `pnpm test`
 * stays green on machines without a deployment. To run it:
 *
 *   cd packages/adapter-convex
 *   npx convex dev            # starts a local deployment, writes CONVEX_URL to .env.local
 *   export CONVEX_URL="http://127.0.0.1:3210"
 *   pnpm vitest run packages/adapter-convex/test/conformance.test.ts
 */

import { runConformanceSuite } from "@baas/conformance";
import { describe, it } from "vitest";
import { convexAvailable, makeConvexConformanceBackend } from "./fixture.js";

if (convexAvailable) {
  runConformanceSuite("adapter-convex (live)", makeConvexConformanceBackend);
} else {
  describe("adapter-convex (live)", () => {
    it.skip("needs CONVEX_URL and a running deployment", () => {});
  });
}
