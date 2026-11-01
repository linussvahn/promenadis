alter table public.organizer_profiles
add column team_version integer not null default 1 check (team_version > 0);

alter table public.organizer_profile_memberships
add column id uuid not null default extensions.gen_random_uuid(),
add column display_name text;

update public.organizer_profile_memberships as membership
set display_name = coalesce(
  (select profile.display_name from public.profiles as profile
   where profile.account_id = membership.account_id),
  left(organizer.display_name, 80)
)
from public.organizer_profiles as organizer
where organizer.id = membership.organizer_profile_id;

alter table public.organizer_profile_memberships
alter column display_name set not null,
add constraint organizer_profile_memberships_display_name check (
  display_name = btrim(display_name) and char_length(display_name) between 1 and 80
);

create unique index organizer_profile_memberships_id_key
on public.organizer_profile_memberships (id);

create or replace function app_private.set_organizer_membership_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.display_name is null then
    select coalesce(profile.display_name, left(organizer.display_name, 80))
    into new.display_name
    from public.organizer_profiles as organizer
    left join public.profiles as profile on profile.account_id = new.account_id
    where organizer.id = new.organizer_profile_id;
  end if;
  return new;
end;
$$;

create trigger organizer_memberships_set_display_name
before insert on public.organizer_profile_memberships
for each row execute function app_private.set_organizer_membership_display_name();

create table public.organizer_profile_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  organizer_profile_id uuid not null references public.organizer_profiles (id) on delete cascade,
  invited_email text not null,
  created_by_account_id uuid not null references public.profiles (account_id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  constraint organizer_profile_invites_email check (
    invited_email = lower(btrim(invited_email))
    and char_length(invited_email) between 3 and 320
    and invited_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint organizer_profile_invites_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '7 days 1 minute'
  ),
  unique (organizer_profile_id, invited_email)
);

create index organizer_profile_invites_expiry on public.organizer_profile_invites (expires_at);
create index organizer_profile_invites_email_expiry
on public.organizer_profile_invites (invited_email, expires_at);

create or replace function app_private.organizer_team_summary(
  p_organizer_profile_id uuid,
  p_include_invite_emails boolean
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'organizerProfileId', organizer.id,
    'teamVersion', organizer.team_version,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'displayName', membership.display_name,
        'id', membership.id,
        'role', membership.role
      ) order by case membership.role when 'owner' then 0 else 1 end, membership.created_at)
      from public.organizer_profile_memberships as membership
      where membership.organizer_profile_id = organizer.id
    ), '[]'::jsonb),
    'pendingInvites', case when p_include_invite_emails then coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', invite.invited_email,
        'expiresAt', invite.expires_at,
        'id', invite.id
      ) order by invite.created_at)
      from public.organizer_profile_invites as invite
      where invite.organizer_profile_id = organizer.id
        and invite.expires_at > clock_timestamp()
    ), '[]'::jsonb) else '[]'::jsonb end
  )
  from public.organizer_profiles as organizer
  where organizer.id = p_organizer_profile_id;
$$;

create or replace function public.get_organizer_team_command(
  p_actor_id uuid,
  p_organizer_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_membership public.organizer_profile_memberships;
begin
  select * into actor_membership
  from public.organizer_profile_memberships
  where organizer_profile_id = p_organizer_profile_id and account_id = p_actor_id;
  if actor_membership.id is null then
    raise exception 'Actor is not an organizer manager';
  end if;
  return app_private.organizer_team_summary(
    p_organizer_profile_id,
    actor_membership.role = 'owner'
  ) || jsonb_build_object('currentMembershipId', actor_membership.id);
end;
$$;

create or replace function public.invite_organizer_manager_command(
  p_actor_id uuid,
  p_organizer_profile_id uuid,
  p_expected_team_version integer,
  p_email text,
  p_authenticated_at timestamptz,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_row public.organizer_profiles;
  invite_email text := lower(btrim(coalesce(p_email, '')));
  invite_id uuid;
  actor_membership_id uuid;
begin
  select id into actor_membership_id
  from public.organizer_profile_memberships
  where organizer_profile_id = p_organizer_profile_id
    and account_id = p_actor_id and role = 'owner';
  if actor_membership_id is null then
    raise exception 'Only the organizer owner can manage managers';
  end if;
  perform app_private.require_recent_authentication(p_authenticated_at);

  select * into organizer_row
  from public.organizer_profiles where id = p_organizer_profile_id for update;
  if organizer_row.id is null then raise exception 'Organizer not found'; end if;
  if organizer_row.organizer_type = 'individual' then
    raise exception 'Individual organizer identities cannot have managers';
  end if;
  if p_expected_team_version is distinct from organizer_row.team_version then
    raise exception 'Organizer team version conflict';
  end if;
  if invite_email = '' or char_length(invite_email) > 320
    or invite_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  then
    raise exception 'Invalid invitation email';
  end if;
  if exists (
    select 1
    from public.organizer_profile_memberships as membership
    join auth.users as account on account.id = membership.account_id
    where membership.organizer_profile_id = p_organizer_profile_id
      and lower(account.email) = invite_email
  ) then
    raise exception 'Account is already an organizer manager';
  end if;

  insert into public.organizer_profile_invites (
    organizer_profile_id, invited_email, created_by_account_id, created_at, expires_at
  ) values (
    p_organizer_profile_id, invite_email, p_actor_id,
    clock_timestamp(), clock_timestamp() + interval '7 days'
  )
  on conflict (organizer_profile_id, invited_email) do update
  set created_by_account_id = excluded.created_by_account_id,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  returning id into invite_id;

  update public.organizer_profiles
  set team_version = team_version + 1
  where id = p_organizer_profile_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'organizer.manager_invited',
    'organizer_profile_invite', invite_id, jsonb_build_object('role', 'manager')
  );
  return app_private.organizer_team_summary(p_organizer_profile_id, true)
    || jsonb_build_object('currentMembershipId', actor_membership_id);
end;
$$;

create or replace function public.cancel_organizer_manager_invite_command(
  p_actor_id uuid,
  p_organizer_profile_id uuid,
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
  organizer_row public.organizer_profiles;
  actor_membership_id uuid;
  deleted_id uuid;
begin
  select id into actor_membership_id
  from public.organizer_profile_memberships
  where organizer_profile_id = p_organizer_profile_id
    and account_id = p_actor_id and role = 'owner';
  if actor_membership_id is null then
    raise exception 'Only the organizer owner can manage managers';
  end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into organizer_row
  from public.organizer_profiles where id = p_organizer_profile_id for update;
  if p_expected_team_version is distinct from organizer_row.team_version then
    raise exception 'Organizer team version conflict';
  end if;
  delete from public.organizer_profile_invites
  where id = p_invite_id and organizer_profile_id = p_organizer_profile_id
  returning id into deleted_id;
  if deleted_id is null then raise exception 'Organizer invitation unavailable'; end if;
  update public.organizer_profiles set team_version = team_version + 1
  where id = p_organizer_profile_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'organizer.manager_invite_cancelled',
    'organizer_profile_invite', p_invite_id, jsonb_build_object('role', 'manager')
  );
  return app_private.organizer_team_summary(p_organizer_profile_id, true)
    || jsonb_build_object('currentMembershipId', actor_membership_id);
end;
$$;

create or replace function public.accept_organizer_manager_invite_command(
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
  actor_confirmed timestamptz;
  invite_row public.organizer_profile_invites;
  organizer_row public.organizer_profiles;
  membership_id uuid;
begin
  if p_display_name is null or p_display_name is distinct from btrim(p_display_name)
    or char_length(p_display_name) not between 1 and 80
  then raise exception 'Invalid organizer team display name'; end if;
  select lower(email), email_confirmed_at into actor_email, actor_confirmed
  from auth.users where id = p_actor_id;
  if actor_email is null or actor_confirmed is null then
    raise exception 'Verified invited email required';
  end if;
  select * into invite_row from public.organizer_profile_invites
  where id = p_invite_id and invited_email = actor_email
    and expires_at > clock_timestamp()
  for update;
  if invite_row.id is null then raise exception 'Organizer invitation unavailable'; end if;
  select * into organizer_row from public.organizer_profiles
  where id = invite_row.organizer_profile_id for update;
  if organizer_row.organizer_type = 'individual' then
    raise exception 'Individual organizer identities cannot have managers';
  end if;
  if exists (
    select 1 from public.organizer_profile_memberships
    where organizer_profile_id = invite_row.organizer_profile_id and account_id = p_actor_id
  ) then raise exception 'Account is already an organizer manager'; end if;
  insert into public.organizer_profile_memberships (
    organizer_profile_id, account_id, role, display_name
  ) values (invite_row.organizer_profile_id, p_actor_id, 'manager', p_display_name)
  returning id into membership_id;
  delete from public.organizer_profile_invites where id = invite_row.id;
  update public.organizer_profiles set team_version = team_version + 1
  where id = invite_row.organizer_profile_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'organizer.manager_invite_accepted',
    'organizer_profile_membership', membership_id, jsonb_build_object('role', 'manager')
  );
  return app_private.organizer_team_summary(invite_row.organizer_profile_id, false)
    || jsonb_build_object('currentMembershipId', membership_id);
end;
$$;

create or replace function public.remove_organizer_manager_command(
  p_actor_id uuid,
  p_organizer_profile_id uuid,
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
  organizer_row public.organizer_profiles;
  actor_membership_id uuid;
  member_role text;
begin
  select id into actor_membership_id from public.organizer_profile_memberships
  where organizer_profile_id = p_organizer_profile_id
    and account_id = p_actor_id and role = 'owner';
  if actor_membership_id is null then
    raise exception 'Only the organizer owner can manage managers';
  end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into organizer_row from public.organizer_profiles
  where id = p_organizer_profile_id for update;
  if p_expected_team_version is distinct from organizer_row.team_version then
    raise exception 'Organizer team version conflict';
  end if;
  delete from public.organizer_profile_memberships
  where id = p_membership_id and organizer_profile_id = p_organizer_profile_id
    and role = 'manager'
  returning role into member_role;
  if member_role is null then raise exception 'Organizer manager not found'; end if;
  update public.organizer_profiles set team_version = team_version + 1
  where id = p_organizer_profile_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'organizer.manager_removed',
    'organizer_profile_membership', p_membership_id, jsonb_build_object('role', 'manager')
  );
  return app_private.organizer_team_summary(p_organizer_profile_id, true)
    || jsonb_build_object('currentMembershipId', actor_membership_id);
end;
$$;

create or replace function public.get_incoming_organizer_invites_command(p_actor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'expiresAt', invite.expires_at,
    'id', invite.id,
    'organizerDisplayName', organizer.display_name,
    'organizerProfileId', organizer.id
  ) order by invite.created_at), '[]'::jsonb)
  from auth.users as account
  join public.organizer_profile_invites as invite
    on invite.invited_email = lower(account.email)
    and invite.expires_at > clock_timestamp()
  join public.organizer_profiles as organizer on organizer.id = invite.organizer_profile_id
  where account.id = p_actor_id and account.email_confirmed_at is not null;
$$;

create or replace function public.purge_expired_organizer_invites_command()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare deleted_count bigint;
begin
  delete from public.organizer_profile_invites where expires_at <= clock_timestamp();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

select cron.schedule(
  'promenadis-purge-expired-organizer-invites',
  '41 * * * *',
  'select public.purge_expired_organizer_invites_command()'
);

alter table public.organizer_profile_invites enable row level security;
alter table public.organizer_profile_invites force row level security;
revoke all on table public.organizer_profile_invites from public, anon, authenticated;
grant select, insert, update, delete on table public.organizer_profile_invites to service_role;

revoke all on function app_private.organizer_team_summary(uuid,boolean) from public, anon, authenticated;
grant execute on function app_private.organizer_team_summary(uuid,boolean) to service_role;

revoke all on function public.get_organizer_team_command(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_organizer_team_command(uuid,uuid) to service_role;
revoke all on function public.invite_organizer_manager_command(uuid,uuid,integer,text,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.invite_organizer_manager_command(uuid,uuid,integer,text,timestamptz,uuid) to service_role;
revoke all on function public.cancel_organizer_manager_invite_command(uuid,uuid,uuid,integer,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.cancel_organizer_manager_invite_command(uuid,uuid,uuid,integer,timestamptz,uuid) to service_role;
revoke all on function public.accept_organizer_manager_invite_command(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.accept_organizer_manager_invite_command(uuid,uuid,text,uuid) to service_role;
revoke all on function public.remove_organizer_manager_command(uuid,uuid,uuid,integer,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.remove_organizer_manager_command(uuid,uuid,uuid,integer,timestamptz,uuid) to service_role;
revoke all on function public.get_incoming_organizer_invites_command(uuid) from public, anon, authenticated;
grant execute on function public.get_incoming_organizer_invites_command(uuid) to service_role;
revoke all on function public.purge_expired_organizer_invites_command() from public, anon, authenticated;
grant execute on function public.purge_expired_organizer_invites_command() to service_role;

comment on table public.organizer_profile_invites is
  'Short-lived verified-email invitations to manage a shared organizer profile.';
