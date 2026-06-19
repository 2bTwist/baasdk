---
"@baas/adapter-supabase": minor
---

Add opt-in live `subscribe()` via a `realtime` watch map. Declaring
`realtime: { <query>: { tables: [...] } }` flips `reactiveQueries` on and makes
`subscribe()` deliver live updates: a change to a watched table re-runs the query
and delivers the full fresh result (the same shape Convex delivers), coalesced
over a short debounce. Channel failures and subscribing to a query with no
declared watch surface as loud error `Result`s rather than silently degrading to
one-shot. Requires the watched tables in the `supabase_realtime` publication. The
default (no `realtime` config) is unchanged: `reactiveQueries: false`, one-shot.
