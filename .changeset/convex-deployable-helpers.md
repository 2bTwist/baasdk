---
"@baas/adapter-convex": minor
---

Add `@baas/adapter-convex` with its deployable server helpers (the `./convex`
entry): schemaless, table-name-first CRUD (`insert`/`get`/`list`/`patch`/
`remove`), file storage (`generateUploadUrl`/`getFileUrl`/`deleteFile`), and an
auth `whoami`, built on Convex's generic `queryGeneric`/`mutationGeneric`
builders so they ship from npm with no codegen dependency. Proven hermetically
with `convex-test`. The client-side adapter follows.
