-- Table the conformance list() suite drives via portable insert: a numeric and a
-- text column to exercise the six filter operators, a nullable column for the
-- null filter cases, and created_at for keyset (creation-order) pagination.
create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  n          int not null,
  tag        text not null,
  nilable    text,
  flag       boolean not null default false,
  created_at timestamptz not null default now()
);

grant all on public.items to anon, authenticated, service_role;
