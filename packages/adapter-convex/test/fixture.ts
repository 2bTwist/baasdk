/**
 * Wires the canonical ConformanceSchema onto Convex and resets persistent state
 * on every construction, so the suite's "fresh, empty backend" precondition
 * holds. Runs against a real deployment over a `ConvexClient` (the only way to
 * cover reactivity, the upload dance, and auth wiring).
 *
 * Needs a reachable deployment via `CONVEX_URL` (e.g. the local one `npx convex
 * dev` starts). Self-skips when absent.
 */

import { createConvexBackend } from "@baas/adapter-convex";
import type { ConformanceSchema } from "@baas/conformance";
import type { Backend } from "@baas/core";
import { ConvexClient } from "convex/browser";
import { anyApi, type FunctionReference } from "convex/server";

const url = process.env.CONVEX_URL;

/** True when a deployment URL is present. Gates the live suite. */
export const convexAvailable = Boolean(url);

// `anyApi` types every access as possibly-undefined; reference the test app's
// deployed functions through narrow typed views.
const todos = anyApi.todos as unknown as {
  listTodos: FunctionReference<"query">;
  getTodo: FunctionReference<"query">;
  addTodo: FunctionReference<"mutation">;
  toggleTodo: FunctionReference<"mutation">;
  addThenFail: FunctionReference<"mutation">;
};
const testing = anyApi.testing as unknown as {
  reset: FunctionReference<"mutation", "public", { tables: string[] }, null>;
};

export async function makeConvexConformanceBackend(): Promise<Backend<ConformanceSchema>> {
  const client = new ConvexClient(url as string);
  // Reset persistent state: each test must see an empty backend.
  await client.mutation(testing.reset, { tables: ["todos", "notes"] });

  return createConvexBackend<ConformanceSchema>({
    client,
    queries: { listTodos: todos.listTodos, getTodo: todos.getTodo },
    mutations: {
      addTodo: todos.addTodo,
      toggleTodo: todos.toggleTodo,
      addThenFail: todos.addThenFail,
    },
  });
}
