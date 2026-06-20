-- Marquee's relational spine on Postgres. Domain columns are camelCase (quoted)
-- so they are byte-identical to the Convex field names the portable store reads
-- and writes: the SAME movie object flows to BOTH backends with no per-backend
-- field mapping. That identity is the whole point of the dogfood.
--
-- Each table also carries the two infra columns the Supabase adapter needs:
--   id         -> mapped to the portable `_id`
--   created_at -> the keyset-pagination order column (adapter default)
-- The app never reads/writes these directly; it sees `_id` on both backends.
--
-- RLS is intentionally OFF in Phase 1 (the app uses the service/anon key);
-- real per-backend enforcement (RLS policies) arrives in Phase 3.

create extension if not exists "pgcrypto";

-- Movies: the catalog. `primaryGenre` is a scalar slug so the portable `where`
-- (`eq`) can filter by genre in Phase 1 without joins; `genres` is the full
-- denormalized slug list for display. `director` is a denormalized name for
-- display (full credits/joins are the Phase 2 SDK-gap story).
create table if not exists public.movies (
  id           uuid primary key default gen_random_uuid(),
  "title"        text    not null,
  "year"         integer not null,
  "synopsis"     text    not null default '',
  "runtime"      integer not null default 0,
  "director"     text    not null default '',
  "primaryGenre" text    not null default '',
  "genres"       text[]  not null default '{}',
  created_at   timestamptz not null default now()
);

-- Genres: the canonical list backing the filter dropdown.
create table if not exists public.genres (
  id         uuid primary key default gen_random_uuid(),
  "name"       text not null,
  "slug"       text not null,
  created_at timestamptz not null default now()
);

-- The many-to-many join, populated by the seed. NOT queried via join in Phase 1
-- (that is the Phase 2 native() join story); present so the relational spine is
-- real and the seed exercises cross-table references. The table name is QUOTED
-- so Postgres keeps the camelCase (unquoted it folds to `moviegenres`, which
-- PostgREST then cannot match against the portable `store("movieGenres")` call).
create table if not exists public."movieGenres" (
  id         uuid primary key default gen_random_uuid(),
  "movieId"    text not null,
  "genreId"    text not null,
  created_at timestamptz not null default now()
);

-- Index the columns the catalog filters/sorts by. Supabase can sort by any
-- column without these, but they keep the seeded catalog snappy and mirror the
-- intent of the Convex by_<field> indexes.
create index if not exists movies_year_idx  on public.movies ("year");
create index if not exists movies_title_idx on public.movies ("title");
create index if not exists movies_primary_genre_idx on public.movies ("primaryGenre");
create index if not exists genres_slug_idx on public.genres ("slug");
create index if not exists movie_genres_movie_idx on public."movieGenres" ("movieId");
create index if not exists movie_genres_genre_idx on public."movieGenres" ("genreId");

-- A fresh CI database does not inherit default privileges for new public tables,
-- so PostgREST returns "permission denied" even with the service key unless we
-- grant explicitly (learned in the adapter's 0001 migration).
grant all on public.movies      to anon, authenticated, service_role;
grant all on public.genres      to anon, authenticated, service_role;
grant all on public."movieGenres" to anon, authenticated, service_role;
