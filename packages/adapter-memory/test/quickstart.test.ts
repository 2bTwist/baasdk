/**
 * The README "Quickstart" snippet, executed in CI so it can't rot.
 *
 * The code between the `#region quickstart` / `#endregion` markers is the single
 * source of truth for the README block: `scripts/quickstart-snippet.mjs`
 * extracts it and `--check` (run in `verify` + CI) fails if the committed README
 * has drifted. Keep that region as clean, copy-pasteable user code (imports,
 * schema, wiring, one write, one read). Test scaffolding stays OUTSIDE the region.
 *
 * Memory + core only: an adapter test that imported a sibling adapter would
 * violate the `adapters-only-core` dependency-cruiser boundary (it applies to
 * `test/` too), so the quickstart deliberately uses the in-memory adapter, which
 * needs no server and is the "first query in under 10 minutes" path.
 */

// #region quickstart
import { createMemoryBackend } from "@baas/adapter-memory";
import type { DocumentId, StoreSchema } from "@baas/core";

// 1. Describe your backend surface: named reads (`queries`) and writes
//    (`mutations`), each with its arg and result types. This is the contract;
//    every adapter implements the same named operations.
interface Todo {
  _id: DocumentId;
  title: string;
}
interface TodoSchema extends StoreSchema {
  queries: {
    listTodos: { args: Record<string, never>; result: Todo[] };
  };
  mutations: {
    addTodo: { args: { title: string }; result: DocumentId };
  };
}

// 2. Wire the schema to a backend. The in-memory adapter needs no server, so it
//    runs anywhere (tests, a REPL, a demo) with the same contract as Supabase
//    or Convex. Each operation is a plain function over a tiny document context.
const backend = createMemoryBackend<TodoSchema>({
  queries: {
    listTodos: (ctx) => ctx.all<Todo>("todos"),
  },
  mutations: {
    addTodo: (ctx, { title }) => ctx.insert("todos", { title }),
  },
});

// 3. First write, then first query. Every call returns a `Result`, either
//    `{ ok: true, data }` or `{ ok: false, error }`, so errors are values
//    rather than thrown exceptions, uniformly across every backend.
async function quickstart() {
  const added = await backend.store.mutate("addTodo", { title: "Ship baasdk" });
  if (!added.ok) throw new Error(added.error.message);

  const result = await backend.store.run("listTodos", {});
  if (!result.ok) throw new Error(result.error.message);

  return result.data; // [{ _id: "todos:1", title: "Ship baasdk" }]
}

// #endregion

import { expect, test } from "vitest";

test("quickstart: first write + first query returns the inserted todo", async () => {
  const todos = await quickstart();

  expect(todos).toHaveLength(1);
  expect(todos[0]).toMatchObject({ title: "Ship baasdk" });
  expect(todos[0]?._id).toBeTypeOf("string");
});
