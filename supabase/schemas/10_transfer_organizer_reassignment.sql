alter table public.event_ownership_transfers
add column target_organizer_profile_id uuid references public.organizer_profiles (id) on delete restrict;

create or replace function app_private.event_team_summary(
  p_event_id uuid,
  p_include_invite_emails boolean
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'eventId', event.id,
    'teamVersion', event.team_version,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'canReceiveOwnership', p_include_invite_emails
          and membership.role = 'co_host'
          and account.email_confirmed_at is not null
          and exists (
            select 1 from public.organizer_profile_memberships as organizer_membership
            where organizer_membership.account_id = membership.account_id
          ),
        'displayName', membership.display_name,
        'id', membership.id,
        'role', membership.role
      ) order by
        case membership.role when 'owner' then 0 when 'co_host' then 1 else 2 end,
        membership.created_at)
      from public.event_memberships as membership
      join auth.users as account on account.id = membership.account_id
      where membership.event_id = event.id
    ), '[]'::jsonb),
    'ownershipTransferOptions', case when p_include_invite_emails then coalesce((
      select jsonb_agg(jsonb_build_object(
        'organizerDisplayName', target_organizer.display_name,
        'organizerProfileId', target_organizer.id,
        'organizerWillChange', target_organizer.id <> event.organizer_profile_id,
        'recipientDisplayName', recipient.display_name,
        'toMembershipId', recipient.id
      ) order by recipient.created_at, target_organizer.created_at)
      from public.event_memberships as recipient
      join auth.users as account on account.id = recipient.account_id
      join public.organizer_profile_memberships as organizer_membership
        on organizer_membership.account_id = recipient.account_id
      join public.organizer_profiles as target_organizer
        on target_organizer.id = organizer_membership.organizer_profile_id
      where recipient.event_id = event.id
        and recipient.role = 'co_host'
        and account.email_confirmed_at is not null
    ), '[]'::jsonb) else '[]'::jsonb end,
    'pendingInvites', case when p_include_invite_emails then coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', invite.invited_email,
        'expiresAt', invite.expires_at,
        'id', invite.id,
        'role', invite.role
      ) order by invite.created_at)
      from public.event_invites as invite
      where invite.event_id = event.id and invite.expires_at > clock_timestamp()
    ), '[]'::jsonb) else '[]'::jsonb end,
    'pendingTransfer', (
      select jsonb_build_object(
        'expiresAt', transfer.expires_at,
        'id', transfer.id,
        'organizerWillChange', coalesce(transfer.target_organizer_profile_id, event.organizer_profile_id) <> event.organizer_profile_id,
        'targetOrganizerDisplayName', target_organizer.display_name,
        'toDisplayName', recipient.display_name,
        'toMembershipId', transfer.to_membership_id
      )
      from public.event_ownership_transfers as transfer
      join public.event_memberships as recipient on recipient.id = transfer.to_membership_id
      join public.organizer_profiles as target_organizer
        on target_organizer.id = coalesce(transfer.target_organizer_profile_id, event.organizer_profile_id)
      where transfer.event_id = event.id and transfer.expires_at > clock_timestamp()
    )
  )
  from public.events as event
  where event.id = p_event_id;
$$;

create or replace function public.initiate_event_ownership_transfer_v2_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_to_membership_id uuid,
  p_target_organizer_profile_id uuid,
  p_expected_team_version integer,
  p_authenticated_at timestamptz,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events;
  owner_membership public.event_memberships;
  recipient_membership public.event_memberships;
  transfer_id uuid;
begin
  select * into owner_membership from public.event_memberships
  where event_id = p_event_id and account_id = p_actor_id and role = 'owner';
  if owner_membership.id is null then
    raise exception 'Only the event owner can transfer ownership';
  end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.id is null then raise exception 'Event not found'; end if;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;
  delete from public.event_ownership_transfers
  where event_id = p_event_id and expires_at <= clock_timestamp();
  if exists (select 1 from public.event_ownership_transfers where event_id = p_event_id) then
    raise exception 'An ownership transfer is already pending';
  end if;
  select * into recipient_membership from public.event_memberships
  where id = p_to_membership_id and event_id = p_event_id for update;
  if recipient_membership.id is null then raise exception 'Event team member not found'; end if;
  if recipient_membership.role <> 'co_host' then
    raise exception 'Ownership can only be transferred to a co-host';
  end if;
  if not exists (
    select 1 from auth.users
    where id = recipient_membership.account_id and email_confirmed_at is not null
  ) then raise exception 'A verified co-host is required'; end if;
  if not exists (
    select 1 from public.organizer_profile_memberships
    where organizer_profile_id = p_target_organizer_profile_id
      and account_id = recipient_membership.account_id
      and role in ('owner', 'manager')
  ) then raise exception 'The co-host must manage the selected organizer'; end if;

  insert into public.event_ownership_transfers (
    event_id, from_membership_id, to_membership_id, target_organizer_profile_id,
    created_at, expires_at
  ) values (
    p_event_id, owner_membership.id, recipient_membership.id,
    p_target_organizer_profile_id, clock_timestamp(), clock_timestamp() + interval '7 days'
  ) returning id into transfer_id;
  update public.events set team_version = team_version + 1 where id = p_event_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.ownership_transfer_initiated',
    'event_ownership_transfer', transfer_id, p_event_id,
    jsonb_build_object(
      'organizerWillChange', p_target_organizer_profile_id <> event_row.organizer_profile_id,
      'recipientRole', recipient_membership.role
    )
  );
  return app_private.event_team_summary(p_event_id, true)
    || jsonb_build_object('currentMembershipId', owner_membership.id);
end;
$$;

create or replace function public.accept_event_ownership_transfer_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_transfer_id uuid,
  p_expected_team_version integer,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events;
  transfer_row public.event_ownership_transfers;
  previous_owner public.event_memberships;
  recipient_membership public.event_memberships;
  target_organizer_id uuid;
  organizer_will_change boolean;
begin
  select transfer.* into transfer_row
  from public.event_ownership_transfers as transfer
  join public.event_memberships as recipient on recipient.id = transfer.to_membership_id
  where transfer.id = p_transfer_id and transfer.event_id = p_event_id
    and transfer.expires_at > clock_timestamp() and recipient.account_id = p_actor_id
  for update of transfer;
  if transfer_row.id is null then raise exception 'Ownership transfer unavailable'; end if;
  select * into event_row from public.events where id = p_event_id for update;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;
  select * into previous_owner from public.event_memberships
  where id = transfer_row.from_membership_id and event_id = p_event_id for update;
  select * into recipient_membership from public.event_memberships
  where id = transfer_row.to_membership_id and event_id = p_event_id for update;
  if previous_owner.id is null or previous_owner.role <> 'owner'
    or recipient_membership.id is null or recipient_membership.role <> 'co_host'
  then raise exception 'Ownership transfer unavailable'; end if;
  if not exists (
    select 1 from auth.users where id = p_actor_id and email_confirmed_at is not null
  ) then raise exception 'A verified co-host is required'; end if;
  target_organizer_id := coalesce(
    transfer_row.target_organizer_profile_id,
    event_row.organizer_profile_id
  );
  if not exists (
    select 1 from public.organizer_profile_memberships
    where organizer_profile_id = target_organizer_id and account_id = p_actor_id
      and role in ('owner', 'manager')
  ) then raise exception 'The co-host must manage the selected organizer'; end if;
  organizer_will_change := target_organizer_id <> event_row.organizer_profile_id;

  delete from public.event_ownership_transfers where id = p_transfer_id;
  update public.event_memberships set role = 'co_host' where id = previous_owner.id;
  update public.event_memberships set role = 'owner' where id = recipient_membership.id;
  update public.events
  set organizer_profile_id = target_organizer_id,
      team_version = team_version + 1,
      version = version + case when organizer_will_change then 1 else 0 end
  where id = p_event_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.ownership_transfer_accepted',
    'event_ownership_transfer', p_transfer_id, p_event_id,
    jsonb_build_object(
      'newOwnerRole', 'owner',
      'organizerChanged', organizer_will_change,
      'previousOwnerRole', 'co_host'
    )
  );
  return app_private.event_team_summary(p_event_id, true)
    || jsonb_build_object('currentMembershipId', recipient_membership.id);
end;
$$;

revoke all on function public.initiate_event_ownership_transfer_v2_command(uuid,uuid,uuid,uuid,integer,timestamptz,uuid)
from public, anon, authenticated;
grant execute on function public.initiate_event_ownership_transfer_v2_command(uuid,uuid,uuid,uuid,integer,timestamptz,uuid)
to service_role;

comment on column public.event_ownership_transfers.target_organizer_profile_id is
  'Organizer identity approved by the current owner for use when the recipient accepts.';
