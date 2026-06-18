import { defineConfig } from "vitest/config";

// convex-test requires the edge-runtime environment and inlining convex-test.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
