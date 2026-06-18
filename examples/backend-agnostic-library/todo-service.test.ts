/**
 * Executes the backend-agnostic library against a concrete backend, so the
 * example provably runs (and can't rot) in CI.
 *
 * This file plays the role of "the app": it supplies the ONLY backend-specific
 * code, wiring the `listTodos` query and choosing the in-memory adapter. To run
 * the very same `TodoService` against Supabase or Convex, an app writes the
 * equivalent `listTodos` wiring for that adapter and passes the resulting
 * `Backend`; nothing in `todo-service.ts` changes.
 *
 * That per-backend wiring is not always one line. On a SQL backend like Supabase
 * the `listTodos` query also maps the primary-key column onto `_id` and assumes
 * the `todos` table already exists (the in-memory adapter synthesizes `_id` and
 * creates collections on first write, which hides both costs). See
 * `packages/adapter-supabase/test/fixture.ts` for that exact wiring shape. The
 * point holds: the service is portable; the query is the explicit per-backend seam.
 */

import { createMemoryBackend } from "@baas/adapter-memory";
import { expect, test } from "vitest";
import { TODO_COLLECTION, type Todo, type TodoSchema, TodoService } from "./todo-service.js";

/** The app: wire the one query, pick a backend, hand it to the agnostic library. */
function makeTodoApp(): TodoService {
  const backend = createMemoryBackend<TodoSchema>({
    queries: {
      listTodos: (ctx) => ctx.all<Todo>(TODO_COLLECTION),
    },
    mutations: {},
  });
  return new TodoService(backend);
}

test("the library drives add / list / complete / remove against the injected backend", async () => {
  const todos = makeTodoApp();

  const added = await todos.add("write the docs");
  if (!added.ok) throw new Error(added.error.message);
  expect((await todos.add("ship the examples")).ok).toBe(true);

  expect((await todos.listOpen()).map((t) => t.title)).toEqual([
    "write the docs",
    "ship the examples",
  ]);

  // Completing a todo drops it from the open list.
  const done = await todos.setDone(added.data, true);
  expect(done.ok).toBe(true);
  expect((await todos.listOpen()).map((t) => t.title)).toEqual(["ship the examples"]);

  // Removing it leaves the rest untouched.
  expect((await todos.remove(added.data)).ok).toBe(true);
  expect((await todos.listOpen()).map((t) => t.title)).toEqual(["ship the examples"]);
});
