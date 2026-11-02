-- Milestone 3, slice 2: public snapshot, manifest and coordinate-free safety
-- feed per event.
--
-- A domain change marks the event dirty (and, for safety-relevant changes,
-- bumps the safety sequence) in the committing transaction. A worker builds
-- the full snapshot from one consistent read, validates it, stores the exact
-- bytes with their SHA-256 and only then moves the manifest pointer. The
-- predecessor stays for at most 60 seconds. Ending, cancelling, postponing or
-- archiving an event writes a tombstone at once and deletes snapshot bytes.
-- The safety feed is computed live, so removals reach clients without waiting
-- for a rebuild.
alter table public.events
  -- Host choice: show approved locations before the event starts.
  add column early_location_visibility boolean not null default false,
  -- Keys event-scoped public IDs; never leaves the database.
  add column public_salt bytea not null default extensions.gen_random_bytes(16);

create table app_private.public_event_publications (
  event_id uuid primary key references public.events (id) on delete cascade,
  public_revision bigint not null default 0 check (public_revision >= 0),
  safety_sequence bigint not null default 1 check (safety_sequence >= 1),
  state text not null check (state in ('published', 'active', 'postponed', 'ended', 'cancelled', 'archived')),
  active_snapshot_id uuid,
  dirty boolean not null default true,
  dirty_since timestamptz default clock_timestamp(),
  generated_at timestamptz,
  expires_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  updated_at timestamptz not null default clock_timestamp()
);

create table app_private.public_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  public_revision bigint not null,
  body text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size between 1 and 2097152),
  seller_ids text[] not null,
  stop_ids text[] not null,
  generated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  -- Set when replaced; the predecessor is deleted 60 seconds later.
  superseded_at timestamptz
);
create index public_snapshots_event on app_private.public_snapshots (event_id);
alter table app_private.public_event_publications
  add constraint public_event_publications_snapshot
  foreign key (active_snapshot_id) references app_private.public_snapshots (id) on delete set null;

create function app_private.public_id(p_event public.events, p_kind text, p_id uuid)
returns text language sql immutable set search_path = '' as $$
  select encode(substr(extensions.hmac(convert_to(p_kind || ':' || p_id::text, 'UTF8'), p_event.public_salt, 'sha256'), 1, 12), 'hex');
$$;

-- Hard expiry: the end of the event's last interval.
create function app_private.public_expiry(p_event_id uuid)
returns timestamptz language sql stable set search_path = '' as $$
  select max(ends_at) from public.event_intervals where event_id = p_event_id;
$$;

-- Which sellers may appear publicly right now.
create function app_private.publishable_participations(p_event_id uuid)
returns setof public.seller_participations language sql stable set search_path = '' as $$
  select p.* from public.seller_participations p
  join public.events e on e.id = p.event_id
  join public.event_locations l on l.id = p.location_id
  left join public.seller_listings sl on sl.participation_id = p.id
  left join public.seller_live_status s on s.participation_id = p.id
  where p.event_id = p_event_id
    and p.state = 'approved'
    and l.quarantined_at is null
    and (l.inside_boundary or p.geographic_exception)
    and coalesce(s.status, 'open') <> 'closed_early'
    and (
      e.state = 'active'
      or (e.state = 'published' and e.early_location_visibility and not coalesce(sl.early_visibility_opt_out, false))
    )
    and clock_timestamp() < app_private.public_expiry(p_event_id);
$$;

-- Built from one read. Contains only allowlisted public fields: no address
-- lines, account, participation, contact, report or moderation data.
create function app_private.build_public_snapshot(p_event_id uuid, p_revision bigint)
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

-- Denylist backstop on top of the allowlisted construction.
create function app_private.assert_public_snapshot_safe(p_doc jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare bad text;
begin
  select key into bad from (
    with recursive walk(value) as (
      select p_doc
      union all
      select child.value from walk,
        lateral (
          select v as value from jsonb_each(case when jsonb_typeof(walk.value) = 'object' then walk.value end) as e(k, v)
          union all
          select v from jsonb_array_elements(case when jsonb_typeof(walk.value) = 'array' then walk.value end) as a(v)
        ) child
    )
    select k as key from walk, jsonb_object_keys(case when jsonb_typeof(walk.value) = 'object' then walk.value end) as k
  ) keys
  where key ~* '(account|email|contact|address|postal|unit|apartment|participation|report|moderation|audit|reason|geocod|attendee|location_?id)'
  limit 1;
  if bad is not null then raise exception 'Snapshot contains a denied field: %', bad; end if;
end;
$$;

-- Builds, validates and stores one snapshot, then moves the pointer.
create function app_private.publish_public_snapshot(p_event_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  publication app_private.public_event_publications;
  doc jsonb;
  body_text text;
  new_id uuid;
begin
  select * into publication from app_private.public_event_publications where event_id = p_event_id for update;
  if publication.event_id is null or publication.state not in ('published', 'active') then return null; end if;
  doc := app_private.build_public_snapshot(p_event_id, publication.public_revision + 1);
  perform app_private.assert_public_snapshot_safe(doc);
  body_text := doc::text;
  if octet_length(body_text) > 2097152 then raise exception 'Snapshot too large'; end if;
  insert into app_private.public_snapshots (event_id, public_revision, body, sha256, byte_size, seller_ids, stop_ids, expires_at)
  values (p_event_id, publication.public_revision + 1, body_text,
    encode(extensions.digest(convert_to(body_text, 'UTF8'), 'sha256'), 'hex'), octet_length(body_text),
    array(select s->>'id' from jsonb_array_elements(doc->'sellers') s),
    array(select s->>'id' from jsonb_array_elements(doc->'stops') s),
    (doc->>'expiresAt')::timestamptz)
  returning id into new_id;
  update app_private.public_snapshots set superseded_at = clock_timestamp()
  where id = publication.active_snapshot_id;
  update app_private.public_event_publications set
    active_snapshot_id = new_id, public_revision = public_revision + 1, dirty = false, dirty_since = null,
    generated_at = clock_timestamp(), expires_at = (doc->>'expiresAt')::timestamptz, last_error = null,
    updated_at = clock_timestamp()
  where event_id = p_event_id;
  return new_id;
end;
$$;

-- Called by triggers in the committing transaction.
create function app_private.touch_public_state(p_event_id uuid, p_urgent boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare event_state text;
begin
  select state into event_state from public.events where id = p_event_id;
  if event_state is null or event_state = 'draft' then return; end if;
  if event_state in ('published', 'active') then
    insert into app_private.public_event_publications (event_id, state)
    values (p_event_id, event_state)
    on conflict (event_id) do update set
      state = excluded.state,
      dirty = true,
      dirty_since = coalesce(app_private.public_event_publications.dirty_since, clock_timestamp()),
      safety_sequence = app_private.public_event_publications.safety_sequence + case when p_urgent then 1 else 0 end,
      updated_at = clock_timestamp();
  else
    -- Tombstone: no precise data survives postponement, end, cancellation or archive.
    insert into app_private.public_event_publications (event_id, state, dirty, dirty_since)
    values (p_event_id, event_state, false, null)
    on conflict (event_id) do update set
      state = excluded.state, active_snapshot_id = null, dirty = false, dirty_since = null,
      safety_sequence = app_private.public_event_publications.safety_sequence + 1,
      updated_at = clock_timestamp();
    delete from app_private.public_snapshots where event_id = p_event_id;
  end if;
end;
$$;

create function app_private.touch_public_from_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.touch_public_state(new.id,
    new.state is distinct from old.state or new.early_location_visibility is distinct from old.early_location_visibility
    or new.public_key is distinct from old.public_key);
  return null;
end;
$$;
create trigger events_touch_public
after update on public.events
for each row when (old.* is distinct from new.*)
execute function app_private.touch_public_from_event();

-- Changes that can remove someone from the public map are urgent.
create function app_private.touch_public_from_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target_event uuid;
begin
  if tg_argv[0] = 'event' then
    target_event := (row_data->>'event_id')::uuid;
  else
    select event_id into target_event from public.seller_participations
    where id = (row_data->>'participation_id')::uuid;
  end if;
  if target_event is not null then
    perform app_private.touch_public_state(target_event, tg_argv[1]::boolean);
  end if;
  return null;
end;
$$;

create trigger seller_participations_touch_public after insert or update or delete on public.seller_participations
for each row execute function app_private.touch_public_from_row('event', 'true');
create trigger event_locations_touch_public after insert or update or delete on public.event_locations
for each row execute function app_private.touch_public_from_row('event', 'true');
create trigger seller_live_status_touch_public after insert or update or delete on public.seller_live_status
for each row execute function app_private.touch_public_from_row('participation', 'true');
create trigger seller_listings_touch_public after insert or update or delete on public.seller_listings
for each row execute function app_private.touch_public_from_row('participation', 'false');
create trigger highlighted_items_touch_public after insert or update or delete on public.highlighted_items
for each row execute function app_private.touch_public_from_row('participation', 'false');
create trigger seller_tags_touch_public after insert or update or delete on public.seller_tags
for each row execute function app_private.touch_public_from_row('participation', 'false');
create trigger seller_categories_touch_public after insert or update or delete on public.seller_category_assignments
for each row execute function app_private.touch_public_from_row('participation', 'false');
create trigger seller_availability_touch_public after insert or update or delete on public.seller_availability
for each row execute function app_private.touch_public_from_row('participation', 'false');
create trigger event_intervals_touch_public after insert or update or delete on public.event_intervals
for each row execute function app_private.touch_public_from_row('event', 'false');
create trigger event_boundaries_touch_public after insert or update or delete on public.event_boundaries
for each row execute function app_private.touch_public_from_row('event', 'false');
create trigger event_taxonomies_touch_public after insert or update or delete on public.event_taxonomies
for each row execute function app_private.touch_public_from_row('event', 'false');

-- Worker, every 30 seconds: rebuild dirty publications, delete superseded
-- snapshots after 60 seconds and expired ones at their hard expiry. A failed
-- build keeps the previous safe snapshot and records the error.
create function app_private.refresh_public_snapshots_command()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  target uuid;
  built integer := 0;
begin
  for target in
    select event_id from app_private.public_event_publications
    where dirty and state in ('published', 'active') order by dirty_since nulls last limit 50
  loop
    begin
      perform app_private.publish_public_snapshot(target);
      built := built + 1;
    exception when others then
      update app_private.public_event_publications set last_error = left(sqlerrm, 200), updated_at = clock_timestamp()
      where event_id = target;
    end;
  end loop;
  delete from app_private.public_snapshots
  where superseded_at <= clock_timestamp() - interval '60 seconds' or expires_at <= clock_timestamp();
  return built;
end;
$$;
select cron.schedule('promenadis-refresh-public-snapshots', '30 seconds',
  'select app_private.refresh_public_snapshots_command();');

create function app_private.public_event_for_route(p_route text, p_key text)
returns public.events language sql stable set search_path = '' as $$
  select e.* from public.events e
  where p_key ~ '^[0-9a-f]{32}$' and e.public_key = p_key and e.visibility = p_route and e.state <> 'draft';
$$;

create function public.public_event_manifest_command(p_route text, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  publication app_private.public_event_publications;
  snapshot app_private.public_snapshots;
begin
  event_row := app_private.public_event_for_route(p_route, p_key);
  if event_row.id is null then
    return jsonb_build_object('status', case when exists (
      select 1 from public.retired_event_keys where public_key = p_key) then 'gone' else 'not_found' end);
  end if;
  select * into publication from app_private.public_event_publications where event_id = event_row.id;
  select * into snapshot from app_private.public_snapshots
  where id = publication.active_snapshot_id and expires_at > clock_timestamp();
  return jsonb_build_object('status', 'ok', 'manifest', jsonb_build_object(
    'schemaVersion', '1.0',
    'eventKey', event_row.public_key,
    'state', case when event_row.state = 'archived' then 'ended' else event_row.state end,
    'publicRevision', coalesce(publication.public_revision, 0),
    'safetySequence', coalesce(publication.safety_sequence, 1),
    'routingVersion', null,
    'snapshot', case when snapshot.id is not null then jsonb_build_object(
      'id', snapshot.id, 'sha256', snapshot.sha256, 'byteSize', snapshot.byte_size) end,
    'generatedAt', coalesce(publication.generated_at, clock_timestamp()),
    'expiresAt', coalesce(app_private.public_expiry(event_row.id), clock_timestamp())
  ));
end;
$$;

-- Coordinate-free and computed from authoritative state on every read.
create function public.public_event_safety_feed_command(p_route text, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  publication app_private.public_event_publications;
  snapshot app_private.public_snapshots;
  current_sellers text[];
  current_stops text[];
begin
  event_row := app_private.public_event_for_route(p_route, p_key);
  if event_row.id is null then
    return jsonb_build_object('status', case when exists (
      select 1 from public.retired_event_keys where public_key = p_key) then 'gone' else 'not_found' end);
  end if;
  select * into publication from app_private.public_event_publications where event_id = event_row.id;
  select * into snapshot from app_private.public_snapshots where id = publication.active_snapshot_id;
  current_sellers := array(select app_private.public_id(event_row, 'seller', p.id)
    from app_private.publishable_participations(event_row.id) p);
  current_stops := array(select app_private.public_id(event_row, 'stop', p.location_id)
    from app_private.publishable_participations(event_row.id) p);
  return jsonb_build_object('status', 'ok', 'feed', jsonb_build_object(
    'schemaVersion', '1.0',
    'eventKey', event_row.public_key,
    'sequence', coalesce(publication.safety_sequence, 1),
    'state', case when event_row.state = 'archived' then 'ended' else event_row.state end,
    'removedSellerIds', to_jsonb(array(select s from unnest(coalesce(snapshot.seller_ids, '{}')) s
      where s <> all (current_sellers) order by s)),
    'removedStopIds', to_jsonb(array(select s from unnest(coalesce(snapshot.stop_ids, '{}')) s
      where s <> all (current_stops) order by s)),
    'awaySellerIds', to_jsonb(array(select app_private.public_id(event_row, 'seller', p.id)
      from app_private.publishable_participations(event_row.id) p
      join public.seller_live_status s on s.participation_id = p.id and s.status = 'away' order by 1)),
    'blockedEdgeIds', '[]'::jsonb,
    'requiredGraphVersion', null,
    'generatedAt', clock_timestamp(),
    'expiresAt', least(clock_timestamp() + interval '2 minutes',
      coalesce(app_private.public_expiry(event_row.id), clock_timestamp()))
  ));
end;
$$;

-- Serves exact stored bytes while the snapshot is current or within its
-- 60-second handover, and never after hard expiry.
create function public.public_snapshot_command(p_snapshot_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('body', s.body, 'sha256', s.sha256, 'expiresAt', s.expires_at,
    'unlisted', e.visibility = 'unlisted')
  from app_private.public_snapshots s join public.events e on e.id = s.event_id
  where s.id = p_snapshot_id and s.expires_at > clock_timestamp()
    and (s.superseded_at is null or s.superseded_at > clock_timestamp() - interval '60 seconds')
    and e.state in ('published', 'active');
$$;

create function public.set_early_location_visibility_command(
  p_actor_id uuid, p_event_id uuid, p_expected_event_version integer, p_visible boolean, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare event_row public.events;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Actor cannot manage admission'; end if;
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.version is distinct from p_expected_event_version then raise exception 'Event version conflict'; end if;
  if event_row.state not in ('draft', 'published') then raise exception 'Early visibility is locked'; end if;
  update public.events set early_location_visibility = p_visible, version = version + 1 where id = p_event_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.early_visibility_set', 'event', p_event_id, p_event_id,
    jsonb_build_object('visible', p_visible));
  return jsonb_build_object('earlyLocationVisibility', p_visible, 'version', event_row.version + 1);
end;
$$;

-- Same as before, plus the host's early-visibility choice.
create or replace function public.list_event_sellers_command(p_actor_id uuid, p_event_id uuid)
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
    'earlyLocationVisibility', event_row.early_location_visibility,
    'sellerLimit', (select seller_limit from public.event_entitlements where event_id = p_event_id),
    'placesUsed', app_private.seller_places_used(p_event_id),
    'locationCount', (select count(distinct location_id) from public.seller_participations
      where event_id = p_event_id and state in ('approved', 'suspended', 'pending_address_change')),
    'sellers', coalesce((select jsonb_agg(app_private.seller_participation_summary(p, true)
        order by p.applied_at, p.id)
      from public.seller_participations p where p.event_id = p_event_id), '[]'::jsonb));
end;
$$;

-- Public delivery exists now; walking routes remain the last system gate.
create or replace function app_private.publication_system_blockers(p_event_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select '["routing_not_ready"]'::jsonb;
$$;

-- Existing published events get a publication row.
insert into app_private.public_event_publications (event_id, state)
select id, state from public.events where state in ('published', 'active')
on conflict do nothing;

alter table app_private.public_event_publications enable row level security;
alter table app_private.public_snapshots enable row level security;
revoke all on app_private.public_event_publications, app_private.public_snapshots from public, anon, authenticated;
revoke all on function app_private.public_id(public.events, text, uuid) from public, anon, authenticated;
revoke all on function app_private.public_expiry(uuid) from public, anon, authenticated;
revoke all on function app_private.publishable_participations(uuid) from public, anon, authenticated;
revoke all on function app_private.build_public_snapshot(uuid, bigint) from public, anon, authenticated;
revoke all on function app_private.assert_public_snapshot_safe(jsonb) from public, anon, authenticated;
revoke all on function app_private.publish_public_snapshot(uuid) from public, anon, authenticated;
revoke all on function app_private.touch_public_state(uuid, boolean) from public, anon, authenticated;
revoke all on function app_private.touch_public_from_event() from public, anon, authenticated;
revoke all on function app_private.touch_public_from_row() from public, anon, authenticated;
revoke all on function app_private.refresh_public_snapshots_command() from public, anon, authenticated;
revoke all on function app_private.public_event_for_route(text, text) from public, anon, authenticated;
revoke all on function public.public_event_manifest_command(text, text) from public, anon, authenticated;
revoke all on function public.public_event_safety_feed_command(text, text) from public, anon, authenticated;
revoke all on function public.public_snapshot_command(uuid) from public, anon, authenticated;
revoke all on function public.set_early_location_visibility_command(uuid, uuid, integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.public_event_manifest_command(text, text) to service_role;
grant execute on function public.public_event_safety_feed_command(text, text) to service_role;
grant execute on function public.public_snapshot_command(uuid) to service_role;
grant execute on function public.set_early_location_visibility_command(uuid, uuid, integer, boolean, uuid) to service_role;
