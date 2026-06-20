# Marquee

Marquee is a movie-catalog app that dogfoods the `@baas` SDK, a provider-agnostic
backend abstraction. It talks to its backend only through the portable `@baas/core`
port (`insert`/`list`/`get`/`patch`/`remove`), so the identical UI runs on an
in-memory store, on Supabase, and on Convex, proving the SDK's thin-honest-waist
thesis under a real, relational app.

Phase 1 builds the portable catalog: list with genre + year filtering, three sorts,
and cursor pagination; movie detail; create and edit, all through the core port, on
both live backends. The header switcher flips the live backend at runtime.

## Run the app (in-memory, zero setup)

```sh
pnpm install            # from the repo root
pnpm --filter marquee dev
```

The dev server starts on http://localhost:5174 on the in-memory backend. Use the
header switcher to change backends (Supabase/Convex appear once their env is set,
see below).

## Run against the live backends

Copy `.env.example` to `.env.local`, then stand up each backend. Both run locally
with no cloud account.

### Supabase (Marquee's own local project, port-offset +1000 from the adapter's)

```sh
supabase start --workdir apps/marquee -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,mailpit
supabase status --workdir apps/marquee -o env   # copy ANON_KEY -> VITE_SUPABASE_ANON_KEY
```

The schema lives in `supabase/migrations/0001_marquee.sql` (movies, genres,
movieGenres). Domain columns are camelCase so they are byte-identical to the Convex
field names the portable store reads and writes.

### Convex (local deployment, no login)

```sh
cd apps/marquee && npx convex dev      # writes VITE_CONVEX_URL to .env.local, leave running
```

`convex/schema.ts` declares the same tables with the `by_year`/`by_title` indexes
portable field-ordering needs; `convex/baas.ts` re-exports the adapter's deployable
CRUD helpers.

### Seed

```sh
# from apps/marquee, with the matching env exported (SUPABASE_URL/SUPABASE_KEY or CONVEX_URL)
npx tsx scripts/seed.mts supabase
npx tsx scripts/seed.mts convex
```

Deterministic: 16 genres, 300 movies, 600 movieGenres join rows.

## Tests

`test/catalog.live.test.ts` is the data-layer integration gate: it drives
`src/lib/movies.ts` (the same functions the UI calls) against a live backend and
asserts the catalog contract holds identically on Supabase and Convex. It self-skips
per backend when that backend's env is absent.

```sh
SUPABASE_URL=... SUPABASE_KEY=... CONVEX_URL=... pnpm --filter marquee test
```

## Scripts

- `pnpm --filter marquee dev` runs the Vite dev server on port 5174
- `pnpm --filter marquee build` runs the production build
- `pnpm --filter marquee typecheck` runs `tsc --noEmit`
- `pnpm --filter marquee test` runs the live integration tests (self-skip without env)
