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
      // More specific subpath alias MUST precede the bare package alias: Vite
      // matches string aliases by prefix, so the bare one would otherwise capture
      // the `/convex` import too.
      "@baas/adapter-convex/convex": src("./packages/adapter-convex/convex/index.ts"),
      "@baas/adapter-convex": src("./packages/adapter-convex/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts"],
    // convex-test runs the real function code in an edge runtime and must not be
    // pre-bundled (it inspects import.meta.glob module maps). Harmless for other
    // packages; the convex hermetic test opts into the env via a file docblock.
    server: { deps: { inline: ["convex-test"] } },
    typecheck: {
      enabled: true,
      include: ["packages/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
  },
});
