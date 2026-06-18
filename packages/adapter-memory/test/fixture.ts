/**
 * Shared wiring of the canonical `ConformanceSchema` onto the in-memory
 * adapter. This is the template a real adapter author follows: implement each
 * named query/mutation against the backend's primitives.
 *
 * Exposed as a factory so the same wiring can be run with different declared
 * capabilities, proving the suite's capability gating flips behavior rather than
 * the adapter quietly doing the same thing.
 */

import { createMemoryBackend, MemoryError } from "@baas/adapter-memory";
import type { ConformanceSchema, Todo } from "@baas/conformance";
import type { Backend, Capabilities } from "@baas/core";

export function makeMemoryConformanceBackend(
  capabilities?: Partial<Capabilities>,
): Backend<ConformanceSchema> {
  return createMemoryBackend<ConformanceSchema>({
    ...(capabilities ? { capabilities } : {}),
    queries: {
      listTodos: (ctx) => ctx.all<Todo>("todos"),
      getTodo: (ctx, { id }) => ctx.get<Todo>("todos", id),
    },
    mutations: {
      addTodo: (ctx, { title }) => ctx.insert("todos", { title, done: false }),
      toggleTodo: (ctx, { id }) => {
        const todo = ctx.get<Todo>("todos", id);
        if (!todo) throw new MemoryError("not_found", `no todo ${id}`);
        ctx.patch("todos", id, { done: !todo.done });
      },
      addThenFail: (ctx, { title }) => {
        ctx.insert("todos", { title, done: false });
        throw new Error("intentional failure — probes transaction rollback");
      },
    },
  });
}
