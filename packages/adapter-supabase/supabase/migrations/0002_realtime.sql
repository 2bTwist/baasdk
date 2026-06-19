-- Enable Realtime (postgres_changes) for the conformance `todos` table so the
-- adapter's reactive subscribe() receives change events. Idempotent: the
-- publication membership add errors if the table is already a member, so guard
-- it; create the publication defensively if the local stack lacks it.
alter table public.todos replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.todos;
exception
  when duplicate_object then null;          -- already a member
  when undefined_object then                -- publication missing (defensive)
    create publication supabase_realtime for table public.todos;
end $$;
