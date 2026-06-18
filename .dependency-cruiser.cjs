/**
 * Ports-and-adapters boundary gate. Run as `pnpm lint:boundaries` and in CI,
 * separately from lint, so a violation reads as an architectural failure.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "core-no-provider-sdk",
      comment: "core is ports-only: it must not import any backend/provider SDK.",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: "node_modules/(@supabase/supabase-js|convex)" },
    },
    {
      name: "core-no-adapters",
      comment: "core must not depend on any adapter (dependency inversion).",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: "^packages/adapter-" },
    },
    {
      name: "adapters-only-core",
      comment: "an adapter may depend on core, never on a sibling adapter.",
      severity: "error",
      from: { path: "^packages/(adapter-[^/]+)/" },
      to: { path: "^packages/adapter-", pathNot: "^packages/$1/" },
    },
    {
      name: "no-circular",
      comment: "no import cycles anywhere in the graph.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // Record edges into node_modules (so provider-SDK imports are visible to the
    // rules) but don't recurse into them.
    doNotFollow: { path: "node_modules" },
    // Exclude our own build output and the throwaway spike. Anchored to
    // `^packages/*/dist/` so it does NOT match node_modules packages that ship
    // from dist/ — dropping those would silently hide the provider-SDK edges
    // core-no-provider-sdk must catch.
    exclude: { path: "^packages/[^/]+/dist/|^spike/" },
    // tsconfig.json (not base) carries the @baas/* path map, so cross-package
    // imports resolve to source — no build needed, paths stay under packages/.
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types"],
    },
  },
};
