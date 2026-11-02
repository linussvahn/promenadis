begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  not has_function_privilege(
    'authenticated',
    'public.enroll_account_recovery_code_command(uuid,text,integer,timestamptz,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass recovery-code enrollment'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.enroll_account_recovery_code_command(uuid,text,integer,timestamptz,uuid)',
    'EXECUTE'
  ),
  'the BFF service role may enroll a recovery code'
);
select ok(
  not has_table_privilege('authenticated', 'app_private.account_recovery_codes', 'SELECT'),
  'authenticated clients cannot read recovery-code hashes'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_emergency_successors', 'SELECT'),
  'authenticated clients cannot bypass the successor command'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_publication_attestations', 'SELECT'),
  'authenticated clients cannot bypass publication attestations'
);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('01992026-0909-7000-8000-000000000101', 'readiness-owner@example.invalid', now(), now(), now()),
  ('01992026-0909-7000-8000-000000000102', 'readiness-successor@example.invalid', now(), now(), now()),
  ('01992026-0909-7000-8000-000000000103', 'readiness-outsider@example.invalid', now(), now(), now());

select public.create_organizer_profile_command(
  '01992026-0909-7000-8000-000000000101',
  'Readiness Owner', 'individual', '', '',
  '01992026-0909-7000-8000-000000000111'
);
select public.create_organizer_profile_command(
  '01992026-0909-7000-8000-000000000102',
  'Readiness Successor', 'individual', '', '',
  '01992026-0909-7000-8000-000000000112'
);
select public.create_scheduled_draft_event_command(
  '01992026-0909-7000-8000-000000000101',
  (select id from public.organizer_profiles where display_name = 'Readiness Owner'),
  '', 'Publication Readiness Fixture', '', 'Europe/Stockholm', 'unlisted',
  '2031-09-09 10:00:00+02', '2031-09-09 15:00:00+02',
  '01992026-0909-7000-8000-000000000113'
);

select is(
  public.get_account_security_command('01992026-0909-7000-8000-000000000101') ->> 'version',
  '0',
  'an account begins without a recovery code'
);
select throws_ok(
  $$
    select public.enroll_account_recovery_code_command(
      '01992026-0909-7000-8000-000000000101',
      'ABCD-EFGH-JKLM-NPQR-STUV', 0, now() - interval '16 minutes',
      '01992026-0909-7000-8000-000000000114'
    )
  $$,
  'P0001', 'Recent authentication required',
  'recovery-code enrollment requires recent authentication'
);
select lives_ok(
  $$
    select public.enroll_account_recovery_code_command(
      '01992026-0909-7000-8000-000000000101',
      'ABCD-EFGH-JKLM-NPQR-STUV', 0, now(),
      '01992026-0909-7000-8000-000000000115'
    )
  $$,
  'a verified account may enroll its first recovery code'
);

select isnt(
  (select code_hash from app_private.account_recovery_codes),
  'ABCD-EFGH-JKLM-NPQR-STUV',
  'the plaintext recovery code is not stored'
);
select ok(
  (
    select extensions.crypt('ABCD-EFGH-JKLM-NPQR-STUV', code_hash) = code_hash
    from app_private.account_recovery_codes
  ),
  'the stored hash verifies the enrolled code'
);
select ok(
  not (
    public.get_account_security_command('01992026-0909-7000-8000-000000000101')
    ? 'codeHash'
  ),
  'the status response never exposes the hash'
);
select throws_ok(
  $$
    select public.enroll_account_recovery_code_command(
      '01992026-0909-7000-8000-000000000101',
      '2345-6789-ABCD-EFGH-JKLM', 0, now(),
      '01992026-0909-7000-8000-000000000116'
    )
  $$,
  'P0001', 'Recovery code version conflict',
  'rotation rejects a stale recovery-code version'
);
select lives_ok(
  $$
    select public.enroll_account_recovery_code_command(
      '01992026-0909-7000-8000-000000000101',
      '2345-6789-ABCD-EFGH-JKLM', 1, now(),
      '01992026-0909-7000-8000-000000000117'
    )
  $$,
  'the current recovery code may be rotated'
);
select is(
  (select version from app_private.account_recovery_codes),
  2,
  'rotation advances the recovery-code version'
);
select ok(
  (select rotated_at is not null from app_private.account_recovery_codes),
  'rotation records only lifecycle metadata'
);

insert into public.event_memberships (event_id, account_id, role, display_name)
select id, '01992026-0909-7000-8000-000000000102', 'co_host', 'Successor Person'
from public.events where title = 'Publication Readiness Fixture';

select is(
  jsonb_array_length(
    public.get_event_team_command(
      '01992026-0909-7000-8000-000000000101',
      (select id from public.events where title = 'Publication Readiness Fixture')
    ) -> 'successorOptions'
  ),
  1,
  'the owner sees one eligible verified co-host and organizer pair'
);
select throws_ok(
  $$
    select public.set_event_emergency_successor_command(
      '01992026-0909-7000-8000-000000000103',
      (select id from public.events where title = 'Publication Readiness Fixture'),
      (select id from public.event_memberships where account_id = '01992026-0909-7000-8000-000000000102'),
      (select id from public.organizer_profiles where display_name = 'Readiness Successor'),
      1, now(), '01992026-0909-7000-8000-000000000118'
    )
  $$,
  'P0001', 'Only the event owner can designate a successor',
  'an outsider cannot designate an emergency successor'
);

select lives_ok(
  $$
    select public.set_event_emergency_successor_command(
      '01992026-0909-7000-8000-000000000101',
      (select id from public.events where title = 'Publication Readiness Fixture'),
      (select id from public.event_memberships where account_id = '01992026-0909-7000-8000-000000000102'),
      (select id from public.organizer_profiles where display_name = 'Readiness Successor'),
      1, now(), '01992026-0909-7000-8000-000000000119'
    )
  $$,
  'the owner may designate the eligible co-host and organizer pair'
);
select is(
  public.get_event_team_command(
    '01992026-0909-7000-8000-000000000102',
    (select id from public.events where title = 'Publication Readiness Fixture')
  ) #>> '{emergencySuccessor,recipientDisplayName}',
  'Successor Person',
  'the event team can see the designated successor without account data'
);
select throws_ok(
  $$
    select public.set_event_emergency_successor_command(
      '01992026-0909-7000-8000-000000000101',
      (select id from public.events where title = 'Publication Readiness Fixture'),
      (select id from public.event_memberships where account_id = '01992026-0909-7000-8000-000000000102'),
      (select id from public.organizer_profiles where display_name = 'Readiness Successor'),
      1, now(), '01992026-0909-7000-8000-000000000120'
    )
  $$,
  'P0001', 'Event team version conflict',
  'successor changes reject a stale team version'
);
select ok(
  public.get_event_publication_readiness_command(
    '01992026-0909-7000-8000-000000000101',
    (select id from public.events where title = 'Publication Readiness Fixture')
  ) -> 'blockers' ? 'boundary_missing',
  'readiness identifies a missing boundary'
);

select public.upsert_draft_event_boundary_command(
  '01992026-0909-7000-8000-000000000101',
  (select id from public.events where title = 'Publication Readiness Fixture'),
  null,
  'Synthetic readiness area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3300]]]}'::jsonb,
  '01992026-0909-7000-8000-000000000121'
);
select ok(
  public.get_event_publication_readiness_command(
    '01992026-0909-7000-8000-000000000101',
    (select id from public.events where title = 'Publication Readiness Fixture')
  ) -> 'blockers' ? 'publication_attestation_missing',
  'readiness requires a current owner attestation'
);
select lives_ok(
  $$
    select public.attest_event_publication_command(
      '01992026-0909-7000-8000-000000000101',
      (select id from public.events where title = 'Publication Readiness Fixture'),
      1, 1, 1, true, true, now(),
      '01992026-0909-7000-8000-000000000122'
    )
  $$,
  'the owner may attest the exact current draft configuration'
);
select ok(
  not (
    public.get_event_publication_readiness_command(
      '01992026-0909-7000-8000-000000000101',
      (select id from public.events where title = 'Publication Readiness Fixture')
    ) -> 'blockers' ? 'publication_attestation_missing'
  ),
  'a current attestation clears its readiness blocker'
);
select is(
  public.get_event_publication_readiness_command(
    '01992026-0909-7000-8000-000000000101',
    (select id from public.events where title = 'Publication Readiness Fixture')
  ) ->> 'readyToPublish',
  'false',
  'publishing remains fail-closed while review, routing, and delivery are unimplemented'
);
select ok(
  public.get_event_publication_readiness_command(
    '01992026-0909-7000-8000-000000000101',
    (select id from public.events where title = 'Publication Readiness Fixture')
  ) -> 'blockers' ? 'routing_not_ready',
  'readiness honestly reports the unimplemented routing dependency'
);

select lives_ok(
  $$
    select public.clear_event_emergency_successor_command(
      '01992026-0909-7000-8000-000000000101',
      (select id from public.events where title = 'Publication Readiness Fixture'),
      2, now(), '01992026-0909-7000-8000-000000000123'
    )
  $$,
  'the owner may clear the successor with the current team version'
);
select is(
  (select count(*) from public.event_emergency_successors),
  0::bigint,
  'clearing removes the successor designation immediately'
);
select ok(
  (select bool_and(safe_summary::text !~* 'email|account') from app_private.audit_events
   where action like 'event.emergency_successor_%'),
  'successor audit summaries contain no email or account identifier fields'
);

select * from finish();
rollback;
