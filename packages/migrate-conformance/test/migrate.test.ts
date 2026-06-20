/**
 * Always-on memory <-> memory run of the migrate cross-backend suite.
 *
 * The in-memory adapter is the portable reference, so running the suite with
 * memory as the "real" side proves the suite itself is portable and keeps the
 * four migrate invariants green on every commit without any live stack. The live
 * adapter packages run the SAME suite against Supabase and Convex.
 */

import { createMemoryBackend } from "@baas/adapter-memory";
import { runMigrateConformanceSuite } from "@baas/migrate-conformance";

runMigrateConformanceSuite("memory", () => createMemoryBackend({ queries: {}, mutations: {} }));
