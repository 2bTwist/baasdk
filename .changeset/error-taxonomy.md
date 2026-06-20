---
"@baas/adapter-supabase": patch
---

Map more Postgres SQLSTATE codes to the portable error taxonomy so a condition
surfaces as the same `ErrorCode` it does on the other adapters. Notably **`42501`
(insufficient_privilege, the SQLSTATE an RLS denial reaches the client as) now maps
to `unauthorized`** instead of falling through to `unknown`; also `23503`
(foreign_key_violation) -> `conflict`, and `23502`/`23514`/`22P02`
(not_null / check / invalid_text_representation) -> `validation`. The normalizer
moved to `src/errors.ts` (internal, not part of the public surface) and is now
unit-tested against the full mapping table; the Convex normalizer gained matching
unit tests for parity.
