-- Tables the live migrate conformance suite copies into/out of. Deliberately
-- DISJOINT from todos/notes/items so the migrate suite and the contract suite
-- never truncate each other's rows when both run against the same stack.
--
-- A Supabase table can be a migrate TARGET only if it has the columns migrate
-- writes: the reserved `migratedFrom` lineage marker (stamped on every copied
-- row) and a `created_at` for list()'s keyset ordering, plus an FK column for the
-- relation pass. PostgREST matches JSON keys to column names CASE-SENSITIVELY and
-- migrate stamps the literal key `migratedFrom`, so the column is quoted to
-- preserve camelCase; an unquoted identifier would fold to lowercase and the
-- insert would fail with "column migratedFrom does not exist".

create table if not exists public.m_people (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  "migratedFrom" text,
  created_at    timestamptz not null default now()
);

create table if not exists public.m_tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  -- The FK into m_people. TEXT, not uuid: before the relink pass the copied row
  -- transiently holds the SOURCE's id (e.g. a memory id like "1", not a uuid),
  -- which a uuid column would reject. No real FK constraint: migrate remaps a
  -- scalar value and the suite asserts resolution via get(), not via the DB.
  "ownerId"      text,
  "migratedFrom" text,
  created_at    timestamptz not null default now()
);

grant all on public.m_people to anon, authenticated, service_role;
grant all on public.m_tasks to anon, authenticated, service_role;
