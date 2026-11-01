begin;

create extension if not exists pgtap with schema extensions;

select plan(43);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.event_invites'::regclass),
  'event invitations have row-level security enabled'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.event_invites'::regclass),
  'event invitations force row-level security'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_invites', 'SELECT'),
  'authenticated clients cannot read invitation emails directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.invite_event_team_member_command(uuid,uuid,integer,text,text,timestamptz,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the BFF invitation command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.invite_event_team_member_command(uuid,uuid,integer,text,text,timestamptz,uuid)',
    'EXECUTE'
  ),
  'the BFF service role may execute the invitation command'
);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('01992026-0908-7000-8000-000000000031', 'team-owner@example.invalid', now(), now(), now()),
  ('01992026-0908-7000-8000-000000000032', 'team-invitee@example.invalid', null, now(), now()),
  ('01992026-0908-7000-8000-000000000033', 'team-wrong@example.invalid', now(), now(), now()),
  ('01992026-0908-7000-8000-000000000034', 'team-moderator@example.invalid', now(), now(), now());

select lives_ok(
  $$
    select public.create_organizer_profile_command(
      '01992026-0908-7000-8000-000000000031',
      'Team Test Organizer',
      'individual',
      '',
      '',
      '01992026-0908-7000-8000-000000000501'
    )
  $$,
  'the owner can create the organizer fixture'
);
select lives_ok(
  $$
    select public.create_scheduled_draft_event_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.organizer_profiles where display_name = 'Team Test Organizer'),
      '',
      'Team Controls Event',
      '',
      'Europe/Stockholm',
      'unlisted',
      '2030-11-08 10:00:00+01',
      '2030-11-08 15:00:00+01',
      '01992026-0908-7000-8000-000000000502'
    )
  $$,
  'the owner can create the event fixture'
);
select is(
  jsonb_array_length(
    public.get_event_team_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.events where title = 'Team Controls Event')
    ) -> 'members'
  ),
  1,
  'a new event starts with one team member'
);
select is(
  public.get_event_team_command(
    '01992026-0908-7000-8000-000000000031',
    (select id from public.events where title = 'Team Controls Event')
  ) #>> '{members,0,role}',
  'owner',
  'the creator is the only owner'
);

select throws_ok(
  $$
    select public.invite_event_team_member_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.events where title = 'Team Controls Event'),
      1,
      'other@example.invalid',
      'moderator',
      now() - interval '16 minutes',
      '01992026-0908-7000-8000-000000000518'
    )
  $$,
  'P0001',
  'Recent authentication required',
  'team privilege changes require a recent sign-in'
);

select lives_ok(
  $$
    select public.invite_event_team_member_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.events where title = 'Team Controls Event'),
      1,
      'TEAM-INVITEE@EXAMPLE.INVALID',
      'co_host',
      now(),
      '01992026-0908-7000-8000-000000000503'
    )
  $$,
  'the owner can invite a co-host'
);
select is(
  (select team_version from public.events where title = 'Team Controls Event'),
  2,
  'creating an invitation increments the team version'
);
select is(
  (select invited_email from public.event_invites),
  'team-invitee@example.invalid',
  'invitation email matching is normalized'
);
select ok(
  (select expires_at <= created_at + interval '7 days 1 minute' from public.event_invites),
  'the invitation expires within seven days'
);
select ok(
  (
    select not (safe_summary ? 'email')
    from app_private.audit_events
    where action = 'event.team_invited'
  ),
  'the invitation audit does not copy the email address'
);

select throws_ok(
  $$
    select public.invite_event_team_member_command(
      '01992026-0908-7000-8000-000000000033',
      (select id from public.events where title = 'Team Controls Event'),
      2,
      'other@example.invalid',
      'moderator',
      now(),
      '01992026-0908-7000-8000-000000000504'
    )
  $$,
  'P0001',
  'Only the event owner can manage the team',
  'an unrelated account cannot invite team members'
);
select throws_ok(
  $$
    select public.invite_event_team_member_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.events where title = 'Team Controls Event'),
      1,
      'other@example.invalid',
      'moderator',
      now(),
      '01992026-0908-7000-8000-000000000505'
    )
  $$,
  'P0001',
  'Event team version conflict',
  'a stale owner cannot overwrite invitation state'
);
select is(
  jsonb_array_length(
    public.get_incoming_event_invites_command('01992026-0908-7000-8000-000000000032')
  ),
  0,
  'an unverified intended account cannot see the incoming invitation'
);
select is(
  jsonb_array_length(
    public.get_incoming_event_invites_command('01992026-0908-7000-8000-000000000033')
  ),
  0,
  'another account cannot see the incoming invitation'
);
select throws_ok(
  $$
    select public.accept_event_team_invite_command(
      '01992026-0908-7000-8000-000000000032',
      (select id from public.event_invites where invited_email = 'team-invitee@example.invalid'),
      'Invited Co-host',
      '01992026-0908-7000-8000-000000000506'
    )
  $$,
  'P0001',
  'Verified invited email required',
  'an unverified email cannot accept a team invitation'
);
select throws_ok(
  $$
    select public.accept_event_team_invite_command(
      '01992026-0908-7000-8000-000000000033',
      (select id from public.event_invites where invited_email = 'team-invitee@example.invalid'),
      'Wrong Account',
      '01992026-0908-7000-8000-000000000507'
    )
  $$,
  'P0001',
  'Event invitation unavailable',
  'a different verified email cannot accept the invitation'
);

update auth.users
set email_confirmed_at = now()
where id = '01992026-0908-7000-8000-000000000032';

select is(
  jsonb_array_length(
    public.get_incoming_event_invites_command('01992026-0908-7000-8000-000000000032')
  ),
  1,
  'the intended verified account sees its incoming invitation'
);

select lives_ok(
  $$
    select public.accept_event_team_invite_command(
      '01992026-0908-7000-8000-000000000032',
      (select id from public.event_invites where invited_email = 'team-invitee@example.invalid'),
      'Invited Co-host',
      '01992026-0908-7000-8000-000000000508'
    )
  $$,
  'the verified intended account can accept the invitation'
);
select is(
  (select team_version from public.events where title = 'Team Controls Event'),
  3,
  'accepting an invitation increments the team version'
);
select is(
  (
    select role from public.event_memberships
    where account_id = '01992026-0908-7000-8000-000000000032'
  ),
  'co_host',
  'acceptance creates the intended co-host membership'
);
select is(
  (select count(*) from public.event_invites),
  0::bigint,
  'acceptance deletes the invitation email record immediately'
);
select is(
  (
    select count(*) from public.event_memberships
    where event_id = (select id from public.events where title = 'Team Controls Event')
      and role = 'owner'
  ),
  1::bigint,
  'acceptance preserves exactly one owner'
);
select is(
  jsonb_array_length(
    public.get_event_team_command(
      '01992026-0908-7000-8000-000000000032',
      (select id from public.events where title = 'Team Controls Event')
    ) -> 'pendingInvites'
  ),
  0,
  'non-owner team members never receive pending invitation emails'
);

select throws_ok(
  $$
    select public.invite_event_team_member_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.events where title = 'Team Controls Event'),
      3,
      'team-invitee@example.invalid',
      'moderator',
      now(),
      '01992026-0908-7000-8000-000000000509'
    )
  $$,
  'P0001',
  'Account is already an event team member',
  'an existing team member cannot be invited again'
);
select lives_ok(
  $$
    select public.invite_event_team_member_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.events where title = 'Team Controls Event'),
      3,
      'team-moderator@example.invalid',
      'moderator',
      now(),
      '01992026-0908-7000-8000-000000000510'
    )
  $$,
  'the owner can invite a moderator'
);
select lives_ok(
  $$
    select public.accept_event_team_invite_command(
      '01992026-0908-7000-8000-000000000034',
      (select id from public.event_invites where invited_email = 'team-moderator@example.invalid'),
      'Invited Moderator',
      '01992026-0908-7000-8000-000000000511'
    )
  $$,
  'the invited moderator can accept'
);
select is(
  (select team_version from public.events where title = 'Team Controls Event'),
  5,
  'two accepted membership changes advance the team version'
);
select lives_ok(
  $$
    select public.update_event_team_member_role_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.events where title = 'Team Controls Event'),
      (select id from public.event_memberships
       where account_id = '01992026-0908-7000-8000-000000000032'),
      5,
      'moderator',
      now(),
      '01992026-0908-7000-8000-000000000512'
    )
  $$,
  'the owner can change a non-owner role'
);
select is(
  (
    select role from public.event_memberships
    where account_id = '01992026-0908-7000-8000-000000000032'
  ),
  'moderator',
  'the changed role is stored'
);
select throws_ok(
  $$
    select public.update_event_team_member_role_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.events where title = 'Team Controls Event'),
      (select id from public.event_memberships where role = 'owner'),
      6,
      'co_host',
      now(),
      '01992026-0908-7000-8000-000000000513'
    )
  $$,
  'P0001',
  'The event owner role requires ownership transfer',
  'ordinary role editing cannot replace the event owner'
);
select throws_ok(
  $$
    select public.remove_event_team_member_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.events where title = 'Team Controls Event'),
      (select id from public.event_memberships where role = 'owner'),
      6,
      now(),
      '01992026-0908-7000-8000-000000000514'
    )
  $$,
  'P0001',
  'The event owner cannot be removed',
  'the only owner cannot be removed'
);
select lives_ok(
  $$
    select public.remove_event_team_member_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.events where title = 'Team Controls Event'),
      (select id from public.event_memberships
       where account_id = '01992026-0908-7000-8000-000000000032'),
      6,
      now(),
      '01992026-0908-7000-8000-000000000515'
    )
  $$,
  'the owner can remove a non-owner team member'
);
select throws_ok(
  $$
    select public.get_event_team_command(
      '01992026-0908-7000-8000-000000000032',
      (select id from public.events where title = 'Team Controls Event')
    )
  $$,
  'P0001',
  'Actor is not an event team member',
  'removed membership loses event-team access immediately'
);
select lives_ok(
  $$
    select public.invite_event_team_member_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.events where title = 'Team Controls Event'),
      7,
      'team-wrong@example.invalid',
      'co_host',
      now(),
      '01992026-0908-7000-8000-000000000516'
    )
  $$,
  'the owner can create another pending invitation'
);
select lives_ok(
  $$
    select public.cancel_event_team_invite_command(
      '01992026-0908-7000-8000-000000000031',
      (select id from public.events where title = 'Team Controls Event'),
      (select id from public.event_invites where invited_email = 'team-wrong@example.invalid'),
      8,
      now(),
      '01992026-0908-7000-8000-000000000517'
    )
  $$,
  'the owner can cancel a pending invitation'
);
select is(
  (select count(*) from public.event_invites),
  0::bigint,
  'cancelling deletes the invitation email record immediately'
);

insert into public.event_invites (
  event_id, invited_email, role, created_by_account_id, created_at, expires_at
)
select
  id,
  'expired@example.invalid',
  'moderator',
  '01992026-0908-7000-8000-000000000031',
  clock_timestamp() - interval '7 days',
  clock_timestamp() - interval '1 second'
from public.events
where title = 'Team Controls Event';

select is(
  public.purge_expired_event_invites_command(),
  1::bigint,
  'the expiry command deletes expired invitation email records'
);
select is(
  (
    select schedule
    from cron.job
    where jobname = 'promenadis-purge-expired-event-invites'
  ),
  '17 * * * *',
  'an hourly database job purges expired invitation emails'
);

select * from finish();
rollback;
