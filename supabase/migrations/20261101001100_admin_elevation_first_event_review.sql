-- Platform administration is never ambient: eligibility is granted only by the
-- operator, and every admin command needs a live elevation bound to the exact
-- Auth session that verified a fresh TOTP code, for at most 15 minutes.
create table app_private.platform_admins (
  account_id uuid primary key references public.profiles (account_id) on delete cascade,
  granted_at timestamptz not null default clock_timestamp()
);
alter table app_private.platform_admins enable row level security;
alter table app_private.platform_admins force row level security;
revoke all on app_private.platform_admins from public, anon, authenticated;

create table app_private.admin_elevation_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  auth_session_id uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  check (expires_at > started_at and expires_at <= started_at + interval '15 minutes 1 second')
);
create unique index admin_elevation_sessions_one_live
on app_private.admin_elevation_sessions (account_id, auth_session_id) where ended_at is null;
alter table app_private.admin_elevation_sessions enable row level security;
alter table app_private.admin_elevation_sessions force row level security;
revoke all on app_private.admin_elevation_sessions from public, anon, authenticated;

-- First-event review: bound to the exact reviewed versions; any later change
-- makes the approval stale. One row per event; decisions are audited.
create table app_private.event_first_reviews (
  event_id uuid primary key references public.events (id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp(),
  event_version integer not null,
  boundary_version integer not null,
  registration_version integer not null,
  visibility text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  decided_by_account_id uuid references public.profiles (account_id) on delete set null,
  reason text check (reason is null or char_length(btrim(reason)) between 3 and 500),
  check ((status = 'pending') = (decided_at is null)),
  check (status <> 'rejected' or reason is not null)
);
alter table app_private.event_first_reviews enable row level security;
alter table app_private.event_first_reviews force row level security;
revoke all on app_private.event_first_reviews from public, anon, authenticated;

create function public.is_platform_admin(p_account_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app_private.platform_admins where account_id = p_account_id);
$$;

create function app_private.require_admin_elevation(p_actor_id uuid, p_auth_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from app_private.admin_elevation_sessions e
    join app_private.platform_admins a on a.account_id = e.account_id
    where e.account_id = p_actor_id and e.auth_session_id = p_auth_session_id
      and e.ended_at is null and e.expires_at > clock_timestamp()
  ) then raise exception 'Admin elevation required'; end if;
end;
$$;

-- Called only after the BFF verified a fresh TOTP code for this session.
create function public.start_admin_elevation_command(
  p_actor_id uuid, p_auth_session_id uuid, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  now_value timestamptz := clock_timestamp();
  elevation app_private.admin_elevation_sessions;
begin
  if not public.is_platform_admin(p_actor_id) then raise exception 'Not a platform administrator'; end if;
  update app_private.admin_elevation_sessions set ended_at = now_value
  where account_id = p_actor_id and ended_at is null;
  insert into app_private.admin_elevation_sessions (account_id, auth_session_id, started_at, expires_at)
  values (p_actor_id, p_auth_session_id, now_value, now_value + interval '15 minutes')
  returning * into elevation;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.elevation_started', 'account', p_actor_id, '{}'::jsonb);
  return jsonb_build_object('elevated', true, 'expiresAt', elevation.expires_at);
end;
$$;

create function public.end_admin_elevation_command(p_actor_id uuid, p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update app_private.admin_elevation_sessions set ended_at = clock_timestamp()
  where account_id = p_actor_id and ended_at is null and expires_at > clock_timestamp();
  if found then
    insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
    values (p_correlation_id, p_actor_id, 'admin.elevation_ended', 'account', p_actor_id, '{}'::jsonb);
  end if;
  return jsonb_build_object('elevated', false, 'expiresAt', null);
end;
$$;

create function public.get_admin_status_command(p_actor_id uuid, p_auth_session_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'eligible', public.is_platform_admin(p_actor_id),
    'elevated', e.id is not null,
    'expiresAt', e.expires_at)
  from (select 1) as one
  left join app_private.admin_elevation_sessions e
    on e.account_id = p_actor_id and e.auth_session_id = p_auth_session_id
    and e.ended_at is null and e.expires_at > clock_timestamp()
    and public.is_platform_admin(p_actor_id);
$$;

-- Review is needed until the owner has an approved first event elsewhere.
create function app_private.first_event_review_blocker(p_event_id uuid, p_owner_account_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from app_private.event_first_reviews r
      join public.event_memberships m on m.event_id = r.event_id and m.role = 'owner'
      where m.account_id = p_owner_account_id and r.event_id <> p_event_id and r.status = 'approved'
    ) then null
    when r.event_id is null then 'first_event_review_required'
    when r.status = 'pending' then 'first_event_review_pending'
    when r.status = 'rejected' then 'first_event_review_rejected'
    when r.event_version = e.version and r.boundary_version = b.version
      and r.registration_version = s.version and r.visibility = e.visibility then null
    else 'first_event_review_required'
  end
  from public.events e
  left join app_private.event_first_reviews r on r.event_id = e.id
  left join public.event_boundaries b on b.event_id = e.id
  left join public.event_registration_settings s on s.event_id = e.id
  where e.id = p_event_id;
$$;

create or replace function public.get_event_publication_readiness_command(
  p_actor_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  event_row public.events;
  owner_account_id uuid;
  boundary_version_value integer;
  registration_version_value integer;
  review_blocker text;
  blockers jsonb := '[]'::jsonb;
  recommendations jsonb := '["totp_recommended"]'::jsonb;
begin
  if not exists (
    select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id
  ) then raise exception 'Actor is not an event team member'; end if;
  select * into event_row from public.events where id = p_event_id;
  select account_id into owner_account_id from public.event_memberships
  where event_id = p_event_id and role = 'owner';
  select version into boundary_version_value from public.event_boundaries where event_id = p_event_id;
  select version into registration_version_value
  from public.event_registration_settings where event_id = p_event_id;

  if event_row.state <> 'draft' then blockers := blockers || '"event_not_draft"'::jsonb; end if;
  if not exists (
    select 1 from auth.users where id = owner_account_id and email_confirmed_at is not null
  ) then blockers := blockers || '"owner_email_unverified"'::jsonb; end if;
  if not exists (
    select 1 from app_private.account_recovery_codes
    where account_id = owner_account_id and used_at is null and invalidated_at is null
  ) then blockers := blockers || '"recovery_code_missing"'::jsonb; end if;
  if boundary_version_value is null then blockers := blockers || '"boundary_missing"'::jsonb; end if;
  if registration_version_value is null then blockers := blockers || '"registration_missing"'::jsonb; end if;
  if not exists (
    select 1 from public.event_publication_attestations as attestation
    where attestation.event_id = p_event_id
      and attestation.attested_by_account_id = owner_account_id
      and attestation.event_version = event_row.version
      and attestation.boundary_version = boundary_version_value
      and attestation.registration_version = registration_version_value
      and attestation.visibility = event_row.visibility
      and attestation.location_authority_confirmed
      and attestation.visibility_understood
  ) then blockers := blockers || '"publication_attestation_missing"'::jsonb; end if;
  if exists (
    select 1 from auth.mfa_factors
    where user_id = owner_account_id and factor_type = 'totp' and status = 'verified'
  ) then recommendations := recommendations - 'totp_recommended'; end if;
  if not exists (
    select 1
    from public.event_emergency_successors as successor
    join public.event_memberships as membership
      on membership.id = successor.successor_membership_id
    join auth.users as account on account.id = membership.account_id
    where successor.event_id = p_event_id
      and membership.role = 'co_host'
      and account.email_confirmed_at is not null
  ) then recommendations := recommendations || '"emergency_successor_recommended"'::jsonb; end if;

  review_blocker := app_private.first_event_review_blocker(p_event_id, owner_account_id);
  if review_blocker is not null then blockers := blockers || to_jsonb(review_blocker); end if;
  blockers := blockers || '["routing_not_ready","public_delivery_not_ready"]'::jsonb;
  return jsonb_build_object(
    'blockers', blockers,
    'eventId', p_event_id,
    'eventVersion', event_row.version,
    'readyToPublish', jsonb_array_length(blockers) = 0,
    'recommendations', recommendations
  );
end;
$$;

-- Owner submits the attested configuration. Only system gates may remain.
create function public.request_first_event_review_command(
  p_actor_id uuid, p_event_id uuid, p_expected_event_version integer, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  readiness jsonb;
  review_blocker text;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role = 'owner')
  then raise exception 'Only the event owner can request review'; end if;
  select * into event_row from public.events where id = p_event_id for update;
  if event_row.version is distinct from p_expected_event_version then raise exception 'Event version conflict'; end if;
  readiness := public.get_event_publication_readiness_command(p_actor_id, p_event_id);
  review_blocker := app_private.first_event_review_blocker(p_event_id, p_actor_id);
  if review_blocker is null or review_blocker = 'first_event_review_pending'
  then raise exception 'First-event review not needed'; end if;
  if exists (select 1 from jsonb_array_elements_text(readiness->'blockers') as blocker
    where blocker not in ('first_event_review_required', 'first_event_review_rejected',
      'routing_not_ready', 'public_delivery_not_ready'))
  then raise exception 'Event not ready for review'; end if;
  insert into app_private.event_first_reviews (event_id, event_version, boundary_version, registration_version, visibility)
  select p_event_id, event_row.version, b.version, s.version, event_row.visibility
  from public.event_boundaries b, public.event_registration_settings s
  where b.event_id = p_event_id and s.event_id = p_event_id
  on conflict (event_id) do update set requested_at = clock_timestamp(), event_version = excluded.event_version,
    boundary_version = excluded.boundary_version, registration_version = excluded.registration_version,
    visibility = excluded.visibility, status = 'pending', decided_at = null, decided_by_account_id = null, reason = null;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.first_review_requested', 'event', p_event_id, p_event_id,
    jsonb_build_object('eventVersion', event_row.version));
  return public.get_event_publication_readiness_command(p_actor_id, p_event_id);
end;
$$;

-- Review queue for an elevated admin. Event content only: no seller or account data.
create function public.list_first_event_reviews_command(
  p_actor_id uuid, p_auth_session_id uuid, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  select coalesce(jsonb_agg(jsonb_build_object(
      'eventId', e.id, 'eventVersion', e.version, 'title', e.title, 'description', e.description,
      'organizerName', o.display_name, 'organizerType', o.organizer_type, 'visibility', e.visibility,
      'requestedAt', r.requested_at,
      'ownEvent', exists (select 1 from public.event_memberships m where m.event_id = e.id and m.account_id = p_actor_id),
      'current', r.event_version = e.version and r.visibility = e.visibility)
    order by r.requested_at), '[]'::jsonb)
  into result
  from app_private.event_first_reviews r
  join public.events e on e.id = r.event_id
  join public.organizer_profiles o on o.id = e.organizer_profile_id
  where r.status = 'pending';
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.first_review_queue_read', 'account', p_actor_id,
    jsonb_build_object('count', jsonb_array_length(result)));
  return result;
end;
$$;

create function public.decide_first_event_review_command(
  p_actor_id uuid, p_auth_session_id uuid, p_event_id uuid, p_expected_event_version integer,
  p_decision text, p_reason text, p_correlation_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  review app_private.event_first_reviews;
  event_row public.events;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  if p_decision not in ('approved', 'rejected')
    or char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500
  then raise exception 'Invalid review decision'; end if;
  select * into event_row from public.events where id = p_event_id for update;
  select * into review from app_private.event_first_reviews where event_id = p_event_id for update;
  if review.event_id is null or review.status <> 'pending' then raise exception 'Review unavailable'; end if;
  if exists (select 1 from public.event_memberships where event_id = p_event_id and account_id = p_actor_id)
  then raise exception 'Cannot review own event'; end if;
  -- The decision covers exactly what was submitted; a changed event needs a new request.
  if event_row.version is distinct from p_expected_event_version
    or event_row.version <> review.event_version or event_row.visibility <> review.visibility
  then raise exception 'Event version conflict'; end if;
  update app_private.event_first_reviews
  set status = p_decision, decided_at = clock_timestamp(), decided_by_account_id = p_actor_id, reason = btrim(p_reason)
  where event_id = p_event_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.first_review_decided', 'event', p_event_id, p_event_id,
    jsonb_build_object('decision', p_decision, 'eventVersion', event_row.version));
end;
$$;

-- Owner-facing outcome. Rejection reasons are written for the owner.
create function public.get_first_event_review_command(p_actor_id uuid, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare review app_private.event_first_reviews;
begin
  if not exists (select 1 from public.event_memberships where event_id = p_event_id and account_id = p_actor_id)
  then raise exception 'Actor is not an event team member'; end if;
  select * into review from app_private.event_first_reviews where event_id = p_event_id;
  return jsonb_build_object(
    'status', coalesce(review.status, 'none'),
    'requestedAt', review.requested_at,
    'decidedAt', review.decided_at,
    'reason', case when review.status = 'rejected' then review.reason end);
end;
$$;

revoke all on function public.is_platform_admin(uuid) from public,anon,authenticated;
revoke all on function app_private.require_admin_elevation(uuid,uuid) from public,anon,authenticated;
revoke all on function app_private.first_event_review_blocker(uuid,uuid) from public,anon,authenticated;
revoke all on function public.start_admin_elevation_command(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.end_admin_elevation_command(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_admin_status_command(uuid,uuid) from public,anon,authenticated;
revoke all on function public.request_first_event_review_command(uuid,uuid,integer,uuid) from public,anon,authenticated;
revoke all on function public.list_first_event_reviews_command(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.decide_first_event_review_command(uuid,uuid,uuid,integer,text,text,uuid) from public,anon,authenticated;
revoke all on function public.get_first_event_review_command(uuid,uuid) from public,anon,authenticated;
grant execute on function public.is_platform_admin(uuid) to service_role;
grant execute on function public.start_admin_elevation_command(uuid,uuid,uuid) to service_role;
grant execute on function public.end_admin_elevation_command(uuid,uuid) to service_role;
grant execute on function public.get_admin_status_command(uuid,uuid) to service_role;
grant execute on function public.request_first_event_review_command(uuid,uuid,integer,uuid) to service_role;
grant execute on function public.list_first_event_reviews_command(uuid,uuid,uuid) to service_role;
grant execute on function public.decide_first_event_review_command(uuid,uuid,uuid,integer,text,text,uuid) to service_role;
grant execute on function public.get_first_event_review_command(uuid,uuid) to service_role;

comment on table app_private.platform_admins is
  'Operator-granted admin eligibility only; never inferred from profile data and never ambient.';
