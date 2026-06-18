/**
 * Hermetic half of the spike: convex-test runs the real function code against
 * an in-process mock of the Convex runtime — no login, no deployment.
 *
 * Passing `undefined` for the schema puts it in SCHEMALESS mode, which is the
 * exact condition we need: generic helpers inserting into runtime-variable
 * table names with no schema.ts. If these pass, the adapter's direct-CRUD
 * primitives are generically implementable.
 *
 * Caveat: convex-test is a reimplementation of the runtime, not prod. The live
 * `spike.ts` run confirms the same against a real deployment.
 */

import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { expect, test } from "vitest";

// Load all function modules (exclude *.test.ts and dotfiles).
const modules = import.meta.glob("./**/!(*.*.*)*.*s");

test("generic schemaless CRUD against a runtime-variable table name", async () => {
  const t = convexTest(undefined, modules);

  const id = await t.mutation(anyApi.baas.insert, {
    collection: "todos",
    value: { title: "hermetic", done: false },
  });
  expect(id).toBeTruthy();

  const doc = await t.query(anyApi.baas.get, { id });
  expect(doc).toMatchObject({ title: "hermetic", done: false });

  const all = await t.query(anyApi.baas.list, { collection: "todos" });
  expect(all).toHaveLength(1);

  await t.mutation(anyApi.baas.patch, { id, value: { done: true } });
  expect((await t.query(anyApi.baas.get, { id })).done).toBe(true);

  await t.mutation(anyApi.baas.remove, { id });
  expect(await t.query(anyApi.baas.get, { id })).toBeNull();
});

test("a previously-unseen collection is created on first insert", async () => {
  const t = convexTest(undefined, modules);

  await t.mutation(anyApi.baas.insert, { collection: "notes", value: { body: "x" } });
  await t.mutation(anyApi.baas.insert, { collection: "tags", value: { name: "y" } });

  expect(await t.query(anyApi.baas.list, { collection: "notes" })).toHaveLength(1);
  expect(await t.query(anyApi.baas.list, { collection: "tags" })).toHaveLength(1);
});

test("named operations behave like store.run / store.mutate", async () => {
  const t = convexTest(undefined, modules);

  expect(await t.query(anyApi.todos.listTodos, {})).toHaveLength(0);
  await t.mutation(anyApi.todos.addTodo, { title: "buy milk" });
  expect(await t.query(anyApi.todos.listTodos, {})).toHaveLength(1);
});
