/**
 * Type-aware lint layer ONLY. Biome owns formatting and all non-type-aware
 * rules (and `useImportType` = consistent-type-imports), so this config does NOT
 * extend eslint:recommended; it adds only what needs the type-checker.
 *
 * Scoping notes:
 *  - `no-throw-statements` is enforced on `core` only. Adapters are single-file
 *    and legitimately throw internally (caught and converted to `err()` at the
 *    boundary, which the conformance suite verifies), so a file-scoped no-throw
 *    would false-positive on them.
 *  - The "core imports no provider SDK / no type leak" rule lives in
 *    dependency-cruiser (`core-no-external-deps`), which bans ALL external
 *    imports there, so it is not duplicated here.
 */

import comments from "@eslint-community/eslint-plugin-eslint-comments";
import functional from "eslint-plugin-functional";
import tseslint from "typescript-eslint";
import baasLocal from "./eslint-local/must-use-result.mjs";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/_generated/**",
      "spike/**",
      "**/*.config.{ts,mts,cts,js,mjs,cjs}",
      "eslint-local/**",
    ],
  },
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        // The root tsconfig carries the @baas/* path map, so cross-package types
        // resolve to SOURCE. That keeps typed lint independent of a prior build
        // (the lint-types CI job has no dist), matching how tests and the editor
        // resolve. projectService would pick per-package tsconfigs that resolve
        // @baas/* to dist, which only exists after a build.
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "baas-local": baasLocal,
      "@eslint-community/eslint-comments": comments,
    },
    rules: {
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { requireDefaultForNonUnion: true },
      ],
      "@typescript-eslint/return-await": ["error", "always"],
      "@typescript-eslint/no-deprecated": "error",
      // Biome owns useImportType; don't double-report.
      "@typescript-eslint/consistent-type-imports": "off",
      // Every eslint-disable must say why (zero silent suppressions).
      "@eslint-community/eslint-comments/require-description": "error",
      // A returned Result must be consumed (custom type-aware rule).
      "baas-local/must-use-result": "error",
      // Port methods are `async` to satisfy a Promise-returning interface even
      // when they wrap a synchronous result; that is intentional, not a smell.
      "@typescript-eslint/require-await": "off",
      // Public generic APIs (e.g. `store.get<T>(...)`) take a caller-specified
      // type parameter used once by design; inlining it would break ergonomics.
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
      // Numbers in template literals are idiomatic (ids, counters).
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // `_`-prefixed params are intentionally unused (interface conformance).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Adapters guard against runtime values the static types over-promise:
    // dynamic operation dispatch (an unknown op name reaches `if (!fn)`) and
    // external provider responses. Those guards are correct; the rule isn't.
    files: ["packages/adapter-*/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["packages/core/src/**/*.ts"],
    plugins: { functional },
    rules: {
      "functional/no-throw-statements": ["error", { allowToRejectPromises: true }],
    },
  },
  {
    // Deployable Convex helpers (the `./convex` entry) run against AnyDataModel
    // in schemaless mode, so `ctx.db`/`ctx.storage` are typed `any` BY DESIGN,
    // and the unsafe-* family would fire on essentially every generic db call.
    // The real bugs to keep catching are the same as for tests: a floating
    // promise, a dropped Result, a deprecated API. So relax ONLY the unsafe
    // family, nothing else.
    files: ["packages/*/convex/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    // Runtime tests and the reference fixtures tolerate provider `any`, but must
    // STILL catch the real bugs the example code should never model: a forgotten
    // `await` (floating promise) or a dropped Result.
    files: ["**/*.test.ts", "**/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    // Type-level assertions in *.test-d.ts are never executed at runtime and
    // reference methods unbound on purpose.
    files: ["**/*.test-d.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/unbound-method": "off",
      "baas-local/must-use-result": "off",
    },
  },
);
