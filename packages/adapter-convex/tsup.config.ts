import { defineConfig } from "tsup";

// One entry for now: the deployable server helpers (the `./convex` export). The
// client adapter (`.` / `src/index.ts`) lands with its own entry next, under a
// separate config so it can keep isolatedDeclarations while the helpers do not.
export default defineConfig({
  entry: { convex: "convex/index.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  tsconfig: "tsconfig.convex.json",
  // Convex is a peer dependency, never bundle it.
  external: ["convex", "convex/server", "convex/values", "convex/browser"],
});
