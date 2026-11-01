begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.organizer_profile_invites'::regclass),
  'organizer invitations have row-level security enabled'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.organizer_profile_invites'::regclass),
  'organizer invitations force row-level security'
);
select ok(
  not has_table_privilege('authenticated', 'public.organizer_profile_invites', 'SELECT'),
  'authenticated clients cannot read organizer invitations directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.invite_organizer_manager_command(uuid,uuid,integer,text,timestamptz,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the BFF organizer invitation command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.invite_organizer_manager_command(uuid,uuid,integer,text,timestamptz,uuid)',
    'EXECUTE'
  ),
  'the BFF service role may execute the organizer invitation command'
);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('01992026-0908-8000-8000-000000000071', 'organizer-owner@example.invalid', now(), now(), now()),
  ('01992026-0908-8000-8000-000000000072', 'organizer-manager@example.invalid', now(), now(), now()),
  ('01992026-0908-8000-8000-000000000073', 'organizer-outsider@example.invalid', now(), now(), now());

select lives_ok(
  $$
    select public.create_organizer_profile_command(
      '01992026-0908-8000-8000-000000000071',
      'Shared Organizer Fixture',
      'informal_group',
      '',
      '',
      '01992026-0908-8000-8000-000000000701'
    )
  $$,
  'the owner can create the shared organizer fixture'
);
select lives_ok(
  $$
    select public.create_organizer_profile_command(
      '01992026-0908-8000-8000-000000000071',
      'Personal Organizer Fixture',
      'individual',
      '',
      '',
      '01992026-0908-8000-8000-000000000702'
    )
  $$,
  'the owner can create the personal organizer fixture'
);

select throws_ok(
  $$
    select public.invite_organizer_manager_command(
      '01992026-0908-8000-8000-000000000073',
      (select id from public.organizer_profiles where display_name = 'Shared Organizer Fixture'),
      1,
      'organizer-manager@example.invalid',
      now(),
      '01992026-0908-8000-8000-000000000703'
    )
  $$,
  'P0001',
  'Only the organizer owner can manage managers',
  'an outsider cannot invite an organizer manager'
);
select throws_ok(
  $$
    select public.invite_organizer_manager_command(
      '01992026-0908-8000-8000-000000000071',
      (select id from public.organizer_profiles where display_name = 'Shared Organizer Fixture'),
      1,
      'organizer-manager@example.invalid',
      now() - interval '16 minutes',
      '01992026-0908-8000-8000-000000000704'
    )
  $$,
  'P0001',
  'Recent authentication required',
  'manager invitations require recent owner authentication'
);
select throws_ok(
  $$
    select public.invite_organizer_manager_command(
      '01992026-0908-8000-8000-000000000071',
      (select id from public.organizer_profiles where display_name = 'Personal Organizer Fixture'),
      1,
      'organizer-manager@example.invalid',
      now(),
      '01992026-0908-8000-8000-000000000705'
    )
  $$,
  'P0001',
  'Individual organizer identities cannot have managers',
  'personal organizer identities cannot be shared'
);
select lives_ok(
  $$
    select public.invite_organizer_manager_command(
      '01992026-0908-8000-8000-000000000071',
      (select id from public.organizer_profiles where display_name = 'Shared Organizer Fixture'),
      1,
      ' ORGANIZER-MANAGER@example.invalid ',
      now(),
      '01992026-0908-8000-8000-000000000706'
    )
  $$,
  'the owner can create a normalized manager invitation'
);
select is(
  (select team_version from public.organizer_profiles where display_name = 'Shared Organizer Fixture'),
  2,
  'creating the invitation increments the organizer team version'
);
select is(
  (select invited_email from public.organizer_profile_invites),
  'organizer-manager@example.invalid',
  'the invitation email is normalized'
);
select ok(
  (select expires_at <= created_at + interval '7 days 1 minute' from public.organizer_profile_invites),
  'the organizer invitation expires within seven days'
);
select is(
  jsonb_array_length(public.get_incoming_organizer_invites_command('01992026-0908-8000-8000-000000000072')),
  1,
  'the verified invited account sees the invitation'
);
select is(
  jsonb_array_length(public.get_incoming_organizer_invites_command('01992026-0908-8000-8000-000000000073')),
  0,
  'an unrelated account cannot discover the invitation'
);
select ok(
  public.get_organizer_team_command(
    '01992026-0908-8000-8000-000000000071',
    (select id from public.organizer_profiles where display_name = 'Shared Organizer Fixture')
  ) #>> '{pendingInvites,0,email}' = 'organizer-manager@example.invalid',
  'the organizer owner can see the pending invitation email'
);
select lives_ok(
  $$
    select public.accept_organizer_manager_invite_command(
      '01992026-0908-8000-8000-000000000072',
      (select id from public.organizer_profile_invites),
      'Fixture Manager',
      '01992026-0908-8000-8000-000000000707'
    )
  $$,
  'the verified invitee can explicitly accept the invitation'
);
select is((select count(*) from public.organizer_profile_invites), 0::bigint, 'acceptance deletes the email-bearing invitation');
select is(
  (select display_name from public.organizer_profile_memberships where account_id = '01992026-0908-8000-8000-000000000072'),
  'Fixture Manager',
  'acceptance stores the chosen organizer-team display name'
);
select is(
  (select role from public.organizer_profile_memberships where account_id = '01992026-0908-8000-8000-000000000072'),
  'manager',
  'acceptance grants only the manager role'
);
select is(
  jsonb_array_length(public.get_organizer_team_command(
    '01992026-0908-8000-8000-000000000072',
    (select id from public.organizer_profiles where display_name = 'Shared Organizer Fixture')
  ) -> 'pendingInvites'),
  0,
  'a manager never receives pending invitation emails in the team summary'
);
select throws_ok(
  $$
    select public.remove_organizer_manager_command(
      '01992026-0908-8000-8000-000000000072',
      (select id from public.organizer_profiles where display_name = 'Shared Organizer Fixture'),
      (select id from public.organizer_profile_memberships where account_id = '01992026-0908-8000-8000-000000000072'),
      3,
      now(),
      '01992026-0908-8000-8000-000000000708'
    )
  $$,
  'P0001',
  'Only the organizer owner can manage managers',
  'a manager cannot remove organizer-team members'
);
select lives_ok(
  $$
    select public.remove_organizer_manager_command(
      '01992026-0908-8000-8000-000000000071',
      (select id from public.organizer_profiles where display_name = 'Shared Organizer Fixture'),
      (select id from public.organizer_profile_memberships where account_id = '01992026-0908-8000-8000-000000000072'),
      3,
      now(),
      '01992026-0908-8000-8000-000000000709'
    )
  $$,
  'the owner can remove a manager'
);
select is(
  (select count(*) from public.organizer_profile_memberships where account_id = '01992026-0908-8000-8000-000000000072'),
  0::bigint,
  'removal revokes organizer management immediately'
);
select ok(
  not exists (
    select 1 from app_private.audit_events
    where action like 'organizer.manager_%'
      and (safe_summary ? 'email' or safe_summary ? 'accountId')
  ),
  'organizer-team audits exclude account IDs and email addresses'
);
select ok(
  exists (select 1 from cron.job where jobname = 'promenadis-purge-expired-organizer-invites'),
  'an hourly organizer-invitation cleanup job is scheduled'
);

select * from finish();
rollback;
