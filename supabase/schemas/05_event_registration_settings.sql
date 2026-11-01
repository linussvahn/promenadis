create table public.event_registration_settings (
  event_id uuid primary key references public.events (id) on delete cascade,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  allow_during_event boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint event_registration_settings_time_order check (closes_at > opens_at),
  constraint event_registration_settings_timestamp_order check (updated_at >= created_at)
);

create trigger event_registration_settings_touch_updated_at
before update on public.event_registration_settings
for each row execute function app_private.touch_updated_at();

create or replace function app_private.create_default_event_registration_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.position = 1 then
    insert into public.event_registration_settings (
      event_id,
      opens_at,
      closes_at,
      allow_during_event
    ) values (
      new.event_id,
      least(clock_timestamp(), new.starts_at - interval '2 hours'),
      new.starts_at - interval '1 hour',
      false
    )
    on conflict (event_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger event_intervals_create_default_registration
after insert on public.event_intervals
for each row execute function app_private.create_default_event_registration_settings();

insert into public.event_registration_settings (
  event_id,
  opens_at,
  closes_at,
  allow_during_event
)
select
  event.id,
  least(event.created_at, first_interval.starts_at - interval '2 hours'),
  first_interval.starts_at - interval '1 hour',
  false
from public.events as event
join lateral (
  select event_interval.starts_at
  from public.event_intervals as event_interval
  where event_interval.event_id = event.id
  order by event_interval.position
  limit 1
) as first_interval on true
on conflict (event_id) do nothing;

create or replace function app_private.event_registration_summary(
  p_registration public.event_registration_settings
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'allowDuringEvent', p_registration.allow_during_event,
    'closesAt', p_registration.closes_at,
    'opensAt', p_registration.opens_at,
    'version', p_registration.version
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

create or replace function public.upsert_draft_event_registration_command(
  p_actor_id uuid,
  p_event_id uuid,
  p_expected_version integer,
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_allow_during_event boolean,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  registration_row public.event_registration_settings;
  event_state text;
  first_start timestamptz;
  last_end timestamptz;
  current_version integer;
begin
  if not exists (
    select 1
    from public.event_memberships
    where event_id = p_event_id
      and account_id = p_actor_id
      and role in ('owner', 'co_host')
  ) then
    raise exception 'Actor cannot manage event registration';
  end if;

  select state
  into event_state
  from public.events
  where id = p_event_id
  for update;

  if event_state is null then
    raise exception 'Event not found';
  end if;
  if event_state <> 'draft' then
    raise exception 'Only draft event registration can be edited directly';
  end if;

  select min(starts_at), max(ends_at)
  into first_start, last_end
  from public.event_intervals
  where event_id = p_event_id;

  if first_start is null or last_end is null then
    raise exception 'Event schedule is required';
  end if;
  if p_opens_at is null or p_closes_at is null or p_closes_at <= p_opens_at then
    raise exception 'Registration close must be after registration open';
  end if;
  if not p_allow_during_event and p_closes_at > first_start then
    raise exception 'Registration cannot close after event start without active-event opt-in';
  end if;
  if p_allow_during_event and p_closes_at > last_end then
    raise exception 'Registration cannot close after event end';
  end if;

  select version
  into current_version
  from public.event_registration_settings
  where event_id = p_event_id;

  if (current_version is null and p_expected_version is not null)
    or (current_version is not null and p_expected_version is distinct from current_version)
  then
    raise exception 'Event registration version conflict';
  end if;

  insert into public.event_registration_settings (
    event_id,
    opens_at,
    closes_at,
    allow_during_event,
    version
  ) values (
    p_event_id,
    p_opens_at,
    p_closes_at,
    p_allow_during_event,
    1
  )
  on conflict (event_id) do update
  set opens_at = excluded.opens_at,
      closes_at = excluded.closes_at,
      allow_during_event = excluded.allow_during_event,
      version = public.event_registration_settings.version + 1
  returning * into registration_row;

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
    'event.registration_saved',
    'event_registration',
    p_event_id,
    p_event_id,
    jsonb_build_object(
      'allowDuringEvent', registration_row.allow_during_event,
      'closesAt', registration_row.closes_at,
      'opensAt', registration_row.opens_at,
      'version', registration_row.version
    )
  );

  return app_private.event_registration_summary(registration_row);
end;
$$;

alter table public.event_registration_settings enable row level security;
alter table public.event_registration_settings force row level security;

revoke all on table public.event_registration_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.event_registration_settings to service_role;

revoke all on function app_private.create_default_event_registration_settings()
from public, anon, authenticated;
grant execute on function app_private.create_default_event_registration_settings()
to service_role;

revoke all on function app_private.event_registration_summary(public.event_registration_settings)
from public, anon, authenticated;
grant execute on function app_private.event_registration_summary(public.event_registration_settings)
to service_role;

revoke all on function public.upsert_draft_event_registration_command(
  uuid, uuid, integer, timestamptz, timestamptz, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.upsert_draft_event_registration_command(
  uuid, uuid, integer, timestamptz, timestamptz, boolean, uuid
) to service_role;

comment on table public.event_registration_settings is
  'Versioned seller-registration window for one event; browser roles have no direct access.';
comment on function public.upsert_draft_event_registration_command(
  uuid, uuid, integer, timestamptz, timestamptz, boolean, uuid
) is
  'Validates and version-checks one draft registration window, including explicit active-event opt-in, and audits the save.';
