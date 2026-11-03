-- Signed-in route sync: the chosen sellers, must-sees, visit progress and the
-- route-wide preferences only. Start points, positions, accuracy and plans
-- stay on the device. Stored by private ID so replaced links keep working;
-- deleted within 24 hours after the event ends or is cancelled.
create table app_private.saved_routes (
  account_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  version integer not null default 1 check (version > 0),
  selected_participation_ids uuid[] not null default '{}' check (cardinality(selected_participation_ids) <= 500),
  must_see_participation_ids uuid[] not null default '{}' check (cardinality(must_see_participation_ids) <= 10),
  visited_participation_ids uuid[] not null default '{}' check (cardinality(visited_participation_ids) <= 500),
  visited_location_ids uuid[] not null default '{}' check (cardinality(visited_location_ids) <= 500),
  skipped_location_ids uuid[] not null default '{}' check (cardinality(skipped_location_ids) <= 500),
  mode text not null default 'availability' check (mode in ('availability', 'shortest')),
  pace text not null default 'standard' check (pace in ('quick', 'standard', 'leisurely')),
  return_to_start boolean not null default false,
  -- A tombstone: the visitor removed the route, so other devices clear theirs.
  deleted_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (account_id, event_id)
);
create index saved_routes_event on app_private.saved_routes (event_id);
alter table app_private.saved_routes enable row level security;
alter table app_private.saved_routes force row level security;
revoke all on app_private.saved_routes from public, anon, authenticated;

create function app_private.saved_route_json(p_event public.events, p_route app_private.saved_routes)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'version', p_route.version,
    'deleted', p_route.deleted_at is not null,
    'selected', to_jsonb(array(select app_private.public_id(p_event, 'seller', id)
      from unnest(p_route.selected_participation_ids) id order by 1)),
    'mustSee', to_jsonb(array(select app_private.public_id(p_event, 'seller', id)
      from unnest(p_route.must_see_participation_ids) id order by 1)),
    'visitedSellers', to_jsonb(array(select app_private.public_id(p_event, 'seller', id)
      from unnest(p_route.visited_participation_ids) id order by 1)),
    'visitedStops', to_jsonb(array(select app_private.public_id(p_event, 'stop', id)
      from unnest(p_route.visited_location_ids) id order by 1)),
    'skipped', to_jsonb(array(select app_private.public_id(p_event, 'stop', id)
      from unnest(p_route.skipped_location_ids) id order by 1)),
    'preferences', jsonb_build_object('mode', p_route.mode, 'pace', p_route.pace,
      'returnToStart', p_route.return_to_start)
  );
$$;

-- Public IDs back to this event's private IDs; unknown IDs are dropped.
create function app_private.saved_route_sellers(p_event public.events, p_ids jsonb)
returns uuid[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(p.id order by p.id), '{}') from public.seller_participations p
  where p.event_id = p_event.id
    and app_private.public_id(p_event, 'seller', p.id) in (select jsonb_array_elements_text(p_ids));
$$;
create function app_private.saved_route_stops(p_event public.events, p_ids jsonb)
returns uuid[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(l.id order by l.id), '{}') from public.event_locations l
  where l.event_id = p_event.id
    and app_private.public_id(p_event, 'stop', l.id) in (select jsonb_array_elements_text(p_ids));
$$;

create function public.get_saved_route_command(p_actor_id uuid, p_route text, p_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  event_row public.events;
  saved app_private.saved_routes;
begin
  event_row := app_private.public_event_for_route(p_route, p_key);
  if event_row.id is null then return jsonb_build_object('status', 'not_found'); end if;
  select * into saved from app_private.saved_routes where account_id = p_actor_id and event_id = event_row.id;
  return jsonb_build_object('status', 'ok',
    'route', case when saved.account_id is null then null else app_private.saved_route_json(event_row, saved) end);
end;
$$;

-- Optimistic concurrency: the caller names the version it last saw (0 when
-- it saw none). A mismatch returns the current route instead of overwriting.
create function public.save_saved_route_command(
  p_actor_id uuid, p_route text, p_key text, p_expected_version integer, p_body jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  saved app_private.saved_routes;
begin
  event_row := app_private.public_event_for_route(p_route, p_key);
  if event_row.id is null then return jsonb_build_object('status', 'not_found'); end if;
  if event_row.state not in ('published', 'active')
    or clock_timestamp() >= coalesce(app_private.public_expiry(event_row.id), clock_timestamp())
  then return jsonb_build_object('status', 'closed'); end if;
  select * into saved from app_private.saved_routes
  where account_id = p_actor_id and event_id = event_row.id for update;
  if coalesce(saved.version, 0) <> p_expected_version then
    return jsonb_build_object('status', 'conflict', 'route', app_private.saved_route_json(event_row, saved));
  end if;
  insert into app_private.saved_routes as r (account_id, event_id, version, selected_participation_ids,
    must_see_participation_ids, visited_participation_ids, visited_location_ids, skipped_location_ids,
    mode, pace, return_to_start)
  values (p_actor_id, event_row.id, p_expected_version + 1,
    app_private.saved_route_sellers(event_row, p_body->'selected'),
    app_private.saved_route_sellers(event_row, p_body->'mustSee'),
    app_private.saved_route_sellers(event_row, p_body->'visitedSellers'),
    app_private.saved_route_stops(event_row, p_body->'visitedStops'),
    app_private.saved_route_stops(event_row, p_body->'skipped'),
    p_body->'preferences'->>'mode', p_body->'preferences'->>'pace',
    (p_body->'preferences'->>'returnToStart')::boolean)
  on conflict (account_id, event_id) do update set
    version = excluded.version,
    selected_participation_ids = excluded.selected_participation_ids,
    must_see_participation_ids = excluded.must_see_participation_ids,
    visited_participation_ids = excluded.visited_participation_ids,
    visited_location_ids = excluded.visited_location_ids,
    skipped_location_ids = excluded.skipped_location_ids,
    mode = excluded.mode, pace = excluded.pace, return_to_start = excluded.return_to_start,
    deleted_at = null, updated_at = clock_timestamp()
  returning * into saved;
  return jsonb_build_object('status', 'ok', 'route', app_private.saved_route_json(event_row, saved));
end;
$$;

-- Early deletion keeps only a tombstone (no stops, no progress) until the
-- event-relative purge, so the visitor's other devices clear their copy too.
create function public.delete_saved_route_command(p_actor_id uuid, p_route text, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  saved app_private.saved_routes;
begin
  event_row := app_private.public_event_for_route(p_route, p_key);
  if event_row.id is null then return jsonb_build_object('status', 'not_found'); end if;
  update app_private.saved_routes set version = version + 1, selected_participation_ids = '{}',
    must_see_participation_ids = '{}', visited_participation_ids = '{}', visited_location_ids = '{}',
    skipped_location_ids = '{}', mode = 'availability', pace = 'standard', return_to_start = false,
    deleted_at = clock_timestamp(), updated_at = clock_timestamp()
  where account_id = p_actor_id and event_id = event_row.id and deleted_at is null
  returning * into saved;
  if saved.account_id is null then
    select * into saved from app_private.saved_routes where account_id = p_actor_id and event_id = event_row.id;
  end if;
  return jsonb_build_object('status', 'ok',
    'route', case when saved.account_id is null then null else app_private.saved_route_json(event_row, saved) end);
end;
$$;

-- Runs every 15 minutes: 23 hours after the last interval ends, or after the
-- event ended early or was cancelled, so nothing outlives the 24-hour bound.
create function app_private.purge_saved_routes_command()
returns integer language plpgsql security definer set search_path = '' as $$
declare erased integer;
begin
  delete from app_private.saved_routes r using public.events e
  where e.id = r.event_id
    and least(app_private.public_expiry(e.id),
      case when e.state in ('ended', 'cancelled', 'archived') then e.state_changed_at end)
      <= clock_timestamp() - interval '23 hours';
  get diagnostics erased = row_count;
  return erased;
end;
$$;
select cron.schedule('promenadis-purge-saved-routes', '*/15 * * * *',
  'select app_private.purge_saved_routes_command(); select app_private.beat(''saved_routes'');');

revoke all on function app_private.saved_route_json(public.events, app_private.saved_routes) from public, anon, authenticated;
revoke all on function app_private.saved_route_sellers(public.events, jsonb) from public, anon, authenticated;
revoke all on function app_private.saved_route_stops(public.events, jsonb) from public, anon, authenticated;
revoke all on function app_private.purge_saved_routes_command() from public, anon, authenticated;
revoke all on function public.get_saved_route_command(uuid, text, text) from public, anon, authenticated;
revoke all on function public.save_saved_route_command(uuid, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.delete_saved_route_command(uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_saved_route_command(uuid, text, text) to service_role;
grant execute on function public.save_saved_route_command(uuid, text, text, integer, jsonb) to service_role;
grant execute on function public.delete_saved_route_command(uuid, text, text) to service_role;
