---
"@baas/adapter-supabase": patch
---

Fix: `subscribe()` and `files.upload()` no longer crash in a non-secure browser context. Both used `crypto.randomUUID()` (for the Realtime channel name and the default Storage path), but `crypto.randomUUID` is defined ONLY in secure contexts (https, or http on `localhost`). On a plain-http origin such as a LAN-IP dev server (`http://192.168.x.x`) or any non-https deployment it is `undefined`, so opening a live subscription threw `TypeError: crypto.randomUUID is not a function` and unmounted the React tree. Both now use an internal id helper that prefers `crypto.randomUUID()` and falls back to a time + counter + `Math.random()` id when it is unavailable. Found by the Marquee dogfood (the realtime UI smoke over a LAN IP).
