-- Event lifecycle: draft -> published -> active -> ended -> archived. A
-- published (or postponed) event is cancelled by its owner; an active event is
-- ended early by the owner or a co-host instead (matrix and domain rules).
-- Transitions are enforced here for every writer. Postponement needs seller reconfirmation (Milestone 2)
-- and is not offered yet; its states remain valid for the model.
alter table public.events
  add column state_changed_at timestamptz not null default clock_timestamp(),
  add column public_notice text check (public_notice is null or char_length(btrim(public_notice)) between 3 and 500);

create function app_private.enforce_event_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.state = old.state then return new; end if;
  if not (
    (old.state = 'draft' and new.state = 'published')
    or (old.state = 'published' and new.state in ('active', 'postponed', 'cancelled'))
    or (old.state = 'active' and new.state in ('ended', 'postponed'))
    or (old.state = 'postponed' and new.state in ('published', 'cancelled'))
    or (old.state in ('ended', 'cancelled') and new.state = 'archived')
  ) then
    raise exception 'Event transition % -> % is not allowed', old.state, new.state;
  end if;
  new.state_changed_at := clock_timestamp();
  return new;
end;
$$;
create trigger events_enforce_transition
before update of state on public.events
for each row execute function app_private.enforce_event_transition();

-- Routing and public delivery do not exist yet (Milestones 3-4). Kept as one
-- function so those gates open in a single, reviewable place.
create function app_private.publication_system_blockers(p_event_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select '["routing_not_ready","public_delivery_not_ready"]'::jsonb;
$$;

-- Same checks as before; the system gates now come from one place.
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
  review_blocker text;
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
  if exists (
    select 1 from auth.mfa_factors
    where user_id = owner_account_id and factor_type = 'totp' and status = 'verified'
  ) then recommendations := recommendations - 'totp_recommended'; end if;
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

  review_blocker := app_private.first_event_review_blocker(p_event_id, owner_account_id);
  if review_blocker is not null then blockers := blockers || to_jsonb(review_blocker); end if;
  blockers := blockers || app_private.publication_system_blockers(p_event_id);
  return jsonb_build_object(
    'blockers', blockers,
    'eventId', p_event_id,
    'eventVersion', event_row.version,
    'readyToPublish', jsonb_array_length(blockers) = 0,
    'recommendations', recommendations
  );
end;
$$;

create function public.publish_event_command(
  p_actor_id uuid, p_event_id uuid, p_expected_event_version integer,
  p_authenticated_at timestamptz, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  readiness jsonb;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role = 'owner')
  then raise exception 'Only the event owner can publish'; end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.version is distinct from p_expected_event_version then raise exception 'Event version conflict'; end if;
  if event_row.state <> 'draft' then raise exception 'Only draft events can be published'; end if;
  if (select min(starts_at) from public.event_intervals where event_id = p_event_id) <= clock_timestamp()
  then raise exception 'Event already started'; end if;
  readiness := public.get_event_publication_readiness_command(p_actor_id, p_event_id);
  if (readiness->>'readyToPublish')::boolean is not true then raise exception 'Event not ready to publish'; end if;
  update public.events set state = 'published', version = version + 1 where id = p_event_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.published', 'event', p_event_id, p_event_id,
    jsonb_build_object('visibility', event_row.visibility));
  return jsonb_build_object('state', 'published', 'version', event_row.version + 1);
end;
$$;

create function public.cancel_event_command(
  p_actor_id uuid, p_event_id uuid, p_expected_event_version integer, p_confirmation_title text,
  p_public_reason text, p_authenticated_at timestamptz, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare event_row public.events;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role = 'owner')
  then raise exception 'Only the event owner can cancel'; end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.version is distinct from p_expected_event_version then raise exception 'Event version conflict'; end if;
  if event_row.state not in ('published', 'postponed') then
    raise exception 'Only published events can be cancelled';
  end if;
  if p_confirmation_title is distinct from event_row.title then raise exception 'Cancellation confirmation mismatch'; end if;
  if char_length(btrim(coalesce(p_public_reason, ''))) not between 3 and 500 then
    raise exception 'Cancellation reason required';
  end if;
  -- Seller locations are unpublished here once sellers exist (Milestone 2).
  update public.events set state = 'cancelled', public_notice = btrim(p_public_reason), version = version + 1
  where id = p_event_id;
  delete from public.event_ownership_transfers where event_id = p_event_id;
  delete from public.event_invites where event_id = p_event_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.cancelled', 'event', p_event_id, p_event_id,
    jsonb_build_object('fromState', event_row.state));
  return jsonb_build_object('state', 'cancelled', 'version', event_row.version + 1);
end;
$$;

-- Protective path: no recent-auth step, so a co-host can always stop a live event.
create function public.end_event_early_command(
  p_actor_id uuid, p_event_id uuid, p_expected_event_version integer, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare event_row public.events;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Only the owner or a co-host can end the event'; end if;
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.version is distinct from p_expected_event_version then raise exception 'Event version conflict'; end if;
  if event_row.state <> 'active' then raise exception 'Only active events can end early'; end if;
  -- Seller locations become non-public here once sellers exist (Milestone 2).
  update public.events set state = 'ended', version = version + 1 where id = p_event_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.ended_early', 'event', p_event_id, p_event_id, '{}'::jsonb);
  return jsonb_build_object('state', 'ended', 'version', event_row.version + 1);
end;
$$;

-- Every minute: start, end, and archive 14 days after ending or cancellation.
create function app_private.advance_event_lifecycle_command()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  changed integer := 0;
  step integer;
begin
  update public.events e set state = 'active', version = version + 1
  where e.state = 'published'
    and (select min(i.starts_at) from public.event_intervals i where i.event_id = e.id) <= clock_timestamp();
  get diagnostics step = row_count; changed := changed + step;
  update public.events e set state = 'ended', version = version + 1
  where e.state = 'active'
    and (select max(i.ends_at) from public.event_intervals i where i.event_id = e.id) <= clock_timestamp();
  get diagnostics step = row_count; changed := changed + step;
  update public.events set state = 'archived', version = version + 1
  where state in ('ended', 'cancelled') and state_changed_at <= clock_timestamp() - interval '14 days';
  get diagnostics step = row_count; changed := changed + step;
  return changed;
end;
$$;
select cron.schedule('promenadis-advance-event-lifecycle', '* * * * *',
  'select app_private.advance_event_lifecycle_command();');

revoke all on function app_private.enforce_event_transition() from public,anon,authenticated;
revoke all on function app_private.publication_system_blockers(uuid) from public,anon,authenticated;
revoke all on function app_private.advance_event_lifecycle_command() from public,anon,authenticated;
revoke all on function public.publish_event_command(uuid,uuid,integer,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.cancel_event_command(uuid,uuid,integer,text,text,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.end_event_early_command(uuid,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.end_event_early_command(uuid,uuid,integer,uuid) to service_role;
grant execute on function public.publish_event_command(uuid,uuid,integer,timestamptz,uuid) to service_role;
grant execute on function public.cancel_event_command(uuid,uuid,integer,text,text,timestamptz,uuid) to service_role;
