-- Milestone 2, slice 5: event-relative retention of seller data, a
-- privacy-minimized heartbeat, moderation-record retention, and severe-weather
-- postponement with seller reconfirmation and automatic cancellation.

alter table public.events
  add column postponed_at timestamptz,
  add column original_starts_at timestamptz,
  add column seller_history jsonb check (seller_history is null or jsonb_typeof(seller_history) = 'object');

comment on column public.events.seller_history is
  'Non-personal counts kept after seller data is erased: {sellerCount, locationCount, erasedAt}.';

alter table app_private.erasure_tombstones drop constraint erasure_tombstones_subject_type_check;
alter table app_private.erasure_tombstones
  add constraint erasure_tombstones_subject_type_check check (subject_type in ('account', 'event_seller_data'));

-- One row per retention job: when it last ran, how much it erased, and
-- whether anything is overdue. No personal data.
create table app_private.retention_heartbeats (
  job text primary key,
  last_run_at timestamptz not null,
  erased_count integer not null,
  overdue_count integer not null
);
alter table app_private.retention_heartbeats enable row level security;
alter table app_private.retention_heartbeats force row level security;
revoke all on app_private.retention_heartbeats from public, anon, authenticated;

-- Events whose 14-day post-event grace has passed but still hold seller data.
create function app_private.events_due_for_seller_erasure(p_now timestamptz)
returns setof uuid language sql stable set search_path = '' as $$
  select e.id from public.events e
  where (e.state = 'archived' or (e.state in ('ended', 'cancelled') and e.state_changed_at <= p_now - interval '14 days'))
    and (exists (select 1 from public.seller_participations p where p.event_id = e.id)
      or exists (select 1 from public.event_locations l where l.event_id = e.id)
      or exists (select 1 from public.seller_invites i where i.event_id = e.id));
$$;

-- Precise addresses, pins, listings, items, availability and invitations go;
-- only counts remain on the event. A tombstone stops imports or restores from
-- bringing them back.
create function app_private.erase_event_seller_data(p_event_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  seller_count integer;
  location_count integer;
begin
  select count(*) filter (where state not in ('withdrawn', 'rejected')), count(distinct location_id)
  into seller_count, location_count
  from public.seller_participations where event_id = p_event_id;
  update public.events
  set seller_history = coalesce(seller_history, jsonb_build_object('sellerCount', seller_count,
    'locationCount', location_count, 'erasedAt', clock_timestamp()))
  where id = p_event_id;
  delete from public.seller_participations where event_id = p_event_id;
  delete from public.event_locations where event_id = p_event_id;
  delete from public.seller_invites where event_id = p_event_id;
  insert into app_private.erasure_tombstones (subject_type, subject_id)
  values ('event_seller_data', p_event_id) on conflict do nothing;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (extensions.gen_random_uuid(), null, 'event.seller_data_erased', 'event', p_event_id, p_event_id,
    jsonb_build_object('sellerCount', seller_count, 'locationCount', location_count));
  return seller_count;
end;
$$;

-- Ordinary moderation records: six months after the case closed (or the
-- action, when no case), then personal evidence is deleted.
create function app_private.purge_moderation_records(p_now timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare purged integer;
begin
  delete from app_private.moderation_actions a
  where coalesce((select c.closed_at from app_private.moderation_cases c where c.id = a.case_id), a.created_at)
      <= p_now - interval '6 months'
    and not exists (select 1 from app_private.moderation_appeals ap
      where ap.action_id = a.id and (ap.state = 'pending' or ap.decided_at > p_now - interval '6 months'));
  get diagnostics purged = row_count;
  delete from app_private.moderation_cases where state = 'closed' and closed_at <= p_now - interval '6 months';
  return purged;
end;
$$;

create function app_private.enforce_event_retention_command()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  now_value timestamptz := clock_timestamp();
  event_value uuid;
  erased integer := 0;
begin
  for event_value in select * from app_private.events_due_for_seller_erasure(now_value) loop
    perform 1 from public.events where id = event_value for update;
    erased := erased + app_private.erase_event_seller_data(event_value);
  end loop;
  perform app_private.purge_moderation_records(now_value);
  insert into app_private.retention_heartbeats (job, last_run_at, erased_count, overdue_count)
  values ('event_seller_data', now_value, erased,
    (select count(*) from app_private.events_due_for_seller_erasure(now_value)))
  on conflict (job) do update set last_run_at = excluded.last_run_at, erased_count = excluded.erased_count,
    overdue_count = excluded.overdue_count;
  return erased;
end;
$$;
select cron.schedule('promenadis-enforce-event-retention', '17 * * * *',
  'select app_private.enforce_event_retention_command();');

-- Monitoring reads only this: a stale heartbeat or any overdue event is an alert.
create function public.retention_health_command()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'lastRunAt', h.last_run_at,
    'overdueCount', (select count(*) from app_private.events_due_for_seller_erasure(clock_timestamp())),
    'stale', h.last_run_at is null or h.last_run_at < clock_timestamp() - interval '3 hours')
  from (select 'event_seller_data' as job) requested
  left join app_private.retention_heartbeats h on h.job = requested.job;
$$;

-- Postponement hides every seller location at once (sellers move to
-- reconfirmation, registration pauses) and keeps a public notice.
create function app_private.apply_postponement(
  p_event_id uuid, p_public_reason text, p_actor_id uuid, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare event_row public.events;
begin
  select * into event_row from public.events where id = p_event_id;
  if event_row.state not in ('published', 'active') then raise exception 'Only published or live events can be postponed'; end if;
  if char_length(btrim(coalesce(p_public_reason, ''))) not between 3 and 500 then raise exception 'Postponement reason required'; end if;
  update public.events
  set state = 'postponed', public_notice = btrim(p_public_reason), postponed_at = clock_timestamp(),
    original_starts_at = coalesce(original_starts_at,
      (select min(starts_at) from public.event_intervals where event_id = p_event_id)),
    version = version + 1
  where id = p_event_id;
  -- An interruption after activation closes the current interval now.
  if event_row.state = 'active' then
    update public.event_intervals set ends_at = greatest(starts_at + interval '1 minute', clock_timestamp())
    where event_id = p_event_id and starts_at <= clock_timestamp() and ends_at > clock_timestamp();
  end if;
  update public.seller_participations set state = 'pending_reschedule_confirmation', version = version + 1
  where event_id = p_event_id and state = 'approved';
  delete from public.seller_live_status s using public.seller_participations p
  where s.participation_id = p.id and p.event_id = p_event_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.postponed', 'event', p_event_id, p_event_id,
    jsonb_build_object('fromState', event_row.state));
  return jsonb_build_object('state', 'postponed', 'version', event_row.version + 1);
end;
$$;

create function public.postpone_event_command(
  p_actor_id uuid, p_event_id uuid, p_expected_event_version integer, p_public_reason text,
  p_authenticated_at timestamptz, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare event_row public.events;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Only the owner or a co-host can postpone'; end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.version is distinct from p_expected_event_version then raise exception 'Event version conflict'; end if;
  return app_private.apply_postponement(p_event_id, p_public_reason, p_actor_id, p_correlation_id);
end;
$$;

-- The replacement must be set within 14 days of postponing and start no more
-- than 30 days after the original date; later dates need cancel + duplicate.
create function public.reschedule_event_command(
  p_actor_id uuid, p_event_id uuid, p_expected_event_version integer, p_starts_at timestamptz,
  p_ends_at timestamptz, p_authenticated_at timestamptz, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  registration public.event_registration_settings;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Only the owner or a co-host can reschedule'; end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.version is distinct from p_expected_event_version then raise exception 'Event version conflict'; end if;
  if event_row.state <> 'postponed' then raise exception 'Only postponed events can be rescheduled'; end if;
  if event_row.postponed_at <= clock_timestamp() - interval '14 days' then raise exception 'Reschedule window closed'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
    or p_starts_at <= clock_timestamp() + interval '1 hour'
    or p_starts_at > event_row.original_starts_at + interval '30 days'
  then raise exception 'Invalid replacement date'; end if;

  delete from public.event_intervals where event_id = p_event_id and position > 1;
  update public.event_intervals set starts_at = p_starts_at, ends_at = p_ends_at
  where event_id = p_event_id and position = 1;
  select * into registration from public.event_registration_settings where event_id = p_event_id for update;
  if registration.event_id is not null and (registration.closes_at > p_starts_at
    or registration.closes_at <= clock_timestamp()) then
    update public.event_registration_settings
    set opens_at = least(opens_at, clock_timestamp()), closes_at = p_starts_at - interval '1 hour',
      allow_during_event = false, version = version + 1
    where event_id = p_event_id;
  end if;
  update public.events set state = 'published', public_notice = null, postponed_at = null, version = version + 1
  where id = p_event_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.rescheduled', 'event', p_event_id, p_event_id,
    jsonb_build_object('pendingSellers', (select count(*) from public.seller_participations
      where event_id = p_event_id and state = 'pending_reschedule_confirmation')));
  return jsonb_build_object('state', 'published', 'version', event_row.version + 1);
end;
$$;

-- Sellers accept the new window (keeping their place, unchanged address
-- needs no new approval) or decline and free it.
create function public.confirm_reschedule_command(
  p_actor_id uuid, p_participation_id uuid, p_accept boolean, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare participation public.seller_participations;
begin
  select event_id into participation.event_id from public.seller_participations
  where id = p_participation_id and account_id = p_actor_id;
  if participation.event_id is null then raise exception 'Participation not found'; end if;
  perform 1 from public.events where id = participation.event_id for update;
  select * into participation from public.seller_participations where id = p_participation_id for update;
  if participation.state <> 'pending_reschedule_confirmation' then raise exception 'Nothing to confirm'; end if;
  if not exists (select 1 from public.events where id = participation.event_id and state = 'published') then
    raise exception 'Wait for the new date';
  end if;
  if p_accept then
    update public.seller_participations set state = 'approved', version = version + 1 where id = p_participation_id;
  else
    perform app_private.close_participation(p_participation_id, 'withdrawn', p_actor_id, null);
    perform app_private.promote_waitlisted_sellers(participation.event_id, p_correlation_id);
  end if;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'seller.reschedule_confirmed', 'seller_participation', p_participation_id,
    participation.event_id, jsonb_build_object('accepted', p_accept));
  select * into participation from public.seller_participations where id = p_participation_id;
  return app_private.seller_participation_summary(participation, true);
end;
$$;

-- Lifecycle job, now also: confirmations still open when a rescheduled event
-- starts withdraw; postponed events without a replacement cancel after 14 days.
create or replace function app_private.advance_event_lifecycle_command()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  changed integer := 0;
  step integer;
  starting uuid;
begin
  for starting in
    select e.id from public.events e
    where e.state = 'published'
      and (select min(i.starts_at) from public.event_intervals i where i.event_id = e.id) <= clock_timestamp()
  loop
    update public.seller_participations set state = 'withdrawn', location_id = null, version = version + 1,
      decision_reason = null
    where event_id = starting and state = 'pending_reschedule_confirmation';
  end loop;
  update public.events e set state = 'active', version = version + 1
  where e.state = 'published'
    and (select min(i.starts_at) from public.event_intervals i where i.event_id = e.id) <= clock_timestamp();
  get diagnostics step = row_count; changed := changed + step;
  update public.events e set state = 'ended', version = version + 1
  where e.state = 'active'
    and (select max(i.ends_at) from public.event_intervals i where i.event_id = e.id) <= clock_timestamp();
  get diagnostics step = row_count; changed := changed + step;
  update public.events
  set state = 'cancelled', version = version + 1,
    public_notice = coalesce(public_notice, 'Postponed without a new date')
  where state = 'postponed' and postponed_at <= clock_timestamp() - interval '14 days';
  get diagnostics step = row_count; changed := changed + step;
  update public.events set state = 'archived', version = version + 1
  where state in ('ended', 'cancelled') and state_changed_at <= clock_timestamp() - interval '14 days';
  get diagnostics step = row_count; changed := changed + step;
  return changed;
end;
$$;

-- Elevated admins may also postpone as a protective intervention.
create or replace function public.admin_intervene_event_command(
  p_actor_id uuid, p_auth_session_id uuid, p_event_id uuid, p_expected_event_version integer,
  p_action text, p_public_reason text, p_internal_reason text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  new_state text;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  if p_action not in ('cancel', 'end_early', 'postpone')
    or char_length(btrim(coalesce(p_internal_reason, ''))) not between 3 and 500
    or (p_action in ('cancel', 'postpone') and char_length(btrim(coalesce(p_public_reason, ''))) not between 3 and 500)
  then raise exception 'Invalid intervention'; end if;
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.id is null then raise exception 'Event not found'; end if;
  if event_row.version is distinct from p_expected_event_version then raise exception 'Event version conflict'; end if;

  if p_action = 'cancel' then
    if event_row.state not in ('published', 'postponed') then raise exception 'Only published events can be cancelled'; end if;
    new_state := 'cancelled';
    update public.events set state = new_state, public_notice = btrim(p_public_reason), version = version + 1
    where id = p_event_id;
    delete from public.event_ownership_transfers where event_id = p_event_id;
    delete from public.event_invites where event_id = p_event_id;
  elsif p_action = 'postpone' then
    if event_row.state not in ('published', 'active') then raise exception 'Only published or live events can be postponed'; end if;
    new_state := 'postponed';
    perform app_private.apply_postponement(p_event_id, p_public_reason, p_actor_id, p_correlation_id);
  else
    if event_row.state <> 'active' then raise exception 'Only active events can end early'; end if;
    new_state := 'ended';
    update public.events set state = new_state, version = version + 1 where id = p_event_id;
  end if;

  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.event_intervention', 'event', p_event_id, p_event_id,
    jsonb_build_object('action', p_action, 'fromState', event_row.state, 'reason', btrim(p_internal_reason)));
  return jsonb_build_object('state', new_state, 'version', event_row.version + 1);
end;
$$;

revoke all on function app_private.events_due_for_seller_erasure(timestamptz) from public, anon, authenticated;
revoke all on function app_private.erase_event_seller_data(uuid) from public, anon, authenticated;
revoke all on function app_private.purge_moderation_records(timestamptz) from public, anon, authenticated;
revoke all on function app_private.enforce_event_retention_command() from public, anon, authenticated;
revoke all on function public.retention_health_command() from public, anon, authenticated;
revoke all on function app_private.apply_postponement(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.postpone_event_command(uuid, uuid, integer, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.reschedule_event_command(uuid, uuid, integer, timestamptz, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.confirm_reschedule_command(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.retention_health_command() to service_role;
grant execute on function public.postpone_event_command(uuid, uuid, integer, text, timestamptz, uuid) to service_role;
grant execute on function public.reschedule_event_command(uuid, uuid, integer, timestamptz, timestamptz, timestamptz, uuid) to service_role;
grant execute on function public.confirm_reschedule_command(uuid, uuid, boolean, uuid) to service_role;
