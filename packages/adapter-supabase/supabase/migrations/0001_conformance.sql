-- Schema the conformance suite needs: a `todos` table (named operations) and a
-- `notes` table (direct CRUD), plus a private storage bucket for the FileStore.
-- RLS is intentionally left off here; the test client uses the service-role key.

create extension if not exists "pgcrypto";

create table if not exists public.todos (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id     uuid primary key default gen_random_uuid(),
  body   text,
  pinned boolean not null default false
);

-- Grant table access to the API roles. On a FRESH database (every CI run) the
-- CLI's migrations do NOT inherit the default privileges that would otherwise
-- grant these roles access to new public tables, so PostgREST returns
-- "permission denied for table" even with the service key. A persisted local
-- volume hides this (it carries grants from earlier runs), which is exactly why
-- it passed locally but failed in CI. Grant explicitly so it is deterministic.
grant all on public.todos to anon, authenticated, service_role;
grant all on public.notes to anon, authenticated, service_role;

insert into storage.buckets (id, name, public)
values ('conformance', 'conformance', false)
on conflict (id) do nothing;
