create table public.event_ownership_transfers (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  from_membership_id uuid not null references public.event_memberships (id) on delete cascade,
  to_membership_id uuid not null references public.event_memberships (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  constraint event_ownership_transfers_different_members check (
    from_membership_id <> to_membership_id
  ),
  constraint event_ownership_transfers_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '7 days 1 minute'
  ),
  unique (event_id)
);

create index event_ownership_transfers_expiry
on public.event_ownership_transfers (expires_at);

create or replace function app_private.validate_event_ownership_transfer_memberships()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.event_memberships as previous_owner
    join public.event_memberships as recipient on recipient.id = new.to_membership_id
    where previous_owner.id = new.from_membership_id
      and previous_owner.event_id = new.event_id
      and previous_owner.role = 'owner'
      and recipient.event_id = new.event_id
      and recipient.role = 'co_host'
  ) then
    raise exception 'Ownership transfer memberships are invalid';
  end if;
  return new;
end;
$$;

create trigger event_ownership_transfers_validate_memberships
before insert or update on public.event_ownership_transfers
for each row execute function app_private.validate_event_ownership_transfer_memberships();

create or replace function app_private.enforce_exactly_one_event_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected_event_id uuid := coalesce(new.event_id, old.event_id);
begin
  if exists (select 1 from public.events where id = affected_event_id)
    and (
      select count(*)
      from public.event_memberships
      where event_id = affected_event_id and role = 'owner'
    ) <> 1
  then
    raise exception 'Every event must have exactly one owner';
  end if;
  return null;
end;
$$;

create constraint trigger event_memberships_exactly_one_owner
after insert or update or delete on public.event_memberships
deferrable initially deferred
for each row execute function app_private.enforce_exactly_one_event_owner();

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
      select jsonb_agg(
        jsonb_build_object(
          'canReceiveOwnership', p_include_invite_emails
            and membership.role = 'co_host'
            and account.email_confirmed_at is not null
            and exists (
              select 1
              from public.organizer_profile_memberships as organizer_membership
              where organizer_membership.organizer_profile_id = event.organizer_profile_id
                and organizer_membership.account_id = membership.account_id
                and organizer_membership.role in ('owner', 'manager')
            ),
          'displayName', membership.display_name,
          'id', membership.id,
          'role', membership.role
        ) order by
          case membership.role when 'owner' then 0 when 'co_host' then 1 else 2 end,
          membership.created_at
      )
      from public.event_memberships as membership
      join auth.users as account on account.id = membership.account_id
      where membership.event_id = event.id
    ), '[]'::jsonb),
    'pendingInvites', case when p_include_invite_emails then coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'email', invite.invited_email,
          'expiresAt', invite.expires_at,
          'id', invite.id,
          'role', invite.role
        ) order by invite.created_at
      )
      from public.event_invites as invite
      where invite.event_id = event.id
        and invite.expires_at > clock_timestamp()
    ), '[]'::jsonb) else '[]'::jsonb end,
    'pendingTransfer', (
      select jsonb_build_object(
        'expiresAt', transfer.expires_at,
        'id', transfer.id,
        'toDisplayName', recipient.display_name,
        'toMembershipId', transfer.to_membership_id
      )
      from public.event_ownership_transfers as transfer
      join public.event_memberships as recipient on recipient.id = transfer.to_membership_id
      where transfer.event_id = event.id
        and transfer.expires_at > clock_timestamp()
    )
  )
  from public.events as event
  where event.id = p_event_id;
$$;

create or replace function public.get_event_team_command(
  p_actor_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_membership public.event_memberships;
begin
  select *
  into actor_membership
  from public.event_memberships
  where event_id = p_event_id and account_id = p_actor_id;

  if actor_membership.id is null then
    raise exception 'Actor is not an event team member';
  end if;

  return app_private.event_team_summary(p_event_id, actor_membership.role = 'owner')
    || jsonb_build_object('currentMembershipId', actor_membership.id);
end;
$$;

create or replace function public.initiate_event_ownership_transfer_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_to_membership_id uuid,
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
  select *
  into owner_membership
  from public.event_memberships
  where event_id = p_event_id and account_id = p_actor_id and role = 'owner';
  if owner_membership.id is null then
    raise exception 'Only the event owner can transfer ownership';
  end if;
  perform app_private.require_recent_authentication(p_authenticated_at);

  select * into event_row from public.events where id = p_event_id for update;
  if event_row.id is null then
    raise exception 'Event not found';
  end if;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;

  delete from public.event_ownership_transfers
  where event_id = p_event_id and expires_at <= clock_timestamp();
  if exists (
    select 1 from public.event_ownership_transfers where event_id = p_event_id
  ) then
    raise exception 'An ownership transfer is already pending';
  end if;

  select *
  into recipient_membership
  from public.event_memberships
  where id = p_to_membership_id and event_id = p_event_id
  for update;
  if recipient_membership.id is null then
    raise exception 'Event team member not found';
  end if;
  if recipient_membership.role <> 'co_host' then
    raise exception 'Ownership can only be transferred to a co-host';
  end if;
  if not exists (
    select 1 from auth.users
    where id = recipient_membership.account_id and email_confirmed_at is not null
  ) then
    raise exception 'A verified co-host is required';
  end if;
  if not exists (
    select 1
    from public.organizer_profile_memberships
    where organizer_profile_id = event_row.organizer_profile_id
      and account_id = recipient_membership.account_id
      and role in ('owner', 'manager')
  ) then
    raise exception 'The co-host must manage the selected organizer';
  end if;

  insert into public.event_ownership_transfers (
    event_id,
    from_membership_id,
    to_membership_id,
    created_at,
    expires_at
  ) values (
    p_event_id,
    owner_membership.id,
    recipient_membership.id,
    clock_timestamp(),
    clock_timestamp() + interval '7 days'
  ) returning id into transfer_id;

  update public.events set team_version = team_version + 1 where id = p_event_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.ownership_transfer_initiated',
    'event_ownership_transfer', transfer_id, p_event_id,
    jsonb_build_object('recipientRole', recipient_membership.role)
  );

  return app_private.event_team_summary(p_event_id, true)
    || jsonb_build_object('currentMembershipId', owner_membership.id);
end;
$$;

create or replace function public.cancel_event_ownership_transfer_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_transfer_id uuid,
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
  deleted_transfer_id uuid;
begin
  select *
  into owner_membership
  from public.event_memberships
  where event_id = p_event_id and account_id = p_actor_id and role = 'owner';
  if owner_membership.id is null then
    raise exception 'Only the event owner can transfer ownership';
  end if;
  perform app_private.require_recent_authentication(p_authenticated_at);

  select * into event_row from public.events where id = p_event_id for update;
  if event_row.id is null then
    raise exception 'Event not found';
  end if;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;

  delete from public.event_ownership_transfers
  where id = p_transfer_id and event_id = p_event_id
  returning id into deleted_transfer_id;
  if deleted_transfer_id is null then
    raise exception 'Ownership transfer unavailable';
  end if;

  update public.events set team_version = team_version + 1 where id = p_event_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.ownership_transfer_cancelled',
    'event_ownership_transfer', p_transfer_id, p_event_id, '{}'::jsonb
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
begin
  select transfer.*
  into transfer_row
  from public.event_ownership_transfers as transfer
  join public.event_memberships as recipient on recipient.id = transfer.to_membership_id
  where transfer.id = p_transfer_id
    and transfer.event_id = p_event_id
    and transfer.expires_at > clock_timestamp()
    and recipient.account_id = p_actor_id
  for update of transfer;
  if transfer_row.id is null then
    raise exception 'Ownership transfer unavailable';
  end if;

  select * into event_row from public.events where id = p_event_id for update;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;

  select * into previous_owner
  from public.event_memberships
  where id = transfer_row.from_membership_id and event_id = p_event_id
  for update;
  select * into recipient_membership
  from public.event_memberships
  where id = transfer_row.to_membership_id and event_id = p_event_id
  for update;
  if previous_owner.id is null or previous_owner.role <> 'owner'
    or recipient_membership.id is null or recipient_membership.role <> 'co_host'
  then
    raise exception 'Ownership transfer unavailable';
  end if;
  if not exists (
    select 1 from auth.users where id = p_actor_id and email_confirmed_at is not null
  ) then
    raise exception 'A verified co-host is required';
  end if;
  if not exists (
    select 1
    from public.organizer_profile_memberships
    where organizer_profile_id = event_row.organizer_profile_id
      and account_id = p_actor_id
      and role in ('owner', 'manager')
  ) then
    raise exception 'The co-host must manage the selected organizer';
  end if;

  delete from public.event_ownership_transfers where id = p_transfer_id;
  update public.event_memberships set role = 'co_host' where id = previous_owner.id;
  update public.event_memberships set role = 'owner' where id = recipient_membership.id;
  update public.events set team_version = team_version + 1 where id = p_event_id;

  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.ownership_transfer_accepted',
    'event_ownership_transfer', p_transfer_id, p_event_id,
    jsonb_build_object('newOwnerRole', 'owner', 'previousOwnerRole', 'co_host')
  );

  return app_private.event_team_summary(p_event_id, true)
    || jsonb_build_object('currentMembershipId', recipient_membership.id);
end;
$$;

create or replace function public.purge_expired_event_ownership_transfers_command()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  delete from public.event_ownership_transfers where expires_at <= clock_timestamp();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

select cron.schedule(
  'promenadis-purge-expired-event-ownership-transfers',
  '29 * * * *',
  'select public.purge_expired_event_ownership_transfers_command()'
);

alter table public.event_ownership_transfers enable row level security;
alter table public.event_ownership_transfers force row level security;

revoke all on table public.event_ownership_transfers from public, anon, authenticated;
grant select, insert, update, delete on table public.event_ownership_transfers to service_role;

revoke all on function app_private.enforce_exactly_one_event_owner()
from public, anon, authenticated;
grant execute on function app_private.enforce_exactly_one_event_owner() to service_role;

revoke all on function app_private.validate_event_ownership_transfer_memberships()
from public, anon, authenticated;
grant execute on function app_private.validate_event_ownership_transfer_memberships() to service_role;

revoke all on function public.initiate_event_ownership_transfer_command(uuid,uuid,uuid,integer,timestamptz,uuid)
from public, anon, authenticated;
grant execute on function public.initiate_event_ownership_transfer_command(uuid,uuid,uuid,integer,timestamptz,uuid)
to service_role;

revoke all on function public.cancel_event_ownership_transfer_command(uuid,uuid,uuid,integer,timestamptz,uuid)
from public, anon, authenticated;
grant execute on function public.cancel_event_ownership_transfer_command(uuid,uuid,uuid,integer,timestamptz,uuid)
to service_role;

revoke all on function public.accept_event_ownership_transfer_command(uuid,uuid,uuid,integer,uuid)
from public, anon, authenticated;
grant execute on function public.accept_event_ownership_transfer_command(uuid,uuid,uuid,integer,uuid)
to service_role;

revoke all on function public.purge_expired_event_ownership_transfers_command()
from public, anon, authenticated;
grant execute on function public.purge_expired_event_ownership_transfers_command() to service_role;

comment on table public.event_ownership_transfers is
  'Short-lived planned event-ownership transfers between compatible event memberships.';
