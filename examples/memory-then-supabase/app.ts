/**
 * The app, written once against `@baas/core`.
 *
 * This is the "develop on memory, deploy on Supabase" example. The app logic
 * here imports no adapter and names no provider; it is identical no matter which
 * backend runs it. `backends.ts` supplies the two wirings (memory for dev/tests,
 * Supabase for deploy) and `app.test.ts` runs THIS code against both.
 *
 * Writes use the portable by-id CRUD, so they need no per-backend wiring. The
 * one named query, `listTodos`, is the seam each backend wires.
 */

import type { Backend, DocumentId, StoreSchema } from "@baas/core";

export interface Todo {
  readonly _id: DocumentId;
  readonly title: string;
  readonly done: boolean;
}

export const TODOS = "todos";

export interface TodoSchema extends StoreSchema {
  readonly queries: {
    readonly listTodos: { readonly args: Record<string, never>; readonly result: Todo[] };
  };
  readonly mutations: Record<string, never>;
}

/** Insert each title as an open todo. Portable: direct inserts, no wiring. */
export async function seedTodos(
  backend: Backend<TodoSchema>,
  titles: readonly string[],
): Promise<void> {
  for (const title of titles) {
    const result = await backend.store.insert(TODOS, { title, done: false });
    if (!result.ok) throw new Error(result.error.message);
  }
}

/** Titles of the still-open todos, via the one named query each backend wires. */
export async function openTitles(backend: Backend<TodoSchema>): Promise<string[]> {
  const result = await backend.store.run("listTodos", {});
  if (!result.ok) throw new Error(result.error.message);
  return result.data.filter((todo) => !todo.done).map((todo) => todo.title);
}

/** Remove every todo. Portable: list ids via the query, then direct-remove each. */
export async function clearTodos(backend: Backend<TodoSchema>): Promise<void> {
  const result = await backend.store.run("listTodos", {});
  if (!result.ok) throw new Error(result.error.message);
  for (const todo of result.data) {
    const removed = await backend.store.remove(TODOS, todo._id);
    if (!removed.ok) throw new Error(removed.error.message);
  }
}
