/**
 * Counting todos, the PORTABLE way.
 *
 * This is the default you should reach for: it works on every backend and never
 * touches `native()`. The escape-hatch version lives in `analytics-native.ts`,
 * deliberately in its own small file, so you can see exactly how little code is
 * allowed to know about a specific provider.
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

/**
 * Count the done todos by listing them and counting client-side. Correct on
 * every backend with no `native()`; the cost is that it transfers every row.
 */
export async function countDone(backend: Backend<TodoSchema>): Promise<number> {
  const result = await backend.store.run("listTodos", {});
  if (!result.ok) throw new Error(result.error.message);
  return result.data.filter((todo) => todo.done).length;
}
