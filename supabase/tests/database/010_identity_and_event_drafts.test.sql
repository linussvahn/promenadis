begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.profiles'::regclass),
  'profiles has row-level security enabled'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.events'::regclass),
  'events has row-level security enabled'
);
select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anonymous clients cannot read profiles directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'authenticated clients cannot read profiles directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'SELECT'),
  'authenticated clients cannot read events directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_organizer_profile_command(uuid,text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the BFF organizer command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_organizer_profile_command(uuid,text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'the BFF service role may execute the organizer command'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('01992026-0907-7000-8000-000000000001', 'owner@example.invalid', now(), now()),
  ('01992026-0907-7000-8000-000000000002', 'other@example.invalid', now(), now());

select is(
  (select count(*) from public.profiles where account_id = '01992026-0907-7000-8000-000000000001'),
  1::bigint,
  'creating an Auth identity creates one minimal profile'
);
select lives_ok(
  $$
    select public.update_profile_command(
      '01992026-0907-7000-8000-000000000001',
      'Linus Test',
      'en',
      '01992026-0907-7000-8000-000000000101'
    )
  $$,
  'profile command succeeds for an existing account'
);
select is(
  (select display_name from public.profiles where account_id = '01992026-0907-7000-8000-000000000001'),
  'Linus Test',
  'profile command normalizes and saves the display name'
);
select lives_ok(
  $$
    select public.create_organizer_profile_command(
      '01992026-0907-7000-8000-000000000001',
      'Testföreningen',
      'association',
      'Stockholm',
      'https://example.invalid',
      '01992026-0907-7000-8000-000000000102'
    )
  $$,
  'organizer creation command succeeds'
);
select is(
  (
    select count(*)
    from public.organizer_profile_memberships
    where account_id = '01992026-0907-7000-8000-000000000001'
      and role = 'owner'
  ),
  1::bigint,
  'organizer creation atomically creates its owner membership'
);
select lives_ok(
  $$
    select public.create_draft_event_command(
      '01992026-0907-7000-8000-000000000001',
      (select id from public.organizer_profiles where display_name = 'Testföreningen'),
      'Testpromenaden',
      'Synthetic event data only',
      'Europe/Stockholm',
      'unlisted',
      '01992026-0907-7000-8000-000000000103'
    )
  $$,
  'draft event creation command succeeds for an organizer owner'
);
select is(
  (select state from public.events where title = 'Testpromenaden'),
  'draft',
  'the command can create only a draft event'
);
select is(
  (
    select count(*)
    from public.event_memberships
    where account_id = '01992026-0907-7000-8000-000000000001'
      and role = 'owner'
  ),
  1::bigint,
  'draft creation atomically creates exactly one event owner'
);
select is(
  (select count(*) from app_private.audit_events),
  3::bigint,
  'each successful command writes one restricted audit event'
);
select throws_ok(
  $$
    select public.create_draft_event_command(
      '01992026-0907-7000-8000-000000000002',
      (select id from public.organizer_profiles where display_name = 'Testföreningen'),
      'Unauthorized event',
      '',
      'Europe/Stockholm',
      'public',
      '01992026-0907-7000-8000-000000000104'
    )
  $$,
  'P0001',
  'Actor is not an organizer manager',
  'an unrelated account cannot create an event for the organizer'
);
select throws_ok(
  $$
    select public.create_draft_event_command(
      '01992026-0907-7000-8000-000000000001',
      (select id from public.organizer_profiles where display_name = 'Testföreningen'),
      'Bad time zone',
      '',
      'Not/AZone',
      'public',
      '01992026-0907-7000-8000-000000000105'
    )
  $$,
  'P0001',
  'Unsupported event timezone',
  'an invalid IANA time zone is rejected'
);

select * from finish();
rollback;
