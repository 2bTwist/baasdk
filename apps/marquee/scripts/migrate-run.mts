/**
 * Phase 5 at-scale cutover driver. Runs the SAME marquee migration the admin
 * panel runs (src/lib/migrate.ts), but headless so a multi-thousand-movie
 * Supabase->Convex copy can run in seconds-to-minutes with stdout progress
 * instead of a 20-minute browser session. The migrate only lists/inserts (no
 * subscribe), so it is safe under tsx (unlike the ConvexClient WS path).
 *
 *   SUPABASE_URL=... SUPABASE_KEY=<service> CONVEX_URL=... \
 *     npx tsx scripts/migrate-run.mts [supabase->convex | convex->supabase]
 */
import { createConvexBackend } from "@baas/adapter-convex";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import type { Backend } from "@baas/core";
import { type MigrateDirection, runMigration } from "../src/lib/migrate";

const dirArg = process.argv[2] ?? "supabase->convex";
const direction: MigrateDirection =
  dirArg === "convex->supabase"
    ? { from: "convex", to: "supabase" }
    : { from: "supabase", to: "convex" };

const supaUrl = process.env.SUPABASE_URL;
const supaKey = process.env.SUPABASE_KEY;
const cxUrl = process.env.CONVEX_URL;
if (!supaUrl || !supaKey || !cxUrl) {
  console.error("need SUPABASE_URL, SUPABASE_KEY, CONVEX_URL");
  process.exit(1);
}

const supabase = createSupabaseBackend({
  url: supaUrl,
  key: supaKey,
  bucket: "posters",
  queries: {},
  mutations: {},
}) as Backend;
const convex = createConvexBackend({ url: cxUrl, queries: {}, mutations: {} }) as Backend;

const source = direction.from === "supabase" ? supabase : convex;
const target = direction.to === "supabase" ? supabase : convex;

console.log(`Migrating ${direction.from} -> ${direction.to}…`);
const t0 = Date.now();
// Throttle progress logging to one line per collection per 500 rows.
const lastLogged: Record<string, number> = {};
const report = await runMigration(source, target, direction, (e) => {
  const prev = lastLogged[`${e.collection}:${e.phase}`] ?? 0;
  if (e.done - prev >= 500 || e.done === 1) {
    lastLogged[`${e.collection}:${e.phase}`] = e.done;
    console.log(`  ${e.phase} ${e.collection}: ${e.done}`);
  }
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\nReport (ok=${report.ok}, ${elapsed}s):`);
for (const [c, r] of Object.entries(report.collections)) {
  console.log(`  ${c.padEnd(12)} copied=${r.copied} skipped=${r.skipped} relinked=${r.relinked}`);
}
if (report.error) {
  console.log(
    `\nFIRST ERROR — ${report.error.collection} (${report.error.phase}): ${report.error.error.message}`,
  );
}
process.exit(report.ok ? 0 : 1);
