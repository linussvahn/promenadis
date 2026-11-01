begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.event_registration_settings'::regclass),
  'event registration settings has row-level security enabled'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.event_registration_settings'::regclass),
  'event registration settings forces row-level security'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_registration_settings', 'SELECT'),
  'authenticated clients cannot read registration settings directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_registration_settings', 'INSERT'),
  'authenticated clients cannot write registration settings directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.upsert_draft_event_registration_command(uuid,uuid,integer,timestamptz,timestamptz,boolean,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the BFF registration command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.upsert_draft_event_registration_command(uuid,uuid,integer,timestamptz,timestamptz,boolean,uuid)',
    'EXECUTE'
  ),
  'the BFF service role may execute the registration command'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('01992026-0908-7000-8000-000000000005', 'registration-owner@example.invalid', now(), now()),
  ('01992026-0908-7000-8000-000000000006', 'registration-other@example.invalid', now(), now());

select lives_ok(
  $$
    select public.create_organizer_profile_command(
      '01992026-0908-7000-8000-000000000005',
      'Registration Test Organizer',
      'individual',
      '',
      '',
      '01992026-0908-7000-8000-000000000301'
    )
  $$,
  'the registration owner can create its organizer fixture'
);
select lives_ok(
  $$
    select public.create_scheduled_draft_event_command(
      '01992026-0908-7000-8000-000000000005',
      (select id from public.organizer_profiles where display_name = 'Registration Test Organizer'),
      '',
      'Registration Test Event',
      '',
      'Europe/Stockholm',
      'unlisted',
      '2030-09-08 10:00:00+02',
      '2030-09-08 15:00:00+02',
      '01992026-0908-7000-8000-000000000302'
    )
  $$,
  'scheduled draft creation also creates default registration settings'
);
select is(
  (select version from public.event_registration_settings),
  1,
  'the default registration version is one'
);
select is(
  (select closes_at from public.event_registration_settings),
  '2030-09-08 07:00:00+00'::timestamptz,
  'registration closes one hour before the event by default'
);
select is(
  (select allow_during_event from public.event_registration_settings),
  false,
  'registration is not allowed during the event by default'
);
select is(
  public.get_identity_dashboard_command('01992026-0908-7000-8000-000000000005')
    #>> '{events,0,registration,version}',
  '1',
  'the allowlisted dashboard includes registration settings'
);

select lives_ok(
  $$
    select public.upsert_draft_event_registration_command(
      '01992026-0908-7000-8000-000000000005',
      (select id from public.events where title = 'Registration Test Event'),
      1,
      '2030-09-07 08:00:00+02',
      '2030-09-08 09:30:00+02',
      false,
      '01992026-0908-7000-8000-000000000303'
    )
  $$,
  'an owner can save a valid registration window'
);
select is(
  (select version from public.event_registration_settings),
  2,
  'a successful update increments the registration version'
);
select is(
  (
    select count(*)
    from app_private.audit_events
    where action = 'event.registration_saved'
      and safe_summary ->> 'version' = '2'
  ),
  1::bigint,
  'a successful registration update is audited'
);
select throws_ok(
  $$
    select public.upsert_draft_event_registration_command(
      '01992026-0908-7000-8000-000000000005',
      (select id from public.events where title = 'Registration Test Event'),
      1,
      '2030-09-07 08:00:00+02',
      '2030-09-08 09:00:00+02',
      false,
      '01992026-0908-7000-8000-000000000304'
    )
  $$,
  'P0001',
  'Event registration version conflict',
  'a stale editor cannot overwrite a newer registration window'
);
select throws_ok(
  $$
    select public.upsert_draft_event_registration_command(
      '01992026-0908-7000-8000-000000000006',
      (select id from public.events where title = 'Registration Test Event'),
      2,
      '2030-09-07 08:00:00+02',
      '2030-09-08 09:00:00+02',
      false,
      '01992026-0908-7000-8000-000000000305'
    )
  $$,
  'P0001',
  'Actor cannot manage event registration',
  'an unrelated account cannot edit registration'
);
select throws_ok(
  $$
    select public.upsert_draft_event_registration_command(
      '01992026-0908-7000-8000-000000000005',
      (select id from public.events where title = 'Registration Test Event'),
      2,
      '2030-09-08 09:30:00+02',
      '2030-09-08 09:00:00+02',
      false,
      '01992026-0908-7000-8000-000000000306'
    )
  $$,
  'P0001',
  'Registration close must be after registration open',
  'registration cannot close before it opens'
);
select throws_ok(
  $$
    select public.upsert_draft_event_registration_command(
      '01992026-0908-7000-8000-000000000005',
      (select id from public.events where title = 'Registration Test Event'),
      2,
      '2030-09-07 08:00:00+02',
      '2030-09-08 10:30:00+02',
      false,
      '01992026-0908-7000-8000-000000000307'
    )
  $$,
  'P0001',
  'Registration cannot close after event start without active-event opt-in',
  'registration during active hours requires explicit opt-in'
);
select lives_ok(
  $$
    select public.upsert_draft_event_registration_command(
      '01992026-0908-7000-8000-000000000005',
      (select id from public.events where title = 'Registration Test Event'),
      2,
      '2030-09-07 08:00:00+02',
      '2030-09-08 10:30:00+02',
      true,
      '01992026-0908-7000-8000-000000000308'
    )
  $$,
  'explicit opt-in permits registration during active event hours'
);
select is(
  (select allow_during_event from public.event_registration_settings),
  true,
  'the active-event opt-in is stored'
);
select is(
  (select version from public.event_registration_settings),
  3,
  'the active-event opt-in increments the version'
);
select throws_ok(
  $$
    select public.upsert_draft_event_registration_command(
      '01992026-0908-7000-8000-000000000005',
      (select id from public.events where title = 'Registration Test Event'),
      3,
      '2030-09-07 08:00:00+02',
      '2030-09-08 15:30:00+02',
      true,
      '01992026-0908-7000-8000-000000000309'
    )
  $$,
  'P0001',
  'Registration cannot close after event end',
  'registration cannot remain open after the event ends'
);

update public.events set state = 'published' where title = 'Registration Test Event';

select throws_ok(
  $$
    select public.upsert_draft_event_registration_command(
      '01992026-0908-7000-8000-000000000005',
      (select id from public.events where title = 'Registration Test Event'),
      3,
      '2030-09-07 08:00:00+02',
      '2030-09-08 09:00:00+02',
      false,
      '01992026-0908-7000-8000-000000000310'
    )
  $$,
  'P0001',
  'Only draft event registration can be edited directly',
  'published registration settings require the later revision workflow'
);
select is(
  (select count(*) from public.event_registration_settings),
  1::bigint,
  'failed commands leave the last valid registration window intact'
);

select * from finish();
rollback;
