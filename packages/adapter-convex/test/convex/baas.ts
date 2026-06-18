/**
 * The test app's `baas.ts`, mirrors EXACTLY what a consumer adds to their own
 * Convex project, except the source path. A consumer writes:
 *
 *   export * from "@baas/adapter-convex/convex";
 *
 * Here it re-exports the package SOURCE (relative) so the hermetic convex-test
 * and the live conformance suite exercise the real shipped helper code, not a
 * copy. `npx convex codegen`/`dev` (and convex-test) treat each re-exported
 * registered function as one of this app's own functions: `anyApi.baas.insert`.
 */
export * from "../../convex/index";
