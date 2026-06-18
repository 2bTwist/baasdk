---
"@baas/adapter-convex": minor
---

Add the client-side Convex adapter (the `.` entry): `createConvexBackend` /
`convexAdapter` with `ConvexDocumentStore` (named ops via FunctionReferences,
direct CRUD + reactive `subscribe` via the deployed helpers), `ConvexAuth`
(verify-only, `managesCredentials: false`, `forceRefreshToken` adapted), and
`ConvexFileStore` (the upload-URL-then-POST dance). Passes the full conformance
suite against a live deployment. The deployable helpers now normalize Convex's
throw-on-missing/foreign-id into the portable contract (idempotent `remove`,
`not_found` `patch`, `null` `get`).
