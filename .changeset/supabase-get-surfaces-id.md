---
"@baas/adapter-supabase": patch
---

Fix: `store.get()` now surfaces the portable `_id` like `store.list()` does. Previously `get()` returned the raw PostgREST row keyed only by the primary-key column, so a fetched document had no `_id` (an inconsistency with `list()`, and with the Convex adapter whose documents carry `_id` natively). A document fetched via `get()` can now be passed straight to `patch()`/`remove()`. Found by the Marquee dogfood.
