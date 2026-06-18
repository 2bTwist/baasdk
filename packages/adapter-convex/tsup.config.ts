import { defineConfig } from "tsup";

// Convex is a peer dependency, never bundle it.
const external = ["convex", "convex/server", "convex/values", "convex/browser"];

// Two configs so each entry uses its own tsconfig: the client surface keeps
// isolatedDeclarations (+ the .d.ts snapshot); the deployable helpers cannot
// satisfy it (generic-builder return types are inferred), so they build under
// tsconfig.convex.json. Only the first cleans dist.
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "es2022",
    tsconfig: "tsconfig.json",
    external,
  },
  {
    entry: { convex: "convex/index.ts" },
    format: ["esm"],
    dts: true,
    clean: false,
    sourcemap: true,
    target: "es2022",
    tsconfig: "tsconfig.convex.json",
    external,
  },
]);
