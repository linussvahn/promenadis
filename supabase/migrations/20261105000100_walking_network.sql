-- Milestone 4, slice 1: walking-network builds, host preview, overrides and
-- the route-readiness gate.
--
-- A build compiles OpenStreetMap street data for the buffered event boundary
-- into an immutable public package (street graph and attribution only; never
-- seller data) plus private diagnostics: snap distance, connected component
-- and status per location, detour outliers and warnings. The compiler runs
-- outside the database (locally inside the BFF against a checksum-verified
-- fixture; a pinned container in hosted environments) and reports back
-- through service-only commands. Owners and co-hosts confirm a preview before
-- it becomes the event's routing version; publication waits for that.
create table public.routing_overrides (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind text not null check (kind in ('block_edge', 'manual_access', 'entrance', 'connector')),
  edge_key text check (edge_key is null or edge_key ~ '^[0-9]+-[0-9]+$'),
  location_id uuid references public.event_locations (id) on delete cascade,
  point extensions.geometry(Point, 4326),
  to_point extensions.geometry(Point, 4326),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  safe_walking_attested boolean not null default false,
  created_by_account_id uuid references public.profiles (account_id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  check (
    (kind = 'block_edge' and edge_key is not null and location_id is null and point is null)
    or (kind = 'manual_access' and location_id is not null and point is null)
    or (kind = 'entrance' and location_id is not null and point is not null and to_point is null)
    or (kind = 'connector' and point is not null and to_point is not null and safe_walking_attested)
  )
);
create index routing_overrides_event on public.routing_overrides (event_id) where removed_at is null;

create table app_private.routing_packages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  body text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size between 1 and 5242880),
  created_at timestamptz not null default clock_timestamp()
);

create table public.routing_builds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  boundary_version integer not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_metadata jsonb not null,
  overrides_hash text not null,
  compiler_version text not null check (char_length(compiler_version) <= 80),
  state text not null default 'queued' check (state in (
    'queued', 'running', 'validating', 'awaiting_host_preview', 'ready', 'failed', 'superseded')),
  error text check (error is null or char_length(error) <= 200),
  diagnostics jsonb,
  package_id uuid references app_private.routing_packages (id) on delete set null,
  requested_by_account_id uuid references public.profiles (account_id) on delete set null,
  confirmed_by_account_id uuid references public.profiles (account_id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  superseded_at timestamptz
);
create index routing_builds_event on public.routing_builds (event_id, created_at desc);
-- At most one confirmed routing version per event.
create unique index routing_builds_one_ready on public.routing_builds (event_id) where state = 'ready';

alter table public.routing_overrides enable row level security;
alter table public.routing_builds enable row level security;
alter table app_private.routing_packages enable row level security;
revoke all on public.routing_overrides, public.routing_builds, app_private.routing_packages
  from public, anon, authenticated;

create function app_private.active_routing_package(p_event_id uuid)
returns table (package_id uuid, sha256 text, byte_size integer, confirmed_at timestamptz)
language sql stable set search_path = '' as $$
  select p.id, p.sha256, p.byte_size, b.confirmed_at
  from public.routing_builds b join app_private.routing_packages p on p.id = b.package_id
  where b.event_id = p_event_id and b.state = 'ready';
$$;

create function app_private.routing_overrides_hash(p_event_id uuid)
returns text language sql stable set search_path = '' as $$
  select encode(extensions.digest(coalesce(string_agg(
    concat_ws('|', o.id, o.kind, o.edge_key, o.location_id, extensions.st_astext(o.point), extensions.st_astext(o.to_point)),
    ',' order by o.id), ''), 'sha256'), 'hex')
  from public.routing_overrides o where o.event_id = p_event_id and o.removed_at is null;
$$;

create function app_private.require_routing_editor(p_actor_id uuid, p_event_id uuid)
returns public.events language plpgsql set search_path = '' as $$
declare event_row public.events;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Actor cannot manage walking routes'; end if;
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.state not in ('draft', 'published', 'active') then raise exception 'Walking routes are closed'; end if;
  return event_row;
end;
$$;

create function app_private.routing_build_summary(p_build public.routing_builds)
returns jsonb language sql stable set search_path = '' as $$
  select case when p_build.id is null then null else jsonb_build_object(
    'id', p_build.id,
    'state', p_build.state,
    'boundaryVersion', p_build.boundary_version,
    'compilerVersion', p_build.compiler_version,
    'source', p_build.source_metadata,
    'error', p_build.error,
    'createdAt', p_build.created_at,
    'confirmedAt', p_build.confirmed_at,
    'packageId', p_build.package_id,
    'byteSize', (select byte_size from app_private.routing_packages where id = p_build.package_id),
    'componentCount', (p_build.diagnostics->>'componentCount')::int,
    'nodeCount', (p_build.diagnostics->>'nodeCount')::int,
    'edgeCount', (p_build.diagnostics->>'edgeCount')::int,
    'warnings', coalesce(p_build.diagnostics->'warnings', '[]'::jsonb),
    'rejectedConnectorIds', coalesce(p_build.diagnostics->'rejectedConnectors', '[]'::jsonb),
    -- Locations named for the team only; this never reaches public DTOs.
    'locations', coalesce((
      select jsonb_agg(d || jsonb_build_object('sellerNames', coalesce((
          select jsonb_agg(p.display_name order by p.display_name) from public.seller_participations p
          where p.location_id = (d->>'id')::uuid), '[]'::jsonb))
        -- Problems first.
        order by case d->>'status' when 'disconnected' then 0 when 'manual_access' then 1 else 2 end, d->>'id')
      from jsonb_array_elements(p_build.diagnostics->'locations') d), '[]'::jsonb)
  ) end;
$$;

-- Routing locations: every location still holding or seeking a place.
create function app_private.routing_locations(p_event_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'longitude', extensions.st_x(l.point), 'latitude', extensions.st_y(l.point)) order by l.id), '[]'::jsonb)
  from public.event_locations l
  where l.event_id = p_event_id and exists (select 1 from public.seller_participations p
    where p.location_id = l.id and p.state not in ('withdrawn', 'rejected', 'revoked'));
$$;

create function app_private.routing_blockers(p_event_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  ready public.routing_builds;
  blockers jsonb := '[]'::jsonb;
begin
  select * into ready from public.routing_builds where event_id = p_event_id and state = 'ready';
  if ready.id is null then return '["routing_not_ready"]'::jsonb; end if;
  if ready.boundary_version is distinct from (select version from public.event_boundaries where event_id = p_event_id)
  then blockers := blockers || '"routing_not_ready"'::jsonb; end if;
  return blockers;
end;
$$;

create or replace function app_private.publication_system_blockers(p_event_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select app_private.routing_blockers(p_event_id);
$$;

create function public.get_event_routing_command(p_actor_id uuid, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  latest public.routing_builds;
  ready public.routing_builds;
begin
  if not exists (select 1 from public.event_memberships where event_id = p_event_id and account_id = p_actor_id)
  then raise exception 'Actor is not an event team member'; end if;
  select * into latest from public.routing_builds where event_id = p_event_id order by created_at desc limit 1;
  select * into ready from public.routing_builds where event_id = p_event_id and state = 'ready';
  return jsonb_build_object(
    'eventId', p_event_id,
    'boundaryVersion', (select version from public.event_boundaries where event_id = p_event_id),
    'ready', jsonb_array_length(app_private.routing_blockers(p_event_id)) = 0,
    'latest', app_private.routing_build_summary(latest),
    'active', app_private.routing_build_summary(ready),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'kind', o.kind, 'edgeKey', o.edge_key, 'locationId', o.location_id,
        'point', case when o.point is null then null else jsonb_build_array(
          extensions.st_x(o.point), extensions.st_y(o.point)) end,
        'toPoint', case when o.to_point is null then null else jsonb_build_array(
          extensions.st_x(o.to_point), extensions.st_y(o.to_point)) end,
        'reason', o.reason, 'createdAt', o.created_at) order by o.created_at)
      from public.routing_overrides o where o.event_id = p_event_id and o.removed_at is null), '[]'::jsonb)
  );
end;
$$;

-- Step 1 of a build: authorize, then reuse an identical successful build or
-- queue a new one and hand the compiler its inputs.
create function public.start_routing_build_command(
  p_actor_id uuid, p_event_id uuid, p_source_sha256 text, p_source_metadata jsonb,
  p_compiler_version text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  boundary public.event_boundaries;
  existing public.routing_builds;
  build public.routing_builds;
  hash text;
begin
  perform app_private.require_routing_editor(p_actor_id, p_event_id);
  select * into boundary from public.event_boundaries where event_id = p_event_id;
  if boundary.event_id is null then raise exception 'Boundary required'; end if;
  hash := app_private.routing_overrides_hash(p_event_id);
  select * into existing from public.routing_builds
  where event_id = p_event_id and boundary_version = boundary.version and source_sha256 = p_source_sha256
    and overrides_hash = hash and compiler_version = p_compiler_version
    and state in ('awaiting_host_preview', 'ready')
  order by created_at desc limit 1;
  if existing.id is not null then
    return jsonb_build_object('reused', true, 'buildId', existing.id);
  end if;
  if exists (select 1 from public.routing_builds where event_id = p_event_id
    and state in ('queued', 'running', 'validating') and updated_at > clock_timestamp() - interval '10 minutes')
  then raise exception 'Build already running'; end if;
  -- A build that stalled (lost worker) is failed so a retry can start.
  update public.routing_builds set state = 'failed', error = 'stalled', updated_at = clock_timestamp()
  where event_id = p_event_id and state in ('queued', 'running', 'validating');
  insert into public.routing_builds (event_id, boundary_version, source_sha256, source_metadata, overrides_hash,
    compiler_version, state, requested_by_account_id)
  values (p_event_id, boundary.version, p_source_sha256, p_source_metadata, hash, p_compiler_version, 'running', p_actor_id)
  returning * into build;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'routing.build_started', 'routing_build', build.id, p_event_id,
    jsonb_build_object('boundaryVersion', boundary.version, 'compilerVersion', p_compiler_version));
  return jsonb_build_object(
    'reused', false,
    'buildId', build.id,
    'boundary', extensions.st_asgeojson(boundary.boundary)::jsonb -> 'coordinates' -> 0,
    'locations', app_private.routing_locations(p_event_id),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'kind', o.kind, 'edgeKey', o.edge_key, 'locationId', o.location_id,
        'point', case when o.point is null then null else jsonb_build_array(
          extensions.st_x(o.point), extensions.st_y(o.point)) end,
        'toPoint', case when o.to_point is null then null else jsonb_build_array(
          extensions.st_x(o.to_point), extensions.st_y(o.to_point)) end) order by o.id)
      from public.routing_overrides o where o.event_id = p_event_id and o.removed_at is null), '[]'::jsonb)
  );
end;
$$;

-- Step 2 (compiler identity): store the validated package and diagnostics.
create function public.complete_routing_build_command(
  p_build_id uuid, p_body text, p_diagnostics jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  build public.routing_builds;
  new_package_id uuid;
begin
  select * into build from public.routing_builds where id = p_build_id for update;
  if build.id is null or build.state not in ('queued', 'running', 'validating') then
    raise exception 'Build not running';
  end if;
  if octet_length(p_body) > 5242880 then
    update public.routing_builds set state = 'failed', error = 'package_too_large', updated_at = clock_timestamp()
    where id = p_build_id;
    return jsonb_build_object('state', 'failed');
  end if;
  insert into app_private.routing_packages (event_id, body, sha256, byte_size)
  values (build.event_id, p_body, encode(extensions.digest(convert_to(p_body, 'UTF8'), 'sha256'), 'hex'), octet_length(p_body))
  returning id into new_package_id;
  -- Only the newest unpublished preview is kept.
  delete from app_private.routing_packages where id in (
    select b.package_id from public.routing_builds b
    where b.event_id = build.event_id and b.state = 'awaiting_host_preview' and b.package_id is not null);
  update public.routing_builds set state = 'superseded', superseded_at = clock_timestamp(), updated_at = clock_timestamp()
  where event_id = build.event_id and state = 'awaiting_host_preview';
  update public.routing_builds set state = 'awaiting_host_preview', diagnostics = p_diagnostics,
    package_id = new_package_id, updated_at = clock_timestamp()
  where id = p_build_id;
  return jsonb_build_object('state', 'awaiting_host_preview', 'packageId', new_package_id);
end;
$$;

create function public.fail_routing_build_command(p_build_id uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.routing_builds set state = 'failed', error = left(coalesce(p_error, 'unknown'), 200),
    updated_at = clock_timestamp()
  where id = p_build_id and state in ('queued', 'running', 'validating');
end;
$$;

-- Readiness may include known manual-access stops, but not unexplained
-- disconnects, rejected connectors or an empty graph.
create function public.confirm_routing_build_command(
  p_actor_id uuid, p_event_id uuid, p_build_id uuid, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  build public.routing_builds;
begin
  perform app_private.require_routing_editor(p_actor_id, p_event_id);
  select * into build from public.routing_builds where id = p_build_id and event_id = p_event_id for update;
  if build.id is null or build.state <> 'awaiting_host_preview' then raise exception 'Build not ready for review'; end if;
  if build.boundary_version is distinct from (select version from public.event_boundaries where event_id = p_event_id)
    or build.overrides_hash <> app_private.routing_overrides_hash(p_event_id)
  then raise exception 'Build is out of date'; end if;
  if exists (select 1 from jsonb_array_elements(build.diagnostics->'locations') d where d->>'status' = 'disconnected')
  then raise exception 'Disconnected locations need a decision'; end if;
  if build.diagnostics->'warnings' ?| array['empty_graph', 'connector_rejected'] then
    raise exception 'Resolve the build warnings first';
  end if;
  update public.routing_builds set state = 'superseded', superseded_at = clock_timestamp(), updated_at = clock_timestamp()
  where event_id = p_event_id and state = 'ready';
  update public.routing_builds set state = 'ready', confirmed_at = clock_timestamp(),
    confirmed_by_account_id = p_actor_id, updated_at = clock_timestamp()
  where id = p_build_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'routing.build_confirmed', 'routing_build', p_build_id, p_event_id,
    jsonb_build_object('boundaryVersion', build.boundary_version));
  perform app_private.touch_public_state(p_event_id, true);
  return public.get_event_routing_command(p_actor_id, p_event_id);
end;
$$;

create function public.add_routing_override_command(
  p_actor_id uuid, p_event_id uuid, p_kind text, p_edge_key text, p_location_id uuid,
  p_point jsonb, p_to_point jsonb, p_reason text, p_safe_walking_attested boolean,
  p_authenticated_at timestamptz, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  location_row public.event_locations;
  boundary_geometry extensions.geometry;
  from_point extensions.geometry;
  to_point extensions.geometry;
  override_id uuid;
begin
  event_row := app_private.require_routing_editor(p_actor_id, p_event_id);
  -- Blocking an unsafe segment is a protective path and needs no step-up.
  if p_kind <> 'block_edge' then perform app_private.require_recent_authentication(p_authenticated_at); end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Reason required'; end if;
  select boundary into boundary_geometry from public.event_boundaries where event_id = p_event_id;
  if p_point is not null then
    from_point := extensions.st_setsrid(extensions.st_makepoint((p_point->>0)::float8, (p_point->>1)::float8), 4326);
  end if;
  if p_to_point is not null then
    to_point := extensions.st_setsrid(extensions.st_makepoint((p_to_point->>0)::float8, (p_to_point->>1)::float8), 4326);
  end if;
  if p_location_id is not null then
    select * into location_row from public.event_locations where id = p_location_id and event_id = p_event_id;
    if location_row.id is null then raise exception 'Location not found'; end if;
  end if;
  if p_kind = 'block_edge' then
    if p_edge_key is null or p_edge_key !~ '^[0-9]+-[0-9]+$' then raise exception 'Invalid override'; end if;
  elsif p_kind = 'manual_access' then
    if location_row.id is null then raise exception 'Invalid override'; end if;
  elsif p_kind = 'entrance' then
    if location_row.id is null or from_point is null
      or extensions.st_distancesphere(from_point, location_row.point) > 25
    then raise exception 'Entrance must be within 25 metres of the pin'; end if;
  elsif p_kind = 'connector' then
    if from_point is null or to_point is null then raise exception 'Invalid override'; end if;
    if not coalesce(p_safe_walking_attested, false) then raise exception 'Safe walking attestation required'; end if;
    if extensions.st_distancesphere(from_point, to_point) > 100 then raise exception 'Connector longer than 100 metres'; end if;
    if not (extensions.st_dwithin(boundary_geometry::extensions.geography, from_point::extensions.geography, 150)
      and extensions.st_dwithin(boundary_geometry::extensions.geography, to_point::extensions.geography, 150))
    then raise exception 'Connector outside the event area'; end if;
  else
    raise exception 'Invalid override';
  end if;
  -- New connectors change the graph and go through preview again; during
  -- the event only safety blocks and manual-access marks apply directly.
  if event_row.state = 'active' and p_kind not in ('block_edge', 'manual_access') then
    raise exception 'Only safety blocks during the event';
  end if;
  insert into public.routing_overrides (event_id, kind, edge_key, location_id, point, to_point, reason,
    safe_walking_attested, created_by_account_id)
  values (p_event_id, p_kind, case when p_kind = 'block_edge' then p_edge_key end,
    case when p_kind in ('manual_access', 'entrance') then p_location_id end,
    case when p_kind in ('entrance', 'connector') then from_point end,
    case when p_kind = 'connector' then to_point end,
    btrim(p_reason), p_kind = 'connector' and coalesce(p_safe_walking_attested, false), p_actor_id)
  returning id into override_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'routing.override_added', 'routing_override', override_id, p_event_id,
    jsonb_build_object('kind', p_kind, 'reason', btrim(p_reason)));
  -- An unsafe edge during the event reaches clients through the safety feed.
  perform app_private.touch_public_state(p_event_id, p_kind = 'block_edge');
  return public.get_event_routing_command(p_actor_id, p_event_id);
end;
$$;

create function public.remove_routing_override_command(
  p_actor_id uuid, p_override_id uuid, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare override_row public.routing_overrides;
begin
  select * into override_row from public.routing_overrides where id = p_override_id and removed_at is null;
  if override_row.id is null then raise exception 'Override not found'; end if;
  perform app_private.require_routing_editor(p_actor_id, override_row.event_id);
  update public.routing_overrides set removed_at = clock_timestamp() where id = p_override_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'routing.override_removed', 'routing_override', p_override_id,
    override_row.event_id, jsonb_build_object('kind', override_row.kind));
  perform app_private.touch_public_state(override_row.event_id, override_row.kind = 'block_edge');
  return public.get_event_routing_command(p_actor_id, override_row.event_id);
end;
$$;

-- Team preview of any kept package; public reads only the confirmed one and
-- its two predecessors while the event is published or active.
create function public.team_routing_package_command(p_actor_id uuid, p_event_id uuid, p_build_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.event_memberships where event_id = p_event_id and account_id = p_actor_id)
  then raise exception 'Actor is not an event team member'; end if;
  return (select p.body from public.routing_builds b join app_private.routing_packages p on p.id = b.package_id
    where b.id = p_build_id and b.event_id = p_event_id);
end;
$$;

create function public.public_routing_package_command(p_package_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('body', p.body, 'sha256', p.sha256, 'unlisted', e.visibility = 'unlisted')
  from app_private.routing_packages p
  join public.routing_builds b on b.package_id = p.id
  join public.events e on e.id = p.event_id
  where p.id = p_package_id and e.state in ('published', 'active')
    and (b.state = 'ready' or b.id in (
      select r.id from public.routing_builds r where r.event_id = p.event_id and r.state = 'superseded'
        and r.confirmed_at is not null order by r.superseded_at desc limit 2));
$$;

-- Hourly. Current plus two confirmed predecessors are kept; older confirmed
-- packages expire 24 hours after supersession, previews and failures too.
-- Everything goes within 24 hours after end or cancellation, keeping only
-- non-personal source/compiler metadata; failure rows go after 30 days.
create function app_private.enforce_routing_retention_command()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  with ranked as (
    select b.package_id, b.state, b.superseded_at, b.confirmed_at, e.state as event_state, e.state_changed_at,
      row_number() over (partition by b.event_id, b.confirmed_at is not null and b.state = 'superseded'
        order by b.superseded_at desc nulls last) as rank
    from public.routing_builds b join public.events e on e.id = b.event_id
    where b.package_id is not null
  )
  delete from app_private.routing_packages p using ranked r
  where p.id = r.package_id and (
    (r.event_state in ('ended', 'cancelled', 'archived') and r.state_changed_at <= clock_timestamp() - interval '24 hours')
    or (r.state = 'superseded' and r.confirmed_at is not null and r.rank > 2
      and r.superseded_at <= clock_timestamp() - interval '24 hours')
    or (r.state = 'superseded' and r.confirmed_at is null and r.superseded_at <= clock_timestamp() - interval '24 hours'));
  get diagnostics removed = row_count;
  delete from public.routing_overrides o using public.events e
  where e.id = o.event_id and e.state in ('ended', 'cancelled', 'archived')
    and e.state_changed_at <= clock_timestamp() - interval '24 hours';
  delete from public.routing_builds where state = 'failed' and updated_at <= clock_timestamp() - interval '30 days';
  return removed;
end;
$$;
select cron.schedule('promenadis-routing-retention', '17 * * * *',
  'select app_private.enforce_routing_retention_command();');

create or replace function app_private.build_public_snapshot(p_event_id uuid, p_revision bigint)
returns jsonb language plpgsql set search_path = '' as $$
declare
  event_row public.events;
  sellers jsonb;
  stops jsonb;
  doc jsonb;
begin
  select * into event_row from public.events where id = p_event_id;
  with sellers_now as (
    select p.*, app_private.public_id(event_row, 'seller', p.id) as public_id,
      app_private.public_id(event_row, 'stop', p.location_id) as stop_id
    from app_private.publishable_participations(p_event_id) p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', sn.public_id,
      'stopId', sn.stop_id,
      'displayName', sn.display_name,
      'title', case when sl.hidden_at is null then sl.title end,
      'description', case when sl.hidden_at is null then coalesce(sl.description, '') else '' end,
      'categoryIds', coalesce((select jsonb_agg(a.category_id order by a.position)
        from public.seller_category_assignments a where a.participation_id = sn.id), '[]'::jsonb),
      'tags', case when sl.hidden_at is null then coalesce((select jsonb_agg(t.display order by t.position)
        from public.seller_tags t where t.participation_id = sn.id), '[]'::jsonb) else '[]'::jsonb end,
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'categoryId', i.category_id,
          'status', i.status, 'priceMinor', i.price_minor, 'currency', i.currency) order by i.position)
        from public.highlighted_items i where i.participation_id = sn.id and i.hidden_at is null
          and sl.hidden_at is null), '[]'::jsonb),
      'accessibility', jsonb_build_object('stepFree', sl.step_free, 'stairs', sl.has_stairs,
        'elevator', sl.has_elevator, 'setting', sl.setting, 'strollerFriendly', sl.stroller_friendly),
      'availability', coalesce((select jsonb_agg(jsonb_build_object('startsAt', a.starts_at, 'endsAt', a.ends_at)
          order by a.starts_at)
        from public.seller_availability a where a.participation_id = sn.id), '[]'::jsonb),
      'status', coalesce((select case s.status when 'away' then 'away' else 'open' end
        from public.seller_live_status s where s.participation_id = sn.id), 'open')
    ) order by sn.public_id), '[]'::jsonb)
  into sellers
  from sellers_now sn left join public.seller_listings sl on sl.participation_id = sn.id;

  -- One stop per physical location; coordinates rounded to about a metre.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', app_private.public_id(event_row, 'stop', l.id),
      'longitude', round(extensions.st_x(l.point)::numeric, 5),
      'latitude', round(extensions.st_y(l.point)::numeric, 5),
      'sellerIds', (select jsonb_agg(app_private.public_id(event_row, 'seller', p.id) order by 1)
        from app_private.publishable_participations(p_event_id) p where p.location_id = l.id),
      -- Host routing decisions: intentional manual access and a corrected
      -- same-address entrance used for snapping instead of the pin.
      'manualAccess', exists (select 1 from public.routing_overrides o
        where o.location_id = l.id and o.kind = 'manual_access' and o.removed_at is null),
      'entrance', (select jsonb_build_object(
          'longitude', round(extensions.st_x(o.point)::numeric, 5),
          'latitude', round(extensions.st_y(o.point)::numeric, 5))
        from public.routing_overrides o
        where o.location_id = l.id and o.kind = 'entrance' and o.removed_at is null
        order by o.created_at desc limit 1),
      -- Grid cells for map clustering at neighbourhood and street zoom.
      'cluster', jsonb_build_object(
        'z13', floor((extensions.st_x(l.point) + 180) / 360 * 8192)::text || '_'
          || floor((1 - ln(tan(radians(extensions.st_y(l.point))) + 1 / cos(radians(extensions.st_y(l.point)))) / pi()) / 2 * 8192)::text,
        'z15', floor((extensions.st_x(l.point) + 180) / 360 * 32768)::text || '_'
          || floor((1 - ln(tan(radians(extensions.st_y(l.point))) + 1 / cos(radians(extensions.st_y(l.point)))) / pi()) / 2 * 32768)::text)
    ) order by app_private.public_id(event_row, 'stop', l.id)), '[]'::jsonb)
  into stops
  from public.event_locations l
  where l.event_id = p_event_id
    and exists (select 1 from app_private.publishable_participations(p_event_id) p where p.location_id = l.id);

  doc := jsonb_build_object(
    'schemaVersion', '1.0',
    'eventKey', event_row.public_key,
    'revision', p_revision,
    'generatedAt', clock_timestamp(),
    'expiresAt', app_private.public_expiry(p_event_id),
    'event', jsonb_build_object(
      'title', event_row.title,
      'state', event_row.state,
      'timezone', event_row.timezone,
      'intervals', coalesce((select jsonb_agg(jsonb_build_object('startsAt', i.starts_at, 'endsAt', i.ends_at)
        order by i.position) from public.event_intervals i where i.event_id = p_event_id), '[]'::jsonb),
      'areaLabel', (select b.display_label from public.event_boundaries b where b.event_id = p_event_id),
      'boundary', (select extensions.st_asgeojson(extensions.st_simplifypreservetopology(b.boundary, 0.00001), 5)::jsonb
        from public.event_boundaries b where b.event_id = p_event_id)
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.id,
          'key', c.key,
          'labels', jsonb_build_object(
            'sv', (select x.label from public.taxonomy_category_localizations x where x.category_id = c.id and x.locale = 'sv'),
            'en', (select x.label from public.taxonomy_category_localizations x where x.category_id = c.id and x.locale = 'en')),
          'synonyms', jsonb_build_object(
            'sv', to_jsonb((select x.synonyms from public.taxonomy_category_localizations x where x.category_id = c.id and x.locale = 'sv')),
            'en', to_jsonb((select x.synonyms from public.taxonomy_category_localizations x where x.category_id = c.id and x.locale = 'en')))
        ) order by array_position(t.enabled_category_ids, c.id))
      from public.event_taxonomies t
      join public.taxonomy_categories c on c.id = any (t.enabled_category_ids)
      where t.event_id = p_event_id), '[]'::jsonb),
    'counts', jsonb_build_object(
      'stops', jsonb_array_length(stops),
      'sellers', jsonb_array_length(sellers),
      'open', (select count(*) from jsonb_array_elements(sellers) s where s->>'status' = 'open'),
      'byCategory', coalesce((select jsonb_object_agg(category_id, n) from (
        select c.value #>> '{}' as category_id, count(*) as n
        from jsonb_array_elements(sellers) s, jsonb_array_elements(s->'categoryIds') c group by 1) counted), '{}'::jsonb)),
    'stops', stops,
    'sellers', sellers
  );
  return doc;
end;
$$;

create or replace function public.public_event_manifest_command(p_route text, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  publication app_private.public_event_publications;
  snapshot app_private.public_snapshots;
  routing record;
begin
  event_row := app_private.public_event_for_route(p_route, p_key);
  if event_row.id is null then
    return jsonb_build_object('status', case when exists (
      select 1 from public.retired_event_keys where public_key = p_key) then 'gone' else 'not_found' end);
  end if;
  select * into publication from app_private.public_event_publications where event_id = event_row.id;
  select * into routing from app_private.active_routing_package(event_row.id);
  select * into snapshot from app_private.public_snapshots
  where id = publication.active_snapshot_id and expires_at > clock_timestamp();
  return jsonb_build_object('status', 'ok', 'manifest', jsonb_build_object(
    'schemaVersion', '1.0',
    'eventKey', event_row.public_key,
    'state', case when event_row.state = 'archived' then 'ended' else event_row.state end,
    'publicRevision', coalesce(publication.public_revision, 0),
    'safetySequence', coalesce(publication.safety_sequence, 1),
    'routingVersion', routing.package_id,
    'routing', case when routing.package_id is not null then jsonb_build_object(
      'id', routing.package_id, 'sha256', routing.sha256, 'byteSize', routing.byte_size) end,
    'snapshot', case when snapshot.id is not null then jsonb_build_object(
      'id', snapshot.id, 'sha256', snapshot.sha256, 'byteSize', snapshot.byte_size) end,
    'generatedAt', coalesce(publication.generated_at, clock_timestamp()),
    'expiresAt', coalesce(app_private.public_expiry(event_row.id), clock_timestamp())
  ));
end;
$$;

create or replace function public.public_event_safety_feed_command(p_route text, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  publication app_private.public_event_publications;
  current_sellers text[];
  current_stops text[];
begin
  event_row := app_private.public_event_for_route(p_route, p_key);
  if event_row.id is null then
    return jsonb_build_object('status', case when exists (
      select 1 from public.retired_event_keys where public_key = p_key) then 'gone' else 'not_found' end);
  end if;
  select * into publication from app_private.public_event_publications where event_id = event_row.id;
  current_sellers := array(select app_private.public_id(event_row, 'seller', p.id)
    from app_private.publishable_participations(event_row.id) p);
  current_stops := array(select app_private.public_id(event_row, 'stop', p.location_id)
    from app_private.publishable_participations(event_row.id) p);
  return jsonb_build_object('status', 'ok', 'feed', jsonb_build_object(
    'schemaVersion', '1.0',
    'eventKey', event_row.public_key,
    'sequence', coalesce(publication.safety_sequence, 1),
    'state', case when event_row.state = 'archived' then 'ended' else event_row.state end,
    'removedSellerIds', to_jsonb(array(select s from unnest(coalesce(publication.published_seller_ids, '{}')) s
      where s <> all (current_sellers) order by s)),
    'removedStopIds', to_jsonb(array(select s from unnest(coalesce(publication.published_stop_ids, '{}')) s
      where s <> all (current_stops) order by s)),
    'awaySellerIds', to_jsonb(array(select app_private.public_id(event_row, 'seller', p.id)
      from app_private.publishable_participations(event_row.id) p
      join public.seller_live_status s on s.participation_id = p.id and s.status = 'away' order by 1)),
    'blockedEdgeIds', to_jsonb(array(select o.edge_key from public.routing_overrides o
      join public.routing_builds b on b.event_id = o.event_id and b.state = 'ready'
      where o.event_id = event_row.id and o.kind = 'block_edge' and o.removed_at is null
        and o.created_at > b.confirmed_at order by 1)),
    'requiredGraphVersion', (select package_id from app_private.active_routing_package(event_row.id)),
    'generatedAt', clock_timestamp(),
    'expiresAt', least(clock_timestamp() + interval '2 minutes',
      coalesce(app_private.public_expiry(event_row.id), clock_timestamp()))
  ));
end;
$$;

revoke all on function app_private.active_routing_package(uuid) from public, anon, authenticated;
revoke all on function app_private.routing_overrides_hash(uuid) from public, anon, authenticated;
revoke all on function app_private.require_routing_editor(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.routing_build_summary(public.routing_builds) from public, anon, authenticated;
revoke all on function app_private.routing_locations(uuid) from public, anon, authenticated;
revoke all on function app_private.routing_blockers(uuid) from public, anon, authenticated;
revoke all on function app_private.enforce_routing_retention_command() from public, anon, authenticated;
revoke all on function public.get_event_routing_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_routing_build_command(uuid, uuid, text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_routing_build_command(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_routing_build_command(uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_routing_build_command(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.add_routing_override_command(uuid, uuid, text, text, uuid, jsonb, jsonb, text, boolean, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.remove_routing_override_command(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.team_routing_package_command(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.public_routing_package_command(uuid) from public, anon, authenticated;
grant execute on function public.get_event_routing_command(uuid, uuid) to service_role;
grant execute on function public.start_routing_build_command(uuid, uuid, text, jsonb, text, uuid) to service_role;
grant execute on function public.complete_routing_build_command(uuid, text, jsonb) to service_role;
grant execute on function public.fail_routing_build_command(uuid, text) to service_role;
grant execute on function public.confirm_routing_build_command(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.add_routing_override_command(uuid, uuid, text, text, uuid, jsonb, jsonb, text, boolean, timestamptz, uuid) to service_role;
grant execute on function public.remove_routing_override_command(uuid, uuid, uuid) to service_role;
grant execute on function public.team_routing_package_command(uuid, uuid, uuid) to service_role;
grant execute on function public.public_routing_package_command(uuid) to service_role;
