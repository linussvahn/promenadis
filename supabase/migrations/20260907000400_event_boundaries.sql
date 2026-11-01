create table public.event_boundaries (
  event_id uuid primary key references public.events (id) on delete cascade,
  boundary extensions.geometry(Polygon, 4326) not null,
  display_label text,
  version integer not null default 1 check (version > 0),
  area_square_meters double precision not null check (
    area_square_meters > 0 and area_square_meters <= 25000000
  ),
  span_meters double precision not null check (
    span_meters > 0 and span_meters <= 10000
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint event_boundaries_display_label check (
    display_label is null
    or (display_label = btrim(display_label) and char_length(display_label) between 1 and 120)
  ),
  constraint event_boundaries_valid check (extensions.st_isvalid(boundary)),
  constraint event_boundaries_point_count check (extensions.st_npoints(boundary) between 4 and 51),
  constraint event_boundaries_timestamp_order check (updated_at >= created_at)
);

create index event_boundaries_geometry_gist
on public.event_boundaries using gist (boundary);

create trigger event_boundaries_touch_updated_at
before update on public.event_boundaries
for each row execute function app_private.touch_updated_at();

create or replace function app_private.event_boundary_summary(
  p_boundary public.event_boundaries
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'areaSquareKilometers', p_boundary.area_square_meters / 1000000.0,
    'displayLabel', p_boundary.display_label,
    'ring', extensions.st_asgeojson(p_boundary.boundary)::jsonb -> 'coordinates' -> 0,
    'spanKilometers', p_boundary.span_meters / 1000.0,
    'version', p_boundary.version,
    'warnings',
      case
        when p_boundary.area_square_meters >= 20000000
          and p_boundary.span_meters >= 8000
          then jsonb_build_array('area_near_limit', 'span_near_limit')
        when p_boundary.area_square_meters >= 20000000
          then jsonb_build_array('area_near_limit')
        when p_boundary.span_meters >= 8000
          then jsonb_build_array('span_near_limit')
        else '[]'::jsonb
      end
  );
$$;

create or replace function public.get_identity_dashboard_command(p_actor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', '1.0',
    'profile', jsonb_build_object(
      'accountId', profile.account_id,
      'displayName', profile.display_name,
      'preferredLocale', profile.preferred_locale
    ),
    'organizers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', organizer.id,
          'displayName', organizer.display_name,
          'organizerType', organizer.organizer_type,
          'locality', organizer.locality,
          'website', organizer.website,
          'role', membership.role
        )
        order by organizer.created_at
      )
      from public.organizer_profile_memberships as membership
      join public.organizer_profiles as organizer
        on organizer.id = membership.organizer_profile_id
      where membership.account_id = p_actor_id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', event.id,
          'organizerProfileId', event.organizer_profile_id,
          'organizerDisplayName', organizer.display_name,
          'title', event.title,
          'description', event.description,
          'timezone', event.timezone,
          'state', event.state,
          'visibility', event.visibility,
          'role', membership.role,
          'intervals', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', event_interval.id,
                'startsAt', event_interval.starts_at,
                'endsAt', event_interval.ends_at
              )
              order by event_interval.position
            )
            from public.event_intervals as event_interval
            where event_interval.event_id = event.id
          ), '[]'::jsonb),
          'boundary', (
            select app_private.event_boundary_summary(event_boundary)
            from public.event_boundaries as event_boundary
            where event_boundary.event_id = event.id
          )
        )
        order by event.created_at desc
      )
      from public.event_memberships as membership
      join public.events as event on event.id = membership.event_id
      join public.organizer_profiles as organizer on organizer.id = event.organizer_profile_id
      where membership.account_id = p_actor_id
    ), '[]'::jsonb)
  )
  from public.profiles as profile
  where profile.account_id = p_actor_id;
$$;

create or replace function public.upsert_draft_event_boundary_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_expected_version integer,
  p_display_label text,
  p_boundary_geojson jsonb,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  boundary_row public.event_boundaries;
  event_state text;
  current_version integer;
  normalized_label text := nullif(btrim(p_display_label), '');
  parsed_boundary extensions.geometry;
  area_meters double precision;
  span_meters double precision;
begin
  if not exists (
    select 1
    from public.event_memberships
    where event_id = p_event_id
      and account_id = p_actor_id
      and role in ('owner', 'co_host')
  ) then
    raise exception 'Actor cannot manage event boundary';
  end if;

  select state
  into event_state
  from public.events
  where id = p_event_id
  for update;

  if event_state <> 'draft' then
    raise exception 'Only draft event boundaries can be edited directly';
  end if;
  if normalized_label is not null and char_length(normalized_label) > 120 then
    raise exception 'Boundary display label is too long';
  end if;

  select version
  into current_version
  from public.event_boundaries
  where event_id = p_event_id;

  if (current_version is null and p_expected_version is not null)
    or (current_version is not null and p_expected_version is distinct from current_version)
  then
    raise exception 'Event boundary version conflict';
  end if;

  begin
    parsed_boundary := extensions.st_geomfromgeojson(p_boundary_geojson::text);
  exception when others then
    raise exception 'Invalid event boundary';
  end;

  if parsed_boundary is null
    or extensions.st_geometrytype(parsed_boundary) <> 'ST_Polygon'
    or extensions.st_ndims(parsed_boundary) <> 2
    or extensions.st_srid(parsed_boundary) not in (0, 4326)
  then
    raise exception 'Invalid event boundary';
  end if;

  parsed_boundary := extensions.st_forcepolygonccw(
    extensions.st_setsrid(parsed_boundary, 4326)
  );

  if not extensions.st_isvalid(parsed_boundary)
    or extensions.st_npoints(parsed_boundary) not between 4 and 51
  then
    raise exception 'Invalid event boundary';
  end if;

  area_meters := extensions.st_area(parsed_boundary::extensions.geography);
  select coalesce(max(extensions.st_distance(
    first_point.geom::extensions.geography,
    second_point.geom::extensions.geography
  )), 0)
  into span_meters
  from extensions.st_dumppoints(parsed_boundary) as first_point
  cross join extensions.st_dumppoints(parsed_boundary) as second_point;

  if area_meters <= 0 or span_meters <= 0 then
    raise exception 'Invalid event boundary';
  end if;
  if area_meters > 25000000 then
    raise exception 'Event boundary exceeds maximum area';
  end if;
  if span_meters > 10000 then
    raise exception 'Event boundary exceeds maximum span';
  end if;

  insert into public.event_boundaries (
    event_id,
    boundary,
    display_label,
    version,
    area_square_meters,
    span_meters
  ) values (
    p_event_id,
    parsed_boundary,
    normalized_label,
    1,
    area_meters,
    span_meters
  )
  on conflict (event_id) do update
  set boundary = excluded.boundary,
      display_label = excluded.display_label,
      version = public.event_boundaries.version + 1,
      area_square_meters = excluded.area_square_meters,
      span_meters = excluded.span_meters
  returning * into boundary_row;

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
    'event.boundary_saved',
    'event_boundary',
    p_event_id,
    p_event_id,
    jsonb_build_object(
      'version', boundary_row.version,
      'areaSquareKilometers', boundary_row.area_square_meters / 1000000.0,
      'spanKilometers', boundary_row.span_meters / 1000.0
    )
  );

  return app_private.event_boundary_summary(boundary_row);
end;
$$;

alter table public.event_boundaries enable row level security;
alter table public.event_boundaries force row level security;

revoke all on table public.event_boundaries from public, anon, authenticated;
grant select, insert, update, delete on table public.event_boundaries to service_role;

revoke all on function app_private.event_boundary_summary(public.event_boundaries)
from public, anon, authenticated;
grant execute on function app_private.event_boundary_summary(public.event_boundaries)
to service_role;

revoke all on function public.upsert_draft_event_boundary_command(
  uuid, uuid, integer, text, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.upsert_draft_event_boundary_command(
  uuid, uuid, integer, text, jsonb, uuid
) to service_role;

comment on table public.event_boundaries is
  'Canonical versioned PostGIS polygon for a draft event; browser roles have no direct access.';
comment on function public.upsert_draft_event_boundary_command(
  uuid, uuid, integer, text, jsonb, uuid
) is
  'Validates and version-checks one draft boundary, computes authoritative geodesic metrics, and audits the save.';
