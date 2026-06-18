import { defineConfig } from "tsup";

// Convex is a peer dependency, never bundle it.
const external = ["convex", "convex/server", "convex/values", "convex/browser"];

// Two configs so each entry uses its own tsconfig: the client surface keeps
// isolatedDeclarations (+ the .d.ts snapshot); the deployable helpers cannot
// satisfy it (generic-builder return types are inferred), so they build under
// tsconfig.convex.json. tsup runs the array sequentially, so the FIRST config
// cleans dist and the second must NOT (it would wipe index.* written first).
const common = {
  format: ["esm"] as const,
  dts: true,
  sourcemap: true,
  target: "es2022" as const,
  external,
};

export default defineConfig([
  { ...common, entry: { index: "src/index.ts" }, tsconfig: "tsconfig.json", clean: true },
  {
    ...common,
    entry: { convex: "convex/index.ts" },
    tsconfig: "tsconfig.convex.json",
    clean: false,
  },
]);
