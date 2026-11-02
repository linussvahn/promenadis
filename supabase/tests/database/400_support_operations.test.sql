begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
select ok(not has_table_privilege('authenticated','app_private.support_requests','SELECT'),'support private');
select ok(not has_table_privilege('authenticated','app_private.event_feedback','SELECT'),'feedback private');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1106-7400-8000-00000000000'||n)::uuid, 'ops-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,3) n;
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1106-7400-8000-00000000000'||p)::uuid $$;
create function pg_temp.session() returns uuid language sql as $$ select '01992026-1106-7400-8000-000000000020'::uuid $$;
insert into app_private.platform_admins(account_id) values (pg_temp.uid(3));
select public.start_admin_elevation_command(pg_temp.uid(3),pg_temp.session(),gen_random_uuid());

-- Support.
select throws_ok($$select public.submit_support_request_command('billing','Something is wrong',null,'net-s')$$,
  'P0001','Invalid request','only the five routes');
select is(public.submit_support_request_command('accessibility','The map cannot be used with a screen reader.','me@example.invalid','net-s'),
  '{"received": true}'::jsonb,'a request is received');
select is((select count(*) from app_private.notification_outbox where template='support_request'),1::bigint,'and routed to the mailbox');
create temporary table claimed as select * from public.claim_application_notifications(25);
select is(public.resolve_application_recipient((select job_id from claimed where template='support_request'),
  (select lease_id from claimed where template='support_request'))->>'email','support@promenadis.local','the operator mailbox receives it');
select throws_ok($$select public.list_support_requests_command(pg_temp.uid(1),pg_temp.session())$$,'P0001','Admin elevation required',
  'only elevated admins read requests');
select is(jsonb_array_length(public.list_support_requests_command(pg_temp.uid(3),pg_temp.session())),1,'elevated admins read them');

-- Feedback.
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Ops Owner','Ops Fixture','','Europe/Stockholm','public',
  now()+interval '1 day', now()+interval '1 day 5 hours',gen_random_uuid());
create function pg_temp.key() returns text language sql as $$ select public_key from public.events where title='Ops Fixture' $$;
select throws_ok($$select public.submit_event_feedback_command(pg_temp.key(),5,'',null,'net-f')$$,'P0001','Feedback closed',
  'feedback opens when the event ends');
update public.events set state='published' where title='Ops Fixture';
update public.events set state='active' where title='Ops Fixture';
update public.events set state='ended' where title='Ops Fixture';
select public.submit_event_feedback_command(pg_temp.key(),4,'Lovely walk','follow@example.invalid','net-f');
select throws_ok($$select public.submit_event_feedback_command(pg_temp.key(),1,'',null,'net-f')$$,'P0001','Feedback already sent',
  'one response per network and event');
select ok(not exists (select 1 from information_schema.columns where table_schema='app_private' and table_name='event_feedback'
  and column_name in ('account_id','network_bucket','contact')),'feedback rows carry no identity');
select is(public.event_feedback_summary_command(pg_temp.uid(1),(select id from public.events where title='Ops Fixture'))->>'averageRating',
  '4.0','the team sees aggregates');

-- Health and switches.
select is(public.operations_status_command() ? 'status' and (select count(*) from jsonb_object_keys(public.operations_status_command())) = 1,
  true,'the public status says only ok or degraded');
select throws_ok($$select public.set_kill_switch_command(pg_temp.uid(1),pg_temp.session(),'exports',true,'Abuse',gen_random_uuid())$$,
  'P0001','Admin elevation required','only elevated admins pull switches');
select public.set_kill_switch_command(pg_temp.uid(3),pg_temp.session(),'support_forms',true,'Spam wave',gen_random_uuid());
select throws_ok($$select public.submit_support_request_command('support','Another request here',null,'net-t')$$,'P0001','Support form paused',
  'a paused form refuses new requests');
select public.set_kill_switch_command(pg_temp.uid(3),pg_temp.session(),'seller_applications',true,'Fraud wave',gen_random_uuid());
update public.events set state='archived' where title='Ops Fixture';
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'','Ops Second','','Europe/Stockholm','public',
  now()+interval '2 days', now()+interval '2 days 5 hours',gen_random_uuid());
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select id from public.events where title='Ops Second'),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,gen_random_uuid());
select throws_ok($$select public.apply_to_event_command(pg_temp.uid(2),(select id from public.events where title='Ops Second'),'S','Testgatan 1','','',
  18.061,59.331,'manual',null,true,gen_random_uuid())$$,'P0001','Applications paused','paused applications are refused everywhere');
select ok(exists (select 1 from app_private.audit_events where action='operations.kill_switch_set'),'switch changes are audited');
select * from finish();
rollback;
