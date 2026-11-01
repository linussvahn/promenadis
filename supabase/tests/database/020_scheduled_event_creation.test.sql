begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.event_intervals'::regclass),
  'event intervals has row-level security enabled'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.event_intervals'::regclass),
  'event intervals forces row-level security'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_intervals', 'SELECT'),
  'authenticated clients cannot read event intervals directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_intervals', 'INSERT'),
  'authenticated clients cannot insert event intervals directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_scheduled_draft_event_command(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the BFF scheduled-event command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_scheduled_draft_event_command(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ),
  'the BFF service role may execute the scheduled-event command'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('01992026-0907-7000-8000-000000000003', 'personal@example.invalid', now(), now()),
  ('01992026-0907-7000-8000-000000000004', 'unrelated@example.invalid', now(), now());

select lives_ok(
  $$
    select public.create_scheduled_draft_event_command(
      '01992026-0907-7000-8000-000000000003',
      null,
      'Test Person',
      'Direct personal event',
      'Synthetic event data only',
      'Europe/Stockholm',
      'unlisted',
      '2026-09-08 08:00:00+00',
      '2026-09-08 13:00:00+00',
      '01992026-0907-7000-8000-000000000201'
    )
  $$,
  'a first event can be created without a pre-existing organizer profile'
);
select is(
  (
    select count(*)
    from public.organizer_profile_memberships
    where account_id = '01992026-0907-7000-8000-000000000003'
  ),
  1::bigint,
  'first-event creation creates exactly one organizer membership'
);
select is(
  (
    select organizer_type
    from public.organizer_profiles
    where created_by_account_id = '01992026-0907-7000-8000-000000000003'
  ),
  'individual',
  'the automatically created organizer is an individual profile'
);
select is(
  (select state from public.events where title = 'Direct personal event'),
  'draft',
  'the direct flow creates only a draft event'
);
select is(
  (
    select count(*)
    from public.event_intervals
    where event_id = (select id from public.events where title = 'Direct personal event')
  ),
  1::bigint,
  'the draft receives one opening interval atomically'
);
select is(
  (
    select ends_at - starts_at
    from public.event_intervals
    where event_id = (select id from public.events where title = 'Direct personal event')
  ),
  interval '5 hours',
  'the opening interval preserves its exact duration'
);
select is(
  (
    select count(*)
    from public.event_memberships
    where account_id = '01992026-0907-7000-8000-000000000003'
      and role = 'owner'
  ),
  1::bigint,
  'the person becomes the event owner atomically'
);
select is(
  (
    select count(*)
    from app_private.audit_events
    where actor_account_id = '01992026-0907-7000-8000-000000000003'
  ),
  2::bigint,
  'automatic organizer and event creation each write a restricted audit event'
);
select is(
  public.get_identity_dashboard_command('01992026-0907-7000-8000-000000000003')
    #>> '{events,0,organizerDisplayName}',
  'Test Person',
  'the dashboard names the public organizer without exposing account identity'
);
select is(
  jsonb_array_length(
    public.get_identity_dashboard_command('01992026-0907-7000-8000-000000000003')
      #> '{events,0,intervals}'
  ),
  1,
  'the dashboard includes the allowlisted event interval'
);
select lives_ok(
  $$
    select public.create_scheduled_draft_event_command(
      '01992026-0907-7000-8000-000000000003',
      null,
      '',
      'Second personal event',
      '',
      'Europe/Stockholm',
      'public',
      '2026-09-09 08:00:00+00',
      '2026-09-09 13:00:00+00',
      '01992026-0907-7000-8000-000000000202'
    )
  $$,
  'the sole usable organizer is selected automatically for later events'
);
select is(
  (
    select count(*)
    from public.organizer_profiles
    where created_by_account_id = '01992026-0907-7000-8000-000000000003'
  ),
  1::bigint,
  'later events do not create duplicate individual organizers'
);
select lives_ok(
  $$
    select public.create_organizer_profile_command(
      '01992026-0907-7000-8000-000000000003',
      'Test Association',
      'association',
      '',
      '',
      '01992026-0907-7000-8000-000000000203'
    )
  $$,
  'the account can add a second organizer identity'
);
select throws_ok(
  $$
    select public.create_scheduled_draft_event_command(
      '01992026-0907-7000-8000-000000000003',
      null,
      '',
      'Ambiguous event',
      '',
      'Europe/Stockholm',
      'public',
      '2026-09-10 08:00:00+00',
      '2026-09-10 13:00:00+00',
      '01992026-0907-7000-8000-000000000204'
    )
  $$,
  'P0001',
  'Organizer selection is required',
  'the command fails closed when more than one organizer is usable'
);
select throws_ok(
  $$
    select public.create_scheduled_draft_event_command(
      '01992026-0907-7000-8000-000000000004',
      (
        select id
        from public.organizer_profiles
        where display_name = 'Test Association'
      ),
      '',
      'Unauthorized event',
      '',
      'Europe/Stockholm',
      'public',
      '2026-09-10 08:00:00+00',
      '2026-09-10 13:00:00+00',
      '01992026-0907-7000-8000-000000000205'
    )
  $$,
  'P0001',
  'Actor is not an organizer manager',
  'an unrelated account cannot select another account organizer'
);
select throws_ok(
  $$
    select public.create_scheduled_draft_event_command(
      '01992026-0907-7000-8000-000000000003',
      (
        select id
        from public.organizer_profiles
        where display_name = 'Test Association'
      ),
      '',
      'Invalid interval',
      '',
      'Europe/Stockholm',
      'public',
      '2026-09-11 13:00:00+00',
      '2026-09-11 08:00:00+00',
      '01992026-0907-7000-8000-000000000206'
    )
  $$,
  'P0001',
  'Event end must be after its start',
  'an invalid opening interval is rejected'
);
select is(
  (
    select count(*)
    from public.events
    where created_by_account_id = '01992026-0907-7000-8000-000000000003'
  ),
  2::bigint,
  'failed commands leave no partial event rows'
);

select * from finish();
rollback;
