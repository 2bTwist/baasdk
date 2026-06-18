/**
 * Proves both paths: the portable count runs everywhere (so it can't rot), and
 * the `native()` server-side count agrees with it against a REAL Supabase stack
 * (run in the live-conformance CI job, self-skipped otherwise).
 *
 * The assertion that matters: `countDoneServerSide` returns the SAME number as
 * the portable `countDone`. The escape hatch is an optimization, not a different
 * answer.
 */

import { createMemoryBackend } from "@baas/adapter-memory";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import type { Backend, DocumentId } from "@baas/core";
import { expect, test } from "vitest";
import { countDone, TODOS, type Todo, type TodoSchema } from "./analytics.js";
import { countDoneServerSide } from "./analytics-native.js";

async function seed(backend: Backend<TodoSchema>, dones: readonly boolean[]): Promise<void> {
  for (const done of dones) {
    const result = await backend.store.insert(TODOS, { title: done ? "done" : "open", done });
    if (!result.ok) throw new Error(result.error.message);
  }
}

/** Empty the collection via the portable API (works on either backend). */
async function clear(backend: Backend<TodoSchema>): Promise<void> {
  const result = await backend.store.run("listTodos", {});
  if (!result.ok) throw new Error(result.error.message);
  for (const todo of result.data) {
    const removed = await backend.store.remove(TODOS, todo._id);
    if (!removed.ok) throw new Error(removed.error.message);
  }
}

test("the portable countDone works on any backend, no native() needed", async () => {
  const backend = createMemoryBackend<TodoSchema>({
    queries: { listTodos: (ctx) => ctx.all<Todo>(TODOS) },
    mutations: {},
  });
  await seed(backend, [true, true, false]);

  expect(await countDone(backend)).toBe(2);
  // memory declares aggregations:false, so the native path is correctly closed.
  expect(backend.capabilities.aggregations).toBe(false);
});

test("countDoneServerSide refuses a non-Supabase backend even if it declares aggregations", async () => {
  // The capability flag says "supports aggregation," not "is Supabase." A memory
  // backend with an override passes the flag check but its native() is not a
  // SupabaseClient, so the function must refuse it loudly, not crash obscurely.
  const backend = createMemoryBackend<TodoSchema>({
    queries: { listTodos: (ctx) => ctx.all<Todo>(TODOS) },
    mutations: {},
    capabilities: { aggregations: true },
  });

  await expect(countDoneServerSide(backend)).rejects.toThrow(/Supabase-backed/);
});

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAvailable = Boolean(url && key);

test.skipIf(!supabaseAvailable)(
  "native() server-side count agrees with the portable count on a live Supabase stack",
  async () => {
    const backend = createSupabaseBackend<TodoSchema>({
      url: url as string,
      key: key as string,
      queries: {
        listTodos: async (sb) => {
          const { data, error } = await sb.from("todos").select("*").order("created_at");
          if (error) throw error;
          const rows = (data ?? []) as { id: string; title: string; done: boolean }[];
          return rows.map((r) => ({ _id: r.id as DocumentId, title: r.title, done: r.done }));
        },
      },
      mutations: {},
    });

    await clear(backend);
    await seed(backend, [true, true, false, true]);

    expect(backend.capabilities.aggregations).toBe(true);
    expect(await countDoneServerSide(backend)).toBe(3); // server-side, no rows transferred
    expect(await countDone(backend)).toBe(3); // portable path, same answer

    await clear(backend);
  },
);
