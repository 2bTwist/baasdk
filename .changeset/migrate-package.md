---
"@baas/migrate": minor
---

New package `@baas/migrate`: a one-time portable data cutover between any two
Backends, built on the core `list`/`insert`/`patch` primitives (no provider SDK).
`migrate(source, target, { collections, relations?, stripFields?, batchSize?,
onProgress? })` pages the source, re-inserts each row into the target (stamping
`migratedFrom: <oldId>` and stripping backend system fields), and optionally
remaps foreign keys to the target's re-minted ids in a second pass. It is
idempotent/resumable (re-runs skip rows already stamped on the target) and
fail-fast (the first backend error stops the run and is returned with the partial
`idMap` intact, never thrown). Proven memory → memory in the test suite; the live
Supabase → Convex cutover is a manual smoke. Explicitly NOT live sync, NOT atomic
across backends, and NOT a schema/DDL tool, a deliberate cutover documented as
such.
