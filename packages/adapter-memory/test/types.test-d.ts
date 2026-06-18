/**
 * Type-level conformance for the in-memory adapter: the factory must produce a
 * `Backend` bound to the schema, and the config must be checked against the
 * schema's declared arg/result types.
 */

import { createMemoryBackend } from "@baas/adapter-memory";
import type { ConformanceSchema, Todo } from "@baas/conformance";
import type { Backend } from "@baas/core";
import { describe, expectTypeOf, it } from "vitest";

describe("createMemoryBackend typing", () => {
  it("returns a Backend bound to the supplied schema", () => {
    const backend = createMemoryBackend<ConformanceSchema>({
      queries: {
        listTodos: (ctx) => ctx.all<Todo>("todos"),
        getTodo: (ctx, { id }) => ctx.get<Todo>("todos", id),
      },
      mutations: {
        addTodo: (ctx, { title }) => ctx.insert("todos", { title, done: false }),
        toggleTodo: (ctx, { id }) => {
          ctx.patch("todos", id, { done: true });
        },
        addThenFail: (ctx, { title }) => {
          ctx.insert("todos", { title, done: false });
          throw new Error("boom");
        },
      },
    });
    expectTypeOf(backend).toEqualTypeOf<Backend<ConformanceSchema>>();
  });

  it("rejects an operation whose return type violates the schema", () => {
    createMemoryBackend<ConformanceSchema>({
      queries: {
        // @ts-expect-error listTodos must return Todo[], not number
        listTodos: () => 42,
        getTodo: (ctx, { id }) => ctx.get<Todo>("todos", id),
      },
      mutations: {
        addTodo: (ctx, { title }) => ctx.insert("todos", { title, done: false }),
        toggleTodo: () => {},
        addThenFail: () => {
          throw new Error("boom");
        },
      },
    });
  });
});
