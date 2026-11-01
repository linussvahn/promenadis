begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.event_ownership_transfers'::regclass),
  'ownership transfers have row-level security enabled'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.event_ownership_transfers'::regclass),
  'ownership transfers force row-level security'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_ownership_transfers', 'SELECT'),
  'authenticated clients cannot read transfer state directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.initiate_event_ownership_transfer_command(uuid,uuid,uuid,integer,timestamptz,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the BFF transfer command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.initiate_event_ownership_transfer_command(uuid,uuid,uuid,integer,timestamptz,uuid)',
    'EXECUTE'
  ),
  'the BFF service role may execute the transfer command'
);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('01992026-0908-7000-8000-000000000061', 'transfer-owner@example.invalid', now(), now(), now()),
  ('01992026-0908-7000-8000-000000000062', 'transfer-recipient@example.invalid', now(), now(), now()),
  ('01992026-0908-7000-8000-000000000063', 'transfer-unverified@example.invalid', null, now(), now()),
  ('01992026-0908-7000-8000-000000000064', 'transfer-moderator@example.invalid', now(), now(), now()),
  ('01992026-0908-7000-8000-000000000065', 'transfer-outsider@example.invalid', now(), now(), now());

select lives_ok(
  $$
    select public.create_organizer_profile_command(
      '01992026-0908-7000-8000-000000000061',
      'Transfer Test Organizer',
      'individual',
      '',
      '',
      '01992026-0908-7000-8000-000000000601'
    )
  $$,
  'the owner can create the organizer fixture'
);
select lives_ok(
  $$
    select public.create_scheduled_draft_event_command(
      '01992026-0908-7000-8000-000000000061',
      (select id from public.organizer_profiles where display_name = 'Transfer Test Organizer'),
      '',
      'Ownership Transfer Event',
      '',
      'Europe/Stockholm',
      'unlisted',
      '2030-11-08 10:00:00+01',
      '2030-11-08 15:00:00+01',
      '01992026-0908-7000-8000-000000000602'
    )
  $$,
  'the owner can create the event fixture'
);

insert into public.event_memberships (event_id, account_id, role, display_name)
select id, '01992026-0908-7000-8000-000000000062', 'co_host', 'Eligible Recipient'
from public.events where title = 'Ownership Transfer Event';
insert into public.event_memberships (event_id, account_id, role, display_name)
select id, '01992026-0908-7000-8000-000000000063', 'co_host', 'Unverified Co-host'
from public.events where title = 'Ownership Transfer Event';
insert into public.event_memberships (event_id, account_id, role, display_name)
select id, '01992026-0908-7000-8000-000000000064', 'moderator', 'Test Moderator'
from public.events where title = 'Ownership Transfer Event';

select is(
  public.get_event_team_command(
    '01992026-0908-7000-8000-000000000061',
    (select id from public.events where title = 'Ownership Transfer Event')
  ) ->> 'currentMembershipId',
  (select id::text from public.event_memberships where account_id = '01992026-0908-7000-8000-000000000061'),
  'the team summary identifies the viewer membership without exposing an account ID'
);
select is(
  (
    select member ->> 'canReceiveOwnership'
    from jsonb_array_elements(public.get_event_team_command(
      '01992026-0908-7000-8000-000000000061',
      (select id from public.events where title = 'Ownership Transfer Event')
    ) -> 'members') as member
    where member ->> 'displayName' = 'Eligible Recipient'
  ),
  'false',
  'a co-host who does not manage the organizer is not offered as a recipient'
);
select throws_ok(
  $$
    select public.initiate_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000061',
      (select id from public.events where title = 'Ownership Transfer Event'),
      (select id from public.event_memberships where account_id = '01992026-0908-7000-8000-000000000062'),
      1,
      now() - interval '16 minutes',
      '01992026-0908-7000-8000-000000000603'
    )
  $$,
  'P0001',
  'Recent authentication required',
  'starting a transfer requires recent owner authentication'
);
select throws_ok(
  $$
    select public.initiate_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000061',
      (select id from public.events where title = 'Ownership Transfer Event'),
      (select id from public.event_memberships where account_id = '01992026-0908-7000-8000-000000000062'),
      1,
      now(),
      '01992026-0908-7000-8000-000000000604'
    )
  $$,
  'P0001',
  'The co-host must manage the selected organizer',
  'event ownership does not silently grant organizer management'
);
select throws_ok(
  $$
    select public.initiate_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000061',
      (select id from public.events where title = 'Ownership Transfer Event'),
      (select id from public.event_memberships where account_id = '01992026-0908-7000-8000-000000000063'),
      1,
      now(),
      '01992026-0908-7000-8000-000000000605'
    )
  $$,
  'P0001',
  'A verified co-host is required',
  'an unverified co-host cannot receive ownership'
);
select throws_ok(
  $$
    select public.initiate_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000061',
      (select id from public.events where title = 'Ownership Transfer Event'),
      (select id from public.event_memberships where account_id = '01992026-0908-7000-8000-000000000064'),
      1,
      now(),
      '01992026-0908-7000-8000-000000000606'
    )
  $$,
  'P0001',
  'Ownership can only be transferred to a co-host',
  'a moderator cannot receive ownership directly'
);

insert into public.organizer_profile_memberships (organizer_profile_id, account_id, role)
select id, '01992026-0908-7000-8000-000000000062', 'manager'
from public.organizer_profiles where display_name = 'Transfer Test Organizer';

select is(
  (
    select member ->> 'canReceiveOwnership'
    from jsonb_array_elements(public.get_event_team_command(
      '01992026-0908-7000-8000-000000000061',
      (select id from public.events where title = 'Ownership Transfer Event')
    ) -> 'members') as member
    where member ->> 'displayName' = 'Eligible Recipient'
  ),
  'true',
  'a verified co-host who manages the organizer is offered as a recipient'
);
select lives_ok(
  $$
    select public.initiate_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000061',
      (select id from public.events where title = 'Ownership Transfer Event'),
      (select id from public.event_memberships where account_id = '01992026-0908-7000-8000-000000000062'),
      1,
      now(),
      '01992026-0908-7000-8000-000000000607'
    )
  $$,
  'the owner can initiate a transfer to an eligible co-host'
);
select is(
  (select team_version from public.events where title = 'Ownership Transfer Event'),
  2,
  'initiating a transfer increments the team version'
);
select is((select count(*) from public.event_ownership_transfers), 1::bigint, 'one transfer is pending');
select ok(
  (select expires_at <= created_at + interval '7 days 1 minute' from public.event_ownership_transfers),
  'the transfer expires within seven days'
);
select is(
  public.get_event_team_command(
    '01992026-0908-7000-8000-000000000062',
    (select id from public.events where title = 'Ownership Transfer Event')
  ) #>> '{pendingTransfer,toDisplayName}',
  'Eligible Recipient',
  'the intended co-host sees the pending transfer without an email address'
);
select ok(
  (
    select not (safe_summary ? 'accountId') and not (safe_summary ? 'email')
    from app_private.audit_events where action = 'event.ownership_transfer_initiated'
  ),
  'the initiation audit excludes account IDs and email addresses'
);
select throws_ok(
  $$
    select public.initiate_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000061',
      (select id from public.events where title = 'Ownership Transfer Event'),
      (select id from public.event_memberships where account_id = '01992026-0908-7000-8000-000000000062'),
      2,
      now(),
      '01992026-0908-7000-8000-000000000608'
    )
  $$,
  'P0001',
  'An ownership transfer is already pending',
  'only one transfer may be pending for an event'
);
select throws_ok(
  $$
    select public.accept_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000065',
      (select event_id from public.event_ownership_transfers),
      (select id from public.event_ownership_transfers),
      2,
      '01992026-0908-7000-8000-000000000609'
    )
  $$,
  'P0001',
  'Ownership transfer unavailable',
  'an unrelated account cannot accept the transfer'
);
select throws_ok(
  $$
    select public.accept_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000062',
      (select event_id from public.event_ownership_transfers),
      (select id from public.event_ownership_transfers),
      1,
      '01992026-0908-7000-8000-000000000610'
    )
  $$,
  'P0001',
  'Event team version conflict',
  'a stale recipient cannot accept the transfer'
);
select lives_ok(
  $$
    select public.accept_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000062',
      (select event_id from public.event_ownership_transfers),
      (select id from public.event_ownership_transfers),
      2,
      '01992026-0908-7000-8000-000000000611'
    )
  $$,
  'the intended verified co-host can explicitly accept the transfer'
);
select is(
  (select team_version from public.events where title = 'Ownership Transfer Event'),
  3,
  'accepting the transfer increments the team version'
);
select is(
  (select count(*) from public.event_memberships where event_id = (select id from public.events where title = 'Ownership Transfer Event') and role = 'owner'),
  1::bigint,
  'the event still has exactly one owner after acceptance'
);
select is(
  (select role from public.event_memberships where account_id = '01992026-0908-7000-8000-000000000062'),
  'owner',
  'the recipient becomes the owner'
);
select is(
  (select role from public.event_memberships where account_id = '01992026-0908-7000-8000-000000000061'),
  'co_host',
  'the previous owner becomes a co-host'
);
select is((select count(*) from public.event_ownership_transfers), 0::bigint, 'acceptance deletes transfer state immediately');
select ok(
  (
    select safe_summary = '{"newOwnerRole":"owner","organizerChanged":false,"previousOwnerRole":"co_host"}'::jsonb
    from app_private.audit_events where action = 'event.ownership_transfer_accepted'
  ),
  'the acceptance audit records only safe role transitions'
);
select throws_ok(
  $$
    select public.initiate_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000061',
      (select id from public.events where title = 'Ownership Transfer Event'),
      (select id from public.event_memberships where account_id = '01992026-0908-7000-8000-000000000062'),
      3,
      now(),
      '01992026-0908-7000-8000-000000000612'
    )
  $$,
  'P0001',
  'Only the event owner can transfer ownership',
  'the previous owner loses owner-only transfer authority'
);
select lives_ok(
  $$
    select public.initiate_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000062',
      (select id from public.events where title = 'Ownership Transfer Event'),
      (select id from public.event_memberships where account_id = '01992026-0908-7000-8000-000000000061'),
      3,
      now(),
      '01992026-0908-7000-8000-000000000613'
    )
  $$,
  'the new owner can initiate a transfer back to the eligible former owner'
);
select throws_ok(
  $$
    select public.cancel_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000061',
      (select event_id from public.event_ownership_transfers),
      (select id from public.event_ownership_transfers),
      4,
      now(),
      '01992026-0908-7000-8000-000000000614'
    )
  $$,
  'P0001',
  'Only the event owner can transfer ownership',
  'a recipient cannot cancel the owner-controlled transfer'
);
select lives_ok(
  $$
    select public.cancel_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000062',
      (select event_id from public.event_ownership_transfers),
      (select id from public.event_ownership_transfers),
      4,
      now(),
      '01992026-0908-7000-8000-000000000615'
    )
  $$,
  'the current owner can cancel the pending transfer'
);
select is((select count(*) from public.event_ownership_transfers), 0::bigint, 'cancellation deletes transfer state immediately');
select is(
  (select count(*) from app_private.audit_events where action = 'event.ownership_transfer_cancelled'),
  1::bigint,
  'cancellation is audited'
);
select throws_ok(
  $$
    do $block$
    begin
      update public.event_memberships
      set role = 'co_host'
      where account_id = '01992026-0908-7000-8000-000000000062';
      set constraints event_memberships_exactly_one_owner immediate;
    end
    $block$
  $$,
  'P0001',
  'Every event must have exactly one owner',
  'the deferred database invariant rejects an ownerless event'
);
select lives_ok(
  $$
    select public.initiate_event_ownership_transfer_command(
      '01992026-0908-7000-8000-000000000062',
      (select id from public.events where title = 'Ownership Transfer Event'),
      (select id from public.event_memberships where account_id = '01992026-0908-7000-8000-000000000061'),
      5,
      now(),
      '01992026-0908-7000-8000-000000000616'
    )
  $$,
  'a final transfer can be created for expiry testing'
);
update public.event_ownership_transfers
set created_at = clock_timestamp() - interval '8 days',
    expires_at = clock_timestamp() - interval '1 day';
select is(
  public.purge_expired_event_ownership_transfers_command(),
  1::bigint,
  'the purge command deletes expired transfer state'
);
select is((select count(*) from public.event_ownership_transfers), 0::bigint, 'no expired transfer data remains');
select ok(
  exists (
    select 1 from cron.job where jobname = 'promenadis-purge-expired-event-ownership-transfers'
  ),
  'an hourly expiry cleanup job is scheduled'
);

select * from finish();
rollback;
