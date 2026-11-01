create table public.profiles (
  account_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  preferred_locale text not null default 'sv' check (preferred_locale in ('sv', 'en')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint profiles_display_name check (
    display_name is null
    or (display_name = btrim(display_name) and char_length(display_name) between 1 and 80)
  ),
  constraint profiles_timestamp_order check (updated_at >= created_at)
);

create table public.organizer_profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  organizer_type text not null check (
    organizer_type in ('individual', 'informal_group', 'association', 'company')
  ),
  display_name text not null,
  locality text,
  website text,
  created_by_account_id uuid not null references public.profiles (account_id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint organizer_profiles_display_name check (
    display_name = btrim(display_name) and char_length(display_name) between 1 and 100
  ),
  constraint organizer_profiles_locality check (
    locality is null
    or (locality = btrim(locality) and char_length(locality) between 1 and 100)
  ),
  constraint organizer_profiles_website check (
    website is null
    or (char_length(website) <= 500 and website ~ '^https://')
  ),
  constraint organizer_profiles_timestamp_order check (updated_at >= created_at)
);

create table public.organizer_profile_memberships (
  organizer_profile_id uuid not null references public.organizer_profiles (id) on delete cascade,
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  role text not null check (role in ('owner', 'manager')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organizer_profile_id, account_id)
);

create unique index organizer_profiles_one_owner
on public.organizer_profile_memberships (organizer_profile_id)
where role = 'owner';

create table public.events (
  id uuid primary key default extensions.gen_random_uuid(),
  organizer_profile_id uuid not null references public.organizer_profiles (id) on delete restrict,
  created_by_account_id uuid not null references public.profiles (account_id) on delete restrict,
  title text not null,
  description text not null default '',
  timezone text not null default 'Europe/Stockholm',
  state text not null default 'draft' check (
    state in ('draft', 'published', 'active', 'postponed', 'ended', 'cancelled', 'archived')
  ),
  visibility text not null default 'public' check (visibility in ('public', 'unlisted')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint events_title check (title = btrim(title) and char_length(title) between 1 and 120),
  constraint events_description check (char_length(description) <= 2000),
  constraint events_timezone check (
    timezone = btrim(timezone) and char_length(timezone) between 1 and 100
  ),
  constraint events_timestamp_order check (updated_at >= created_at)
);

create table public.event_memberships (
  event_id uuid not null references public.events (id) on delete cascade,
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  role text not null check (role in ('owner', 'co_host', 'moderator')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (event_id, account_id)
);

create unique index events_one_owner
on public.event_memberships (event_id)
where role = 'owner';

create table app_private.audit_events (
  id bigint generated always as identity primary key,
  correlation_id uuid not null,
  actor_account_id uuid references public.profiles (account_id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  event_id uuid references public.events (id) on delete set null,
  safe_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint audit_events_action check (action ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  constraint audit_events_target_type check (target_type ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  constraint audit_events_safe_summary_object check (jsonb_typeof(safe_summary) = 'object')
);

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function app_private.touch_updated_at();

create trigger organizer_profiles_touch_updated_at
before update on public.organizer_profiles
for each row execute function app_private.touch_updated_at();

create trigger events_touch_updated_at
before update on public.events
for each row execute function app_private.touch_updated_at();

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (account_id, preferred_locale)
  values (new.id, 'sv')
  on conflict (account_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function app_private.handle_new_auth_user();

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
          'title', event.title,
          'description', event.description,
          'timezone', event.timezone,
          'state', event.state,
          'visibility', event.visibility,
          'role', membership.role
        )
        order by event.created_at desc
      )
      from public.event_memberships as membership
      join public.events as event on event.id = membership.event_id
      where membership.account_id = p_actor_id
    ), '[]'::jsonb)
  )
  from public.profiles as profile
  where profile.account_id = p_actor_id;
$$;

create or replace function public.update_profile_command(
  p_actor_id uuid,
  p_display_name text,
  p_preferred_locale text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_profile public.profiles;
  normalized_name text := nullif(btrim(p_display_name), '');
begin
  if normalized_name is not null and char_length(normalized_name) > 80 then
    raise exception 'Display name is too long';
  end if;
  if p_preferred_locale not in ('sv', 'en') then
    raise exception 'Unsupported locale';
  end if;

  update public.profiles
  set display_name = normalized_name, preferred_locale = p_preferred_locale
  where account_id = p_actor_id
  returning * into updated_profile;

  if updated_profile.account_id is null then
    raise exception 'Account profile not found';
  end if;

  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, safe_summary
  ) values (
    p_correlation_id,
    p_actor_id,
    'profile.updated',
    'profile',
    p_actor_id,
    jsonb_build_object('preferredLocale', p_preferred_locale)
  );

  return jsonb_build_object(
    'accountId', updated_profile.account_id,
    'displayName', updated_profile.display_name,
    'preferredLocale', updated_profile.preferred_locale
  );
end;
$$;

create or replace function public.create_organizer_profile_command(
  p_actor_id uuid,
  p_display_name text,
  p_organizer_type text,
  p_locality text,
  p_website text,
  p_correlation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  organizer_id uuid;
  normalized_name text := btrim(p_display_name);
  normalized_locality text := nullif(btrim(p_locality), '');
  normalized_website text := nullif(btrim(p_website), '');
begin
  if not exists (select 1 from public.profiles where account_id = p_actor_id) then
    raise exception 'Account profile not found';
  end if;
  if char_length(normalized_name) not between 1 and 100 then
    raise exception 'Organizer display name is required';
  end if;
  if p_organizer_type not in ('individual', 'informal_group', 'association', 'company') then
    raise exception 'Unsupported organizer type';
  end if;
  if normalized_website is not null and normalized_website !~ '^https://' then
    raise exception 'Organizer website must use HTTPS';
  end if;

  insert into public.organizer_profiles (
    organizer_type, display_name, locality, website, created_by_account_id
  ) values (
    p_organizer_type, normalized_name, normalized_locality, normalized_website, p_actor_id
  ) returning id into organizer_id;

  insert into public.organizer_profile_memberships (organizer_profile_id, account_id, role)
  values (organizer_id, p_actor_id, 'owner');

  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, safe_summary
  ) values (
    p_correlation_id,
    p_actor_id,
    'organizer.created',
    'organizer_profile',
    organizer_id,
    jsonb_build_object('organizerType', p_organizer_type)
  );

  return organizer_id;
end;
$$;

create or replace function public.create_draft_event_command(
  p_actor_id uuid,
  p_organizer_profile_id uuid,
  p_title text,
  p_description text,
  p_timezone text,
  p_visibility text,
  p_correlation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
  normalized_title text := btrim(p_title);
  normalized_description text := btrim(p_description);
  normalized_timezone text := btrim(p_timezone);
begin
  if not exists (
    select 1
    from public.organizer_profile_memberships
    where organizer_profile_id = p_organizer_profile_id
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

  insert into public.events (
    organizer_profile_id,
    created_by_account_id,
    title,
    description,
    timezone,
    visibility,
    state
  ) values (
    p_organizer_profile_id,
    p_actor_id,
    normalized_title,
    normalized_description,
    normalized_timezone,
    p_visibility,
    'draft'
  ) returning id into event_id;

  insert into public.event_memberships (event_id, account_id, role)
  values (event_id, p_actor_id, 'owner');

  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary
  ) values (
    p_correlation_id,
    p_actor_id,
    'event.draft_created',
    'event',
    event_id,
    event_id,
    jsonb_build_object('visibility', p_visibility, 'timezone', normalized_timezone)
  );

  return event_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.organizer_profiles enable row level security;
alter table public.organizer_profiles force row level security;
alter table public.organizer_profile_memberships enable row level security;
alter table public.organizer_profile_memberships force row level security;
alter table public.events enable row level security;
alter table public.events force row level security;
alter table public.event_memberships enable row level security;
alter table public.event_memberships force row level security;
alter table app_private.audit_events enable row level security;
alter table app_private.audit_events force row level security;

revoke all on table
  public.profiles,
  public.organizer_profiles,
  public.organizer_profile_memberships,
  public.events,
  public.event_memberships
from public, anon, authenticated;

revoke all on table app_private.audit_events from public, anon, authenticated;

grant select, insert, update, delete on table
  public.profiles,
  public.organizer_profiles,
  public.organizer_profile_memberships,
  public.events,
  public.event_memberships,
  app_private.audit_events
to service_role;

grant usage, select on sequence app_private.audit_events_id_seq to service_role;

revoke all on function public.get_identity_dashboard_command(uuid)
from public, anon, authenticated;
revoke all on function public.update_profile_command(uuid, text, text, uuid)
from public, anon, authenticated;
revoke all on function public.create_organizer_profile_command(uuid, text, text, text, text, uuid)
from public, anon, authenticated;
revoke all on function public.create_draft_event_command(uuid, uuid, text, text, text, text, uuid)
from public, anon, authenticated;

grant execute on function public.get_identity_dashboard_command(uuid) to service_role;
grant execute on function public.update_profile_command(uuid, text, text, uuid) to service_role;
grant execute on function public.create_organizer_profile_command(uuid, text, text, text, text, uuid)
to service_role;
grant execute on function public.create_draft_event_command(uuid, uuid, text, text, text, text, uuid)
to service_role;

comment on table public.profiles is
  'Minimal private account profile. Browser roles have no direct table access.';
comment on table public.organizer_profiles is
  'Organizer identity separated from private account identity.';
comment on table public.events is
  'Event lifecycle root. Milestone 1 creates draft rows only.';
comment on table app_private.audit_events is
  'Restricted append-oriented security and domain command history.';
