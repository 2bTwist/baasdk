-- Phase 4: realtime + files (Supabase half).
--
-- Realtime: the live review feed/count rides Supabase Realtime, which only emits
-- for tables in the `supabase_realtime` publication. Add `reviews`, and set its
-- replica identity to FULL so DELETE events carry the whole old row — required
-- for Realtime's RLS check to evaluate `reviews_select` on a delete (otherwise a
-- deleted review would not fire an event to anon subscribers, and the live count
-- would stick high).
--
-- Files: posters are stored through the file port (Supabase Storage). The handle
-- (bucket::path) is persisted on the movie row as `posterFile`. The `posters`
-- bucket itself is created by the seed (idempotent createBucket) so it survives a
-- `supabase start` reset without depending on storage-schema migration ordering.

alter table public.movies add column if not exists "posterFile" text;

alter table public.reviews replica identity full;

-- Add reviews to the realtime publication, idempotently (re-running a migration on
-- a reset DB must not error on an already-published table).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reviews'
  ) then
    alter publication supabase_realtime add table public.reviews;
  end if;
end
$$;

-- Poster Storage policies on the `posters` bucket: PUBLIC read, AUTHENTICATED
-- write. Same shape as the reviews model (open read, signed-in write), enforced
-- by Storage's RLS rather than the app. service_role (the seed) bypasses RLS, so
-- it can create the bucket and back-fill regardless. Guarded on storage.objects
-- existing so the migration is safe if Storage is disabled.
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists posters_read on storage.objects;
    create policy posters_read on storage.objects
      for select using (bucket_id = 'posters');
    drop policy if exists posters_insert on storage.objects;
    create policy posters_insert on storage.objects
      for insert to authenticated with check (bucket_id = 'posters');
    drop policy if exists posters_update on storage.objects;
    create policy posters_update on storage.objects
      for update to authenticated using (bucket_id = 'posters') with check (bucket_id = 'posters');
    drop policy if exists posters_delete on storage.objects;
    create policy posters_delete on storage.objects
      for delete to authenticated using (bucket_id = 'posters');
  end if;
end
$$;
