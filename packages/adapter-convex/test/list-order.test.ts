/**
 * Convex-specific: ordering `list` by a field with no `by_<field>` index returns
 * an `unsupported_capability` error (not a throw, not a silent fallback). This is
 * NOT portable, Supabase/memory order by any field, so it lives here rather than
 * in the shared conformance suite. The test app indexes `by_n`/`by_tag` on `items`
 * (see test/convex/schema.ts) but deliberately NOT `nilable`.
 */
import type { DocumentId } from "@baas/core";
import { describe, expect, it } from "vitest";
import { convexAvailable, makeConvexConformanceBackend } from "./fixture.js";

(convexAvailable ? describe : describe.skip)("convex list() ordering by an unindexed field", () => {
  it("returns unsupported_capability (no by_nilable index)", async () => {
    const backend = await makeConvexConformanceBackend();
    expect(
      (await backend.store.insert("items", { n: 1, tag: "a", nilable: null, flag: false })).ok,
    ).toBe(true);
    const r = await backend.store.list("items", { order: { field: "nilable" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unsupported_capability");
  });

  it("orders by an indexed field (by_n) without error", async () => {
    const backend = await makeConvexConformanceBackend();
    expect(
      (await backend.store.insert("items", { n: 2, tag: "a", nilable: null, flag: false })).ok,
    ).toBe(true);
    expect(
      (await backend.store.insert("items", { n: 1, tag: "b", nilable: null, flag: false })).ok,
    ).toBe(true);
    const r = await backend.store.list<{ _id: DocumentId; n: number }>("items", {
      order: { field: "n" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.items.map((i) => i.n)).toEqual([1, 2]);
  });
});
