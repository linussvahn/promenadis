-- Milestone 3, slice 3.
--
-- Removals in the safety feed are now relative to every ID this event has
-- ever published, not only the newest snapshot: an open page may still hold
-- an older snapshot when the worker has already rebuilt without the seller.
alter table app_private.public_event_publications
  add column published_seller_ids text[] not null default '{}',
  add column published_stop_ids text[] not null default '{}';

create or replace function app_private.publish_public_snapshot(p_event_id uuid)
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
    published_seller_ids = array(select distinct unnest(published_seller_ids
      || array(select s->>'id' from jsonb_array_elements(doc->'sellers') s)) order by 1),
    published_stop_ids = array(select distinct unnest(published_stop_ids
      || array(select s->>'id' from jsonb_array_elements(doc->'stops') s)) order by 1),
    updated_at = clock_timestamp()
  where event_id = p_event_id;
  return new_id;
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
    'blockedEdgeIds', '[]'::jsonb,
    'requiredGraphVersion', null,
    'generatedAt', clock_timestamp(),
    'expiresAt', least(clock_timestamp() + interval '2 minutes',
      coalesce(app_private.public_expiry(event_row.id), clock_timestamp()))
  ));
end;
$$;


-- Reports from the public map. Visitors only ever see
-- opaque public IDs, so a report names the event key and a public stop or
-- seller ID; this resolves it to the private subject while it is public.
create function public.resolve_public_report_subject_command(
  p_event_key text, p_subject_type text, p_public_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  subject uuid;
begin
  if p_event_key !~ '^[0-9a-f]{32}$' or p_public_id !~ '^[0-9a-f]{24}$'
    or p_subject_type not in ('location', 'participation')
  then return null; end if;
  select * into event_row from public.events where public_key = p_event_key and state in ('published', 'active');
  if event_row.id is null then return null; end if;
  select case when p_subject_type = 'location' then p.location_id else p.id end into subject
  from app_private.publishable_participations(event_row.id) p
  where app_private.public_id(event_row, case when p_subject_type = 'location' then 'stop' else 'seller' end,
    case when p_subject_type = 'location' then p.location_id else p.id end) = p_public_id
  limit 1;
  if subject is null then return null; end if;
  return jsonb_build_object('eventId', event_row.id, 'subjectId', subject);
end;
$$;

revoke all on function public.resolve_public_report_subject_command(text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_public_report_subject_command(text, text, text) to service_role;
