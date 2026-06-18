/**
 * Live half of the spike: exercises the CLIENT-side mappings against a real
 * Convex deployment (the parts convex-test cannot cover — WebSocket dispatch,
 * reactivity, and auth wiring).
 *
 * Run AFTER `npx convex dev` (or `npx convex dev --once`) has pushed the
 * functions and written .env.local:
 *
 *   CONVEX_URL=https://<your-deployment>.convex.cloud npm run spike
 *   # or, if .env.local has CONVEX_URL:  npm run spike
 *
 * Proves: (1) setAuth accepts our TokenFetcher shape, (2) dynamic dispatch by
 * string via anyApi, (3) the generic schemaless insert helper, (4) onUpdate
 * delivers a live update after the insert (reactiveQueries: true).
 */

import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";

// Prefer CONVEX_URL; otherwise derive it from CONVEX_DEPLOYMENT (what
// `convex dev` writes to .env.local), e.g. "dev:happy-otter-42" -> the cloud URL.
let url = process.env.CONVEX_URL;
if (!url && process.env.CONVEX_DEPLOYMENT) {
  const name = process.env.CONVEX_DEPLOYMENT.replace(/^(dev|prod):/, "");
  url = `https://${name}.convex.cloud`;
}
if (!url) {
  console.error("No CONVEX_URL / CONVEX_DEPLOYMENT found. Run `npx convex dev` first.");
  process.exit(1);
}

const client = new ConvexClient(url);

// Fail fast instead of hanging if the deployment isn't reachable (e.g. a local
// backend that was started with `--once` and has since exited).
const watchdog = setTimeout(() => {
  console.error(`Timed out reaching ${url}. Is the deployment up? A LOCAL backend needs`);
  console.error("`npx convex dev` to keep running (don't use --once for the spike).");
  process.exit(2);
}, 12_000);

// (1) setAuth — same shape as core's TokenFetcher: (opts:{forceRefresh}) => Promise<string|null>
client.setAuth(async ({ forceRefresh }) => {
  console.log(`[setAuth] fetchToken called (forceRefresh=${forceRefresh})`);
  return null; // unauthenticated; this only proves the wiring + signature match
});

// (2)+(4) dynamic dispatch by string + reactivity
const updates: number[] = [];
const unsubscribe = client.onUpdate(anyApi.todos.listTodos, {}, (todos: unknown[]) => {
  updates.push(todos.length);
  console.log(`[onUpdate] listTodos -> ${todos.length} doc(s)`);
});

// (3) generic schemaless insert via the deployed helper, dynamic table name
const id = await client.mutation(anyApi.baas.insert, {
  collection: "todos",
  value: { title: "live-spike", done: false },
});
console.log(`[insert] new id = ${id}`);

await new Promise((r) => setTimeout(r, 1500)); // let the subscription tick
clearTimeout(watchdog);
unsubscribe();
await client.close();

const reactive = updates.length >= 2;
console.log("");
console.log(`setAuth wired ........... ✅ (see log above)`);
console.log(`dynamic dispatch ........ ✅ (insert returned id ${id})`);
console.log(`reactive onUpdate ....... ${reactive ? "✅" : "❌"} (${updates.length} deliveries: ${updates.join(", ")})`);
process.exit(reactive ? 0 : 1);
