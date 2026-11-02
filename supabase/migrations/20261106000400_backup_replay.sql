-- Milestone 5, slice 3b: erasure-tombstone replay for restores.
--
-- A restored archive may predate erasures. Before a restored database serves
-- anything, the current tombstones are copied in and replayed so deleted
-- accounts and erased post-event seller data are not resurrected.
create function app_private.replay_erasure_tombstones()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  accounts integer;
  events integer;
begin
  delete from auth.users u using app_private.erasure_tombstones t
  where t.subject_type = 'account' and t.subject_id = u.id;
  get diagnostics accounts = row_count;
  with erased as (
    select t.subject_id as event_id from app_private.erasure_tombstones t where t.subject_type = 'event_seller_data'
  ), participations as (
    delete from public.seller_participations p using erased where p.event_id = erased.event_id returning p.event_id
  ), invites as (
    delete from public.seller_invites i using erased where i.event_id = erased.event_id returning i.event_id
  ), locations as (
    delete from public.event_locations l using erased where l.event_id = erased.event_id returning l.event_id
  )
  select count(distinct event_id) into events from (
    select event_id from participations union all select event_id from invites union all select event_id from locations) changed;
  return jsonb_build_object('accountsRemoved', accounts, 'eventsCleared', events);
end;
$$;

-- Restore drills read these to compare with the archive manifest.
create function app_private.backup_manifest_counts()
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'events', (select count(*) from public.events),
    'participations', (select count(*) from public.seller_participations),
    'tombstones', (select count(*) from app_private.erasure_tombstones),
    'tombstoneWatermark', (select max(erased_at) from app_private.erasure_tombstones),
    'migration', (select max(version) from supabase_migrations.schema_migrations)
  );
$$;

revoke all on function app_private.replay_erasure_tombstones() from public, anon, authenticated;
revoke all on function app_private.backup_manifest_counts() from public, anon, authenticated;
