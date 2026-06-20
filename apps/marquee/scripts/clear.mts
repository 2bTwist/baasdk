/**
 * Dev utility: wipe every Marquee collection on a backend through the portable
 * store (list a page, remove each, repeat until empty). Used to reset a backend
 * that accumulated data from seeds or migration runs.
 *
 *   SUPABASE_URL=... SUPABASE_KEY=<service> npx tsx scripts/clear.mts supabase
 *   CONVEX_URL=...                            npx tsx scripts/clear.mts convex
 */
import { createConvexBackend } from "@baas/adapter-convex";
import { createMemoryBackend } from "@baas/adapter-memory";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import type { Backend, DocumentId } from "@baas/core";

type Kind = "memory" | "supabase" | "convex";
const arg = process.argv[2];
if (arg !== "memory" && arg !== "supabase" && arg !== "convex") {
  console.error("Usage: clear.mts <memory|supabase|convex>");
  process.exit(1);
}
const kind: Kind = arg;

function build(): Backend {
  if (kind === "supabase") {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) throw new Error("supabase clear needs SUPABASE_URL and SUPABASE_KEY");
    return createSupabaseBackend({ url, key, queries: {}, mutations: {} });
  }
  if (kind === "convex") {
    const url = process.env.CONVEX_URL;
    if (!url) throw new Error("convex clear needs CONVEX_URL");
    return createConvexBackend({ url, queries: {}, mutations: {} });
  }
  return createMemoryBackend({ queries: {}, mutations: {} });
}

// Children before parents so any FK constraints (Supabase) are satisfied.
const COLLECTIONS = ["reviews", "credits", "movieGenres", "profiles", "movies", "people", "genres"];

const backend = build();
for (const c of COLLECTIONS) {
  let removed = 0;
  while (true) {
    const page = await backend.store.list<{ _id: DocumentId }>(c, { limit: 200 });
    if (!page.ok) throw new Error(`list ${c}: ${page.error.message}`);
    if (page.data.items.length === 0) break;
    for (const item of page.data.items) {
      const r = await backend.store.remove(c, item._id);
      if (!r.ok) throw new Error(`remove ${c}/${item._id}: ${r.error.message}`);
      removed++;
    }
    if (removed % 2000 === 0) console.log(`  ${c}: ${removed}…`);
  }
  console.log(`${c}: removed ${removed}`);
}
console.log(`\nCleared ${kind}.`);
process.exit(0);
