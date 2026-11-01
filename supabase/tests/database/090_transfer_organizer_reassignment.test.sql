begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select ok(
  not has_function_privilege(
    'authenticated',
    'public.initiate_event_ownership_transfer_v2_command(uuid,uuid,uuid,uuid,integer,timestamptz,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the BFF organizer-reassignment command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.initiate_event_ownership_transfer_v2_command(uuid,uuid,uuid,uuid,integer,timestamptz,uuid)',
    'EXECUTE'
  ),
  'the BFF service role may execute the organizer-reassignment command'
);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('01992026-0908-9000-8000-000000000081', 'handoff-owner@example.invalid', now(), now(), now()),
  ('01992026-0908-9000-8000-000000000082', 'handoff-recipient@example.invalid', now(), now(), now());

select lives_ok(
  $$
    select public.create_organizer_profile_command(
      '01992026-0908-9000-8000-000000000081',
      'Original Personal Organizer',
      'individual', '', '',
      '01992026-0908-9000-8000-000000000801'
    )
  $$,
  'the current owner can create a personal organizer identity'
);
select lives_ok(
  $$
    select public.create_organizer_profile_command(
      '01992026-0908-9000-8000-000000000082',
      'Recipient Personal Organizer',
      'individual', '', '',
      '01992026-0908-9000-8000-000000000802'
    )
  $$,
  'the recipient can create a separate personal organizer identity'
);
select lives_ok(
  $$
    select public.create_scheduled_draft_event_command(
      '01992026-0908-9000-8000-000000000081',
      (select id from public.organizer_profiles where display_name = 'Original Personal Organizer'),
      '', 'Private Handoff Fixture', '', 'Europe/Stockholm', 'unlisted',
      '2030-12-08 10:00:00+01', '2030-12-08 15:00:00+01',
      '01992026-0908-9000-8000-000000000803'
    )
  $$,
  'the owner can create the event fixture'
);

insert into public.event_memberships (event_id, account_id, role, display_name)
select id, '01992026-0908-9000-8000-000000000082', 'co_host', 'Handoff Recipient'
from public.events where title = 'Private Handoff Fixture';

select is(
  (
    select option ->> 'organizerDisplayName'
    from jsonb_array_elements(public.get_event_team_command(
      '01992026-0908-9000-8000-000000000081',
      (select id from public.events where title = 'Private Handoff Fixture')
    ) -> 'ownershipTransferOptions') as option
    where option ->> 'recipientDisplayName' = 'Handoff Recipient'
  ),
  'Recipient Personal Organizer',
  'the owner is offered the organizer identity the recipient already controls'
);
select is(
  (
    select option ->> 'organizerWillChange'
    from jsonb_array_elements(public.get_event_team_command(
      '01992026-0908-9000-8000-000000000081',
      (select id from public.events where title = 'Private Handoff Fixture')
    ) -> 'ownershipTransferOptions') as option
    where option ->> 'recipientDisplayName' = 'Handoff Recipient'
  ),
  'true',
  'the transfer option explicitly signals the public organizer change'
);
select is(
  jsonb_array_length(public.get_event_team_command(
    '01992026-0908-9000-8000-000000000082',
    (select id from public.events where title = 'Private Handoff Fixture')
  ) -> 'ownershipTransferOptions'),
  0,
  'a co-host cannot enumerate owner-only transfer choices'
);
select throws_ok(
  $$
    select public.initiate_event_ownership_transfer_v2_command(
      '01992026-0908-9000-8000-000000000081',
      (select id from public.events where title = 'Private Handoff Fixture'),
      (select id from public.event_memberships where account_id = '01992026-0908-9000-8000-000000000082'),
      (select id from public.organizer_profiles where display_name = 'Original Personal Organizer'),
      1, now(), '01992026-0908-9000-8000-000000000804'
    )
  $$,
  'P0001',
  'The co-host must manage the selected organizer',
  'the current owner cannot grant access to their own organizer as a transfer side effect'
);
select lives_ok(
  $$
    select public.initiate_event_ownership_transfer_v2_command(
      '01992026-0908-9000-8000-000000000081',
      (select id from public.events where title = 'Private Handoff Fixture'),
      (select id from public.event_memberships where account_id = '01992026-0908-9000-8000-000000000082'),
      (select id from public.organizer_profiles where display_name = 'Recipient Personal Organizer'),
      1, now(), '01992026-0908-9000-8000-000000000805'
    )
  $$,
  'the owner can propose a handoff to the recipient-controlled organizer'
);
select is(
  (select target_organizer_profile_id from public.event_ownership_transfers),
  (select id from public.organizer_profiles where display_name = 'Recipient Personal Organizer'),
  'the pending transfer freezes the owner-approved target organizer identity'
);
select is(
  public.get_event_team_command(
    '01992026-0908-9000-8000-000000000082',
    (select id from public.events where title = 'Private Handoff Fixture')
  ) #>> '{pendingTransfer,targetOrganizerDisplayName}',
  'Recipient Personal Organizer',
  'the recipient sees which public organizer identity will be used'
);
select lives_ok(
  $$
    select public.accept_event_ownership_transfer_command(
      '01992026-0908-9000-8000-000000000082',
      (select event_id from public.event_ownership_transfers),
      (select id from public.event_ownership_transfers),
      2,
      '01992026-0908-9000-8000-000000000806'
    )
  $$,
  'the recipient can explicitly accept the owner-approved handoff'
);
select is(
  (select organizer_profile_id from public.events where title = 'Private Handoff Fixture'),
  (select id from public.organizer_profiles where display_name = 'Recipient Personal Organizer'),
  'acceptance atomically changes the event organizer identity'
);
select is(
  (select role from public.event_memberships where account_id = '01992026-0908-9000-8000-000000000082'),
  'owner',
  'acceptance atomically promotes the recipient to event owner'
);
select is(
  (select role from public.event_memberships where account_id = '01992026-0908-9000-8000-000000000081'),
  'co_host',
  'acceptance atomically demotes the previous owner to co-host'
);
select is(
  (select version from public.events where title = 'Private Handoff Fixture'),
  2,
  'changing the public organizer increments the event content version'
);
select is(
  (select team_version from public.events where title = 'Private Handoff Fixture'),
  3,
  'acceptance increments the event team version'
);
select is((select count(*) from public.event_ownership_transfers), 0::bigint, 'acceptance deletes the transfer record immediately');
select ok(
  (
    select safe_summary = '{"newOwnerRole":"owner","organizerChanged":true,"previousOwnerRole":"co_host"}'::jsonb
    from app_private.audit_events
    where action = 'event.ownership_transfer_accepted'
  ),
  'the acceptance audit records the organizer change without profile or account identifiers'
);

select * from finish();
rollback;
