---
"@baas/core": patch
"@baas/adapter-memory": patch
"@baas/adapter-supabase": patch
---

Internal: type-aware lint (typescript-eslint strictTypeChecked) cleanups. Remove unnecessary type assertions and a redundant boolean comparison surfaced by the new lint pass. No behavior or public API change.
