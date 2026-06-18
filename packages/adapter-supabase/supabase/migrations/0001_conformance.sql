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

insert into storage.buckets (id, name, public)
values ('conformance', 'conformance', false)
on conflict (id) do nothing;
