# Marquee

Marquee is a movie-catalog app that dogfoods the `@baas` SDK, a provider-agnostic
backend abstraction. It talks to its backend only through the portable `@baas/core`
port (`insert`/`list`/`get`/`patch`/`remove`/`subscribe`), so the same UI can run on
an in-memory store today and on Supabase or Convex later, proving the SDK's
thin-honest-waist thesis under a real app.

## Run it

```sh
pnpm install            # from the repo root
pnpm --filter marquee dev
```

The dev server starts on http://localhost:5174. Click "Add sample movie" to insert a
movie through the store and see it round-trip back into the catalog.

Scripts:

- `pnpm --filter marquee dev` — Vite dev server on port 5174
- `pnpm --filter marquee build` — production build
- `pnpm --filter marquee typecheck` — `tsc --noEmit`

## Backends

Phase 0 wires the in-memory backend live. The Supabase and Convex segments appear in
the header switcher but are disabled ("Available in Phase 1"); selecting an initial
backend via the optional `VITE_BAAS_BACKEND` env var falls back to memory until those
adapters are wired in Phase 1.
