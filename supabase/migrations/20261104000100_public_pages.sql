-- Milestone 3, slice 1: sanitized public and unlisted landing pages,
-- discovery, organizer pages and the sitemap.
--
-- Every event gets a 128-bit route key. A public event is served at
-- /e/{key}, an unlisted one at /u/{key}; a key never resolves on the other
-- path. Changing visibility or rotating an unlisted link retires the old key,
-- which then answers 410 without a redirect. Public reads return only
-- event-level fields: no seller, location, account or moderation data.

alter table public.events
  add column public_key text not null unique
    default encode(extensions.gen_random_bytes(16), 'hex')
    check (public_key ~ '^[0-9a-f]{32}$');
alter table public.organizer_profiles
  add column public_key text not null unique
    default encode(extensions.gen_random_bytes(12), 'hex')
    check (public_key ~ '^[0-9a-f]{24}$');

create table public.retired_event_keys (
  public_key text primary key check (public_key ~ '^[0-9a-f]{32}$'),
  event_id uuid references public.events(id) on delete set null,
  reason text not null check (reason in ('visibility_changed', 'rotated', 'deleted')),
  retired_at timestamptz not null default clock_timestamp()
);
alter table public.retired_event_keys enable row level security;
revoke all on public.retired_event_keys from public, anon, authenticated;

create function app_private.retire_event_key_on_visibility()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.visibility is distinct from old.visibility and new.public_key = old.public_key then
    insert into public.retired_event_keys (public_key, event_id, reason)
    values (old.public_key, old.id, 'visibility_changed');
    new.public_key := encode(extensions.gen_random_bytes(16), 'hex');
  end if;
  return new;
end;
$$;
create trigger events_retire_key_on_visibility
before update of visibility on public.events
for each row execute function app_private.retire_event_key_on_visibility();

-- A deleted event that was ever published answers 410, not 404.
create function app_private.retire_event_key_on_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state <> 'draft' then
    insert into public.retired_event_keys (public_key, event_id, reason)
    values (old.public_key, null, 'deleted')
    on conflict (public_key) do nothing;
  end if;
  return old;
end;
$$;
create trigger events_retire_key_on_delete
before delete on public.events
for each row execute function app_private.retire_event_key_on_delete();

create function app_private.organizer_verified(p_organizer_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((
    select v.status = 'verified' and v.recheck_due_at > clock_timestamp()
    from app_private.organizer_verifications v where v.organizer_profile_id = p_organizer_id
  ), false);
$$;

-- Event-level public fields only. Archived events keep a minimal shell.
create function app_private.public_event_summary(p_event public.events)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'publicKey', p_event.public_key,
    'visibility', p_event.visibility,
    'state', p_event.state,
    'title', p_event.title,
    'description', case when p_event.state = 'archived' then '' else p_event.description end,
    'publicNotice', case when p_event.state in ('postponed', 'cancelled') then p_event.public_notice end,
    'timezone', p_event.timezone,
    'areaLabel', case when p_event.state = 'archived' then null else b.display_label end,
    'intervals', coalesce((
      select jsonb_agg(jsonb_build_object('startsAt', i.starts_at, 'endsAt', i.ends_at) order by i.position)
      from public.event_intervals i where i.event_id = p_event.id
    ), '[]'::jsonb),
    'originalStartsAt', case when p_event.state <> 'archived' then p_event.original_starts_at end,
    'organizer', jsonb_build_object(
      'displayName', o.display_name,
      'locality', o.locality,
      -- Unlisted events never link to the organizer's public page.
      'publicKey', case when p_event.visibility = 'public' and o.detached_at is null then o.public_key end,
      'verified', app_private.organizer_verified(o.id)
    ),
    'indexable', p_event.visibility = 'public' and p_event.state <> 'archived',
    'updatedAt', p_event.updated_at
  )
  from public.organizer_profiles o
  left join public.event_boundaries b on b.event_id = p_event.id
  where o.id = p_event.organizer_profile_id;
$$;

create function public.public_event_landing_command(p_route text, p_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare event_row public.events;
begin
  if p_route not in ('public', 'unlisted') or p_key !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('status', 'not_found');
  end if;
  if exists (select 1 from public.retired_event_keys where public_key = p_key) then
    return jsonb_build_object('status', 'gone');
  end if;
  select * into event_row from public.events where public_key = p_key;
  if event_row.id is null or event_row.state = 'draft' or event_row.visibility <> p_route then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'ok', 'event', app_private.public_event_summary(event_row));
end;
$$;

-- Discovery: public events that are upcoming, live, postponed or cancelled
-- (cancelled ones stay listed with their notice until archived). Every query
-- word must match the title, description, organizer, locality or area.
create function public.public_list_events_command(
  p_query text, p_live_only boolean, p_after_starts_at timestamptz, p_after_id uuid, p_limit integer
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  words text[];
  page_size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  found_rows jsonb;
begin
  if char_length(coalesce(p_query, '')) > 100 then raise exception 'Invalid search'; end if;
  words := array(
    select lower(w) from regexp_split_to_table(btrim(coalesce(p_query, '')), '\s+') as w
    where w <> '' limit 8
  );
  with candidates as (
    select e, (select min(i.starts_at) from public.event_intervals i where i.event_id = e.id) as first_start,
      lower(concat_ws(' ', e.title, e.description, o.display_name, o.locality, b.display_label)) as doc
    from public.events e
    join public.organizer_profiles o on o.id = e.organizer_profile_id
    left join public.event_boundaries b on b.event_id = e.id
    where e.visibility = 'public'
      and e.state in ('published', 'active', 'postponed', 'cancelled')
      and (not coalesce(p_live_only, false) or e.state = 'active')
  ), page as (
    select c.* from candidates c
    where (select bool_and(strpos(c.doc, w) > 0) from unnest(words) as w) is not false
      and (p_after_starts_at is null or (c.first_start, (c.e).id) > (p_after_starts_at, p_after_id))
    order by c.first_start, (c.e).id
    limit page_size + 1
  )
  select coalesce(jsonb_agg(app_private.public_event_summary(page.e) || jsonb_build_object('firstStartsAt', page.first_start, 'id', (page.e).id)
    order by page.first_start, (page.e).id), '[]'::jsonb)
  into found_rows from page;
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(r - 'id' order by n) from jsonb_array_elements(found_rows) with ordinality as t(r, n) where n <= page_size), '[]'::jsonb),
    'nextCursor', case when jsonb_array_length(found_rows) > page_size then jsonb_build_object(
      'afterStartsAt', found_rows->(page_size - 1)->>'firstStartsAt',
      'afterId', found_rows->(page_size - 1)->>'id') end
  );
end;
$$;

-- An organizer page exists only while the organizer has public, non-archived
-- event history, so private or unused organizer identities are never exposed.
create function public.public_organizer_page_command(p_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare organizer public.organizer_profiles;
begin
  if p_key !~ '^[0-9a-f]{24}$' then return jsonb_build_object('status', 'not_found'); end if;
  select * into organizer from public.organizer_profiles where public_key = p_key and detached_at is null;
  if organizer.id is null or not exists (
    select 1 from public.events e where e.organizer_profile_id = organizer.id
      and e.visibility = 'public' and e.state not in ('draft', 'archived')
  ) then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok', 'organizer', jsonb_build_object(
    'publicKey', organizer.public_key,
    'displayName', organizer.display_name,
    'locality', organizer.locality,
    'website', organizer.website,
    'verified', app_private.organizer_verified(organizer.id),
    'events', coalesce((
      select jsonb_agg(app_private.public_event_summary(e) order by (
        select min(i.starts_at) from public.event_intervals i where i.event_id = e.id) desc)
      from public.events e
      where e.organizer_profile_id = organizer.id and e.visibility = 'public'
        and e.state not in ('draft', 'archived')
    ), '[]'::jsonb)
  ));
end;
$$;

create function public.public_sitemap_command()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('publicKey', e.public_key, 'updatedAt', e.updated_at) order by e.public_key)
      from public.events e where e.visibility = 'public' and e.state not in ('draft', 'archived')
    ), '[]'::jsonb),
    'organizers', coalesce((
      select jsonb_agg(jsonb_build_object('publicKey', o.public_key, 'updatedAt', o.updated_at) order by o.public_key)
      from public.organizer_profiles o
      where o.detached_at is null and exists (
        select 1 from public.events e where e.organizer_profile_id = o.id
          and e.visibility = 'public' and e.state not in ('draft', 'archived'))
    ), '[]'::jsonb)
  );
$$;

-- Team-only: the event's own public link.
create function public.get_event_public_link_command(p_actor_id uuid, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare event_row public.events;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id)
  then raise exception 'Actor is not an event team member'; end if;
  select * into event_row from public.events where id = p_event_id;
  return jsonb_build_object(
    'eventId', event_row.id,
    'publicKey', event_row.public_key,
    'visibility', event_row.visibility,
    'state', event_row.state,
    'version', event_row.version,
    'live', event_row.state <> 'draft'
  );
end;
$$;

-- Owner-only. Before activation any owner may rotate a leaked unlisted link;
-- during an active event only with a stated safety reason.
create function public.rotate_unlisted_link_command(
  p_actor_id uuid, p_event_id uuid, p_expected_event_version integer, p_safety_reason text,
  p_authenticated_at timestamptz, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare event_row public.events;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role = 'owner')
  then raise exception 'Only the event owner can rotate the link'; end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.version is distinct from p_expected_event_version then raise exception 'Event version conflict'; end if;
  if event_row.visibility <> 'unlisted' then raise exception 'Only unlisted links can be rotated'; end if;
  if event_row.state not in ('draft', 'published', 'postponed', 'active') then
    raise exception 'This link can no longer be rotated';
  end if;
  if event_row.state = 'active' and char_length(btrim(coalesce(p_safety_reason, ''))) not between 3 and 500 then
    raise exception 'Safety reason required';
  end if;
  insert into public.retired_event_keys (public_key, event_id, reason)
  values (event_row.public_key, event_row.id, 'rotated');
  update public.events set public_key = encode(extensions.gen_random_bytes(16), 'hex'), version = version + 1
  where id = p_event_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.unlisted_link_rotated', 'event', p_event_id, p_event_id,
    jsonb_build_object('state', event_row.state, 'safetyReason', nullif(btrim(coalesce(p_safety_reason, '')), '')));
  return public.get_event_public_link_command(p_actor_id, p_event_id);
end;
$$;

revoke all on function app_private.retire_event_key_on_visibility() from public, anon, authenticated;
revoke all on function app_private.retire_event_key_on_delete() from public, anon, authenticated;
revoke all on function app_private.organizer_verified(uuid) from public, anon, authenticated;
revoke all on function app_private.public_event_summary(public.events) from public, anon, authenticated;
revoke all on function public.public_event_landing_command(text, text) from public, anon, authenticated;
revoke all on function public.public_list_events_command(text, boolean, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.public_organizer_page_command(text) from public, anon, authenticated;
revoke all on function public.public_sitemap_command() from public, anon, authenticated;
revoke all on function public.get_event_public_link_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rotate_unlisted_link_command(uuid, uuid, integer, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.public_event_landing_command(text, text) to service_role;
grant execute on function public.public_list_events_command(text, boolean, timestamptz, uuid, integer) to service_role;
grant execute on function public.public_organizer_page_command(text) to service_role;
grant execute on function public.public_sitemap_command() to service_role;
grant execute on function public.get_event_public_link_command(uuid, uuid) to service_role;
grant execute on function public.rotate_unlisted_link_command(uuid, uuid, integer, text, timestamptz, uuid) to service_role;
