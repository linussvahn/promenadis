-- Remaining Milestone 1 commands: edit a draft's core details, edit an
-- organizer profile, duplicate an event shell, and the elevated-admin
-- protective intervention (cancel a published event, end a live one).

alter table public.organizer_profiles
  add column version integer not null default 1 check (version > 0);

-- Same as before plus the organizer version used for optimistic edits.
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
          'role', membership.role,
          'version', organizer.version
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
          'version', event.version,
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
          ),
          'registration', (
            select app_private.event_registration_summary(registration)
            from public.event_registration_settings as registration
            where registration.event_id = event.id
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

-- Organizer type stays fixed: it decides whether managers and verification
-- apply. A name change sends a verified badge back for review (existing trigger).
create function public.update_organizer_profile_command(
  p_actor_id uuid, p_organizer_profile_id uuid, p_expected_version integer,
  p_display_name text, p_locality text, p_website text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  organizer public.organizer_profiles;
  normalized_name text := btrim(coalesce(p_display_name, ''));
  normalized_locality text := nullif(btrim(coalesce(p_locality, '')), '');
  normalized_website text := nullif(btrim(coalesce(p_website, '')), '');
  changed text[] := array[]::text[];
begin
  if not exists (select 1 from public.organizer_profile_memberships
    where organizer_profile_id = p_organizer_profile_id and account_id = p_actor_id
      and role in ('owner', 'manager'))
  then raise exception 'Organizer profile not found'; end if;
  select * into organizer from public.organizer_profiles where id = p_organizer_profile_id for update;
  if organizer.version is distinct from p_expected_version then raise exception 'Organizer version conflict'; end if;
  if char_length(normalized_name) not between 1 and 100
    or char_length(coalesce(normalized_locality, '')) > 100
    or (normalized_website is not null and (normalized_website !~ '^https://' or char_length(normalized_website) > 500))
  then raise exception 'Invalid organizer profile'; end if;

  if normalized_name is distinct from organizer.display_name then changed := array_append(changed, 'displayName'); end if;
  if normalized_locality is distinct from organizer.locality then changed := array_append(changed, 'locality'); end if;
  if normalized_website is distinct from organizer.website then changed := array_append(changed, 'website'); end if;
  if cardinality(changed) > 0 then
    update public.organizer_profiles
    set display_name = normalized_name, locality = normalized_locality, website = normalized_website,
      version = version + 1
    where id = p_organizer_profile_id
    returning * into organizer;
    insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
    values (p_correlation_id, p_actor_id, 'organizer.profile_updated', 'organizer_profile', p_organizer_profile_id,
      jsonb_build_object('changedFields', to_jsonb(changed), 'version', organizer.version));
  end if;
  return jsonb_build_object(
    'id', organizer.id, 'displayName', organizer.display_name, 'organizerType', organizer.organizer_type,
    'locality', organizer.locality, 'website', organizer.website, 'version', organizer.version);
end;
$$;

-- Core draft details. Registration settings that no longer fit the new
-- schedule are reset to the defaults rather than left invalid.
create function public.update_draft_event_details_command(
  p_actor_id uuid, p_event_id uuid, p_expected_version integer, p_title text, p_description text,
  p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  interval_row public.event_intervals;
  registration public.event_registration_settings;
  normalized_title text := btrim(coalesce(p_title, ''));
  normalized_description text := btrim(coalesce(p_description, ''));
  normalized_timezone text := btrim(coalesce(p_timezone, ''));
  changed text[] := array[]::text[];
  registration_reset boolean := false;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Actor cannot edit this event'; end if;
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.state <> 'draft' then raise exception 'Only draft event details can be edited directly'; end if;
  if event_row.version is distinct from p_expected_version then raise exception 'Event version conflict'; end if;
  if char_length(normalized_title) not between 1 and 120 then raise exception 'Event title is required'; end if;
  if char_length(normalized_description) > 2000 then raise exception 'Event description is too long'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone) then
    raise exception 'Unsupported event timezone';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Event end must be after its start';
  end if;

  select * into interval_row from public.event_intervals
  where event_id = p_event_id and position = 1 for update;
  if normalized_title <> event_row.title then changed := array_append(changed, 'title'); end if;
  if normalized_description <> event_row.description then changed := array_append(changed, 'description'); end if;
  if normalized_timezone <> event_row.timezone then changed := array_append(changed, 'timezone'); end if;
  if p_starts_at <> interval_row.starts_at or p_ends_at <> interval_row.ends_at then
    changed := array_append(changed, 'schedule');
  end if;
  if cardinality(changed) = 0 then return app_private.event_control_summary(event_row); end if;

  update public.events
  set title = normalized_title, description = normalized_description, timezone = normalized_timezone,
    version = version + 1
  where id = p_event_id
  returning * into event_row;

  if 'schedule' = any(changed) then
    update public.event_intervals set starts_at = p_starts_at, ends_at = p_ends_at where id = interval_row.id;
    select * into registration from public.event_registration_settings where event_id = p_event_id for update;
    if registration.event_id is not null and (
      (not registration.allow_during_event and registration.closes_at > p_starts_at)
      or (registration.allow_during_event and registration.closes_at > p_ends_at)
    ) then
      update public.event_registration_settings
      set opens_at = least(clock_timestamp(), p_starts_at - interval '2 hours'),
        closes_at = p_starts_at - interval '1 hour', allow_during_event = false, version = version + 1
      where event_id = p_event_id;
      registration_reset := true;
    end if;
  end if;

  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.details_updated', 'event', p_event_id, p_event_id,
    jsonb_build_object('changedFields', to_jsonb(changed), 'registrationReset', registration_reset,
      'version', event_row.version));
  return app_private.event_control_summary(event_row) || jsonb_build_object('registrationReset', registration_reset);
end;
$$;

-- Copies configuration, description and boundary into a new owner-only draft.
-- Never copies dates, team, sellers, addresses, reports, routes or audit records.
create function public.duplicate_event_command(
  p_actor_id uuid, p_source_event_id uuid, p_organizer_profile_id uuid, p_title text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_correlation_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  source public.events;
  new_event_id uuid;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_source_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Actor cannot duplicate this event'; end if;
  select * into source from public.events where id = p_source_event_id;

  new_event_id := public.create_scheduled_draft_event_command(
    p_actor_id, coalesce(p_organizer_profile_id, source.organizer_profile_id), '',
    p_title, source.description, source.timezone, source.visibility, p_starts_at, p_ends_at, p_correlation_id);

  insert into public.event_boundaries (event_id, boundary, display_label, area_square_meters, span_meters)
  select new_event_id, boundary, display_label, area_square_meters, span_meters
  from public.event_boundaries where event_id = p_source_event_id;

  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.duplicated', 'event', new_event_id, new_event_id,
    jsonb_build_object('sourceEventId', p_source_event_id,
      'boundaryCopied', exists (select 1 from public.event_boundaries where event_id = new_event_id)));
  return new_event_id;
end;
$$;

-- Elevated admins can look up one event by id for a protective intervention.
create function public.admin_get_event_command(
  p_actor_id uuid, p_auth_session_id uuid, p_event_id uuid, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  select jsonb_build_object(
      'id', e.id, 'title', e.title, 'state', e.state, 'timezone', e.timezone, 'visibility', e.visibility, 'version', e.version,
      'organizerDisplayName', o.display_name,
      'startsAt', (select min(i.starts_at) from public.event_intervals i where i.event_id = e.id),
      'endsAt', (select max(i.ends_at) from public.event_intervals i where i.event_id = e.id))
  into result
  from public.events e join public.organizer_profiles o on o.id = e.organizer_profile_id
  where e.id = p_event_id;
  if result is null then raise exception 'Event not found'; end if;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.event_read', 'event', p_event_id, p_event_id, '{}'::jsonb);
  return result;
end;
$$;

-- Protective only: cancel a published/postponed event or end a live one.
-- The internal reason stays in the restricted audit record; the public reason
-- becomes the cancellation notice.
create function public.admin_intervene_event_command(
  p_actor_id uuid, p_auth_session_id uuid, p_event_id uuid, p_expected_event_version integer,
  p_action text, p_public_reason text, p_internal_reason text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  new_state text;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  if p_action not in ('cancel', 'end_early')
    or char_length(btrim(coalesce(p_internal_reason, ''))) not between 3 and 500
    or (p_action = 'cancel' and char_length(btrim(coalesce(p_public_reason, ''))) not between 3 and 500)
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

revoke all on function public.update_organizer_profile_command(uuid,uuid,integer,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.update_draft_event_details_command(uuid,uuid,integer,text,text,text,timestamptz,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.duplicate_event_command(uuid,uuid,uuid,text,timestamptz,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.admin_get_event_command(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.admin_intervene_event_command(uuid,uuid,uuid,integer,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.update_organizer_profile_command(uuid,uuid,integer,text,text,text,uuid) to service_role;
grant execute on function public.update_draft_event_details_command(uuid,uuid,integer,text,text,text,timestamptz,timestamptz,uuid) to service_role;
grant execute on function public.duplicate_event_command(uuid,uuid,uuid,text,timestamptz,timestamptz,uuid) to service_role;
grant execute on function public.admin_get_event_command(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.admin_intervene_event_command(uuid,uuid,uuid,integer,text,text,text,uuid) to service_role;
