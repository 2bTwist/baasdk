---
"@baas/adapter-supabase": minor
---

Realtime watches can now be filtered. A `realtime` watch entry accepts
`{ table, filter }` (a Supabase Realtime filter string like `"room_id=eq.42"`)
in place of a bare table name, narrowing the subscription to matching rows to cut
fan-out on high-write tables. Bare table names still watch the whole table (the
safe default). Filters are unsafe for columns whose value changes after insert (a
row leaving the filtered set fires no event), so they are opt-in and documented
for append-mostly tables.
