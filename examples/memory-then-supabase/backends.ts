/**
 * The two wirings for the one app. This file is the ONLY place that names a
 * provider, and it is why examples live outside the adapter packages: it imports
 * two adapters, which the `adapters-only-core` boundary forbids inside any
 * `packages/adapter-*`.
 *
 * The app code in `app.ts` is identical across both; only the factory differs.
 */

import { createMemoryBackend } from "@baas/adapter-memory";
import { createSupabaseBackend } from "@baas/adapter-supabase";
import type { Backend, DocumentId } from "@baas/core";
import { TODOS, type Todo, type TodoSchema } from "./app.js";

/** Dev / test backend: no server. `listTodos` reads the in-memory collection. */
export function memoryBackend(): Backend<TodoSchema> {
  return createMemoryBackend<TodoSchema>({
    queries: { listTodos: (ctx) => ctx.all<Todo>(TODOS) },
    mutations: {},
  });
}

/**
 * Deploy backend: the same app, pointed at Supabase.
 *
 * The `listTodos` seam does one extra thing a SQL backend needs and the
 * in-memory adapter hid: it maps the primary-key column (`id`) onto `_id`, since
 * Postgres rows carry their own id rather than the synthetic one memory adds.
 * The `todos` table (`id`, `title`, `done`, `created_at`) must already exist;
 * this repo's adapter migration creates it.
 */
export function supabaseBackend(url: string, key: string): Backend<TodoSchema> {
  return createSupabaseBackend<TodoSchema>({
    url,
    key,
    queries: {
      listTodos: async (sb) => {
        const { data, error } = await sb.from("todos").select("*").order("created_at");
        if (error) throw error;
        // supabase-js returns `data: null` only alongside an error (thrown above);
        // a successful select yields `[]`, never null. So no `?? []` guard here
        // (the conformance fixture keeps one, but it is a test file where the
        // no-unnecessary-condition lint that would flag it is relaxed).
        const rows = data as { id: string; title: string; done: boolean }[];
        return rows.map((row) => ({ _id: row.id as DocumentId, title: row.title, done: row.done }));
      },
    },
    mutations: {},
  });
}
