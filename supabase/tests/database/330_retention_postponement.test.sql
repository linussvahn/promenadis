begin;
create extension if not exists pgtap with schema extensions;
select plan(26);
select ok(not has_function_privilege('authenticated','public.postpone_event_command(uuid,uuid,integer,text,timestamptz,uuid)','EXECUTE'),
  'browser cannot postpone directly');
select ok(not has_table_privilege('authenticated','app_private.retention_heartbeats','SELECT'),'heartbeat private');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1103-7500-8000-00000000000'||n)::uuid, 'retention-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,5) n;
-- 1 owner, 2 co-host, 3-5 sellers
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1103-7500-8000-00000000000'||p)::uuid $$;
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Retention Owner','Retention Fixture','','Europe/Stockholm','unlisted',
  now()+interval '3 days', now()+interval '3 days 5 hours',gen_random_uuid());
create temporary table fixture as select id as event_id from public.events where title='Retention Fixture';
insert into public.event_memberships(event_id,account_id,role,display_name)
values ((select event_id from fixture),pg_temp.uid(2),'co_host','Co-host');
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select event_id from fixture),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  gen_random_uuid());
update public.events set admission_mode='auto_inside' where id=(select event_id from fixture);
update public.event_entitlements set seller_limit=2 where event_id=(select event_id from fixture);
create function pg_temp.apply(p int) returns jsonb language sql as $$
select public.apply_to_event_command(pg_temp.uid(p),(select event_id from fixture),'Seller '||p,'Testgatan '||p,'','',18.061+p*0.0002,59.331,'manual',null,true,gen_random_uuid());
$$;
create function pg_temp.p(p int) returns public.seller_participations language sql as $$
select * from public.seller_participations where account_id=pg_temp.uid(p) and event_id=(select event_id from fixture);
$$;
create function pg_temp.version() returns int language sql as $$ select version from public.events where id=(select event_id from fixture) $$;
select pg_temp.apply(3); select pg_temp.apply(4); select pg_temp.apply(5);
select is((pg_temp.p(5)).state,'waitlisted','third seller waits');
update public.events set state='published' where id=(select event_id from fixture);

-- Postponement.
select throws_ok($$select public.postpone_event_command(pg_temp.uid(3),(select event_id from fixture),pg_temp.version(),'Storm',now(),gen_random_uuid())$$,
  'P0001','Only the owner or a co-host can postpone','sellers cannot postpone');
select throws_ok($$select public.postpone_event_command(pg_temp.uid(2),(select event_id from fixture),pg_temp.version(),'Storm',now()-interval '1 hour',gen_random_uuid())$$,
  'P0001','Recent authentication required','postponing needs a recent sign-in');
select throws_ok($$select public.postpone_event_command(pg_temp.uid(2),(select event_id from fixture),pg_temp.version(),'',now(),gen_random_uuid())$$,
  'P0001','Postponement reason required','public reason required');
select is(public.postpone_event_command(pg_temp.uid(2),(select event_id from fixture),pg_temp.version(),'Storm warning',now(),gen_random_uuid())->>'state',
  'postponed','co-host postpones');
select is((pg_temp.p(3)).state||'/'||(pg_temp.p(4)).state,'pending_reschedule_confirmation/pending_reschedule_confirmation',
  'approved sellers must reconfirm');
select is((public.list_event_sellers_command(pg_temp.uid(1),(select event_id from fixture))->>'placesUsed')::int,0,
  'pending reconfirmation holds no counted place');
select throws_ok($$select public.apply_to_event_command(pg_temp.uid(1),(select event_id from fixture),'X','Testgatan 99','','',18.062,59.331,'manual',null,true,gen_random_uuid())$$,
  'P0001','Registration is closed','registration pauses while postponed');
select throws_ok($$select public.confirm_reschedule_command(pg_temp.uid(3),(pg_temp.p(3)).id,true,gen_random_uuid())$$,
  'P0001','Wait for the new date','confirmation waits for the replacement');
select throws_ok($$select public.reschedule_event_command(pg_temp.uid(1),(select event_id from fixture),pg_temp.version(),
  (select original_starts_at from public.events where id=(select event_id from fixture))+interval '31 days',
  (select original_starts_at from public.events where id=(select event_id from fixture))+interval '31 days 5 hours',now(),gen_random_uuid())$$,
  'P0001','Invalid replacement date','no more than 30 days after the original date');
select is(public.reschedule_event_command(pg_temp.uid(1),(select event_id from fixture),pg_temp.version(),
  now()+interval '10 days',now()+interval '10 days 5 hours',now(),gen_random_uuid())->>'state','published','owner sets the replacement date');
select is((select closes_at from public.event_registration_settings where event_id=(select event_id from fixture)) <=
  (select starts_at from public.event_intervals where event_id=(select event_id from fixture)),true,'registration fits the new date');
select is(public.confirm_reschedule_command(pg_temp.uid(3),(pg_temp.p(3)).id,true,gen_random_uuid())->>'state','approved',
  'seller accepts the new date and keeps the place');
select is(public.confirm_reschedule_command(pg_temp.uid(4),(pg_temp.p(4)).id,false,gen_random_uuid())->>'state','withdrawn',
  'seller declines and frees the place');
select is((pg_temp.p(5)).state,'approved','the freed place promotes the waiting seller');

-- Automatic cancellation without a replacement.
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'','Abandoned Fixture','','Europe/Stockholm','unlisted',
  now()+interval '3 days', now()+interval '3 days 5 hours',gen_random_uuid());
update public.events set state='published' where title='Abandoned Fixture';
select app_private.apply_postponement((select id from public.events where title='Abandoned Fixture'),'Flooding',pg_temp.uid(1),gen_random_uuid());
update public.events set postponed_at=now()-interval '15 days' where title='Abandoned Fixture';
select app_private.advance_event_lifecycle_command();
select is((select state from public.events where title='Abandoned Fixture'),'cancelled','no replacement within 14 days cancels');

-- Retention after the event.
update public.events set state='active' where id=(select event_id from fixture);
update public.events set state='ended' where id=(select event_id from fixture);
select app_private.enforce_event_retention_command();
select is((select count(*) from public.event_locations where event_id=(select event_id from fixture)),2::bigint,
  'locations stay during the 14-day grace');
update public.events set state_changed_at=now()-interval '15 days' where id=(select event_id from fixture);
select is(app_private.enforce_event_retention_command(),2,'two remaining sellers erased after the grace');
select is((select count(*) from public.event_locations where event_id=(select event_id from fixture)),0::bigint,'addresses and pins deleted');
select is((select count(*) from public.seller_participations where event_id=(select event_id from fixture)),0::bigint,
  'participations, listings and items deleted');
select is((select seller_history->>'sellerCount' from public.events where id=(select event_id from fixture)),'2','only counts of sellers who took part remain');
select ok(exists(select 1 from app_private.erasure_tombstones where subject_type='event_seller_data' and subject_id=(select event_id from fixture)),
  'tombstone written');
select is((public.retention_health_command()->>'overdueCount')::int,0,'heartbeat reports nothing overdue');
select ok(not (public.retention_health_command()->>'stale')::boolean,'heartbeat is fresh');
select * from finish();
rollback;
