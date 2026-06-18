---
"@baas/core": minor
---

Add `CAPABILITY_KEYS`, the runtime list of every `Capabilities` key, kept exhaustive against the interface by a type-level test (`as const` literal tuple). It is a trustworthy source of truth for iterating capabilities, used by the conformance suite's new capability-coverage meta-test to guard against a newly added flag silently going untested.
