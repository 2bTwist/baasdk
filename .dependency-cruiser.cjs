/**
 * Ports-and-adapters boundary gate. Run as `pnpm lint:boundaries` and in CI,
 * separately from lint, so a violation reads as an architectural failure.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "core-no-external-deps",
      comment:
        "core is ports-only: it must not import ANY npm package (no backend SDK, none). It may import only @baas/* (resolved to source) and node builtins. This is an allowlist that fails CLOSED: any external import, declared in package.json or hoisted, is a violation. Scoped to src/ so build configs (tsup.config) are exempt.",
      severity: "error",
      from: { path: "^packages/core/src/" },
      to: {
        dependencyTypes: [
          "npm",
          "npm-dev",
          "npm-optional",
          "npm-peer",
          "npm-no-pkg",
          "npm-unknown",
        ],
      },
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
      name: "src-no-test-or-harness",
      comment:
        "publishable src must not import test files or the dev-only conformance harness, which would ship dev code and pull vitest into consumers.",
      severity: "error",
      from: { path: "^packages/(core|adapter-[^/]+)/src/" },
      to: { path: "^packages/conformance/|^packages/[^/]+/test/" },
    },
    {
      name: "no-unresolvable",
      comment:
        "every import under packages/*/src must resolve, so a dropped edge (e.g. a new package missing from tsconfig paths) cannot silently hide a boundary violation.",
      severity: "error",
      from: { path: "^packages/[^/]+/src/" },
      to: { couldNotResolve: true },
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
    // rules) but do not recurse into them.
    doNotFollow: { path: "node_modules" },
    // Exclude our own build output and the throwaway spike. Anchored to
    // `^packages/*/dist/` so it does NOT match node_modules packages that ship
    // from dist/; dropping those would hide the provider edges core must reject.
    exclude: { path: "^packages/[^/]+/dist/|^spike/" },
    // tsconfig.json (not base) carries the @baas/* path map, so cross-package
    // imports resolve to source. No build needed, paths stay under packages/.
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types"],
    },
  },
};
