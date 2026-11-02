-- Milestone 2, slice 1: seller applications and admission.
-- A seller applies with a private address, a manually placed pin and an
-- attestation of the right to use the location. Admission depends on the
-- event's mode, the boundary and the seller-place entitlement. Each
-- application gets its own physical location here; shared-location merges,
-- address changes and geocoding follow in later slices.

alter table public.events
  add column admission_mode text not null default 'host_approval'
    check (admission_mode in ('auto_inside', 'host_approval', 'invite_only')),
  add column waitlist_promotion_paused boolean not null default false;

-- Platform-controlled; not editable by the event team.
create table public.event_entitlements (
  event_id uuid primary key references public.events (id) on delete cascade,
  seller_limit integer not null default 30 check (seller_limit between 0 and 30),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.event_entitlements (event_id) select id from public.events;

create function app_private.create_default_event_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.event_entitlements (event_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger events_create_default_entitlement
after insert on public.events
for each row execute function app_private.create_default_event_entitlement();

-- Precise address and pin: private to the seller and the event team until
-- publication exists (Milestone 3).
create table public.event_locations (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  point extensions.geometry(Point, 4326) not null,
  address_line text not null check (address_line = btrim(address_line) and char_length(address_line) between 3 and 200),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{3} ?[0-9]{2}$'),
  locality text check (locality is null or (locality = btrim(locality) and char_length(locality) between 1 and 100)),
  normalized_address text not null,
  placement text not null check (placement in ('manual', 'geocoded')),
  inside_boundary boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index event_locations_event on public.event_locations (event_id);
create index event_locations_normalized on public.event_locations (event_id, normalized_address);

create table public.seller_participations (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  location_id uuid references public.event_locations (id) on delete cascade,
  state text not null check (state in (
    'pending', 'waitlisted', 'approved', 'withdrawn', 'rejected', 'suspended', 'revoked',
    'pending_address_change', 'pending_reschedule_confirmation')),
  display_name text not null check (display_name = btrim(display_name) and char_length(display_name) between 1 and 80),
  geographic_exception boolean not null,
  address_attested_at timestamptz not null,
  applied_at timestamptz not null default clock_timestamp(),
  state_changed_at timestamptz not null default clock_timestamp(),
  decided_by_account_id uuid references public.profiles (account_id) on delete set null,
  decision_reason text check (decision_reason is null or char_length(btrim(decision_reason)) between 3 and 500),
  version integer not null default 1 check (version > 0),
  constraint seller_participations_one_per_event unique (event_id, account_id),
  -- Closed participations keep no address.
  constraint seller_participations_location_matches_state check (
    (state in ('withdrawn', 'rejected', 'revoked')) = (location_id is null))
);
create index seller_participations_event_state on public.seller_participations (event_id, state, applied_at);
create index seller_participations_account on public.seller_participations (account_id, applied_at);

alter table public.event_entitlements enable row level security;
alter table public.event_entitlements force row level security;
alter table public.event_locations enable row level security;
alter table public.event_locations force row level security;
alter table public.seller_participations enable row level security;
alter table public.seller_participations force row level security;
revoke all on public.event_entitlements, public.event_locations, public.seller_participations
  from public, anon, authenticated;
grant select, insert, update, delete on public.event_entitlements, public.event_locations,
  public.seller_participations to service_role;

create trigger event_locations_touch_updated_at
before update on public.event_locations
for each row execute function app_private.touch_updated_at();

-- Same table as packages/domain seller-admission.ts.
create function app_private.enforce_participation_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.state = old.state then return new; end if;
  if not (
    (old.state = 'pending' and new.state in ('approved', 'waitlisted', 'rejected', 'withdrawn'))
    or (old.state = 'waitlisted' and new.state in ('approved', 'rejected', 'withdrawn'))
    or (old.state = 'approved' and new.state in ('withdrawn', 'revoked', 'suspended',
      'pending_address_change', 'pending_reschedule_confirmation'))
    or (old.state = 'suspended' and new.state in ('approved', 'withdrawn', 'revoked'))
    or (old.state = 'pending_address_change' and new.state in ('approved', 'withdrawn', 'revoked'))
    or (old.state = 'pending_reschedule_confirmation' and new.state in ('approved', 'withdrawn'))
  ) then
    raise exception 'Participation transition % -> % is not allowed', old.state, new.state;
  end if;
  new.state_changed_at := clock_timestamp();
  return new;
end;
$$;
create trigger seller_participations_enforce_transition
before update of state on public.seller_participations
for each row execute function app_private.enforce_participation_transition();

-- A location without participations holds an address nobody needs.
create function app_private.delete_unused_event_location()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.location_id is not null
    and (tg_op = 'DELETE' or new.location_id is distinct from old.location_id)
    and not exists (select 1 from public.seller_participations where location_id = old.location_id)
  then
    delete from public.event_locations where id = old.location_id;
  end if;
  return null;
end;
$$;
create trigger seller_participations_delete_unused_location
after update of location_id or delete on public.seller_participations
for each row execute function app_private.delete_unused_event_location();

create function app_private.normalize_address(p_address_line text, p_postal_code text)
returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(coalesce(p_address_line, '')), '\s+', ' ', 'g'))
    || '|' || replace(coalesce(p_postal_code, ''), ' ', '');
$$;

create function app_private.seller_places_used(p_event_id uuid)
returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from public.seller_participations
  where event_id = p_event_id and state in ('approved', 'suspended', 'pending_address_change');
$$;

create function app_private.seller_places_available(p_event_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select app_private.seller_places_used(p_event_id)
    < (select seller_limit from public.event_entitlements where event_id = p_event_id);
$$;

-- Closing a participation erases its address in the same statement.
create function app_private.close_participation(
  p_participation_id uuid, p_state text, p_actor_id uuid, p_reason text
)
returns void language sql security definer set search_path = '' as $$
  update public.seller_participations
  set state = p_state, location_id = null, decided_by_account_id = p_actor_id,
    decision_reason = nullif(btrim(coalesce(p_reason, '')), ''), version = version + 1
  where id = p_participation_id;
$$;

-- Automatic events promote the earliest inside-boundary waitlisted seller
-- whenever a place opens before the event starts. Callers hold the event lock.
create function app_private.promote_waitlisted_sellers(p_event_id uuid, p_correlation_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  candidate public.seller_participations;
  promoted integer := 0;
begin
  select * into event_row from public.events where id = p_event_id;
  if event_row.admission_mode <> 'auto_inside' or event_row.waitlist_promotion_paused
    or event_row.state not in ('draft', 'published')
    or (select min(starts_at) from public.event_intervals where event_id = p_event_id) <= clock_timestamp()
  then return 0; end if;
  loop
    exit when not app_private.seller_places_available(p_event_id);
    select * into candidate from public.seller_participations
    where event_id = p_event_id and state = 'waitlisted' and not geographic_exception
    order by applied_at, id limit 1 for update;
    exit when candidate.id is null;
    update public.seller_participations set state = 'approved', version = version + 1, decided_by_account_id = null
    where id = candidate.id;
    insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
    values (p_correlation_id, null, 'seller.promoted', 'seller_participation', candidate.id, p_event_id, '{}'::jsonb);
    promoted := promoted + 1;
    candidate := null;
  end loop;
  return promoted;
end;
$$;

create function app_private.seller_participation_summary(
  p_participation public.seller_participations, p_include_address boolean
)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_participation.id,
    'eventId', p_participation.event_id,
    'state', p_participation.state,
    'displayName', p_participation.display_name,
    'geographicException', p_participation.geographic_exception,
    'appliedAt', p_participation.applied_at,
    'version', p_participation.version,
    'decisionReason', case when p_participation.state in ('rejected', 'revoked') then p_participation.decision_reason end,
    'location', case when p_include_address then (
      select jsonb_build_object(
        'addressLine', l.address_line, 'postalCode', l.postal_code, 'locality', l.locality,
        'longitude', extensions.st_x(l.point), 'latitude', extensions.st_y(l.point),
        'placement', l.placement, 'insideBoundary', l.inside_boundary)
      from public.event_locations l where l.id = p_participation.location_id) end);
$$;

-- What a prospective seller may see about an event they hold the link to.
create function public.get_event_for_seller_command(p_actor_id uuid, p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  registration public.event_registration_settings;
  own public.seller_participations;
  now_value timestamptz := clock_timestamp();
begin
  select * into event_row from public.events where id = p_event_id;
  if event_row.id is null or event_row.state in ('archived') then raise exception 'Event not found'; end if;
  select * into registration from public.event_registration_settings where event_id = p_event_id;
  select * into own from public.seller_participations where event_id = p_event_id and account_id = p_actor_id;
  return jsonb_build_object(
    'id', event_row.id,
    'title', event_row.title,
    'description', event_row.description,
    'organizerDisplayName', (select display_name from public.organizer_profiles where id = event_row.organizer_profile_id),
    'state', event_row.state,
    'timezone', event_row.timezone,
    'admissionMode', event_row.admission_mode,
    'startsAt', (select min(starts_at) from public.event_intervals where event_id = p_event_id),
    'endsAt', (select max(ends_at) from public.event_intervals where event_id = p_event_id),
    'registrationOpen', app_private.seller_registration_open(event_row, registration, now_value),
    'registrationClosesAt', registration.closes_at,
    'boundary', (select extensions.st_asgeojson(b.boundary)::jsonb -> 'coordinates' -> 0
      from public.event_boundaries b where b.event_id = p_event_id),
    'placesFull', not app_private.seller_places_available(p_event_id),
    'participation', case when own.id is null then null
      else app_private.seller_participation_summary(own, true) end);
end;
$$;

create function app_private.seller_registration_open(
  p_event public.events, p_registration public.event_registration_settings, p_now timestamptz
)
returns boolean language sql stable set search_path = '' as $$
  select p_registration.event_id is not null
    and p_event.admission_mode <> 'invite_only'
    and p_now >= p_registration.opens_at and p_now < p_registration.closes_at
    and (p_event.state in ('draft', 'published')
      or (p_event.state = 'active' and p_registration.allow_during_event));
$$;

create function public.apply_to_event_command(
  p_actor_id uuid, p_event_id uuid, p_display_name text, p_address_line text, p_postal_code text,
  p_locality text, p_longitude double precision, p_latitude double precision,
  p_right_to_use_attested boolean, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  registration public.event_registration_settings;
  boundary_geometry extensions.geometry;
  point_geometry extensions.geometry;
  inside boolean;
  location_id uuid;
  initial_state text;
  participation public.seller_participations;
  normalized_postal text := nullif(btrim(coalesce(p_postal_code, '')), '');
begin
  if not exists (select 1 from public.profiles where account_id = p_actor_id) then
    raise exception 'Account profile not found';
  end if;
  -- One lock per event serializes every capacity decision.
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.id is null then raise exception 'Event not found'; end if;
  select * into registration from public.event_registration_settings where event_id = p_event_id;
  if event_row.admission_mode = 'invite_only' then raise exception 'Event is invite-only'; end if;
  if not app_private.seller_registration_open(event_row, registration, clock_timestamp()) then
    raise exception 'Registration is closed';
  end if;
  if exists (select 1 from public.seller_participations where event_id = p_event_id and account_id = p_actor_id) then
    raise exception 'Already applied';
  end if;
  if (select count(*) from public.seller_participations
      where account_id = p_actor_id and applied_at > clock_timestamp() - interval '1 day') >= 10 then
    raise exception 'Application limit reached';
  end if;
  if p_right_to_use_attested is not true then raise exception 'Right to use the location must be confirmed'; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 80
    or char_length(btrim(coalesce(p_address_line, ''))) not between 3 and 200
    or (normalized_postal is not null and normalized_postal !~ '^[0-9]{3} ?[0-9]{2}$')
    or char_length(btrim(coalesce(p_locality, ''))) > 100
    or p_longitude is null or p_latitude is null
    or p_longitude not between -180 and 180 or p_latitude not between -90 and 90
  then raise exception 'Invalid application'; end if;
  select boundary into boundary_geometry from public.event_boundaries where event_id = p_event_id;
  if boundary_geometry is null then raise exception 'Event area not ready'; end if;

  point_geometry := extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326);
  inside := extensions.st_covers(boundary_geometry, point_geometry);
  initial_state := case
    when inside and event_row.admission_mode = 'auto_inside' then
      case when app_private.seller_places_available(p_event_id) then 'approved' else 'waitlisted' end
    else 'pending' end;

  insert into public.event_locations (event_id, point, address_line, postal_code, locality,
    normalized_address, placement, inside_boundary)
  values (p_event_id, point_geometry, btrim(p_address_line), normalized_postal,
    nullif(btrim(coalesce(p_locality, '')), ''),
    app_private.normalize_address(p_address_line, normalized_postal), 'manual', inside)
  returning id into location_id;
  insert into public.seller_participations (event_id, account_id, location_id, state, display_name,
    geographic_exception, address_attested_at)
  values (p_event_id, p_actor_id, location_id, initial_state, btrim(p_display_name), not inside, clock_timestamp())
  returning * into participation;

  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'seller.applied', 'seller_participation', participation.id, p_event_id,
    jsonb_build_object('state', initial_state, 'insideBoundary', inside, 'admissionMode', event_row.admission_mode));
  return app_private.seller_participation_summary(participation, true);
end;
$$;

create function public.list_my_participations_command(p_actor_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
      app_private.seller_participation_summary(p, false)
        || jsonb_build_object('eventTitle', e.title, 'eventState', e.state, 'timezone', e.timezone,
          'startsAt', (select min(starts_at) from public.event_intervals where event_id = e.id))
      order by p.applied_at desc), '[]'::jsonb)
  from public.seller_participations p join public.events e on e.id = p.event_id
  where p.account_id = p_actor_id;
$$;

create function public.withdraw_participation_command(
  p_actor_id uuid, p_participation_id uuid, p_expected_version integer, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  participation public.seller_participations;
begin
  select event_id into participation.event_id from public.seller_participations
  where id = p_participation_id and account_id = p_actor_id;
  if participation.event_id is null then raise exception 'Participation not found'; end if;
  perform 1 from public.events where id = participation.event_id for update;
  select * into participation from public.seller_participations where id = p_participation_id for update;
  if participation.version is distinct from p_expected_version then raise exception 'Participation version conflict'; end if;
  if participation.state in ('withdrawn', 'rejected', 'revoked') then raise exception 'Participation already closed'; end if;
  perform app_private.close_participation(p_participation_id, 'withdrawn', p_actor_id, null);
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'seller.withdrew', 'seller_participation', p_participation_id,
    participation.event_id, jsonb_build_object('fromState', participation.state));
  perform app_private.promote_waitlisted_sellers(participation.event_id, p_correlation_id);
  select * into participation from public.seller_participations where id = p_participation_id;
  return app_private.seller_participation_summary(participation, true);
end;
$$;

create function public.list_event_sellers_command(p_actor_id uuid, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare event_row public.events;
begin
  if not exists (select 1 from public.event_memberships where event_id = p_event_id and account_id = p_actor_id)
  then raise exception 'Actor is not an event team member'; end if;
  select * into event_row from public.events where id = p_event_id;
  return jsonb_build_object(
    'eventId', p_event_id,
    'eventVersion', event_row.version,
    'admissionMode', event_row.admission_mode,
    'waitlistPromotionPaused', event_row.waitlist_promotion_paused,
    'sellerLimit', (select seller_limit from public.event_entitlements where event_id = p_event_id),
    'placesUsed', app_private.seller_places_used(p_event_id),
    'locationCount', (select count(distinct location_id) from public.seller_participations
      where event_id = p_event_id and state in ('approved', 'suspended', 'pending_address_change')),
    'sellers', coalesce((select jsonb_agg(app_private.seller_participation_summary(p, true)
        order by p.applied_at, p.id)
      from public.seller_participations p where p.event_id = p_event_id), '[]'::jsonb));
end;
$$;

-- Host decisions. Approval checks the entitlement under the event lock and
-- refuses rather than over-filling; revocation frees a place.
create function public.decide_seller_participation_command(
  p_actor_id uuid, p_participation_id uuid, p_expected_version integer, p_decision text,
  p_reason text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  participation public.seller_participations;
  event_row public.events;
begin
  select event_id into participation.event_id from public.seller_participations where id = p_participation_id;
  if participation.event_id is null or not exists (select 1 from public.event_memberships
    where event_id = participation.event_id and account_id = p_actor_id and role in ('owner', 'co_host', 'moderator'))
  then raise exception 'Participation not found'; end if;
  select * into event_row from public.events where id = participation.event_id for update;
  select * into participation from public.seller_participations where id = p_participation_id for update;
  if participation.version is distinct from p_expected_version then raise exception 'Participation version conflict'; end if;
  if event_row.state in ('ended', 'cancelled', 'archived') then raise exception 'Event is closed'; end if;
  if participation.account_id = p_actor_id then raise exception 'Cannot decide own participation'; end if;

  if p_decision = 'approve' then
    if participation.state not in ('pending', 'waitlisted') then raise exception 'Invalid seller decision'; end if;
    if not app_private.seller_places_available(participation.event_id) then raise exception 'Seller places are full'; end if;
    update public.seller_participations set state = 'approved', decided_by_account_id = p_actor_id,
      decision_reason = null, version = version + 1 where id = p_participation_id;
  elsif p_decision = 'waitlist' then
    if participation.state <> 'pending' then raise exception 'Invalid seller decision'; end if;
    update public.seller_participations set state = 'waitlisted', decided_by_account_id = p_actor_id,
      version = version + 1 where id = p_participation_id;
  elsif p_decision in ('reject', 'revoke') then
    if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500
      or (p_decision = 'reject' and participation.state not in ('pending', 'waitlisted'))
      or (p_decision = 'revoke' and participation.state not in ('approved', 'suspended', 'pending_address_change'))
    then raise exception 'Invalid seller decision'; end if;
    perform app_private.close_participation(p_participation_id, case p_decision when 'reject' then 'rejected' else 'revoked' end,
      p_actor_id, p_reason);
  else
    raise exception 'Invalid seller decision';
  end if;

  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'seller.decided', 'seller_participation', p_participation_id,
    participation.event_id, jsonb_build_object('decision', p_decision, 'fromState', participation.state));
  if p_decision = 'revoke' then
    perform app_private.promote_waitlisted_sellers(participation.event_id, p_correlation_id);
  end if;
  select * into participation from public.seller_participations where id = p_participation_id;
  return app_private.seller_participation_summary(participation, true);
end;
$$;

create function public.update_event_admission_command(
  p_actor_id uuid, p_event_id uuid, p_expected_version integer, p_admission_mode text,
  p_waitlist_promotion_paused boolean, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare event_row public.events;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Actor cannot manage admission'; end if;
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.state not in ('draft', 'published') then raise exception 'Admission can no longer change'; end if;
  if event_row.version is distinct from p_expected_version then raise exception 'Event version conflict'; end if;
  if p_admission_mode not in ('auto_inside', 'host_approval', 'invite_only') or p_waitlist_promotion_paused is null then
    raise exception 'Invalid admission settings';
  end if;
  update public.events set admission_mode = p_admission_mode,
    waitlist_promotion_paused = p_waitlist_promotion_paused, version = version + 1
  where id = p_event_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.admission_updated', 'event', p_event_id, p_event_id,
    jsonb_build_object('admissionMode', p_admission_mode, 'promotionPaused', p_waitlist_promotion_paused));
  -- Switching to automatic (or unpausing) can open waiting places at once.
  perform app_private.promote_waitlisted_sellers(p_event_id, p_correlation_id);
  return public.list_event_sellers_command(p_actor_id, p_event_id);
end;
$$;

revoke all on function app_private.create_default_event_entitlement() from public, anon, authenticated;
revoke all on function app_private.enforce_participation_transition() from public, anon, authenticated;
revoke all on function app_private.delete_unused_event_location() from public, anon, authenticated;
revoke all on function app_private.normalize_address(text, text) from public, anon, authenticated;
revoke all on function app_private.seller_places_used(uuid) from public, anon, authenticated;
revoke all on function app_private.seller_places_available(uuid) from public, anon, authenticated;
revoke all on function app_private.close_participation(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function app_private.promote_waitlisted_sellers(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.seller_participation_summary(public.seller_participations, boolean) from public, anon, authenticated;
revoke all on function app_private.seller_registration_open(public.events, public.event_registration_settings, timestamptz) from public, anon, authenticated;
revoke all on function public.get_event_for_seller_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.apply_to_event_command(uuid, uuid, text, text, text, text, double precision, double precision, boolean, uuid) from public, anon, authenticated;
revoke all on function public.list_my_participations_command(uuid) from public, anon, authenticated;
revoke all on function public.withdraw_participation_command(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.list_event_sellers_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.decide_seller_participation_command(uuid, uuid, integer, text, text, uuid) from public, anon, authenticated;
revoke all on function public.update_event_admission_command(uuid, uuid, integer, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.get_event_for_seller_command(uuid, uuid) to service_role;
grant execute on function public.apply_to_event_command(uuid, uuid, text, text, text, text, double precision, double precision, boolean, uuid) to service_role;
grant execute on function public.list_my_participations_command(uuid) to service_role;
grant execute on function public.withdraw_participation_command(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.list_event_sellers_command(uuid, uuid) to service_role;
grant execute on function public.decide_seller_participation_command(uuid, uuid, integer, text, text, uuid) to service_role;
grant execute on function public.update_event_admission_command(uuid, uuid, integer, text, boolean, uuid) to service_role;

comment on table public.event_locations is
  'Private precise address and pin for one physical stop. Deleted when its last participation closes.';
comment on table public.seller_participations is
  'One account per event. Approved, suspended and pending_address_change consume a seller place.';
