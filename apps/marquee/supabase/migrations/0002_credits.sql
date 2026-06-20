-- Phase 2: the relational spine for the rich detail page. `people` + `credits`
-- make cast/director a REAL many-to-many relation (not the denormalized director
-- string Phase 1 showed), so the detail page can do a genuine server-side JOIN on
-- Supabase (PostgREST embedded resources, which require these FK constraints).
--
-- `genre_counts` is a VIEW: a real server-side GROUP BY aggregation, the Supabase
-- side of the capability-gated aggregation story (Convex scans instead).

create table if not exists public.people (
  id         uuid primary key default gen_random_uuid(),
  "name"       text not null,
  "bio"        text not null default '',
  created_at timestamptz not null default now()
);

-- A credit links a movie to a person in a role. `movieId`/`personId` are real
-- uuid FKs so PostgREST can embed `people` under `credits` in one request.
create table if not exists public.credits (
  id          uuid primary key default gen_random_uuid(),
  "movieId"     uuid not null references public.movies(id) on delete cascade,
  "personId"    uuid not null references public.people(id) on delete cascade,
  -- "director" | "actor"
  "role"        text not null,
  -- the character played (actors only; empty for directors)
  "character"   text not null default '',
  -- billing order within the movie (lower shows first)
  "billing"     integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists credits_movie_idx  on public.credits ("movieId");
create index if not exists credits_person_idx on public.credits ("personId");

-- Server-side aggregation: movie count per primary genre. A VIEW so PostgREST
-- can read it directly (it cannot GROUP BY in a normal request). This is the
-- Supabase half of the `aggregations` capability; Convex tallies via a scan.
-- `total` (not `count`) to avoid colliding with PostgREST's aggregate syntax.
create or replace view public.genre_counts as
  select "primaryGenre" as slug, count(*)::int as total
  from public.movies
  group by "primaryGenre";

grant all    on public.people  to anon, authenticated, service_role;
grant all    on public.credits to anon, authenticated, service_role;
grant select on public.genre_counts to anon, authenticated, service_role;
