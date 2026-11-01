begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
select ok(not has_table_privilege('authenticated','app_private.platform_admins','SELECT'),'admin eligibility private');
select ok(not has_function_privilege('authenticated','public.start_admin_elevation_command(uuid,uuid,uuid)','EXECUTE'),'browser cannot elevate');
select ok(not has_function_privilege('authenticated','public.decide_first_event_review_command(uuid,uuid,uuid,integer,text,text,uuid)','EXECUTE'),'browser cannot decide reviews');

-- Owner with a fully attested draft, an admin, and an admin who is also on the team.
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values
  ('01992026-1101-7600-8000-000000000001','review-owner@example.invalid',now(),now(),now()),
  ('01992026-1101-7600-8000-000000000002','review-admin@example.invalid',now(),now(),now());
select public.create_organizer_profile_command('01992026-1101-7600-8000-000000000001',
  'Review Owner','individual','','','01992026-1101-7600-8000-000000000011');
select public.create_scheduled_draft_event_command('01992026-1101-7600-8000-000000000001',
  (select id from public.organizer_profiles where display_name='Review Owner'),
  '','Review Fixture','A walk','Europe/Stockholm','unlisted',
  '2031-09-09 10:00:00+02','2031-09-09 15:00:00+02','01992026-1101-7600-8000-000000000012');
create temporary table fixture as select id as event_id from public.events where title='Review Fixture';
select public.enroll_account_recovery_code_command('01992026-1101-7600-8000-000000000001',
  'ABCD-EFGH-JKLM-NPQR-STUV',0,now(),'01992026-1101-7600-8000-000000000013');
select public.upsert_draft_event_boundary_command('01992026-1101-7600-8000-000000000001',
  (select event_id from fixture),null,'Synthetic review area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3300]]]}'::jsonb,
  '01992026-1101-7600-8000-000000000014');

create function pg_temp.blockers() returns jsonb language sql as $$
select public.get_event_publication_readiness_command('01992026-1101-7600-8000-000000000001',(select event_id from fixture))->'blockers';
$$;
create function pg_temp.request_review() returns jsonb language sql as $$
select public.request_first_event_review_command('01992026-1101-7600-8000-000000000001',(select event_id from fixture),
  (select version from public.events where id=(select event_id from fixture)),extensions.gen_random_uuid());
$$;
create function pg_temp.decide(p_actor uuid, p_session uuid, p_decision text) returns void language sql as $$
select public.decide_first_event_review_command(p_actor,p_session,(select event_id from fixture),
  (select version from public.events where id=(select event_id from fixture)),p_decision,'Looks fine',extensions.gen_random_uuid());
$$;

select ok(pg_temp.blockers() ? 'first_event_review_required','first event needs review');
select throws_ok('select pg_temp.request_review()','P0001','Event not ready for review','attestation must come first');
select public.attest_event_publication_command('01992026-1101-7600-8000-000000000001',(select event_id from fixture),
  1,1,1,true,true,now(),'01992026-1101-7600-8000-000000000015');
select ok(pg_temp.request_review()->'blockers' ? 'first_event_review_pending','request moves review to pending');

-- Admin elevation is never ambient.
select throws_ok($$select pg_temp.decide('01992026-1101-7600-8000-000000000002','01992026-1101-7600-8000-000000000021','approved')$$,
  'P0001','Admin elevation required','ordinary account cannot decide');
select throws_ok($$select public.start_admin_elevation_command('01992026-1101-7600-8000-000000000002','01992026-1101-7600-8000-000000000021',gen_random_uuid())$$,
  'P0001','Not a platform administrator','only eligible accounts elevate');
insert into app_private.platform_admins(account_id) values ('01992026-1101-7600-8000-000000000002');
select throws_ok($$select public.list_first_event_reviews_command('01992026-1101-7600-8000-000000000002','01992026-1101-7600-8000-000000000021',gen_random_uuid())$$,
  'P0001','Admin elevation required','eligibility alone grants nothing');
select is((public.start_admin_elevation_command('01992026-1101-7600-8000-000000000002','01992026-1101-7600-8000-000000000021',gen_random_uuid())->>'elevated'),
  'true','eligible admin elevates');
select ok((select expires_at <= started_at + interval '15 minutes' from app_private.admin_elevation_sessions
  where account_id='01992026-1101-7600-8000-000000000002' and ended_at is null),'elevation lasts at most 15 minutes');
select throws_ok($$select public.list_first_event_reviews_command('01992026-1101-7600-8000-000000000002','01992026-1101-7600-8000-000000000099',gen_random_uuid())$$,
  'P0001','Admin elevation required','elevation is bound to its Auth session');
select is(jsonb_array_length(public.list_first_event_reviews_command('01992026-1101-7600-8000-000000000002','01992026-1101-7600-8000-000000000021',gen_random_uuid())),
  1,'elevated admin sees the queue');

-- A team member cannot review the event.
insert into public.event_memberships(event_id,account_id,role,display_name)
values ((select event_id from fixture),'01992026-1101-7600-8000-000000000002','moderator','Admin Moderator');
select throws_ok($$select pg_temp.decide('01992026-1101-7600-8000-000000000002','01992026-1101-7600-8000-000000000021','approved')$$,
  'P0001','Cannot review own event','conflict of interest refused');
delete from public.event_memberships where account_id='01992026-1101-7600-8000-000000000002';

select throws_ok($$select public.decide_first_event_review_command('01992026-1101-7600-8000-000000000002','01992026-1101-7600-8000-000000000021',
  (select event_id from fixture),1,'rejected','',gen_random_uuid())$$,'P0001','Invalid review decision','a reason is required');
select pg_temp.decide('01992026-1101-7600-8000-000000000002','01992026-1101-7600-8000-000000000021','rejected');
select ok(pg_temp.blockers() ? 'first_event_review_rejected','rejection blocks publication');
select is((public.get_first_event_review_command('01992026-1101-7600-8000-000000000001',(select event_id from fixture))->>'reason'),
  'Looks fine','owner sees the rejection reason');
select ok(pg_temp.request_review()->'blockers' ? 'first_event_review_pending','owner may resubmit after rejection');
select pg_temp.decide('01992026-1101-7600-8000-000000000002','01992026-1101-7600-8000-000000000021','approved');
select ok(not (pg_temp.blockers() ?| array['first_event_review_required','first_event_review_pending','first_event_review_rejected']),
  'approval clears the review gate');

-- Approval covers exactly what was reviewed.
update public.events set visibility='public', version=version+1 where id=(select event_id from fixture);
select ok(pg_temp.blockers() ? 'first_event_review_required','a changed event needs a new review');

select public.end_admin_elevation_command('01992026-1101-7600-8000-000000000002',gen_random_uuid());
select throws_ok($$select public.list_first_event_reviews_command('01992026-1101-7600-8000-000000000002','01992026-1101-7600-8000-000000000021',gen_random_uuid())$$,
  'P0001','Admin elevation required','exiting admin mode ends access');
select is((select count(*) from app_private.audit_events where action in ('admin.elevation_started','admin.elevation_ended','admin.first_review_decided')
  and actor_account_id='01992026-1101-7600-8000-000000000002'),4::bigint,'elevation and decisions audited');
select * from finish();
rollback;
