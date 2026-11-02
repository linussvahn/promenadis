begin;
create extension if not exists pgtap with schema extensions;
select plan(21);
select ok(not has_table_privilege('authenticated','app_private.relay_threads','SELECT'),'relay private');
select ok(not has_table_privilege('authenticated','app_private.event_exports','SELECT'),'exports private');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1106-7300-8000-00000000000'||n)::uuid, 'relay-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,4) n;
-- 1 owner, 2 moderator, 3-4 sellers
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1106-7300-8000-00000000000'||p)::uuid $$;
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Relay Owner','Relay Fixture','','Europe/Stockholm','public',
  now()+interval '1 day', now()+interval '1 day 5 hours',gen_random_uuid());
create temporary table fixture as select id as event_id from public.events where title='Relay Fixture';
create function pg_temp.ev() returns public.events language sql as $$ select * from public.events where id=(select event_id from fixture) $$;
insert into public.event_memberships(event_id,account_id,role,display_name) values ((select event_id from fixture),pg_temp.uid(2),'moderator','Mod');
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select event_id from fixture),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  gen_random_uuid());
update public.events set admission_mode='auto_inside' where id=(select event_id from fixture);
select public.apply_to_event_command(pg_temp.uid(3),(select event_id from fixture),'=cmd|calc','Testgatan 1','11122','Stockholm',
  18.061,59.331,'manual',null,true,gen_random_uuid());
select public.apply_to_event_command(pg_temp.uid(4),(select event_id from fixture),'Plain Seller','Testgatan 2','11122','Stockholm',
  18.062,59.331,'manual',null,true,gen_random_uuid());

-- Relay.
select throws_ok($$select public.start_relay_thread_command((pg_temp.ev()).public_key,'visitor@example.invalid','Hello there!',repeat('t',40),'net-r')$$,
  'P0001','Event not found','drafts take no messages');
update public.events set state='published' where id=(select event_id from fixture);
select throws_ok($$select public.start_relay_thread_command((pg_temp.ev()).public_key,'visitor@example.invalid','Hi',repeat('t',40),'net-r')$$,
  'P0001','Invalid message','messages need some text');
create temporary table thread as select (public.start_relay_thread_command((pg_temp.ev()).public_key,'Visitor@Example.invalid',
  'Is there parking near the market?',repeat('t',40),'net-r')->>'threadId')::uuid as id;
select is((select count(*) from app_private.notification_outbox where template='relay_to_organizer'),1::bigint,
  'the owner is notified, not the moderator');
select ok((select payload::text from app_private.notification_outbox where template='relay_to_organizer') !~ 'parking',
  'the body is not copied into the outbox');
select throws_ok($$select public.list_relay_threads_command(pg_temp.uid(2),(select event_id from fixture))$$,
  'P0001','Actor cannot read organizer messages','moderators do not read the relay');
select is(public.list_relay_threads_command(pg_temp.uid(1),(select event_id from fixture))->0->'messages'->0->>'body',
  'Is there parking near the market?','the owner reads the message');
select ok(position('visitor@example' in public.list_relay_threads_command(pg_temp.uid(1),(select event_id from fixture))::text)=0,
  'the visitor address is never shown');
select public.reply_relay_thread_command(pg_temp.uid(1),(select id from thread),null,'Yes, on the side street.');
select is((select count(*) from app_private.notification_outbox where template='relay_to_visitor'),1::bigint,'the reply goes to the visitor');
select is(jsonb_array_length(public.read_relay_thread_command((select id from thread),repeat('t',40))->'messages'),2,
  'the visitor reads the thread with the private link');
select ok(public.read_relay_thread_command((select id from thread),repeat('x',40)) is null,'a wrong token reads nothing');
select throws_ok($$select public.reply_relay_thread_command(null,(select id from thread),repeat('x',40),'Trying to reply here')$$,
  'P0001','Thread not found','a wrong token cannot reply');
create temporary table claimed as select * from public.claim_application_notifications(25);
select is(public.resolve_application_recipient((select job_id from claimed where template='relay_to_visitor'),
  (select lease_id from claimed where template='relay_to_visitor'))->>'body','Yes, on the side street.','the worker reads the body at send time');
select public.start_relay_thread_command((pg_temp.ev()).public_key,'b@example.invalid','Second thread here',repeat('u',40),'net-r');
select public.start_relay_thread_command((pg_temp.ev()).public_key,'c@example.invalid','Third thread here!',repeat('v',40),'net-r');
select throws_ok($$select public.start_relay_thread_command((pg_temp.ev()).public_key,'d@example.invalid','Fourth thread here',repeat('w',40),'net-r')$$,
  'P0001','Message limit reached','new threads are rate limited per network');

-- Export.
select throws_ok($$select public.request_event_export_command(pg_temp.uid(2),(select event_id from fixture),repeat('e',40),now(),gen_random_uuid())$$,
  'P0001','Actor cannot export','moderators cannot export');
select throws_ok($$select public.request_event_export_command(pg_temp.uid(1),(select event_id from fixture),repeat('e',40),now()-interval '1 hour',gen_random_uuid())$$,
  'P0001','Recent authentication required','exports need a recent sign-in');
create temporary table export as select (public.request_event_export_command(pg_temp.uid(1),(select event_id from fixture),repeat('e',40),now(),gen_random_uuid())->>'exportId')::uuid as id;
select throws_ok($$select public.request_event_export_command(pg_temp.uid(1),(select event_id from fixture),repeat('f',40),now(),gen_random_uuid())$$,
  'P0001','Export already active','one active export per event');
create temporary table csv as select public.download_event_export_command(pg_temp.uid(1),(select id from export),repeat('e',40)) as body;
select ok((select body from csv) like 'address,postal_code,locality,seller,title,hours,categories,status%'
  and (select body from csv) like '%"Testgatan 2","11122","Stockholm","Plain Seller"%','approved sellers with public operational fields');
select ok((select body from csv) like '%"''=cmd|calc"%','formula cells are neutralized');
select throws_ok($$select public.download_event_export_command(pg_temp.uid(1),(select id from export),repeat('e',40))$$,
  'P0001','Export unavailable','the download works once');
select * from finish();
rollback;
