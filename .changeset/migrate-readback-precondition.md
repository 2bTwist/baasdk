---
"@baas/migrate": patch
---

Enforce the read-after-write precondition and document migration preconditions.
After the first row it copies into each collection, `migrate()` now reads that
row back and aborts with a `validation` error if it is invisible ("inserted a row
but could not read it back"). This converts a silent footgun into a loud, early
failure: a Supabase target reached without a service-role key can have RLS that
allows the insert but denies the select, in which case the resume scan would
silently see an empty target and re-copy everything (duplicates) on a re-run. The
check is portable (it asserts only "what I just wrote, I can read back" and never
inspects RLS) and costs one extra read per collection.

`MigrateEndpoint` now requires `get` on its `store` (alongside `list`/`insert`/
`patch`); any whole `Backend` already satisfies this. The README gains a
Preconditions section: Supabase targets need a service-role key (or RLS granting
read + write); Convex targets re-mint `_id`, so `report.idMap` is the only
old-to-new link and id stability is never promised.
