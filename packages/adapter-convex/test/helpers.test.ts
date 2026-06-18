// @vitest-environment edge-runtime
/**
 * Hermetic proof of the DEPLOYABLE helpers (the `./convex` entry), run with
 * `convex-test`, an in-process reimplementation of the Convex runtime, so no
 * login and no deployment. This is the red-green tripwire for the table-name-
 * first rewrite (the spike proved only the deprecated single-arg API).
 *
 * `convexTest(undefined, ...)` selects SCHEMALESS mode, exactly the condition
 * the generic helpers need: inserting into runtime-variable table names with no
 * `schema.ts`. The modules map is globbed from the test app in `./convex`
 * (which re-exports the real shipped helpers); the `_generated` dir present
 * there is what lets convex-test resolve module paths.
 *
 * What this CANNOT cover (live-only, see the conformance suite): reactivity /
 * WebSocket dispatch, real `setAuth` wiring, the upload HTTP dance, and
 * production error-message fidelity.
 */

import { anyApi, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

// Vitest provides `import.meta.glob` at runtime (Vite's API); the type isn't in
// the base lib, so narrow it locally rather than pulling in vite/client ambients
// (which a triple-slash reference would need, and the lint forbids that).
const modules = (
  import.meta as ImportMeta & {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
).glob("./convex/**/!(*.*.*)*.*s");

// `anyApi` types every module/function access as possibly-`undefined`, it can't
// know a schemaless app's functions. They DO exist in the test app, so reference
// them through one narrow typed view (cleaner than asserting at each call site,
// and avoids `as any`, which biome forbids).
const baas = anyApi.baas as unknown as {
  insert: FunctionReference<"mutation">;
  get: FunctionReference<"query">;
  list: FunctionReference<"query">;
  patch: FunctionReference<"mutation">;
  remove: FunctionReference<"mutation">;
  whoami: FunctionReference<"query">;
};

describe("@baas/adapter-convex deployable helpers (hermetic)", () => {
  it("insert / get / list / patch / remove round-trip on the table-name-first API", async () => {
    const t = convexTest(undefined, modules);

    const id = await t.mutation(baas.insert, {
      collection: "notes",
      value: { body: "hello", pinned: false },
    });
    expect(id).toBeTruthy();

    const doc = await t.query(baas.get, { collection: "notes", id });
    expect(doc).toMatchObject({ body: "hello", pinned: false });

    expect(await t.query(baas.list, { collection: "notes" })).toHaveLength(1);

    await t.mutation(baas.patch, { collection: "notes", id, value: { pinned: true } });
    const patched = await t.query(baas.get, { collection: "notes", id });
    expect(patched.pinned).toBe(true);
    // patch is a shallow MERGE, not a replace: the untouched field survives.
    expect(patched.body).toBe("hello");

    await t.mutation(baas.remove, { collection: "notes", id });
    expect(await t.query(baas.get, { collection: "notes", id })).toBeNull();
  });

  it("creates a previously-unseen collection on first insert", async () => {
    const t = convexTest(undefined, modules);

    await t.mutation(baas.insert, {
      collection: "todos",
      value: { title: "x", done: false },
    });
    await t.mutation(baas.insert, { collection: "tags", value: { name: "y" } });

    expect(await t.query(baas.list, { collection: "todos" })).toHaveLength(1);
    expect(await t.query(baas.list, { collection: "tags" })).toHaveLength(1);
  });

  // NOTE on system-field stripping: the helper strips `_id`/`_creationTime` so a
  // fetched doc can be re-inserted without a prod throw. There is deliberately NO
  // hermetic test for it, convex-test's reimplementation does NOT enforce
  // `WithoutSystemFields` on insert (verified: the assertion stays green with the
  // strip removed), so any such test would be vacuously green. It is a prod-only
  // safeguard; the live suite is the real check if a reinsert path is added.

  it("whoami returns null unauthenticated and the identity under withIdentity", async () => {
    const t = convexTest(undefined, modules);

    expect(await t.query(baas.whoami, {})).toBeNull();

    const asAlice = t.withIdentity({ subject: "alice", issuer: "https://issuer.test" });
    const identity = await asAlice.query(baas.whoami, {});
    expect(identity).toMatchObject({ subject: "alice", issuer: "https://issuer.test" });
  });

  // Deterministic CRUD edge cases the conformance contract requires. Raw Convex
  // throws on each of these (verified: "Delete on non-existent doc", "Patch on
  // non-existent document", "expected ID in table X"); the helpers normalize them.

  it("remove of a missing id is idempotent (no throw)", async () => {
    const t = convexTest(undefined, modules);
    const id = await t.mutation(baas.insert, { collection: "notes", value: { body: "x" } });
    await t.mutation(baas.remove, { collection: "notes", id });
    // Second remove of the now-gone id must NOT throw.
    await t.mutation(baas.remove, { collection: "notes", id });
    expect(await t.query(baas.get, { collection: "notes", id })).toBeNull();
  });

  it("patch of a missing id throws a not_found ConvexError (survives prod scrubbing)", async () => {
    const t = convexTest(undefined, modules);
    const id = await t.mutation(baas.insert, { collection: "notes", value: { body: "x" } });
    await t.mutation(baas.remove, { collection: "notes", id });

    const error = await t
      .mutation(baas.patch, { collection: "notes", id, value: { body: "y" } })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<{ code: string }>).data).toMatchObject({ code: "not_found" });
  });

  it("get of a foreign-table id returns null (not a throw)", async () => {
    const t = convexTest(undefined, modules);
    const todoId = await t.mutation(baas.insert, { collection: "todos", value: { title: "t" } });
    // A valid id, but for a different table: absent, not an error.
    expect(await t.query(baas.get, { collection: "notes", id: todoId })).toBeNull();
  });
});
