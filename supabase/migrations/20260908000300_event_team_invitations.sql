alter table public.events
add column team_version integer not null default 1 check (team_version > 0);

alter table public.event_memberships
add column id uuid not null default extensions.gen_random_uuid(),
add column display_name text;

update public.event_memberships as membership
set display_name = coalesce(
  (select profile.display_name from public.profiles as profile
   where profile.account_id = membership.account_id),
  left(organizer.display_name, 80)
)
from public.events as event
join public.organizer_profiles as organizer on organizer.id = event.organizer_profile_id
where event.id = membership.event_id;

alter table public.event_memberships
alter column display_name set not null,
add constraint event_memberships_display_name check (
  display_name = btrim(display_name) and char_length(display_name) between 1 and 80
);

create unique index event_memberships_id_key on public.event_memberships (id);

create or replace function app_private.set_event_membership_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.display_name is null then
    select coalesce(profile.display_name, left(organizer.display_name, 80))
    into new.display_name
    from public.events as event
    join public.organizer_profiles as organizer on organizer.id = event.organizer_profile_id
    left join public.profiles as profile on profile.account_id = new.account_id
    where event.id = new.event_id;
  end if;
  return new;
end;
$$;

create trigger event_memberships_set_display_name
before insert on public.event_memberships
for each row execute function app_private.set_event_membership_display_name();

create or replace function app_private.require_recent_authentication(p_authenticated_at timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_authenticated_at is null
    or p_authenticated_at < clock_timestamp() - interval '15 minutes'
    or p_authenticated_at > clock_timestamp() + interval '1 minute'
  then
    raise exception 'Recent authentication required';
  end if;
end;
$$;

create table public.event_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  invited_email text not null,
  role text not null check (role in ('co_host', 'moderator')),
  created_by_account_id uuid not null references public.profiles (account_id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  constraint event_invites_email check (
    invited_email = lower(btrim(invited_email))
    and char_length(invited_email) between 3 and 320
    and invited_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint event_invites_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '7 days 1 minute'
  ),
  unique (event_id, invited_email)
);

create index event_invites_expiry on public.event_invites (expires_at);
create index event_invites_email_expiry on public.event_invites (invited_email, expires_at);

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
          'displayName', membership.display_name,
          'id', membership.id,
          'role', membership.role
        ) order by
          case membership.role when 'owner' then 0 when 'co_host' then 1 else 2 end,
          membership.created_at
      )
      from public.event_memberships as membership
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
    ), '[]'::jsonb) else '[]'::jsonb end
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
  actor_role text;
begin
  select role
  into actor_role
  from public.event_memberships
  where event_id = p_event_id and account_id = p_actor_id;

  if actor_role is null then
    raise exception 'Actor is not an event team member';
  end if;

  return app_private.event_team_summary(p_event_id, actor_role = 'owner');
end;
$$;

create or replace function public.invite_event_team_member_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_expected_team_version integer,
  p_email text,
  p_role text,
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
  invite_email text := lower(btrim(coalesce(p_email, '')));
  invite_id uuid;
begin
  if not exists (
    select 1
    from public.event_memberships
    where event_id = p_event_id
      and account_id = p_actor_id
      and role = 'owner'
  ) then
    raise exception 'Only the event owner can manage the team';
  end if;
  perform app_private.require_recent_authentication(p_authenticated_at);

  select * into event_row from public.events where id = p_event_id for update;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;
  if p_role not in ('co_host', 'moderator') then
    raise exception 'Unsupported invited event role';
  end if;
  if invite_email = '' or char_length(invite_email) > 320
    or invite_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  then
    raise exception 'Invalid invitation email';
  end if;
  if exists (
    select 1
    from public.event_memberships as membership
    join auth.users as account on account.id = membership.account_id
    where membership.event_id = p_event_id
      and lower(account.email) = invite_email
  ) then
    raise exception 'Account is already an event team member';
  end if;

  insert into public.event_invites (
    event_id,
    invited_email,
    role,
    created_by_account_id,
    created_at,
    expires_at
  ) values (
    p_event_id,
    invite_email,
    p_role,
    p_actor_id,
    clock_timestamp(),
    clock_timestamp() + interval '7 days'
  )
  on conflict (event_id, invited_email) do update
  set role = excluded.role,
      created_by_account_id = excluded.created_by_account_id,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  returning id into invite_id;

  update public.events
  set team_version = team_version + 1
  where id = p_event_id;

  insert into app_private.audit_events (
    correlation_id,
    actor_account_id,
    action,
    target_type,
    target_id,
    event_id,
    safe_summary
  ) values (
    p_correlation_id,
    p_actor_id,
    'event.team_invited',
    'event_invite',
    invite_id,
    p_event_id,
    jsonb_build_object('role', p_role)
  );

  return app_private.event_team_summary(p_event_id, true);
end;
$$;

create or replace function public.cancel_event_team_invite_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_invite_id uuid,
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
  invited_role text;
begin
  if not exists (
    select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role = 'owner'
  ) then
    raise exception 'Only the event owner can manage the team';
  end if;
  perform app_private.require_recent_authentication(p_authenticated_at);

  select * into event_row from public.events where id = p_event_id for update;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;

  delete from public.event_invites
  where id = p_invite_id and event_id = p_event_id
  returning role into invited_role;
  if invited_role is null then
    raise exception 'Event invitation not found';
  end if;

  update public.events set team_version = team_version + 1 where id = p_event_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.team_invite_cancelled', 'event_invite',
    p_invite_id, p_event_id, jsonb_build_object('role', invited_role)
  );

  return app_private.event_team_summary(p_event_id, true);
end;
$$;

create or replace function public.accept_event_team_invite_command(
  p_actor_id uuid,
  p_invite_id uuid,
  p_display_name text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email text;
  actor_email_confirmed_at timestamptz;
  invite_row public.event_invites;
  member_id uuid;
begin
  if p_display_name is null
    or p_display_name is distinct from btrim(p_display_name)
    or char_length(p_display_name) not between 1 and 80
  then
    raise exception 'Invalid event team display name';
  end if;

  select lower(email), email_confirmed_at
  into actor_email, actor_email_confirmed_at
  from auth.users
  where id = p_actor_id;
  if actor_email is null or actor_email_confirmed_at is null then
    raise exception 'Verified invited email required';
  end if;

  select * into invite_row
  from public.event_invites
  where id = p_invite_id
    and invited_email = actor_email
    and expires_at > clock_timestamp()
  for update;
  if invite_row.id is null then
    raise exception 'Event invitation unavailable';
  end if;

  perform 1 from public.events where id = invite_row.event_id for update;
  if exists (
    select 1 from public.event_memberships
    where event_id = invite_row.event_id and account_id = p_actor_id
  ) then
    raise exception 'Account is already an event team member';
  end if;

  insert into public.event_memberships (event_id, account_id, role, display_name)
  values (invite_row.event_id, p_actor_id, invite_row.role, p_display_name)
  returning id into member_id;

  delete from public.event_invites where id = invite_row.id;
  update public.events
  set team_version = team_version + 1
  where id = invite_row.event_id;

  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.team_invite_accepted', 'event_membership',
    member_id, invite_row.event_id, jsonb_build_object('role', invite_row.role)
  );

  return app_private.event_team_summary(invite_row.event_id, false);
end;
$$;

create or replace function public.update_event_team_member_role_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_membership_id uuid,
  p_expected_team_version integer,
  p_role text,
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
  member_row public.event_memberships;
begin
  if not exists (
    select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role = 'owner'
  ) then
    raise exception 'Only the event owner can manage the team';
  end if;
  perform app_private.require_recent_authentication(p_authenticated_at);

  select * into event_row from public.events where id = p_event_id for update;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;
  if p_role not in ('co_host', 'moderator') then
    raise exception 'Unsupported event team role';
  end if;

  select * into member_row from public.event_memberships
  where id = p_membership_id and event_id = p_event_id for update;
  if member_row.id is null then
    raise exception 'Event team member not found';
  end if;
  if member_row.role = 'owner' then
    raise exception 'The event owner role requires ownership transfer';
  end if;
  if member_row.role = p_role then
    return app_private.event_team_summary(p_event_id, true);
  end if;

  update public.event_memberships set role = p_role where id = p_membership_id;
  update public.events set team_version = team_version + 1 where id = p_event_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.team_role_changed', 'event_membership',
    p_membership_id, p_event_id,
    jsonb_build_object('after', p_role, 'before', member_row.role)
  );

  return app_private.event_team_summary(p_event_id, true);
end;
$$;

create or replace function public.remove_event_team_member_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_membership_id uuid,
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
  member_row public.event_memberships;
begin
  if not exists (
    select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role = 'owner'
  ) then
    raise exception 'Only the event owner can manage the team';
  end if;
  perform app_private.require_recent_authentication(p_authenticated_at);

  select * into event_row from public.events where id = p_event_id for update;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;

  select * into member_row from public.event_memberships
  where id = p_membership_id and event_id = p_event_id for update;
  if member_row.id is null then
    raise exception 'Event team member not found';
  end if;
  if member_row.role = 'owner' then
    raise exception 'The event owner cannot be removed';
  end if;

  delete from public.event_memberships where id = p_membership_id;
  update public.events set team_version = team_version + 1 where id = p_event_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.team_member_removed', 'event_membership',
    p_membership_id, p_event_id, jsonb_build_object('role', member_row.role)
  );

  return app_private.event_team_summary(p_event_id, true);
end;
$$;

create or replace function public.get_incoming_event_invites_command(p_actor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'eventId', event.id,
      'eventTitle', event.title,
      'expiresAt', invite.expires_at,
      'id', invite.id,
      'organizerDisplayName', organizer.display_name,
      'role', invite.role
    ) order by invite.created_at
 
  ), '[]'::jsonb)
  from auth.users as account
  join public.event_invites as invite
    on invite.invited_email = lower(account.email)
    and invite.expires_at > clock_timestamp()
  join public.events as event on event.id = invite.event_id
  join public.organizer_profiles as organizer on organizer.id = event.organizer_profile_id
  where account.id = p_actor_id
    and account.email_confirmed_at is not null;
$$;

create or replace function public.purge_expired_event_invites_command()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  delete from public.event_invites where expires_at <= clock_timestamp();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'promenadis-purge-expired-event-invites',
  '17 * * * *',
  'select public.purge_expired_event_invites_command()'
);

alter table public.event_invites enable row level security;
alter table public.event_invites force row level security;

revoke all on table public.event_invites from public, anon, authenticated;
grant select, insert, update, delete on table public.event_invites to service_role;

revoke all on function app_private.event_team_summary(uuid, boolean)
from public, anon, authenticated;
grant execute on function app_private.event_team_summary(uuid, boolean) to service_role;

revoke all on function app_private.require_recent_authentication(timestamptz)
from public, anon, authenticated;
grant execute on function app_private.require_recent_authentication(timestamptz) to service_role;

revoke all on function public.get_event_team_command(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.get_event_team_command(uuid, uuid) to service_role;

revoke all on function public.invite_event_team_member_command(uuid, uuid, integer, text, text, timestamptz, uuid)
from public, anon, authenticated;
grant execute on function public.invite_event_team_member_command(uuid, uuid, integer, text, text, timestamptz, uuid)
to service_role;

revoke all on function public.cancel_event_team_invite_command(uuid, uuid, uuid, integer, timestamptz, uuid)
from public, anon, authenticated;
grant execute on function public.cancel_event_team_invite_command(uuid, uuid, uuid, integer, timestamptz, uuid)
to service_role;

revoke all on function public.accept_event_team_invite_command(uuid, uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.accept_event_team_invite_command(uuid, uuid, text, uuid)
to service_role;

revoke all on function public.update_event_team_member_role_command(uuid, uuid, uuid, integer, text, timestamptz, uuid)
from public, anon, authenticated;
grant execute on function public.update_event_team_member_role_command(uuid, uuid, uuid, integer, text, timestamptz, uuid)
to service_role;

revoke all on function public.remove_event_team_member_command(uuid, uuid, uuid, integer, timestamptz, uuid)
from public, anon, authenticated;
grant execute on function public.remove_event_team_member_command(uuid, uuid, uuid, integer, timestamptz, uuid)
to service_role;

revoke all on function public.get_incoming_event_invites_command(uuid)
from public, anon, authenticated;
grant execute on function public.get_incoming_event_invites_command(uuid) to service_role;

revoke all on function public.purge_expired_event_invites_command()
from public, anon, authenticated;
grant execute on function public.purge_expired_event_invites_command() to service_role;

comment on table public.event_invites is
  'Private verified-email event-team invitations that expire after at most seven days.';
