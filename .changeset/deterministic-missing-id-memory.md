---
"@baas/adapter-memory": patch
---

`remove()` of a non-existent id is now idempotent (returns `ok`) instead of erroring, establishing the portable contract the conformance suite enforces. `remove()` reaches a desired end state, so a redundant remove succeeds; `patch()` still requires an existing document and reports `not_found`.
