/**
 * Memory-only unit test for the `list` page-size clamp. The clamp arithmetic
 * (`Math.min(limit, 200)`) is identical across adapters, so proving it once here
 * (250 rows, instant in memory) is cheaper than seeding 200+ rows on every live
 * backend in the conformance suite.
 */

import { createMemoryBackend } from "@baas/adapter-memory";
import { describe, expect, it } from "vitest";

describe("memory list() page-size clamp", () => {
  it("clamps a requested limit above 200 down to 200", async () => {
    const backend = createMemoryBackend({ queries: {}, mutations: {} });
    for (let i = 0; i < 250; i++) {
      const r = await backend.store.insert("things", { i });
      expect(r.ok).toBe(true);
    }
    const r = await backend.store.list("things", { limit: 1000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.items).toHaveLength(200);
      expect(r.data.nextCursor).not.toBeNull();
    }
  });
});
