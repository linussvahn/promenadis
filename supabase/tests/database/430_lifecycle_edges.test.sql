-- Edge cases around expiry, job lag, postponement, quarantine, retention
-- boundaries and clock skew.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1107-7100-8000-00000000000'||n)::uuid, 'edge-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,3) n;
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1107-7100-8000-00000000000'||p)::uuid $$;
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Edge Owner','Edge Fixture','','Europe/Stockholm','unlisted',
  now()+interval '1 day', now()+interval '1 day 5 hours',gen_random_uuid());
create temporary table fixture as select id as event_id from public.events where title='Edge Fixture';
create function pg_temp.ev() returns public.events language sql as $$ select * from public.events where id=(select event_id from fixture) $$;
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select event_id from fixture),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  gen_random_uuid());
update public.events set admission_mode='auto_inside' where id=(select event_id from fixture);
select public.apply_to_event_command(pg_temp.uid(n),(select event_id from fixture),'Seller '||n,'Testgatan '||n,'','',
  18.061+n*0.0003,59.331,'manual',null,true,gen_random_uuid()) from generate_series(2,3) n;
create function pg_temp.p(p int) returns public.seller_participations language sql as $$
  select * from public.seller_participations where account_id=pg_temp.uid(p) $$;
create function pg_temp.feed() returns jsonb language sql as $$
  select public.public_event_safety_feed_command('unlisted',(pg_temp.ev()).public_key)->'feed' $$;
create function pg_temp.publishable() returns bigint language sql as $$
  select count(*) from app_private.publishable_participations((select event_id from fixture)) $$;
update public.events set state='published' where id=(select event_id from fixture);
update public.events set state='active' where id=(select event_id from fixture);
select app_private.refresh_public_snapshots_command();

-- Hard expiry wins over a lagging lifecycle job.
select is(pg_temp.publishable(),2::bigint,'sellers are public while the event runs');
update public.event_intervals set starts_at=now()-interval '5 hours', ends_at=now()-interval '1 second'
where event_id=(select event_id from fixture);
select is(pg_temp.publishable(),0::bigint,'nothing is publishable after the hard expiry, even before the end job runs');
select ok(public.public_snapshot_command((select active_snapshot_id from app_private.public_event_publications
  where event_id=(select event_id from fixture))) is null,'an expired snapshot is not served');
select is(jsonb_array_length(pg_temp.feed()->'removedSellerIds'),2,'the feed tells open maps to drop every seller');
select app_private.advance_event_lifecycle_command();
select is((pg_temp.ev()).state,'ended','the lifecycle job then ends the event');

-- Retention boundary: 14 days exactly.
update public.events set state_changed_at=now()-interval '14 days'+interval '1 minute' where id=(select event_id from fixture);
select app_private.enforce_event_retention_command();
select is((select count(*) from public.seller_participations where event_id=(select event_id from fixture)),2::bigint,
  'seller data stays until the full 14 days have passed');
update public.events set state_changed_at=now()-interval '14 days'-interval '1 minute' where id=(select event_id from fixture);
select app_private.enforce_event_retention_command();
select is((select count(*) from public.seller_participations where event_id=(select event_id from fixture)),0::bigint,
  'and is erased right after');
select throws_ok($$select public.rotate_unlisted_link_command(pg_temp.uid(1),(select event_id from fixture),(pg_temp.ev()).version,'Leak',now(),gen_random_uuid())$$,
  'P0001','This link can no longer be rotated','an ended event keeps its link');

-- Postponement during the event, then a new date.
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'','Edge Second','','Europe/Stockholm','public',
  now()+interval '1 day', now()+interval '1 day 5 hours',gen_random_uuid());
create temporary table second as select id as event_id from public.events where title='Edge Second';
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select event_id from second),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,gen_random_uuid());
update public.events set admission_mode='auto_inside' where id=(select event_id from second);
select public.apply_to_event_command(pg_temp.uid(2),(select event_id from second),'Seller','Testgatan 9','','',
  18.061,59.331,'manual',null,true,gen_random_uuid());
update public.events set state='published' where id=(select event_id from second);
update public.events set state='active' where id=(select event_id from second);
select app_private.refresh_public_snapshots_command();
select ok(exists (select 1 from app_private.public_snapshots where event_id=(select event_id from second)),'a live event has a snapshot');
select public.postpone_event_command(pg_temp.uid(1),(select event_id from second),(select version from public.events where id=(select event_id from second)),
  'Storm warning',now(),gen_random_uuid());
select ok(not exists (select 1 from app_private.public_snapshots where event_id=(select event_id from second)),
  'postponing during the event deletes snapshot bytes at once');
select public.reschedule_event_command(pg_temp.uid(1),(select event_id from second),(select version from public.events where id=(select event_id from second)),
  now()+interval '5 days',now()+interval '5 days 4 hours',now(),gen_random_uuid());
update public.events set early_location_visibility=true where id=(select event_id from second);
select is((select count(*) from app_private.publishable_participations((select event_id from second))),0::bigint,
  'sellers are not public again until they reconfirm the new date');
select public.confirm_reschedule_command(pg_temp.uid(2),(select id from public.seller_participations where event_id=(select event_id from second)),true,gen_random_uuid());
select is((select count(*) from app_private.publishable_participations((select event_id from second))),1::bigint,
  'a reconfirmed seller is public again');

-- Clock skew on recent authentication.
select throws_ok($$select public.rotate_unlisted_link_command(pg_temp.uid(1),(select event_id from second),1,null,now()+interval '2 minutes',gen_random_uuid())$$,
  'P0001','Recent authentication required','a sign-in time from the future is refused');
select throws_ok($$select public.request_event_export_command(pg_temp.uid(1),(select event_id from second),repeat('e',40),now()-interval '16 minutes',gen_random_uuid())$$,
  'P0001','Recent authentication required','a sign-in older than 15 minutes is refused');
select * from finish();
rollback;
