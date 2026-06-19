---
"@baas/migrate": patch
---

Fix: use a portable resume marker `migratedFrom` (no leading underscore) instead
of `_migratedFrom`. Convex rejects any user field whose name starts with `_`
("only allowed for system fields like `_id`"), so the old marker made Convex
unusable as a migration target. The new name is accepted by Convex, Supabase, and
the in-memory adapter alike. Caught by driving a real Supabase -> Convex cutover
against live stacks (the memory -> memory suite could not surface it); a guard test
now asserts the marker carries no leading underscore.
