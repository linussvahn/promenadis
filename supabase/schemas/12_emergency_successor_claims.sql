create table public.event_emergency_successor_claims (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null unique references public.events (id) on delete cascade,
  from_owner_membership_id uuid not null references public.event_memberships (id) on delete cascade,
  successor_membership_id uuid not null references public.event_memberships (id) on delete cascade,
  target_organizer_profile_id uuid not null references public.organizer_profiles (id) on delete restrict,
  initiated_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz not null default (clock_timestamp() + interval '24 hours'),
  expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  constraint event_emergency_successor_claims_different_members check (
    from_owner_membership_id <> successor_membership_id
  ),
  constraint event_emergency_successor_claims_delay check (
    ready_at >= initiated_at + interval '24 hours'
  ),
  constraint event_emergency_successor_claims_expiry check (
    expires_at > ready_at and expires_at <= initiated_at + interval '7 days 1 minute'
  )
);

create index event_emergency_successor_claims_expiry
on public.event_emergency_successor_claims (expires_at);

create table app_private.notification_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  correlation_id uuid not null,
  source_id uuid not null,
  event_id uuid not null references public.events (id) on delete cascade,
  recipient_account_id uuid not null references public.profiles (account_id) on delete cascade,
  template_key text not null check (
    template_key in (
      'event_emergency_claim_started',
      'event_emergency_claim_ready',
      'event_emergency_claim_cancelled',
      'event_emergency_claim_completed',
      'event_emergency_claim_expired'
    )
  ),
  available_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '30 days'),
  cancelled_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  constraint notification_jobs_terminal_state check (
    cancelled_at is null or completed_at is null
  ),
  constraint notification_jobs_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '30 days 1 minute'
  ),
  unique (source_id, recipient_account_id, template_key)
);

create index notification_jobs_pending
on app_private.notification_jobs (available_at)
where cancelled_at is null and completed_at is null;

alter table public.event_emergency_successor_claims enable row level security;
alter table app_private.notification_jobs enable row level security;
alter table app_private.notification_jobs force row level security;

revoke all on table public.event_emergency_successor_claims from public, anon, authenticated;
revoke all on table app_private.notification_jobs from public, anon, authenticated;

create or replace function app_private.validate_event_emergency_successor_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.event_emergency_successors as designation
    join public.event_memberships as previous_owner
      on previous_owner.id = new.from_owner_membership_id
    join public.event_memberships as successor
      on successor.id = new.successor_membership_id
    join auth.users as successor_account
      on successor_account.id = successor.account_id
    where designation.event_id = new.event_id
      and designation.successor_membership_id = new.successor_membership_id
      and designation.target_organizer_profile_id = new.target_organizer_profile_id
      and previous_owner.event_id = new.event_id
      and previous_owner.role = 'owner'
      and successor.event_id = new.event_id
      and successor.role = 'co_host'
      and successor_account.email_confirmed_at is not null
      and exists (
        select 1
        from public.organizer_profile_memberships as organizer_membership
        where organizer_membership.organizer_profile_id = new.target_organizer_profile_id
          and organizer_membership.account_id = successor.account_id
          and organizer_membership.role in ('owner', 'manager')
      )
  ) then
    raise exception 'Emergency successor designation is no longer valid';
  end if;
  if exists (
    select 1 from public.event_ownership_transfers where event_id = new.event_id
  ) then
    raise exception 'An ownership transfer is already pending';
  end if;
  return new;
end;
$$;

create trigger event_emergency_successor_claims_validate
before insert or update on public.event_emergency_successor_claims
for each row execute function app_private.validate_event_emergency_successor_claim();

create or replace function app_private.block_planned_transfer_during_emergency_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.event_emergency_successor_claims
    where event_id = new.event_id and expires_at > clock_timestamp()
  ) then
    raise exception 'An emergency successor claim is already pending';
  end if;
  return new;
end;
$$;

create trigger event_ownership_transfers_block_emergency_claim
before insert on public.event_ownership_transfers
for each row execute function app_private.block_planned_transfer_during_emergency_claim();

create or replace function app_private.event_team_summary_with_emergency_claim(
  p_event_id uuid,
  p_include_invite_emails boolean
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select app_private.event_team_summary(p_event_id, p_include_invite_emails)
    || jsonb_build_object(
      'pendingEmergencyClaim', (
        select jsonb_build_object(
          'expiresAt', claim.expires_at,
          'id', claim.id,
          'initiatedAt', claim.initiated_at,
          'readyAt', claim.ready_at,
          'successorDisplayName', successor.display_name,
          'successorMembershipId', claim.successor_membership_id,
          'targetOrganizerDisplayName', organizer.display_name
        )
        from public.event_emergency_successor_claims as claim
        join public.event_memberships as successor
          on successor.id = claim.successor_membership_id
        join public.organizer_profiles as organizer
          on organizer.id = claim.target_organizer_profile_id
        where claim.event_id = p_event_id
          and claim.expires_at > clock_timestamp()
      )
    );
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
  select * into actor_membership
  from public.event_memberships
  where event_id = p_event_id and account_id = p_actor_id;
  if actor_membership.id is null then
    raise exception 'Actor is not an event team member';
  end if;
  return app_private.event_team_summary_with_emergency_claim(
    p_event_id,
    actor_membership.role = 'owner'
  ) || jsonb_build_object('currentMembershipId', actor_membership.id);
end;
$$;

create or replace function public.initiate_event_emergency_successor_claim_command(
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
  successor_membership public.event_memberships;
  designation public.event_emergency_successors;
  claim_id uuid;
  initiated_at_value timestamptz := clock_timestamp();
  ready_at_value timestamptz := initiated_at_value + interval '24 hours';
begin
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.id is null then raise exception 'Event not found'; end if;
  if event_row.state in ('ended', 'cancelled', 'archived') then
    raise exception 'A terminal event cannot be claimed';
  end if;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;
  select * into designation
  from public.event_emergency_successors
  where event_id = p_event_id;
  select * into successor_membership
  from public.event_memberships
  where id = designation.successor_membership_id
    and event_id = p_event_id
    and account_id = p_actor_id
    and role = 'co_host'
  for update;
  if successor_membership.id is null then
    raise exception 'Only the designated successor can start a claim';
  end if;
  if not exists (
    select 1 from auth.users
    where id = p_actor_id and email_confirmed_at is not null
  ) then raise exception 'A verified co-host is required'; end if;
  select * into owner_membership
  from public.event_memberships
  where event_id = p_event_id and role = 'owner'
  for update;
  if exists (
    select 1 from public.event_ownership_transfers where event_id = p_event_id
  ) then raise exception 'An ownership transfer is already pending'; end if;
  delete from public.event_emergency_successor_claims
  where event_id = p_event_id and expires_at <= clock_timestamp();
  if exists (
    select 1 from public.event_emergency_successor_claims where event_id = p_event_id
  ) then raise exception 'An emergency successor claim is already pending'; end if;

  insert into public.event_emergency_successor_claims (
    event_id, from_owner_membership_id, successor_membership_id,
    target_organizer_profile_id, initiated_at, ready_at, expires_at
  ) values (
    p_event_id, owner_membership.id, successor_membership.id,
    designation.target_organizer_profile_id, initiated_at_value, ready_at_value,
    initiated_at_value + interval '7 days'
  ) returning id into claim_id;
  update public.events set team_version = team_version + 1 where id = p_event_id;

  insert into app_private.notification_jobs (
    correlation_id, source_id, event_id, recipient_account_id,
    template_key, available_at, created_at, expires_at
  )
  select distinct p_correlation_id, claim_id, p_event_id, membership.account_id,
    'event_emergency_claim_started', clock_timestamp(), clock_timestamp(),
    clock_timestamp() + interval '30 days'
  from public.event_memberships as membership
  where membership.event_id = p_event_id;
  insert into app_private.notification_jobs (
    correlation_id, source_id, event_id, recipient_account_id,
    template_key, available_at, created_at, expires_at
  ) values (
    p_correlation_id, claim_id, p_event_id, p_actor_id,
    'event_emergency_claim_ready', ready_at_value, clock_timestamp(),
    clock_timestamp() + interval '30 days'
  );
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.emergency_successor_claim_initiated',
    'event_emergency_successor_claim', claim_id, p_event_id,
    jsonb_build_object('delayHours', 24, 'recipientRole', 'co_host')
  );
  return app_private.event_team_summary_with_emergency_claim(p_event_id, false)
    || jsonb_build_object('currentMembershipId', successor_membership.id);
end;
$$;

create or replace function public.cancel_event_emergency_successor_claim_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_claim_id uuid,
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
  claim_row public.event_emergency_successor_claims;
  actor_membership public.event_memberships;
begin
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into event_row from public.events where id = p_event_id for update;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;
  select * into claim_row
  from public.event_emergency_successor_claims
  where id = p_claim_id and event_id = p_event_id and expires_at > clock_timestamp()
  for update;
  if claim_row.id is null then raise exception 'Emergency successor claim unavailable'; end if;
  select * into actor_membership
  from public.event_memberships
  where event_id = p_event_id and account_id = p_actor_id
    and (role = 'owner' or id = claim_row.successor_membership_id);
  if actor_membership.id is null then
    raise exception 'Only the owner or designated successor can cancel the claim';
  end if;

  delete from public.event_emergency_successor_claims where id = p_claim_id;
  update app_private.notification_jobs
  set cancelled_at = clock_timestamp()
  where source_id = p_claim_id and cancelled_at is null and completed_at is null;
  insert into app_private.notification_jobs (
    correlation_id, source_id, event_id, recipient_account_id,
    template_key, available_at, created_at, expires_at
  )
  select distinct p_correlation_id, p_claim_id, p_event_id, membership.account_id,
    'event_emergency_claim_cancelled', clock_timestamp(), clock_timestamp(),
    clock_timestamp() + interval '30 days'
  from public.event_memberships as membership
  where membership.event_id = p_event_id;
  update public.events set team_version = team_version + 1 where id = p_event_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.emergency_successor_claim_cancelled',
    'event_emergency_successor_claim', p_claim_id, p_event_id,
    jsonb_build_object('cancelledByRole', actor_membership.role)
  );
  return app_private.event_team_summary_with_emergency_claim(
    p_event_id,
    actor_membership.role = 'owner'
  ) || jsonb_build_object('currentMembershipId', actor_membership.id);
end;
$$;

create or replace function public.complete_event_emergency_successor_claim_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_claim_id uuid,
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
  claim_row public.event_emergency_successor_claims;
  previous_owner public.event_memberships;
  successor_membership public.event_memberships;
  organizer_will_change boolean;
begin
  perform app_private.require_recent_authentication(p_authenticated_at);
  select claim.* into claim_row
  from public.event_emergency_successor_claims as claim
  join public.event_memberships as successor
    on successor.id = claim.successor_membership_id
  where claim.id = p_claim_id
    and claim.event_id = p_event_id
    and claim.expires_at > clock_timestamp()
    and successor.account_id = p_actor_id
  for update of claim;
  if claim_row.id is null then raise exception 'Emergency successor claim unavailable'; end if;
  if claim_row.ready_at > clock_timestamp() then
    raise exception 'Emergency successor claim is not ready';
  end if;
  select * into event_row from public.events where id = p_event_id for update;
  if p_expected_team_version is distinct from event_row.team_version then
    raise exception 'Event team version conflict';
  end if;
  if event_row.state in ('ended', 'cancelled', 'archived') then
    raise exception 'A terminal event cannot be claimed';
  end if;
  select * into previous_owner from public.event_memberships
  where id = claim_row.from_owner_membership_id
    and event_id = p_event_id and role = 'owner'
  for update;
  select * into successor_membership from public.event_memberships
  where id = claim_row.successor_membership_id
    and event_id = p_event_id and account_id = p_actor_id and role = 'co_host'
  for update;
  if previous_owner.id is null or successor_membership.id is null then
    raise exception 'Emergency successor designation is no longer valid';
  end if;
  if not exists (
    select 1 from auth.users
    where id = p_actor_id and email_confirmed_at is not null
  ) then raise exception 'A verified co-host is required'; end if;
  if not exists (
    select 1 from public.event_emergency_successors
    where event_id = p_event_id
      and successor_membership_id = claim_row.successor_membership_id
      and target_organizer_profile_id = claim_row.target_organizer_profile_id
  ) then raise exception 'Emergency successor designation is no longer valid'; end if;
  if not exists (
    select 1 from public.organizer_profile_memberships
    where organizer_profile_id = claim_row.target_organizer_profile_id
      and account_id = p_actor_id and role in ('owner', 'manager')
  ) then raise exception 'The co-host must manage the selected organizer'; end if;
  if exists (
    select 1 from public.event_ownership_transfers where event_id = p_event_id
  ) then raise exception 'An ownership transfer is already pending'; end if;
  organizer_will_change := claim_row.target_organizer_profile_id <> event_row.organizer_profile_id;

  delete from public.event_emergency_successor_claims where id = p_claim_id;
  delete from public.event_emergency_successors where event_id = p_event_id;
  update public.event_memberships set role = 'co_host' where id = previous_owner.id;
  update public.event_memberships set role = 'owner' where id = successor_membership.id;
  update public.events
  set organizer_profile_id = claim_row.target_organizer_profile_id,
      team_version = team_version + 1,
      version = version + case when organizer_will_change then 1 else 0 end
  where id = p_event_id;
  update app_private.notification_jobs
  set cancelled_at = clock_timestamp()
  where source_id = p_claim_id and cancelled_at is null and completed_at is null;
  insert into app_private.notification_jobs (
    correlation_id, source_id, event_id, recipient_account_id,
    template_key, available_at, created_at, expires_at
  )
  select distinct p_correlation_id, p_claim_id, p_event_id, membership.account_id,
    'event_emergency_claim_completed', clock_timestamp(), clock_timestamp(),
    clock_timestamp() + interval '30 days'
  from public.event_memberships as membership
  where membership.event_id = p_event_id;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'event.emergency_successor_claim_completed',
    'event_emergency_successor_claim', p_claim_id, p_event_id,
    jsonb_build_object(
      'delayHours', 24,
      'newOwnerRole', 'owner',
      'organizerChanged', organizer_will_change,
      'previousOwnerRole', 'co_host'
    )
  );
  return app_private.event_team_summary_with_emergency_claim(p_event_id, true)
    || jsonb_build_object('currentMembershipId', successor_membership.id);
end;
$$;

create or replace function public.purge_expired_emergency_successor_claims_command()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_row public.event_emergency_successor_claims;
  deleted_count bigint := 0;
begin
  for claim_row in
    select * from public.event_emergency_successor_claims
    where expires_at <= clock_timestamp()
    for update
  loop
    delete from public.event_emergency_successor_claims where id = claim_row.id;
    update app_private.notification_jobs
    set cancelled_at = clock_timestamp()
    where source_id = claim_row.id and cancelled_at is null and completed_at is null;
    insert into app_private.notification_jobs (
      correlation_id, source_id, event_id, recipient_account_id,
      template_key, available_at, created_at, expires_at
    )
    select distinct extensions.gen_random_uuid(), claim_row.id, claim_row.event_id,
      membership.account_id, 'event_emergency_claim_expired', clock_timestamp(),
      clock_timestamp(), clock_timestamp() + interval '30 days'
    from public.event_memberships as membership
    where membership.event_id = claim_row.event_id;
    insert into app_private.audit_events (
      correlation_id, action, target_type, target_id, event_id, safe_summary
    ) values (
      extensions.gen_random_uuid(), 'event.emergency_successor_claim_expired',
      'event_emergency_successor_claim', claim_row.id, claim_row.event_id,
      jsonb_build_object('expired', true)
    );
    update public.events set team_version = team_version + 1 where id = claim_row.event_id;
    deleted_count := deleted_count + 1;
  end loop;
  delete from app_private.notification_jobs where expires_at <= clock_timestamp();
  return deleted_count;
end;
$$;

select cron.schedule(
  'promenadis-purge-expired-emergency-successor-claims',
  '41 * * * *',
  'select public.purge_expired_emergency_successor_claims_command()'
);

revoke all on function app_private.event_team_summary_with_emergency_claim(uuid,boolean)
from public, anon, authenticated;
revoke all on function public.initiate_event_emergency_successor_claim_command(uuid,uuid,integer,timestamptz,uuid)
from public, anon, authenticated;
revoke all on function public.cancel_event_emergency_successor_claim_command(uuid,uuid,uuid,integer,timestamptz,uuid)
from public, anon, authenticated;
revoke all on function public.complete_event_emergency_successor_claim_command(uuid,uuid,uuid,integer,timestamptz,uuid)
from public, anon, authenticated;
revoke all on function public.purge_expired_emergency_successor_claims_command()
from public, anon, authenticated;

grant execute on function public.initiate_event_emergency_successor_claim_command(uuid,uuid,integer,timestamptz,uuid)
to service_role;
grant execute on function public.cancel_event_emergency_successor_claim_command(uuid,uuid,uuid,integer,timestamptz,uuid)
to service_role;
grant execute on function public.complete_event_emergency_successor_claim_command(uuid,uuid,uuid,integer,timestamptz,uuid)
to service_role;

comment on table public.event_emergency_successor_claims is
  'Short-lived owner-notified emergency claims with a mandatory 24-hour delay.';
comment on table app_private.notification_jobs is
  'Restricted structured notification outbox; recipient email is resolved only by the future delivery worker.';
