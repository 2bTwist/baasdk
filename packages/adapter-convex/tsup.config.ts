import { defineConfig } from "tsup";

// Convex is a peer dependency, never bundle it.
const external = ["convex", "convex/server", "convex/values", "convex/browser"];

// Two configs so each entry uses its own tsconfig: the client surface keeps
// isolatedDeclarations (+ the .d.ts snapshot); the deployable helpers cannot
// satisfy it (generic-builder return types are inferred), so they build under
// tsconfig.convex.json. NEITHER cleans: the two configs run concurrently, so a
// `clean: true` on one could wipe the other's just-written output. The `build`
// script does a single `rm -rf dist` first instead.
const common = {
  format: ["esm"] as const,
  dts: true,
  clean: false,
  sourcemap: true,
  target: "es2022" as const,
  external,
};

export default defineConfig([
  { ...common, entry: { index: "src/index.ts" }, tsconfig: "tsconfig.json" },
  { ...common, entry: { convex: "convex/index.ts" }, tsconfig: "tsconfig.convex.json" },
]);
