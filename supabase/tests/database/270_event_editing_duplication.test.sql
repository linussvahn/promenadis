begin;
create extension if not exists pgtap with schema extensions;
select plan(35);
select ok(not has_function_privilege('authenticated','public.update_draft_event_details_command(uuid,uuid,integer,text,text,text,timestamptz,timestamptz,uuid)','EXECUTE'),'browser cannot edit details');
select ok(not has_function_privilege('authenticated','public.update_organizer_profile_command(uuid,uuid,integer,text,text,text,uuid)','EXECUTE'),'browser cannot edit organizers');
select ok(not has_function_privilege('authenticated','public.duplicate_event_command(uuid,uuid,uuid,text,timestamptz,timestamptz,uuid)','EXECUTE'),'browser cannot duplicate');
select ok(not has_function_privilege('authenticated','public.admin_intervene_event_command(uuid,uuid,uuid,integer,text,text,text,uuid)','EXECUTE'),'browser cannot intervene');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values
  ('01992026-1102-7300-8000-000000000001','edit-owner@example.invalid',now(),now(),now()),
  ('01992026-1102-7300-8000-000000000002','edit-cohost@example.invalid',now(),now(),now()),
  ('01992026-1102-7300-8000-000000000003','edit-outsider@example.invalid',now(),now(),now()),
  ('01992026-1102-7300-8000-000000000004','edit-admin@example.invalid',now(),now(),now());
select public.create_organizer_profile_command('01992026-1102-7300-8000-000000000001',
  'Edit Association','association','Uppsala','https://example.invalid','01992026-1102-7300-8000-000000000011');
create temporary table org as select id from public.organizer_profiles where display_name='Edit Association';
select public.create_scheduled_draft_event_command('01992026-1102-7300-8000-000000000001',(select id from org),
  '','Edit Fixture','Original text','Europe/Stockholm','unlisted',
  '2031-09-09 10:00:00+02','2031-09-09 15:00:00+02','01992026-1102-7300-8000-000000000012');
create temporary table fixture as select id as event_id from public.events where title='Edit Fixture';
insert into public.event_memberships(event_id,account_id,role,display_name)
values ((select event_id from fixture),'01992026-1102-7300-8000-000000000002','co_host','Co-host');
select public.upsert_draft_event_boundary_command('01992026-1102-7300-8000-000000000001',
  (select event_id from fixture),null,'Synthetic edit area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3300]]]}'::jsonb,
  '01992026-1102-7300-8000-000000000013');

create function pg_temp.version() returns integer language sql as $$
select version from public.events where id=(select event_id from fixture);
$$;
create function pg_temp.edit(p_actor uuid, p_title text, p_starts timestamptz, p_ends timestamptz) returns jsonb language sql as $$
select public.update_draft_event_details_command(p_actor,(select event_id from fixture),pg_temp.version(),
  p_title,'Edited text','Europe/Stockholm',p_starts,p_ends,gen_random_uuid());
$$;

-- Draft details.
select throws_ok($$select pg_temp.edit('01992026-1102-7300-8000-000000000003','X','2031-09-09 10:00+02','2031-09-09 15:00+02')$$,
  'P0001','Actor cannot edit this event','outsiders cannot edit');
select throws_ok($$select public.update_draft_event_details_command('01992026-1102-7300-8000-000000000001',(select event_id from fixture),
  pg_temp.version()-1,'X','','Europe/Stockholm','2031-09-09 10:00+02','2031-09-09 15:00+02',gen_random_uuid())$$,
  'P0001','Event version conflict','stale edit refused');
select throws_ok($$select pg_temp.edit('01992026-1102-7300-8000-000000000001','  ','2031-09-09 10:00+02','2031-09-09 15:00+02')$$,
  'P0001','Event title is required','blank title refused');
select throws_ok($$select pg_temp.edit('01992026-1102-7300-8000-000000000001','X','2031-09-09 15:00+02','2031-09-09 10:00+02')$$,
  'P0001','Event end must be after its start','reversed schedule refused');
select throws_ok($$select public.update_draft_event_details_command('01992026-1102-7300-8000-000000000001',(select event_id from fixture),
  pg_temp.version(),'X','','Mars/Olympus','2031-09-09 10:00+02','2031-09-09 15:00+02',gen_random_uuid())$$,
  'P0001','Unsupported event timezone','unknown timezone refused');

select is((pg_temp.edit('01992026-1102-7300-8000-000000000002','Renamed Fixture','2031-09-09 10:00+02','2031-09-09 15:00+02')->>'registrationReset'),
  'false','co-host edits text without touching registration');
select is((select title||'|'||description from public.events where id=(select event_id from fixture)),'Renamed Fixture|Edited text','details saved');
select is((select registration_version from (select version as registration_version from public.event_registration_settings
  where event_id=(select event_id from fixture)) r),1,'registration untouched');

-- A later start keeps the registration window valid; an earlier one resets it.
select is((pg_temp.edit('01992026-1102-7300-8000-000000000001','Renamed Fixture','2031-09-10 10:00+02','2031-09-10 15:00+02')->>'registrationReset'),
  'false','moving later keeps registration');
select is((pg_temp.edit('01992026-1102-7300-8000-000000000001','Renamed Fixture','2031-09-01 10:00+02','2031-09-01 15:00+02')->>'registrationReset'),
  'true','moving earlier resets registration');
select is((select closes_at from public.event_registration_settings where event_id=(select event_id from fixture)),
  '2031-09-01 09:00+02'::timestamptz,'reset closes one hour before the new start');
select is((select starts_at from public.event_intervals where event_id=(select event_id from fixture)),
  '2031-09-01 10:00+02'::timestamptz,'interval moved');
select is((select count(*) from app_private.audit_events where action='event.details_updated'
  and event_id=(select event_id from fixture) and not safe_summary::text like '%Renamed%'),3::bigint,'edits audited without content');
create temporary table before_noop as select pg_temp.version() as v;
select pg_temp.edit('01992026-1102-7300-8000-000000000001','Renamed Fixture','2031-09-01 10:00+02','2031-09-01 15:00+02');
select is(pg_temp.version(),(select v from before_noop),'unchanged edit keeps the version');

-- Organizer profile.
select throws_ok($$select public.update_organizer_profile_command('01992026-1102-7300-8000-000000000003',(select id from org),1,'X','','',gen_random_uuid())$$,
  'P0001','Organizer profile not found','non-managers cannot edit organizer');
select throws_ok($$select public.update_organizer_profile_command('01992026-1102-7300-8000-000000000001',(select id from org),1,'X','','http://insecure.invalid',gen_random_uuid())$$,
  'P0001','Invalid organizer profile','plain-HTTP website refused');
select is((public.update_organizer_profile_command('01992026-1102-7300-8000-000000000001',(select id from org),1,
  ' Edited Association ','',null,gen_random_uuid())->>'version'),'2','manager edits organizer');
select is((select display_name||'|'||coalesce(locality,'-')||'|'||coalesce(website,'-') from public.organizer_profiles where id=(select id from org)),
  'Edited Association|-|-','organizer fields normalized and cleared');
select throws_ok($$select public.update_organizer_profile_command('01992026-1102-7300-8000-000000000001',(select id from org),1,'Again','','',gen_random_uuid())$$,
  'P0001','Organizer version conflict','stale organizer edit refused');

-- Duplication.
select throws_ok($$select public.duplicate_event_command('01992026-1102-7300-8000-000000000003',(select event_id from fixture),null,
  'Copy','2032-09-09 10:00+02','2032-09-09 15:00+02',gen_random_uuid())$$,'P0001','Actor cannot duplicate this event','outsiders cannot duplicate');
select throws_ok($$select public.duplicate_event_command('01992026-1102-7300-8000-000000000002',(select event_id from fixture),null,
  'Copy','2032-09-09 10:00+02','2032-09-09 15:00+02',gen_random_uuid())$$,'P0001','Actor is not an organizer manager',
  'a co-host needs an organizer they manage');
create temporary table copy as select public.duplicate_event_command('01992026-1102-7300-8000-000000000001',(select event_id from fixture),null,
  'Next Year','2032-09-09 10:00+02','2032-09-09 15:00+02',gen_random_uuid()) as event_id;
select is((select state||'|'||visibility||'|'||description from public.events where id=(select event_id from copy)),
  'draft|unlisted|Edited text','duplicate is a draft with copied configuration');
select ok((select st_equals(c.boundary,s.boundary) and c.version=1 from public.event_boundaries c, public.event_boundaries s
  where c.event_id=(select event_id from copy) and s.event_id=(select event_id from fixture)),'boundary copied as a fresh version');
select is((select array_agg(role) from public.event_memberships where event_id=(select event_id from copy)),array['owner'],
  'duplicate is owner-only');
select is((select starts_at from public.event_intervals where event_id=(select event_id from copy)),'2032-09-09 10:00+02'::timestamptz,
  'duplicate uses the new dates');

-- Admin intervention.
insert into app_private.platform_admins(account_id) values ('01992026-1102-7300-8000-000000000004');
select throws_ok($$select public.admin_get_event_command('01992026-1102-7300-8000-000000000004','01992026-1102-7300-8000-000000000021',(select event_id from fixture),gen_random_uuid())$$,
  'P0001','Admin elevation required','lookup needs elevation');
select public.start_admin_elevation_command('01992026-1102-7300-8000-000000000004','01992026-1102-7300-8000-000000000021',gen_random_uuid());
select is((public.admin_get_event_command('01992026-1102-7300-8000-000000000004','01992026-1102-7300-8000-000000000021',(select event_id from fixture),gen_random_uuid())->>'title'),
  'Renamed Fixture','elevated admin looks up an event');
update public.events set state='published' where id=(select event_id from fixture);
select throws_ok($$select public.admin_intervene_event_command('01992026-1102-7300-8000-000000000004','01992026-1102-7300-8000-000000000021',
  (select event_id from fixture),pg_temp.version(),'cancel','Unsafe area','',gen_random_uuid())$$,'P0001','Invalid intervention','internal reason required');
select throws_ok($$select public.admin_intervene_event_command('01992026-1102-7300-8000-000000000004','01992026-1102-7300-8000-000000000021',
  (select event_id from fixture),pg_temp.version(),'end_early',null,'Report 42',gen_random_uuid())$$,'P0001','Only active events can end early','state checked');
select is((public.admin_intervene_event_command('01992026-1102-7300-8000-000000000004','01992026-1102-7300-8000-000000000021',
  (select event_id from fixture),pg_temp.version(),'cancel','Unsafe area','Report 42',gen_random_uuid())->>'state'),'cancelled','admin cancels a published event');
select is((select count(*) from app_private.audit_events where action='admin.event_intervention'
  and safe_summary->>'reason'='Report 42'),1::bigint,'intervention audited with its internal reason');
select * from finish();
rollback;
