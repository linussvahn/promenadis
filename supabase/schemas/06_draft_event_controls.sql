alter table public.events
add column version integer not null default 1 check (version > 0);

create or replace function app_private.event_control_summary(p_event public.events)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_event.id,
    'state', p_event.state,
    'version', p_event.version,
    'visibility', p_event.visibility
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

create or replace function public.update_draft_event_visibility_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_expected_version integer,
  p_visibility text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events;
  previous_visibility text;
begin
  if not exists (
    select 1
    from public.event_memberships
    where event_id = p_event_id
      and account_id = p_actor_id
      and role in ('owner', 'co_host')
  ) then
    raise exception 'Actor cannot manage event visibility';
  end if;

  select *
  into event_row
  from public.events
  where id = p_event_id
  for update;

  if event_row.state <> 'draft' then
    raise exception 'Only draft event visibility can be edited directly';
  end if;
  if p_visibility not in ('public', 'unlisted') then
    raise exception 'Unsupported event visibility';
  end if;
  if p_expected_version is distinct from event_row.version then
    raise exception 'Event version conflict';
  end if;
  if p_visibility = event_row.visibility then
    return app_private.event_control_summary(event_row);
  end if;

  previous_visibility := event_row.visibility;

  update public.events
  set visibility = p_visibility,
      version = version + 1
  where id = p_event_id
  returning * into event_row;

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
    'event.visibility_changed',
    'event',
    p_event_id,
    p_event_id,
    jsonb_build_object(
      'after', event_row.visibility,
      'before', previous_visibility,
      'version', event_row.version
    )
  );

  return app_private.event_control_summary(event_row);
end;
$$;

create or replace function public.delete_draft_event_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_expected_version integer,
  p_confirm_title text,
  p_authenticated_at timestamptz,
  p_correlation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events;
begin
  if not exists (
    select 1
    from public.event_memberships
    where event_id = p_event_id
      and account_id = p_actor_id
      and role = 'owner'
  ) then
    raise exception 'Only the event owner can delete a draft';
  end if;

  select *
  into event_row
  from public.events
  where id = p_event_id
  for update;

  if event_row.state <> 'draft' then
    raise exception 'Only draft events can be deleted';
  end if;
  if p_expected_version is distinct from event_row.version then
    raise exception 'Event version conflict';
  end if;
  if btrim(coalesce(p_confirm_title, '')) <> event_row.title then
    raise exception 'Event title confirmation does not match';
  end if;
  if p_authenticated_at is null
    or p_authenticated_at < clock_timestamp() - interval '15 minutes'
    or p_authenticated_at > clock_timestamp() + interval '1 minute'
  then
    raise exception 'Recent authentication required';
  end if;

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
    'event.draft_deleted',
    'event',
    p_event_id,
    p_event_id,
    jsonb_build_object(
      'state', event_row.state,
      'version', event_row.version,
      'visibility', event_row.visibility
    )
  );

  delete from public.events where id = p_event_id;
  return p_event_id;
end;
$$;

revoke all on function app_private.event_control_summary(public.events)
from public, anon, authenticated;
grant execute on function app_private.event_control_summary(public.events)
to service_role;

revoke all on function public.update_draft_event_visibility_command(
  uuid, uuid, integer, text, uuid
) from public, anon, authenticated;
grant execute on function public.update_draft_event_visibility_command(
  uuid, uuid, integer, text, uuid
) to service_role;

revoke all on function public.delete_draft_event_command(
  uuid, uuid, integer, text, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.delete_draft_event_command(
  uuid, uuid, integer, text, timestamptz, uuid
) to service_role;

comment on function public.update_draft_event_visibility_command(
  uuid, uuid, integer, text, uuid
) is
  'Changes draft visibility for an owner or co-host with optimistic concurrency and an audit event.';
comment on function public.delete_draft_event_command(
  uuid, uuid, integer, text, timestamptz, uuid
) is
  'Permanently deletes an owner-controlled draft after version, exact-title, and recent-authentication checks.';
