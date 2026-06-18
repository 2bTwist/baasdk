/**
 * A backend-agnostic todo library.
 *
 * The point of this example: `TodoService` is written ONLY against `@baas/core`.
 * It imports no adapter and names no provider. The same class runs unchanged
 * against the in-memory adapter, Supabase, or Convex; the app picks the backend
 * and passes it in. (`todo-service.test.ts` wires it to memory and exercises it.)
 *
 * How that is possible, concretely:
 *  - Writes use the PORTABLE by-id CRUD (`insert` / `patch` / `remove`), which
 *    every adapter implements identically, so they need no per-backend wiring.
 *  - Listing is the one thing the core contract has no portable primitive for
 *    (reads are NAMED operations, there is no "scan a whole collection"), so
 *    `listTodos` is declared here and wired once per backend by the app.
 *
 * That split is the honest lesson: direct CRUD is free across backends; a query
 * is the small, explicit seam you wire per adapter.
 */

import type { Backend, DocumentId, Result, StoreSchema } from "@baas/core";

export interface Todo {
  readonly _id: DocumentId;
  readonly title: string;
  readonly done: boolean;
}

/** The collection the service reads and writes. The app's query wiring lists it. */
export const TODO_COLLECTION = "todos";

/**
 * The library's backend contract: a single list query. Writes go through the
 * portable CRUD primitives, so there are no mutations to wire.
 */
export interface TodoSchema extends StoreSchema {
  readonly queries: {
    readonly listTodos: { readonly args: Record<string, never>; readonly result: Todo[] };
  };
  readonly mutations: Record<string, never>;
}

export class TodoService {
  constructor(private readonly backend: Backend<TodoSchema>) {}

  /** Add a todo, returning its new id. Portable: a direct insert. */
  add(title: string): Promise<Result<DocumentId>> {
    return this.backend.store.insert(TODO_COLLECTION, { title, done: false });
  }

  /** Flip a todo's done flag. Portable: a direct patch. */
  setDone(id: DocumentId, done: boolean): Promise<Result<void>> {
    return this.backend.store.patch(TODO_COLLECTION, id, { done });
  }

  /** Delete a todo. Portable: a direct remove (idempotent by contract). */
  remove(id: DocumentId): Promise<Result<void>> {
    return this.backend.store.remove(TODO_COLLECTION, id);
  }

  /** The todos still open. Uses the one named query the app wires per backend. */
  async listOpen(): Promise<Todo[]> {
    const result = await this.backend.store.run("listTodos", {});
    if (!result.ok) throw new Error(result.error.message);
    return result.data.filter((todo) => !todo.done);
  }
}
