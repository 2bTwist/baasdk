import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Cross-package imports resolve to TypeScript source (not built dist), so the
// conformance suite runs without a prior build step. These aliases mirror the
// `paths` in tsconfig.base.json.
const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@baas/core": src("./packages/core/src/index.ts"),
      "@baas/conformance": src("./packages/conformance/src/index.ts"),
      "@baas/adapter-memory": src("./packages/adapter-memory/src/index.ts"),
      "@baas/adapter-supabase": src("./packages/adapter-supabase/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts"],
    typecheck: {
      enabled: true,
      include: ["packages/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
  },
});
