-- Milestone 2, slice 2: geocoding budget and cache, shared physical stops,
-- address changes with reapproval, and small pin corrections by the team.

alter table public.event_locations
  add column needs_review boolean not null default false,
  drop constraint event_locations_placement_check,
  add constraint event_locations_placement_check check (placement in ('manual', 'geocoded', 'corrected'));

comment on column public.event_locations.needs_review is
  'Applicant said the entrance is separate although another active stop has the same address; the host merges or confirms.';

-- Geocoding: keyed by a hash of the normalized query, coordinates only, short TTL.
create table app_private.geocode_cache (
  query_hash text primary key check (query_hash ~ '^[a-f0-9]{64}$'),
  longitude double precision check (longitude between -180 and 180),
  latitude double precision check (latitude between -90 and 90),
  provider text not null check (provider in ('fixture', 'geoapify')),
  found boolean not null,
  expires_at timestamptz not null,
  check (found = (longitude is not null and latitude is not null))
);
create table app_private.geocode_requests (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp()
);
create index geocode_requests_account on app_private.geocode_requests (account_id, requested_at);
create index geocode_requests_event on app_private.geocode_requests (event_id, requested_at);
create index geocode_requests_time on app_private.geocode_requests (requested_at);
alter table app_private.geocode_cache enable row level security;
alter table app_private.geocode_cache force row level security;
alter table app_private.geocode_requests enable row level security;
alter table app_private.geocode_requests force row level security;
revoke all on app_private.geocode_cache, app_private.geocode_requests from public, anon, authenticated;

create function public.read_geocode_cache_command(p_query_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('found', found, 'longitude', longitude, 'latitude', latitude, 'provider', provider)
  from app_private.geocode_cache where query_hash = p_query_hash and expires_at > clock_timestamp();
$$;

-- Ceilings from ARCHITECTURE: 10/min and 30/day per account, 750/day per
-- event, 2,500/day platform-wide. At a ceiling the seller places the pin by hand.
create function public.reserve_geocode_request_command(p_actor_id uuid, p_event_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare now_value timestamptz := clock_timestamp();
begin
  if not exists (select 1 from public.events where id = p_event_id and state not in ('ended', 'cancelled', 'archived'))
  then raise exception 'Event not found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(hashtext('promenadis-geocode-budget'));
  if (select count(*) from app_private.geocode_requests where account_id = p_actor_id and requested_at > now_value - interval '1 minute') >= 10
    or (select count(*) from app_private.geocode_requests where account_id = p_actor_id and requested_at > now_value - interval '1 day') >= 30
    or (select count(*) from app_private.geocode_requests where event_id = p_event_id and requested_at > now_value - interval '1 day') >= 750
    or (select count(*) from app_private.geocode_requests where requested_at > now_value - interval '1 day') >= 2500
  then raise exception 'Geocoding limit reached'; end if;
  insert into app_private.geocode_requests (account_id, event_id, requested_at) values (p_actor_id, p_event_id, now_value);
end;
$$;

create function public.store_geocode_cache_command(
  p_query_hash text, p_provider text, p_longitude double precision, p_latitude double precision
)
returns void language sql security definer set search_path = '' as $$
  insert into app_private.geocode_cache (query_hash, longitude, latitude, provider, found, expires_at)
  values (p_query_hash, p_longitude, p_latitude, p_provider, p_longitude is not null, clock_timestamp() + interval '7 days')
  on conflict (query_hash) do update set longitude = excluded.longitude, latitude = excluded.latitude,
    provider = excluded.provider, found = excluded.found, expires_at = excluded.expires_at;
$$;

create function app_private.purge_geocode_records_command()
returns void language sql security definer set search_path = '' as $$
  delete from app_private.geocode_cache where expires_at <= clock_timestamp();
  delete from app_private.geocode_requests where requested_at <= clock_timestamp() - interval '2 days';
$$;
select cron.schedule('promenadis-purge-geocode-records', '41 * * * *',
  'select app_private.purge_geocode_records_command();');

-- Team pin corrections keep before/after points with the location only, so
-- they are erased with it; the audit records distance and reason.
create table app_private.location_pin_corrections (
  id uuid primary key default extensions.gen_random_uuid(),
  location_id uuid not null references public.event_locations (id) on delete cascade,
  before_point extensions.geometry(Point, 4326) not null,
  after_point extensions.geometry(Point, 4326) not null,
  distance_meters double precision not null check (distance_meters between 0 and 25),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  actor_account_id uuid references public.profiles (account_id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
alter table app_private.location_pin_corrections enable row level security;
alter table app_private.location_pin_corrections force row level security;
revoke all on app_private.location_pin_corrections from public, anon, authenticated;

-- Places (or re-places) one participation. An exact normalized-address match
-- with another active stop must be answered: shared entrance joins that stop;
-- a separate entrance creates a new stop flagged for host review.
create function app_private.place_participation_location(
  p_event_id uuid, p_exclude_participation_id uuid, p_address_line text, p_postal_code text,
  p_locality text, p_longitude double precision, p_latitude double precision, p_placement text,
  p_shares_entrance boolean
)
returns table (placed_location_id uuid, placed_inside boolean, placed_shared boolean)
language plpgsql security definer set search_path = '' as $$
declare
  boundary_geometry extensions.geometry;
  point_geometry extensions.geometry;
  normalized_postal text := nullif(btrim(coalesce(p_postal_code, '')), '');
  normalized text;
  existing public.event_locations;
begin
  if char_length(btrim(coalesce(p_address_line, ''))) not between 3 and 200
    or (normalized_postal is not null and normalized_postal !~ '^[0-9]{3} ?[0-9]{2}$')
    or char_length(btrim(coalesce(p_locality, ''))) > 100
    or p_longitude is null or p_latitude is null
    or p_longitude not between -180 and 180 or p_latitude not between -90 and 90
    or p_placement not in ('manual', 'geocoded')
  then raise exception 'Invalid application'; end if;
  select boundary into boundary_geometry from public.event_boundaries where event_id = p_event_id;
  if boundary_geometry is null then raise exception 'Event area not ready'; end if;
  normalized := app_private.normalize_address(p_address_line, normalized_postal);

  select l.* into existing from public.event_locations l
  where l.event_id = p_event_id and l.normalized_address = normalized
    and exists (select 1 from public.seller_participations p
      where p.location_id = l.id and p.id is distinct from p_exclude_participation_id)
  order by l.created_at limit 1;
  if existing.id is not null and p_shares_entrance is null then raise exception 'Shared entrance question'; end if;
  if existing.id is not null and p_shares_entrance then
    return query select existing.id, existing.inside_boundary, true;
    return;
  end if;

  point_geometry := extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326);
  return query
  insert into public.event_locations (event_id, point, address_line, postal_code, locality,
    normalized_address, placement, inside_boundary, needs_review)
  values (p_event_id, point_geometry, btrim(p_address_line), normalized_postal,
    nullif(btrim(coalesce(p_locality, '')), ''), normalized, p_placement,
    extensions.st_covers(boundary_geometry, point_geometry), existing.id is not null)
  returning id, inside_boundary, false;
end;
$$;

create or replace function app_private.seller_participation_summary(
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
        'id', l.id,
        'addressLine', l.address_line, 'postalCode', l.postal_code, 'locality', l.locality,
        'longitude', extensions.st_x(l.point), 'latitude', extensions.st_y(l.point),
        'placement', l.placement, 'insideBoundary', l.inside_boundary, 'needsReview', l.needs_review,
        'sellerCount', (select count(*) from public.seller_participations s where s.location_id = l.id))
      from public.event_locations l where l.id = p_participation.location_id) end);
$$;

drop function public.apply_to_event_command(uuid, uuid, text, text, text, text, double precision, double precision, boolean, uuid);
create function public.apply_to_event_command(
  p_actor_id uuid, p_event_id uuid, p_display_name text, p_address_line text, p_postal_code text,
  p_locality text, p_longitude double precision, p_latitude double precision, p_placement text,
  p_shares_entrance boolean, p_right_to_use_attested boolean, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  registration public.event_registration_settings;
  placed record;
  initial_state text;
  participation public.seller_participations;
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
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 80 then raise exception 'Invalid application'; end if;

  select * into placed from app_private.place_participation_location(p_event_id, null, p_address_line,
    p_postal_code, p_locality, p_longitude, p_latitude, p_placement, p_shares_entrance);
  initial_state := case
    when placed.placed_inside and event_row.admission_mode = 'auto_inside' then
      case when app_private.seller_places_available(p_event_id) then 'approved' else 'waitlisted' end
    else 'pending' end;
  insert into public.seller_participations (event_id, account_id, location_id, state, display_name,
    geographic_exception, address_attested_at)
  values (p_event_id, p_actor_id, placed.placed_location_id, initial_state, btrim(p_display_name), not placed.placed_inside,
    clock_timestamp())
  returning * into participation;

  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'seller.applied', 'seller_participation', participation.id, p_event_id,
    jsonb_build_object('state', initial_state, 'insideBoundary', placed.placed_inside, 'sharedStop', placed.placed_shared,
      'placement', p_placement, 'admissionMode', event_row.admission_mode));
  return app_private.seller_participation_summary(participation, true);
end;
$$;

-- Before approval the new address follows normal admission. After approval
-- (or during review) it always unpublishes and needs the host again.
create function public.change_participation_address_command(
  p_actor_id uuid, p_participation_id uuid, p_expected_version integer, p_address_line text,
  p_postal_code text, p_locality text, p_longitude double precision, p_latitude double precision,
  p_placement text, p_shares_entrance boolean, p_right_to_use_attested boolean, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  participation public.seller_participations;
  event_row public.events;
  placed record;
  next_state text;
begin
  select event_id into participation.event_id from public.seller_participations
  where id = p_participation_id and account_id = p_actor_id;
  if participation.event_id is null then raise exception 'Participation not found'; end if;
  select * into event_row from public.events where id = participation.event_id for update;
  select * into participation from public.seller_participations where id = p_participation_id for update;
  if participation.version is distinct from p_expected_version then raise exception 'Participation version conflict'; end if;
  if event_row.state in ('ended', 'cancelled', 'archived') then raise exception 'Event is closed'; end if;
  if participation.state not in ('pending', 'waitlisted', 'approved', 'pending_address_change') then
    raise exception 'Address cannot change now';
  end if;
  if p_right_to_use_attested is not true then raise exception 'Right to use the location must be confirmed'; end if;

  select * into placed from app_private.place_participation_location(participation.event_id, p_participation_id,
    p_address_line, p_postal_code, p_locality, p_longitude, p_latitude, p_placement, p_shares_entrance);
  next_state := case
    when participation.state in ('approved', 'pending_address_change') then 'pending_address_change'
    when participation.state = 'pending' and placed.placed_inside and event_row.admission_mode = 'auto_inside' then
      case when app_private.seller_places_available(participation.event_id) then 'approved' else 'waitlisted' end
    else participation.state end;
  update public.seller_participations
  set location_id = placed.placed_location_id, state = next_state, geographic_exception = not placed.placed_inside,
    address_attested_at = clock_timestamp(), version = version + 1
  where id = p_participation_id
  returning * into participation;

  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'seller.address_changed', 'seller_participation', p_participation_id,
    participation.event_id, jsonb_build_object('state', next_state, 'insideBoundary', placed.placed_inside,
      'sharedStop', placed.placed_shared, 'eventState', event_row.state));
  return app_private.seller_participation_summary(participation, true);
end;
$$;

-- Same decisions as before; approving a reviewed address change keeps the
-- place it already holds, so it needs no free place.
create or replace function public.decide_seller_participation_command(
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
    if participation.state not in ('pending', 'waitlisted', 'pending_address_change') then
      raise exception 'Invalid seller decision';
    end if;
    if participation.state <> 'pending_address_change' and not app_private.seller_places_available(participation.event_id) then
      raise exception 'Seller places are full';
    end if;
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

-- Host location review: merge two stops that share an actual entrance, split
-- one seller onto its own stop, or confirm that a flagged stop is separate.
create function public.review_event_location_command(
  p_actor_id uuid, p_event_id uuid, p_action text, p_location_id uuid, p_target_location_id uuid,
  p_participation_id uuid, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  source public.event_locations;
  target public.event_locations;
  new_location_id uuid;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Actor cannot review locations'; end if;
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.state in ('ended', 'cancelled', 'archived') then raise exception 'Event is closed'; end if;
  select * into source from public.event_locations where id = p_location_id and event_id = p_event_id for update;
  if source.id is null then raise exception 'Location not found'; end if;

  if p_action = 'merge' then
    select * into target from public.event_locations
    where id = p_target_location_id and event_id = p_event_id and id <> source.id for update;
    if target.id is null then raise exception 'Location not found'; end if;
    update public.seller_participations set location_id = target.id, version = version + 1
    where location_id = source.id;
    update public.event_locations set needs_review = false where id = target.id;
  elsif p_action = 'split' then
    if not exists (select 1 from public.seller_participations
        where id = p_participation_id and location_id = source.id)
      or (select count(*) from public.seller_participations where location_id = source.id) < 2
    then raise exception 'Location cannot be split'; end if;
    insert into public.event_locations (event_id, point, address_line, postal_code, locality,
      normalized_address, placement, inside_boundary)
    select event_id, point, address_line, postal_code, locality, normalized_address, placement, inside_boundary
    from public.event_locations where id = source.id
    returning id into new_location_id;
    update public.seller_participations set location_id = new_location_id, version = version + 1
    where id = p_participation_id;
  elsif p_action = 'confirm_separate' then
    update public.event_locations set needs_review = false where id = source.id;
  else
    raise exception 'Invalid location review';
  end if;

  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'location.reviewed', 'event_location', source.id, p_event_id,
    jsonb_build_object('action', p_action));
  return public.list_event_sellers_command(p_actor_id, p_event_id);
end;
$$;

-- An obvious same-address mapping error, at most 25 metres, by the team.
create function public.correct_location_pin_command(
  p_actor_id uuid, p_location_id uuid, p_longitude double precision, p_latitude double precision,
  p_reason text, p_authenticated_at timestamptz, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  location_row public.event_locations;
  event_row public.events;
  after_point extensions.geometry;
  distance double precision;
begin
  select * into location_row from public.event_locations where id = p_location_id;
  if location_row.id is null or not exists (select 1 from public.event_memberships
    where event_id = location_row.event_id and account_id = p_actor_id and role in ('owner', 'co_host', 'moderator'))
  then raise exception 'Location not found'; end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into event_row from public.events where id = location_row.event_id for update;
  if event_row.state in ('ended', 'cancelled', 'archived') then raise exception 'Event is closed'; end if;
  select * into location_row from public.event_locations where id = p_location_id for update;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500
    or p_longitude is null or p_latitude is null
  then raise exception 'Invalid pin correction'; end if;
  after_point := extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326);
  distance := extensions.st_distance(location_row.point::extensions.geography, after_point::extensions.geography);
  if distance > 25 then raise exception 'Pin correction too large'; end if;

  insert into app_private.location_pin_corrections (location_id, before_point, after_point, distance_meters, reason, actor_account_id)
  values (p_location_id, location_row.point, after_point, distance, btrim(p_reason), p_actor_id);
  update public.event_locations
  set point = after_point, placement = 'corrected',
    inside_boundary = extensions.st_covers((select boundary from public.event_boundaries where event_id = location_row.event_id), after_point)
  where id = p_location_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'location.pin_corrected', 'event_location', p_location_id, location_row.event_id,
    jsonb_build_object('distanceMeters', round(distance::numeric, 1), 'eventState', event_row.state));
  return public.list_event_sellers_command(p_actor_id, location_row.event_id);
end;
$$;

revoke all on function public.read_geocode_cache_command(text) from public, anon, authenticated;
revoke all on function public.reserve_geocode_request_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.store_geocode_cache_command(text, text, double precision, double precision) from public, anon, authenticated;
revoke all on function app_private.purge_geocode_records_command() from public, anon, authenticated;
revoke all on function app_private.place_participation_location(uuid, uuid, text, text, text, double precision, double precision, text, boolean) from public, anon, authenticated;
revoke all on function public.apply_to_event_command(uuid, uuid, text, text, text, text, double precision, double precision, text, boolean, boolean, uuid) from public, anon, authenticated;
revoke all on function public.change_participation_address_command(uuid, uuid, integer, text, text, text, double precision, double precision, text, boolean, boolean, uuid) from public, anon, authenticated;
revoke all on function public.review_event_location_command(uuid, uuid, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.correct_location_pin_command(uuid, uuid, double precision, double precision, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.read_geocode_cache_command(text) to service_role;
grant execute on function public.reserve_geocode_request_command(uuid, uuid) to service_role;
grant execute on function public.store_geocode_cache_command(text, text, double precision, double precision) to service_role;
grant execute on function public.apply_to_event_command(uuid, uuid, text, text, text, text, double precision, double precision, text, boolean, boolean, uuid) to service_role;
grant execute on function public.change_participation_address_command(uuid, uuid, integer, text, text, text, double precision, double precision, text, boolean, boolean, uuid) to service_role;
grant execute on function public.review_event_location_command(uuid, uuid, text, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.correct_location_pin_command(uuid, uuid, double precision, double precision, text, timestamptz, uuid) to service_role;
