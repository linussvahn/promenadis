begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  not has_table_privilege('authenticated', 'public.event_emergency_successor_claims', 'SELECT'),
  'authenticated clients cannot read emergency claims directly'
);
select ok(
  not has_table_privilege('authenticated', 'app_private.notification_jobs', 'SELECT'),
  'authenticated clients cannot read notification jobs directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.initiate_event_emergency_successor_claim_command(uuid,uuid,integer,timestamptz,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass emergency-claim initiation'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_event_emergency_successor_claim_command(uuid,uuid,uuid,integer,timestamptz,uuid)',
    'EXECUTE'
  ),
  'the BFF service role may complete a mature emergency claim'
);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('01992026-0909-7100-8000-000000000101', 'claim-owner@example.invalid', now(), now(), now()),
  ('01992026-0909-7100-8000-000000000102', 'claim-successor@example.invalid', now(), now(), now()),
  ('01992026-0909-7100-8000-000000000103', 'claim-outsider@example.invalid', now(), now(), now());

select public.create_organizer_profile_command(
  '01992026-0909-7100-8000-000000000101',
  'Claim Owner', 'individual', '', '',
  '01992026-0909-7100-8000-000000000111'
);
select public.create_organizer_profile_command(
  '01992026-0909-7100-8000-000000000102',
  'Claim Successor', 'individual', '', '',
  '01992026-0909-7100-8000-000000000112'
);
select public.create_scheduled_draft_event_command(
  '01992026-0909-7100-8000-000000000101',
  (select id from public.organizer_profiles where display_name = 'Claim Owner'),
  '', 'Emergency Claim Fixture', '', 'Europe/Stockholm', 'unlisted',
  '2031-09-09 10:00:00+02', '2031-09-09 15:00:00+02',
  '01992026-0909-7100-8000-000000000113'
);
insert into public.event_memberships (event_id, account_id, role, display_name)
values (
  (select id from public.events where title = 'Emergency Claim Fixture'),
  '01992026-0909-7100-8000-000000000102',
  'co_host',
  'Claim Successor'
);
select public.set_event_emergency_successor_command(
  '01992026-0909-7100-8000-000000000101',
  (select id from public.events where title = 'Emergency Claim Fixture'),
  (select id from public.event_memberships
   where account_id = '01992026-0909-7100-8000-000000000102'),
  (select id from public.organizer_profiles where display_name = 'Claim Successor'),
  1, now(), '01992026-0909-7100-8000-000000000114'
);

select throws_ok(
  $$
    select public.initiate_event_emergency_successor_claim_command(
      '01992026-0909-7100-8000-000000000103',
      (select id from public.events where title = 'Emergency Claim Fixture'),
      2, now(), '01992026-0909-7100-8000-000000000115'
    )
  $$,
  'P0001', 'Only the designated successor can start a claim',
  'an outsider cannot start the emergency claim'
);
select throws_ok(
  $$
    select public.initiate_event_emergency_successor_claim_command(
      '01992026-0909-7100-8000-000000000102',
      (select id from public.events where title = 'Emergency Claim Fixture'),
      2, now() - interval '16 minutes', '01992026-0909-7100-8000-000000000116'
    )
  $$,
  'P0001', 'Recent authentication required',
  'emergency-claim initiation requires recent authentication'
);
select lives_ok(
  $$
    select public.initiate_event_emergency_successor_claim_command(
      '01992026-0909-7100-8000-000000000102',
      (select id from public.events where title = 'Emergency Claim Fixture'),
      2, now(), '01992026-0909-7100-8000-000000000117'
    )
  $$,
  'the designated verified successor may start a claim'
);
select is(
  (select team_version from public.events where title = 'Emergency Claim Fixture'),
  3,
  'starting a claim advances the event team version'
);
select ok(
  (select ready_at >= initiated_at + interval '24 hours'
   from public.event_emergency_successor_claims),
  'the claim cannot mature before 24 hours'
);
select ok(
  public.get_event_team_command(
    '01992026-0909-7100-8000-000000000101',
    (select id from public.events where title = 'Emergency Claim Fixture')
  ) -> 'pendingEmergencyClaim' is not null,
  'the owner sees the pending claim in the event team summary'
);
select is(
  (select count(*) from app_private.notification_jobs
   where template_key = 'event_emergency_claim_started'),
  2::bigint,
  'claim initiation queues one start notice per event-team account'
);
select is(
  (select count(*) from app_private.notification_jobs
   where template_key = 'event_emergency_claim_ready'),
  1::bigint,
  'claim initiation queues one delayed ready notice for the successor'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'notification_jobs'
      and column_name like '%email%'
  ),
  'notification jobs do not copy email addresses'
);
select throws_ok(
  $$
    select public.complete_event_emergency_successor_claim_command(
      '01992026-0909-7100-8000-000000000102',
      (select id from public.events where title = 'Emergency Claim Fixture'),
      (select id from public.event_emergency_successor_claims),
      3, now(), '01992026-0909-7100-8000-000000000118'
    )
  $$,
  'P0001', 'Emergency successor claim is not ready',
  'the successor cannot bypass the 24-hour delay'
);
select throws_ok(
  $$
    select public.initiate_event_ownership_transfer_v2_command(
      '01992026-0909-7100-8000-000000000101',
      (select id from public.events where title = 'Emergency Claim Fixture'),
      (select id from public.event_memberships
       where account_id = '01992026-0909-7100-8000-000000000102'),
      (select id from public.organizer_profiles where display_name = 'Claim Successor'),
      3, now(), '01992026-0909-7100-8000-000000000119'
    )
  $$,
  'P0001', 'An emergency successor claim is already pending',
  'a planned transfer cannot overlap an emergency claim'
);
select lives_ok(
  $$
    select public.cancel_event_emergency_successor_claim_command(
      '01992026-0909-7100-8000-000000000101',
      (select id from public.events where title = 'Emergency Claim Fixture'),
      (select id from public.event_emergency_successor_claims),
      3, now(), '01992026-0909-7100-8000-000000000120'
    )
  $$,
  'the current owner may cancel a pending emergency claim'
);
select is(
  (select count(*) from public.event_emergency_successor_claims),
  0::bigint,
  'cancellation deletes the short-lived claim'
);
select is(
  (select count(*) from app_private.notification_jobs
   where template_key in ('event_emergency_claim_started', 'event_emergency_claim_ready')
     and cancelled_at is not null),
  3::bigint,
  'cancellation invalidates undelivered claim notifications'
);
select is(
  (select count(*) from app_private.notification_jobs
   where template_key = 'event_emergency_claim_cancelled'),
  2::bigint,
  'cancellation queues one notice per event-team account'
);

select public.initiate_event_emergency_successor_claim_command(
  '01992026-0909-7100-8000-000000000102',
  (select id from public.events where title = 'Emergency Claim Fixture'),
  4, now(), '01992026-0909-7100-8000-000000000121'
);
update public.event_emergency_successor_claims
set initiated_at = clock_timestamp() - interval '2 days',
    ready_at = clock_timestamp() - interval '1 day',
    expires_at = clock_timestamp() + interval '4 days';

select throws_ok(
  $$
    select public.complete_event_emergency_successor_claim_command(
      '01992026-0909-7100-8000-000000000103',
      (select id from public.events where title = 'Emergency Claim Fixture'),
      (select id from public.event_emergency_successor_claims),
      5, now(), '01992026-0909-7100-8000-000000000122'
    )
  $$,
  'P0001', 'Emergency successor claim unavailable',
  'an outsider cannot complete a mature emergency claim'
);
select throws_ok(
  $$
    select public.complete_event_emergency_successor_claim_command(
      '01992026-0909-7100-8000-000000000102',
      (select id from public.events where title = 'Emergency Claim Fixture'),
      (select id from public.event_emergency_successor_claims),
      4, now(), '01992026-0909-7100-8000-000000000123'
    )
  $$,
  'P0001', 'Event team version conflict',
  'claim completion rejects a stale event team version'
);
select lives_ok(
  $$
    select public.complete_event_emergency_successor_claim_command(
      '01992026-0909-7100-8000-000000000102',
      (select id from public.events where title = 'Emergency Claim Fixture'),
      (select id from public.event_emergency_successor_claims),
      5, now(), '01992026-0909-7100-8000-000000000124'
    )
  $$,
  'the successor may complete a mature valid claim'
);
select is(
  (select role from public.event_memberships
   where account_id = '01992026-0909-7100-8000-000000000102'),
  'owner',
  'the successor becomes the event owner'
);
select is(
  (select role from public.event_memberships
   where account_id = '01992026-0909-7100-8000-000000000101'),
  'co_host',
  'the previous owner becomes a co-host'
);
select is(
  (select count(*) from public.event_memberships where role = 'owner'),
  1::bigint,
  'emergency completion preserves exactly one owner'
);
select is(
  (select organizer.display_name
   from public.events as event
   join public.organizer_profiles as organizer on organizer.id = event.organizer_profile_id
   where event.title = 'Emergency Claim Fixture'),
  'Claim Successor',
  'the pre-approved organizer identity is applied atomically'
);
select is(
  (select count(*) from public.event_emergency_successor_claims),
  0::bigint,
  'completion deletes the pending claim'
);
select is(
  (select count(*) from public.event_emergency_successors),
  0::bigint,
  'completion clears the consumed designation'
);
select is(
  (select count(*) from app_private.notification_jobs
   where template_key = 'event_emergency_claim_completed'),
  2::bigint,
  'completion queues one notice per resulting event-team account'
);
select is(
  (select count(*) from app_private.audit_events
   where action like 'event.emergency_successor_claim_%'),
  4::bigint,
  'claim initiation, cancellation, restart, and completion are audited'
);
select ok(
  not exists (
    select 1 from app_private.audit_events
    where action like 'event.emergency_successor_claim_%'
      and safe_summary::text ~* 'email|account'
  ),
  'claim audit summaries exclude email and account identifiers'
);

select * from finish();
rollback;
