begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
select ok(not has_function_privilege('authenticated','public.publish_event_command(uuid,uuid,integer,timestamptz,uuid)','EXECUTE'),'browser cannot publish');
select ok(not has_function_privilege('authenticated','public.cancel_event_command(uuid,uuid,integer,text,text,timestamptz,uuid)','EXECUTE'),'browser cannot cancel');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values
  ('01992026-1102-7000-8000-000000000001','life-owner@example.invalid',now(),now(),now()),
  ('01992026-1102-7000-8000-000000000002','life-cohost@example.invalid',now(),now(),now());
select public.create_organizer_profile_command('01992026-1102-7000-8000-000000000001',
  'Life Owner','individual','','','01992026-1102-7000-8000-000000000011');
select public.create_scheduled_draft_event_command('01992026-1102-7000-8000-000000000001',
  (select id from public.organizer_profiles where display_name='Life Owner'),
  '','Lifecycle Fixture','','Europe/Stockholm','unlisted',
  '2031-09-09 10:00:00+02','2031-09-09 15:00:00+02','01992026-1102-7000-8000-000000000012');
create temporary table fixture as select id as event_id from public.events where title='Lifecycle Fixture';
insert into public.event_memberships(event_id,account_id,role,display_name)
values ((select event_id from fixture),'01992026-1102-7000-8000-000000000002','co_host','Co-host');
select public.enroll_account_recovery_code_command('01992026-1102-7000-8000-000000000001',
  'ABCD-EFGH-JKLM-NPQR-STUV',0,now(),'01992026-1102-7000-8000-000000000013');
select public.upsert_draft_event_boundary_command('01992026-1102-7000-8000-000000000001',
  (select event_id from fixture),null,'Synthetic lifecycle area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3300]]]}'::jsonb,
  '01992026-1102-7000-8000-000000000014');
select public.attest_event_publication_command('01992026-1102-7000-8000-000000000001',(select event_id from fixture),
  1,1,1,true,true,now(),'01992026-1102-7000-8000-000000000015');
insert into app_private.event_first_reviews(event_id,event_version,boundary_version,registration_version,visibility,status,decided_at,reason)
select e.id,e.version,1,1,e.visibility,'approved',now(),'Synthetic approval' from public.events e where e.id=(select event_id from fixture);

create function pg_temp.version() returns integer language sql as $$
select version from public.events where id=(select event_id from fixture);
$$;
create function pg_temp.publish(p_actor uuid) returns jsonb language sql as $$
select public.publish_event_command(p_actor,(select event_id from fixture),pg_temp.version(),now(),gen_random_uuid());
$$;
create function pg_temp.cancel(p_actor uuid, p_title text, p_reason text) returns jsonb language sql as $$
select public.cancel_event_command(p_actor,(select event_id from fixture),pg_temp.version(),p_title,p_reason,now(),gen_random_uuid());
$$;

select throws_ok($$update public.events set state='ended' where id=(select event_id from fixture)$$,
  'P0001','Event transition draft -> ended is not allowed','illegal transitions are refused for every writer');
select throws_ok($$select pg_temp.publish('01992026-1102-7000-8000-000000000001')$$,
  'P0001','Event not ready to publish','routing and delivery gates keep publication closed');
select throws_ok($$select pg_temp.cancel('01992026-1102-7000-8000-000000000001','Lifecycle Fixture','Rain')$$,
  'P0001','Only published events can be cancelled','drafts are deleted, not cancelled');

-- Open the not-yet-built system gates inside this rolled-back test only.
create or replace function app_private.publication_system_blockers(p_event_id uuid)
returns jsonb language sql stable set search_path = '' as $$ select '[]'::jsonb; $$;
select is((public.get_event_publication_readiness_command('01992026-1102-7000-8000-000000000001',(select event_id from fixture))->>'readyToPublish'),
  'true','a reviewed, attested event is otherwise ready');
select throws_ok($$select pg_temp.publish('01992026-1102-7000-8000-000000000002')$$,
  'P0001','Only the event owner can publish','co-host cannot publish');
select throws_ok($$select public.publish_event_command('01992026-1102-7000-8000-000000000001',(select event_id from fixture),pg_temp.version(),now()-interval '1 hour',gen_random_uuid())$$,
  'P0001','Recent authentication required','publication needs a recent sign-in');
select throws_ok($$select public.publish_event_command('01992026-1102-7000-8000-000000000001',(select event_id from fixture),pg_temp.version()-1,now(),gen_random_uuid())$$,
  'P0001','Event version conflict','stale publication refused');
select is(pg_temp.publish('01992026-1102-7000-8000-000000000001')->>'state','published','owner publishes');
select is((select count(*) from app_private.audit_events where action='event.published' and target_id=(select event_id from fixture)),1::bigint,'publication audited');
select ok((public.get_account_deletion_command('01992026-1102-7000-8000-000000000001')->'blockers') @> '[{"kind":"owned_event","state":"published"}]',
  'a published event blocks account deletion');

select throws_ok($$select pg_temp.cancel('01992026-1102-7000-8000-000000000002','Lifecycle Fixture','Rain')$$,
  'P0001','Only the event owner can cancel','co-host cannot cancel');
select throws_ok($$select pg_temp.cancel('01992026-1102-7000-8000-000000000001','Wrong title','Rain')$$,
  'P0001','Cancellation confirmation mismatch','exact title required');
select throws_ok($$select pg_temp.cancel('01992026-1102-7000-8000-000000000001','Lifecycle Fixture','')$$,
  'P0001','Cancellation reason required','public reason required');

select is(pg_temp.cancel('01992026-1102-7000-8000-000000000001','Lifecycle Fixture','Storm warning')->>'state',
  'cancelled','owner cancels a published event');
select is((select public_notice from public.events where id=(select event_id from fixture)),'Storm warning','public cancellation notice stored');
select is(jsonb_array_length(public.get_account_deletion_command('01992026-1102-7000-8000-000000000001')->'blockers'),0,
  'cancellation clears the deletion blocker');

-- A second event goes live; live events end early instead of cancelling.
select public.create_scheduled_draft_event_command('01992026-1102-7000-8000-000000000001',
  (select id from public.organizer_profiles where display_name='Life Owner'),
  '','Live Fixture','','Europe/Stockholm','unlisted',
  '2031-09-10 10:00:00+02','2031-09-10 15:00:00+02','01992026-1102-7000-8000-000000000016');
create temporary table live as select id as event_id from public.events where title='Live Fixture';
insert into public.event_memberships(event_id,account_id,role,display_name)
values ((select event_id from live),'01992026-1102-7000-8000-000000000002','co_host','Co-host');
update public.events set state='published' where id=(select event_id from live);
update public.event_intervals set starts_at=now()-interval '2 hours', ends_at=now()+interval '2 hours'
where event_id=(select event_id from live);
select app_private.advance_event_lifecycle_command();
select is((select state from public.events where id=(select event_id from live)),'active','start activates the event');
select throws_ok($$select public.cancel_event_command('01992026-1102-7000-8000-000000000001',(select event_id from live),
  (select version from public.events where id=(select event_id from live)),'Live Fixture','Rain',now(),gen_random_uuid())$$,
  'P0001','Only published events can be cancelled','a live event cannot be cancelled');
select is(public.end_event_early_command('01992026-1102-7000-8000-000000000002',(select event_id from live),
  (select version from public.events where id=(select event_id from live)),gen_random_uuid())->>'state',
  'ended','a co-host ends a live event early without re-authenticating');
update public.events set state_changed_at=now()-interval '15 days' where id=(select event_id from live);
select app_private.advance_event_lifecycle_command();
select is((select state from public.events where id=(select event_id from live)),'archived','archived 14 days after ending');
select * from finish();
rollback;
