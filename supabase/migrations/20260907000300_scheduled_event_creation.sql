create table public.event_intervals (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  position smallint not null default 1 check (position > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint event_intervals_time_order check (ends_at > starts_at),
  constraint event_intervals_position_unique unique (event_id, position)
);

create index event_intervals_event_time
on public.event_intervals (event_id, starts_at, ends_at);

create trigger event_intervals_touch_updated_at
before update on public.event_intervals
for each row execute function app_private.touch_updated_at();

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
          ), '[]'::jsonb)
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

create or replace function public.create_scheduled_draft_event_command(
  p_actor_id uuid,
  p_organizer_profile_id uuid,
  p_public_organizer_name text,
  p_title text,
  p_description text,
  p_timezone text,
  p_visibility text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_correlation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
  selected_organizer_id uuid := p_organizer_profile_id;
  managed_organizer_count integer;
  normalized_public_name text := btrim(coalesce(p_public_organizer_name, ''));
  normalized_title text := btrim(p_title);
  normalized_description text := btrim(p_description);
  normalized_timezone text := btrim(p_timezone);
begin
  perform 1
  from public.profiles
  where account_id = p_actor_id
  for update;

  if not found then
    raise exception 'Account profile not found';
  end if;

  if selected_organizer_id is null then
    select count(*)
    into managed_organizer_count
    from public.organizer_profile_memberships
    where account_id = p_actor_id
      and role in ('owner', 'manager');

    if managed_organizer_count = 0 then
      if char_length(normalized_public_name) not between 1 and 100 then
        raise exception 'Public organizer name is required';
      end if;

      insert into public.organizer_profiles (
        organizer_type,
        display_name,
        created_by_account_id
      ) values (
        'individual',
        normalized_public_name,
        p_actor_id
      ) returning id into selected_organizer_id;

      insert into public.organizer_profile_memberships (
        organizer_profile_id,
        account_id,
        role
      ) values (
        selected_organizer_id,
        p_actor_id,
        'owner'
      );

      insert into app_private.audit_events (
        correlation_id,
        actor_account_id,
        action,
        target_type,
        target_id,
        safe_summary
      ) values (
        p_correlation_id,
        p_actor_id,
        'organizer.created',
        'organizer_profile',
        selected_organizer_id,
        jsonb_build_object('organizerType', 'individual', 'createdDuring', 'event_creation')
      );
    elsif managed_organizer_count = 1 then
      select organizer_profile_id
      into selected_organizer_id
      from public.organizer_profile_memberships
      where account_id = p_actor_id
        and role in ('owner', 'manager');
    else
      raise exception 'Organizer selection is required';
    end if;
  elsif not exists (
    select 1
    from public.organizer_profile_memberships
    where organizer_profile_id = selected_organizer_id
      and account_id = p_actor_id
      and role in ('owner', 'manager')
  ) then
    raise exception 'Actor is not an organizer manager';
  end if;

  if char_length(normalized_title) not between 1 and 120 then
    raise exception 'Event title is required';
  end if;
  if char_length(normalized_description) > 2000 then
    raise exception 'Event description is too long';
  end if;
  if p_visibility not in ('public', 'unlisted') then
    raise exception 'Unsupported event visibility';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone
  ) then
    raise exception 'Unsupported event timezone';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Event end must be after its start';
  end if;

  insert into public.events (
    organizer_profile_id,
    created_by_account_id,
    title,
    description,
    timezone,
    visibility,
    state
  ) values (
    selected_organizer_id,
    p_actor_id,
    normalized_title,
    normalized_description,
    normalized_timezone,
    p_visibility,
    'draft'
  ) returning id into event_id;

  insert into public.event_memberships (event_id, account_id, role)
  values (event_id, p_actor_id, 'owner');

  insert into public.event_intervals (event_id, position, starts_at, ends_at)
  values (event_id, 1, p_starts_at, p_ends_at);

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
    'event.draft_created',
    'event',
    event_id,
    event_id,
    jsonb_build_object(
      'visibility', p_visibility,
      'timezone', normalized_timezone,
      'openingIntervalCount', 1
    )
  );

  return event_id;
end;
$$;

alter table public.event_intervals enable row level security;
alter table public.event_intervals force row level security;

revoke all on table public.event_intervals from public, anon, authenticated;
grant select, insert, update, delete on table public.event_intervals to service_role;

revoke all on function public.create_scheduled_draft_event_command(
  uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.create_scheduled_draft_event_command(
  uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, uuid
) to service_role;

comment on table public.event_intervals is
  'Canonical event opening intervals. The launch UI creates one interval while the model supports many.';
comment on function public.create_scheduled_draft_event_command(
  uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, uuid
) is
  'Creates a scheduled draft and owner atomically, creating the first individual organizer profile when needed.';
