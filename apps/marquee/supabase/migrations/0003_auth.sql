-- Phase 3: auth + RBAC + own-only security (Supabase half = Row Level Security).
--
-- profiles: one row per auth user; `role` drives RBAC. reviews: user-owned, with
-- own-only writes enforced by the DATABASE (RLS), not just the app. These are the
-- new user-owned tables; the catalog tables (movies/genres/credits/...) are left
-- as-is so the Phase 1/2 portable-CRUD tests and the seed (which run with the
-- service key) keep working. Catalog write-gating rides the named mutations
-- (Phase 3 sub-step 3).
--
-- Identity is the Supabase auth uid (auth.uid()), which is also the `sub` Convex
-- verifies from the shared issuer, so userId is consistent across backends.

create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),
  "userId"        uuid not null unique references auth.users(id) on delete cascade,
  -- guest | member | editor | admin
  "role"          text not null default 'member',
  "displayName"   text not null default '',
  created_at    timestamptz not null default now()
);

create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  "movieId"     uuid not null references public.movies(id) on delete cascade,
  "userId"      uuid not null references auth.users(id) on delete cascade,
  "rating"      integer not null check ("rating" between 1 and 5),
  "body"        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists reviews_movie_idx on public.reviews ("movieId");
create index if not exists reviews_user_idx  on public.reviews ("userId");
-- One review per user per movie (an edit updates it).
create unique index if not exists reviews_user_movie_uniq on public.reviews ("userId", "movieId");

-- The caller's role, read from profiles. SECURITY DEFINER so it can read profiles
-- regardless of the caller's own RLS view; STABLE since it depends only on auth.uid().
create or replace function public.auth_role() returns text
  language sql security definer stable
  set search_path = public
as $$
  select coalesce((select "role" from public.profiles where "userId" = auth.uid()), 'guest');
$$;

alter table public.profiles enable row level security;
alter table public.reviews  enable row level security;

-- profiles: readable by all (reviewer display names); a user manages only their own
-- row. Role escalation is NOT self-serviceable here (admin role assignment is a
-- later, admin-only path); a user may create/update their own profile but the app
-- never sends a role change through this path.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (true);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert with check ("userId" = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using ("userId" = auth.uid()) with check ("userId" = auth.uid());

-- reviews: readable by all; write ONLY your own (the own-only headline, DB-enforced).
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select using (true);
drop policy if exists reviews_insert_own on public.reviews;
create policy reviews_insert_own on public.reviews for insert with check ("userId" = auth.uid());
drop policy if exists reviews_update_own on public.reviews;
create policy reviews_update_own on public.reviews
  for update using ("userId" = auth.uid()) with check ("userId" = auth.uid());
drop policy if exists reviews_delete_own on public.reviews;
create policy reviews_delete_own on public.reviews for delete using ("userId" = auth.uid());

-- Grants: RLS filters rows, grants allow the verb. Guests (anon) read; authenticated
-- users read + write (RLS narrows writes to their own rows). service_role bypasses RLS.
grant select                         on public.profiles to anon, authenticated;
grant insert, update                 on public.profiles to authenticated;
grant select                         on public.reviews  to anon, authenticated;
grant insert, update, delete         on public.reviews  to authenticated;
grant all                            on public.profiles to service_role;
grant all                            on public.reviews  to service_role;
