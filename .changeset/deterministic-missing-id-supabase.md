---
"@baas/adapter-supabase": patch
---

`patch()` of a non-existent id now returns `err(not_found)` instead of silently succeeding, matching the portable conformance contract. PostgREST reports no error for an update that affects 0 rows, so the adapter now adds `.select(pk)` and treats an empty result as `not_found`. `remove()` remains an idempotent no-op. (Caveat: under RLS, an update permitted but a select denied would also surface as `not_found`.)
