/**
 * Marquee's `baas.ts`, exactly what any `@baas/adapter-convex` consumer adds to
 * their own Convex project. Re-exporting the package's deployable helpers makes
 * `convex dev` deploy them as THIS app's functions (`anyApi.baas.insert`, etc.),
 * which the client-side adapter dispatches to for the portable store CRUD.
 */
export * from "@baas/adapter-convex/convex";
