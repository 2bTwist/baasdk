# baasdk demo

One todo app, running on two backends, with a one-click migrate between them. The
center panel is the app; the left and right panels are the raw database rows, so
you can watch what the app writes and see it move when you migrate.

## Run it (in-memory, no setup)

```bash
pnpm install
pnpm demo
```

Open **http://localhost:8788**. By default it runs **entirely in-memory in your
browser**: no server, no database, nothing saved. This is also what's published to
GitHub Pages, so a public visitor can never touch a real database.

## Run it against real backends (your own)

The demo only ever talks to backends *you* run, never a shared one:

1. Start your own local Supabase and Convex:
   ```bash
   # Supabase (needs Docker): from packages/adapter-supabase
   supabase start
   # Convex (in another terminal): from packages/adapter-convex
   npx convex dev
   ```
   Your `todos` table needs a `migratedFrom text` column for the migrate to land
   (Supabase: `alter table todos add column "migratedFrom" text;`).
2. Point the demo at them:
   ```bash
   cp demo/config.example.js demo/config.js
   # edit demo/config.js: set mode:"real" and fill in your URLs + anon key
   ```
   `demo/config.js` is gitignored, so your keys never get committed.
3. `pnpm demo` again. It now reads and writes your real Supabase and Convex.

## Give this to an agent

Most setup is faster to hand to a coding agent. Copy/paste:

> Clone https://github.com/2bTwist/baasdk and run `pnpm install`, then `pnpm demo`.
> Open http://localhost:8788 and confirm the demo loads: add a couple of todos,
> check one off, and click the provider toggle to watch the todos migrate to the
> other backend. It runs fully in-memory, so no database is needed. If I ask for
> real backends, start a local Supabase (`supabase start`, needs Docker) and Convex
> (`npx convex dev`), add a `"migratedFrom" text` column to the `todos` table, then
> copy `demo/config.example.js` to `demo/config.js`, set `mode:"real"` with the
> local URLs and anon key, and run `pnpm demo` again.

## Heads up

baasdk is a weekend project, not a product (see the root README). This demo is for
playing with the API, not a benchmark of either backend.
