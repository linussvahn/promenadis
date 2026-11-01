create table app_private.account_recovery_codes (
  account_id uuid primary key references public.profiles (account_id) on delete cascade,
  code_hash text not null,
  version integer not null default 1 check (version > 0),
  issued_at timestamptz not null default clock_timestamp(),
  rotated_at timestamptz,
  used_at timestamptz,
  invalidated_at timestamptz,
  constraint account_recovery_codes_hash check (char_length(code_hash) between 50 and 100),
  constraint account_recovery_codes_timestamp_order check (
    (rotated_at is null or rotated_at >= issued_at)
    and (used_at is null or used_at >= issued_at)
    and (invalidated_at is null or invalidated_at >= issued_at)
  )
);

create table public.event_emergency_successors (
  event_id uuid primary key references public.events (id) on delete cascade,
  successor_membership_id uuid not null references public.event_memberships (id) on delete cascade,
  target_organizer_profile_id uuid not null references public.organizer_profiles (id) on delete restrict,
  designated_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint event_emergency_successors_timestamp_order check (updated_at >= designated_at)
);

create table public.event_publication_attestations (
  event_id uuid primary key references public.events (id) on delete cascade,
  attested_by_account_id uuid not null references public.profiles (account_id) on delete cascade,
  event_version integer not null check (event_version > 0),
  boundary_version integer not null check (boundary_version > 0),
  registration_version integer not null check (registration_version > 0),
  visibility text not null check (visibility in ('public', 'unlisted')),
  location_authority_confirmed boolean not null check (location_authority_confirmed),
  visibility_understood boolean not null check (visibility_understood),
  attested_at timestamptz not null default clock_timestamp()
);

alter table app_private.account_recovery_codes enable row level security;
alter table public.event_emergency_successors enable row level security;
alter table public.event_publication_attestations enable row level security;

revoke all on table app_private.account_recovery_codes from public, anon, authenticated;
revoke all on table public.event_emergency_successors from public, anon, authenticated;
revoke all on table public.event_publication_attestations from public, anon, authenticated;

create or replace function app_private.validate_event_emergency_successor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.event_memberships as membership
    join auth.users as account on account.id = membership.account_id
    join public.organizer_profile_memberships as organizer_membership
      on organizer_membership.account_id = membership.account_id
      and organizer_membership.organizer_profile_id = new.target_organizer_profile_id
    where membership.id = new.successor_membership_id
      and membership.event_id = new.event_id
      and membership.role = 'co_host'
      and account.email_confirmed_at is not null
      and organizer_membership.role in ('owner', 'manager')
  ) then raise exception 'Invalid emergency successor designation'; end if;
  return new;
end;
$$;

create trigger event_emergency_successors_validate
before insert or update on public.event_emergency_successors
for each row execute function app_private.validate_event_emergency_successor();

create or replace function app_private.clear_successor_for_event_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or new.role <> 'co_host' then
    delete from public.event_emergency_successors
    where successor_membership_id = old.id;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger event_memberships_clear_invalid_successor
before update of role or delete on public.event_memberships
for each row execute function app_private.clear_successor_for_event_membership_change();

create or replace function app_private.clear_successor_for_organizer_membership_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.event_emergency_successors as successor
  using public.event_memberships as membership
  where successor.successor_membership_id = membership.id
    and successor.target_organizer_profile_id = old.organizer_profile_id
    and membership.account_id = old.account_id;
  return old;
end;
$$;

create trigger organizer_memberships_clear_invalid_successor
before delete on public.organizer_profile_memberships
for each row execute function app_private.clear_successor_for_organizer_membership_delete();

create or replace function app_private.account_recovery_status(p_account_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'active', recovery.account_id is not null
      and recovery.used_at is null
      and recovery.invalidated_at is null,
    'issuedAt', recovery.issued_at,
    'rotatedAt', recovery.rotated_at,
    'version', coalesce(recovery.version, 0)
  )
  from (select p_account_id as account_id) as requested
  left join app_private.account_recovery_codes as recovery
    on recovery.account_id = requested.account_id;
$$;

create or replace function public.get_account_security_command(p_actor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where account_id = p_actor_id) then
    raise exception 'Account profile not found';
  end if;
  return app_private.account_recovery_status(p_actor_id);
end;
$$;

create or replace function public.enroll_account_recovery_code_command(
  p_actor_id uuid,
  p_code text,
  p_expected_version integer,
  p_authenticated_at timestamptz,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_recovery app_private.account_recovery_codes;
  normalized_code text := upper(btrim(coalesce(p_code, '')));
  next_version integer;
  issued_at_value timestamptz := clock_timestamp();
begin
  perform app_private.require_recent_authentication(p_authenticated_at);
  if not exists (
    select 1 from auth.users
    where id = p_actor_id and email_confirmed_at is not null
  ) then
    raise exception 'Verified email required';
  end if;
  if normalized_code !~ '^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){4}$' then
    raise exception 'Invalid recovery code format';
  end if;

  select * into current_recovery
  from app_private.account_recovery_codes
  where account_id = p_actor_id
  for update;
  if p_expected_version is distinct from coalesce(current_recovery.version, 0) then
    raise exception 'Recovery code version conflict';
  end if;
  next_version := coalesce(current_recovery.version, 0) + 1;

  insert into app_private.account_recovery_codes (
    account_id, code_hash, version, issued_at, rotated_at, used_at, invalidated_at
  ) values (
    p_actor_id,
    extensions.crypt(normalized_code, extensions.gen_salt('bf', 10)),
    next_version,
    issued_at_value,
    case when current_recovery.account_id is null then null else issued_at_value end,
    null,
    null
  )
  on conflict (account_id) do update set
    code_hash = excluded.code_hash,
    version = excluded.version,
    issued_at = excluded.issued_at,
    rotated_at = excluded.rotated_at,
    used_at = null,
    invalidated_at = null;

  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, safe_summary
  ) values (
    p_correlation_id,
    p_actor_id,
    case when current_recovery.account_id is null
      then 'account.recovery_code_enrolled'
      else 'account.recovery_code_rotated'
    end,
    'account_recovery_code',
    p_actor_id,
    jsonb_build_object('version', next_version)
  );

  return app_private.account_recovery_status(p_actor_id);
end;
$$;

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
    'successorOptions', case when p_include_invite_emails then coalesce((
      select jsonb_agg(jsonb_build_object(
        'organizerDisplayName', target_organizer.display_name,
        'organizerProfileId', target_organizer.id,
        'recipientDisplayName', recipient.display_name,
        'successorMembershipId', recipient.id
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
    'emergencySuccessor', (
      select jsonb_build_object(
        'designatedAt', successor.designated_at,
        'organizerDisplayName', target_organizer.display_name,
        'recipientDisplayName', recipient.display_name,
        'successorMembershipId', recipient.id,
        'targetOrganizerProfileId', target_organizer.id
      )
      from public.event_emergency_successors as successor
      join public.event_memberships as recipient
        on recipient.id = successor.successor_membership_id
      join public.organizer_profiles as target_organizer
        on target_organizer.id = successor.target_organizer_profile_id
      where successor.event_id = event.id
    ),
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

create or replace function public.set_event_emergency_successor_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_successor_membership_id uuid,
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
  successor_membership public.event_memberships;
  existed boolean;
begin
  select * into owner_membership from public.event_memberships
  where event_id = p_event_id and account_id = p_actor_id and role = 'owner';
  if owner_membership.id is null then
    raise exception 'Only the event owner can designate a successor';
  end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.id is null then raise exception 'Event not found'; end if;
  if event_row.state in ('ended', 'cancelled', 'archived') then
    raise exception 'A terminal event cannot have an emergency successor';
  end if;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;
  select * into successor_membership from public.event_memberships
  where id = p_successor_membership_id and event_id = p_event_id for update;
  if successor_membership.id is null or successor_membership.role <> 'co_host' then
    raise exception 'Emergency successor must be a co-host';
  end if;
  if not exists (
    select 1 from auth.users
    where id = successor_membership.account_id and email_confirmed_at is not null
  ) then raise exception 'A verified co-host is required'; end if;
  if not exists (
    select 1 from public.organizer_profile_memberships
    where organizer_profile_id = p_target_organizer_profile_id
      and account_id = successor_membership.account_id
      and role in ('owner', 'manager')
  ) then raise exception 'The co-host must manage the selected organizer'; end if;

  existed := exists (
    select 1 from public.event_emergency_successors where event_id = p_event_id
  );
  insert into public.event_emergency_successors (
    event_id, successor_membership_id, target_organizer_profile_id, designated_at, updated_at
  ) values (
    p_event_id, p_successor_membership_id, p_target_organizer_profile_id,
    clock_timestamp(), clock_timestamp()
  )
  on conflict (event_id) do update set
    successor_membership_id = excluded.successor_membership_id,
    target_organizer_profile_id = excluded.target_organizer_profile_id,
    updated_at = excluded.updated_at;
  update public.events set team_version = team_version + 1 where id = p_event_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id,
    case when existed then 'event.emergency_successor_changed'
      else 'event.emergency_successor_designated' end,
    'event_emergency_successor', p_successor_membership_id, p_event_id,
    jsonb_build_object('recipientRole', successor_membership.role)
  );
  return app_private.event_team_summary(p_event_id, true)
    || jsonb_build_object('currentMembershipId', owner_membership.id);
end;
$$;

create or replace function public.clear_event_emergency_successor_command(
  p_actor_id uuid,
  p_event_id uuid,
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
  removed_membership_id uuid;
begin
  select * into owner_membership from public.event_memberships
  where event_id = p_event_id and account_id = p_actor_id and role = 'owner';
  if owner_membership.id is null then
    raise exception 'Only the event owner can designate a successor';
  end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into event_row from public.events where id = p_event_id for update;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;
  delete from public.event_emergency_successors
  where event_id = p_event_id
  returning successor_membership_id into removed_membership_id;
  if removed_membership_id is null then
    raise exception 'Emergency successor not found';
  end if;
  update public.events set team_version = team_version + 1 where id = p_event_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.emergency_successor_cleared',
    'event_emergency_successor', removed_membership_id, p_event_id,
    jsonb_build_object('cleared', true)
  );
  return app_private.event_team_summary(p_event_id, true)
    || jsonb_build_object('currentMembershipId', owner_membership.id);
end;
$$;

create or replace function public.get_event_publication_readiness_command(
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
  event_row public.events;
  owner_account_id uuid;
  boundary_version_value integer;
  registration_version_value integer;
  blockers jsonb := '[]'::jsonb;
  recommendations jsonb := '["totp_recommended"]'::jsonb;
begin
  if not exists (
    select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id
  ) then raise exception 'Actor is not an event team member'; end if;
  select * into event_row from public.events where id = p_event_id;
  select account_id into owner_account_id from public.event_memberships
  where event_id = p_event_id and role = 'owner';
  select version into boundary_version_value from public.event_boundaries where event_id = p_event_id;
  select version into registration_version_value
  from public.event_registration_settings where event_id = p_event_id;

  if event_row.state <> 'draft' then blockers := blockers || '"event_not_draft"'::jsonb; end if;
  if not exists (
    select 1 from auth.users where id = owner_account_id and email_confirmed_at is not null
  ) then blockers := blockers || '"owner_email_unverified"'::jsonb; end if;
  if not exists (
    select 1 from app_private.account_recovery_codes
    where account_id = owner_account_id and used_at is null and invalidated_at is null
  ) then blockers := blockers || '"recovery_code_missing"'::jsonb; end if;
  if boundary_version_value is null then blockers := blockers || '"boundary_missing"'::jsonb; end if;
  if registration_version_value is null then blockers := blockers || '"registration_missing"'::jsonb; end if;
  if not exists (
    select 1 from public.event_publication_attestations as attestation
    where attestation.event_id = p_event_id
      and attestation.attested_by_account_id = owner_account_id
      and attestation.event_version = event_row.version
      and attestation.boundary_version = boundary_version_value
      and attestation.registration_version = registration_version_value
      and attestation.visibility = event_row.visibility
      and attestation.location_authority_confirmed
      and attestation.visibility_understood
  ) then blockers := blockers || '"publication_attestation_missing"'::jsonb; end if;
  if not exists (
    select 1
    from public.event_emergency_successors as successor
    join public.event_memberships as membership
      on membership.id = successor.successor_membership_id
    join auth.users as account on account.id = membership.account_id
    where successor.event_id = p_event_id
      and membership.role = 'co_host'
      and account.email_confirmed_at is not null
  ) then recommendations := recommendations || '"emergency_successor_recommended"'::jsonb; end if;

  blockers := blockers
    || '["first_event_review_pending","routing_not_ready","public_delivery_not_ready"]'::jsonb;
  return jsonb_build_object(
    'blockers', blockers,
    'eventId', p_event_id,
    'eventVersion', event_row.version,
    'readyToPublish', jsonb_array_length(blockers) = 0,
    'recommendations', recommendations
  );
end;
$$;

create or replace function public.attest_event_publication_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_expected_event_version integer,
  p_expected_boundary_version integer,
  p_expected_registration_version integer,
  p_location_authority_confirmed boolean,
  p_visibility_understood boolean,
  p_authenticated_at timestamptz,
  p_correlation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events;
  boundary_version_value integer;
  registration_version_value integer;
begin
  if not exists (
    select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role = 'owner'
  ) then raise exception 'Only the event owner can attest publication'; end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.state <> 'draft' then raise exception 'Only draft events can be attested'; end if;
  if p_expected_event_version is distinct from event_row.version then
    raise exception 'Event version conflict';
  end if;
  select version into boundary_version_value from public.event_boundaries where event_id = p_event_id;
  select version into registration_version_value
  from public.event_registration_settings where event_id = p_event_id;
  if p_expected_boundary_version is distinct from boundary_version_value
    or p_expected_registration_version is distinct from registration_version_value
  then raise exception 'Publication configuration version conflict'; end if;
  if not coalesce(p_location_authority_confirmed, false)
    or not coalesce(p_visibility_understood, false)
  then raise exception 'Publication attestations are required'; end if;

  insert into public.event_publication_attestations (
    event_id, attested_by_account_id, event_version, boundary_version,
    registration_version, visibility, location_authority_confirmed,
    visibility_understood, attested_at
  ) values (
    p_event_id, p_actor_id, event_row.version, boundary_version_value,
    registration_version_value, event_row.visibility, true, true, clock_timestamp()
  )
  on conflict (event_id) do update set
    attested_by_account_id = excluded.attested_by_account_id,
    event_version = excluded.event_version,
    boundary_version = excluded.boundary_version,
    registration_version = excluded.registration_version,
    visibility = excluded.visibility,
    location_authority_confirmed = true,
    visibility_understood = true,
    attested_at = excluded.attested_at;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.publication_attested',
    'event', p_event_id, p_event_id,
    jsonb_build_object(
      'boundaryVersion', boundary_version_value,
      'eventVersion', event_row.version,
      'registrationVersion', registration_version_value,
      'visibility', event_row.visibility
    )
  );
  return p_event_id;
end;
$$;

revoke all on function app_private.account_recovery_status(uuid) from public, anon, authenticated;
revoke all on function public.get_account_security_command(uuid) from public, anon, authenticated;
revoke all on function public.enroll_account_recovery_code_command(uuid,text,integer,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.set_event_emergency_successor_command(uuid,uuid,uuid,uuid,integer,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.clear_event_emergency_successor_command(uuid,uuid,integer,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.attest_event_publication_command(uuid,uuid,integer,integer,integer,boolean,boolean,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.get_event_publication_readiness_command(uuid,uuid) from public, anon, authenticated;

grant execute on function public.get_account_security_command(uuid) to service_role;
grant execute on function public.enroll_account_recovery_code_command(uuid,text,integer,timestamptz,uuid) to service_role;
grant execute on function public.set_event_emergency_successor_command(uuid,uuid,uuid,uuid,integer,timestamptz,uuid) to service_role;
grant execute on function public.clear_event_emergency_successor_command(uuid,uuid,integer,timestamptz,uuid) to service_role;
grant execute on function public.attest_event_publication_command(uuid,uuid,integer,integer,integer,boolean,boolean,timestamptz,uuid) to service_role;
grant execute on function public.get_event_publication_readiness_command(uuid,uuid) to service_role;

comment on table app_private.account_recovery_codes is
  'Current account recovery code hash and minimal lifecycle metadata; plaintext is never stored.';
comment on table public.event_emergency_successors is
  'One owner-designated verified co-host and pre-approved organizer identity for delayed emergency transfer.';
comment on table public.event_publication_attestations is
  'Owner acknowledgement bound to the exact draft visibility and configuration versions.';
