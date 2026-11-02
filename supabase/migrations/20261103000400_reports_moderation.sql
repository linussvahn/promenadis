-- Milestone 2, slice 4a: anonymous structured reports collapsed into cases,
-- deterministic quarantine of one physical location on a complete
-- unauthorized-address report, and event-team moderation (review cases, hide
-- listing text or items, suspend and reinstate). Reporter identity and contact
-- never reach the event team or the reported seller.

alter table public.event_locations
  add column quarantined_at timestamptz,
  add column quarantine_case_id uuid;
alter table public.seller_listings
  add column hidden_at timestamptz,
  add column hidden_reason text check (hidden_reason is null or char_length(btrim(hidden_reason)) between 3 and 500);
alter table public.highlighted_items add column hidden_at timestamptz;

create table app_private.moderation_cases (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  subject_type text not null check (subject_type in ('location', 'participation', 'item')),
  subject_id uuid not null,
  location_id uuid references public.event_locations (id) on delete set null,
  participation_id uuid references public.seller_participations (id) on delete set null,
  state text not null default 'open' check (state in ('open', 'closed')),
  outcome text check (outcome is null or outcome in ('restored', 'upheld', 'dismissed')),
  opened_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  check ((state = 'closed') = (closed_at is not null and outcome is not null))
);
create unique index moderation_cases_one_open on app_private.moderation_cases (subject_type, subject_id)
  where state = 'open';
create index moderation_cases_event on app_private.moderation_cases (event_id, state);

create table app_private.reports (
  id uuid primary key default extensions.gen_random_uuid(),
  case_id uuid not null references app_private.moderation_cases (id) on delete cascade,
  reason text not null check (reason in ('unauthorized_address', 'safety', 'illegal', 'copyright', 'privacy',
    'fraud', 'harassment', 'other_terms')),
  details text not null check (char_length(details) <= 1000),
  relationship text check (relationship is null or relationship in ('resident', 'owner', 'manager', 'other')),
  -- Restricted: never returned to the event team or the reported seller.
  reporter_contact text check (reporter_contact is null or char_length(reporter_contact) between 3 and 200),
  complete boolean not null,
  created_at timestamptz not null default clock_timestamp()
);
create index reports_case on app_private.reports (case_id, created_at);

create table app_private.moderation_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  case_id uuid references app_private.moderation_cases (id) on delete set null,
  participation_id uuid references public.seller_participations (id) on delete set null,
  -- Kept after the participation is gone so the seller can still appeal.
  affected_account_id uuid references public.profiles (account_id) on delete cascade,
  location_id uuid references public.event_locations (id) on delete set null,
  item_id uuid references public.highlighted_items (id) on delete set null,
  action text not null check (action in ('quarantine', 'restore_location', 'uphold_removal', 'dismiss',
    'hide_listing', 'restore_listing', 'hide_item', 'restore_item', 'suspend', 'reinstate', 'revoke')),
  reason text check (reason is null or char_length(btrim(reason)) between 3 and 500),
  actor_account_id uuid references public.profiles (account_id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index moderation_actions_event on app_private.moderation_actions (event_id, created_at);
create index moderation_actions_affected on app_private.moderation_actions (affected_account_id, created_at);

-- Anonymous report limits: 3/hour per network-prefix HMAC, 10/hour per subject.
create table app_private.report_rate_buckets (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, window_start)
);

alter table app_private.moderation_cases enable row level security;
alter table app_private.moderation_cases force row level security;
alter table app_private.reports enable row level security;
alter table app_private.reports force row level security;
alter table app_private.moderation_actions enable row level security;
alter table app_private.moderation_actions force row level security;
alter table app_private.report_rate_buckets enable row level security;
alter table app_private.report_rate_buckets force row level security;
revoke all on app_private.moderation_cases, app_private.reports, app_private.moderation_actions,
  app_private.report_rate_buckets from public, anon, authenticated;

create function app_private.take_report_budget(p_bucket text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  window_value timestamptz := date_trunc('hour', clock_timestamp());
  used integer;
begin
  insert into app_private.report_rate_buckets (bucket, window_start, count) values (p_bucket, window_value, 1)
  on conflict (bucket, window_start) do update set count = app_private.report_rate_buckets.count + 1
  returning count into used;
  return used <= p_limit;
end;
$$;

create function app_private.record_moderation_action(
  p_event_id uuid, p_case_id uuid, p_participation_id uuid, p_location_id uuid, p_item_id uuid,
  p_action text, p_reason text, p_actor_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare action_id uuid;
begin
  insert into app_private.moderation_actions (event_id, case_id, participation_id, affected_account_id, location_id,
    item_id, action, reason, actor_account_id)
  values (p_event_id, p_case_id, p_participation_id,
    (select account_id from public.seller_participations where id = p_participation_id),
    p_location_id, p_item_id, p_action, nullif(btrim(coalesce(p_reason, '')), ''), p_actor_id)
  returning id into action_id;
  return action_id;
end;
$$;

-- Anonymous structured report. Returns the same neutral answer whether or not
-- it quarantined anything, so a reporter cannot probe the effect.
create function public.submit_report_command(
  p_event_id uuid, p_subject_type text, p_subject_id uuid, p_reason text, p_details text,
  p_relationship text, p_confirms_no_consent boolean, p_reporter_contact text, p_network_bucket text,
  p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  location_id_value uuid;
  participation_id_value uuid;
  case_row app_private.moderation_cases;
  complete_value boolean;
  location_row public.event_locations;
begin
  if p_reason not in ('unauthorized_address', 'safety', 'illegal', 'copyright', 'privacy', 'fraud', 'harassment', 'other_terms')
    or char_length(btrim(coalesce(p_details, ''))) not between 1 and 1000
    or (p_relationship is not null and p_relationship not in ('resident', 'owner', 'manager', 'other'))
    or (p_reporter_contact is not null and char_length(btrim(p_reporter_contact)) not between 3 and 200)
  then raise exception 'Invalid report'; end if;
  if not app_private.take_report_budget('network:' || coalesce(p_network_bucket, 'unknown'), 3)
    or not app_private.take_report_budget('subject:' || p_subject_id::text, 10)
  then raise exception 'Report limit reached'; end if;

  if p_subject_type = 'location' then
    select id into location_id_value from public.event_locations
    where id = p_subject_id and event_id = p_event_id;
  elsif p_subject_type = 'participation' then
    select p.id, p.location_id into participation_id_value, location_id_value from public.seller_participations p
    where p.id = p_subject_id and p.event_id = p_event_id and p.location_id is not null;
  elsif p_subject_type = 'item' then
    select p.id, p.location_id into participation_id_value, location_id_value
    from public.highlighted_items i join public.seller_participations p on p.id = i.participation_id
    where i.id = p_subject_id and p.event_id = p_event_id and p.location_id is not null;
  end if;
  if location_id_value is null then raise exception 'Report subject not found'; end if;

  -- Repeated reports collapse into the subject's open case.
  insert into app_private.moderation_cases (event_id, subject_type, subject_id, location_id, participation_id)
  values (p_event_id, p_subject_type, p_subject_id, location_id_value, participation_id_value)
  on conflict (subject_type, subject_id) where state = 'open' do nothing;
  select * into case_row from app_private.moderation_cases
  where subject_type = p_subject_type and subject_id = p_subject_id and state = 'open' for update;

  complete_value := p_reason = 'unauthorized_address'
    and p_relationship in ('resident', 'owner', 'manager')
    and p_confirms_no_consent is true
    and char_length(btrim(p_details)) >= 20;
  insert into app_private.reports (case_id, reason, details, relationship, reporter_contact, complete)
  values (case_row.id, p_reason, btrim(p_details), p_relationship, nullif(btrim(coalesce(p_reporter_contact, '')), ''),
    complete_value);
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, null, 'report.submitted', 'moderation_case', case_row.id, p_event_id,
    jsonb_build_object('reason', p_reason, 'subjectType', p_subject_type, 'complete', complete_value));

  -- Only the first complete unauthorized-address report quarantines, and only
  -- the reported physical location.
  if complete_value then
    select * into location_row from public.event_locations where id = location_id_value for update;
    if location_row.quarantined_at is null then
      update public.event_locations set quarantined_at = clock_timestamp(), quarantine_case_id = case_row.id
      where id = location_id_value;
      -- One action per seller at the stop, so each of them sees it.
      perform app_private.record_moderation_action(p_event_id, case_row.id, p.id,
        location_id_value, null, 'quarantine', 'Complete unauthorized-address report', null)
      from public.seller_participations p where p.location_id = location_id_value;
      insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
      values (p_correlation_id, null, 'location.quarantined', 'event_location', location_id_value, p_event_id,
        jsonb_build_object('caseId', case_row.id));
    end if;
  end if;
  return jsonb_build_object('received', true);
end;
$$;

create function public.list_event_cases_command(p_actor_id uuid, p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.event_memberships where event_id = p_event_id and account_id = p_actor_id)
  then raise exception 'Actor is not an event team member'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', c.id, 'subjectType', c.subject_type, 'subjectId', c.subject_id, 'state', c.state,
        'outcome', c.outcome, 'openedAt', c.opened_at, 'closedAt', c.closed_at,
        'locationId', c.location_id, 'participationId', c.participation_id,
        'quarantined', exists (select 1 from public.event_locations l
          where l.id = c.location_id and l.quarantine_case_id = c.id and l.quarantined_at is not null),
        'sellerDisplayName', (select display_name from public.seller_participations where id = c.participation_id),
        'addressLine', (select address_line from public.event_locations where id = c.location_id),
        'reports', (select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'details', r.details,
            'relationship', r.relationship, 'complete', r.complete, 'createdAt', r.created_at) order by r.created_at)
          from app_private.reports r where r.case_id = c.id))
      order by c.state, c.opened_at desc)
    from app_private.moderation_cases c
    where c.event_id = p_event_id and (c.state = 'open' or c.closed_at > clock_timestamp() - interval '30 days')), '[]'::jsonb);
end;
$$;

-- restore: lift quarantine and close. uphold: make the removal permanent
-- (revoke the sellers at the location, or hide a reported item). dismiss:
-- close without action; a quarantined location must be restored instead.
create function public.review_moderation_case_command(
  p_actor_id uuid, p_case_id uuid, p_decision text, p_reason text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  case_row app_private.moderation_cases;
  quarantined boolean;
  participant record;
begin
  select * into case_row from app_private.moderation_cases where id = p_case_id;
  if case_row.id is null or not exists (select 1 from public.event_memberships
    where event_id = case_row.event_id and account_id = p_actor_id and role in ('owner', 'co_host', 'moderator'))
  then raise exception 'Case not found'; end if;
  perform 1 from public.events where id = case_row.event_id for update;
  select * into case_row from app_private.moderation_cases where id = p_case_id for update;
  if case_row.state <> 'open' then raise exception 'Case already closed'; end if;
  if p_decision not in ('restore', 'uphold', 'dismiss') or char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500
  then raise exception 'Invalid case decision'; end if;
  quarantined := exists (select 1 from public.event_locations
    where id = case_row.location_id and quarantine_case_id = case_row.id and quarantined_at is not null);
  if p_decision = 'dismiss' and quarantined then raise exception 'Restore or uphold a quarantined location'; end if;

  if p_decision = 'restore' then
    if quarantined and exists (select 1 from public.seller_participations p
        join app_private.platform_account_restrictions r on r.account_id = p.account_id and r.lifted_at is null
        where p.location_id = case_row.location_id)
    then raise exception 'Platform restriction applies'; end if;
    update public.event_locations set quarantined_at = null, quarantine_case_id = null where id = case_row.location_id;
    perform app_private.record_moderation_action(case_row.event_id, case_row.id, case_row.participation_id,
      case_row.location_id, null, 'restore_location', p_reason, p_actor_id);
  elsif p_decision = 'uphold' then
    if case_row.subject_type = 'item' then
      update public.highlighted_items set hidden_at = clock_timestamp() where id = case_row.subject_id;
      perform app_private.record_moderation_action(case_row.event_id, case_row.id, case_row.participation_id,
        case_row.location_id, case_row.subject_id, 'hide_item', p_reason, p_actor_id);
    else
      for participant in
        select id, state from public.seller_participations
        where state not in ('withdrawn', 'rejected', 'revoked')
          and ((case_row.subject_type = 'location' and location_id = case_row.location_id)
            or (case_row.subject_type = 'participation' and id = case_row.participation_id))
      loop
        perform app_private.record_moderation_action(case_row.event_id, case_row.id, participant.id,
          case_row.location_id, null, 'uphold_removal', p_reason, p_actor_id);
        perform app_private.close_participation(participant.id,
          case when participant.state in ('pending', 'waitlisted') then 'rejected' else 'revoked' end, p_actor_id, p_reason);
      end loop;
    end if;
  else
    perform app_private.record_moderation_action(case_row.event_id, case_row.id, case_row.participation_id,
      case_row.location_id, null, 'dismiss', p_reason, p_actor_id);
  end if;
  update app_private.moderation_cases set state = 'closed', closed_at = clock_timestamp(),
    outcome = case p_decision when 'restore' then 'restored' when 'uphold' then 'upheld' else 'dismissed' end
  where id = p_case_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'moderation.case_reviewed', 'moderation_case', p_case_id, case_row.event_id,
    jsonb_build_object('decision', p_decision, 'wasQuarantined', quarantined));
  if p_decision = 'uphold' then
    perform app_private.promote_waitlisted_sellers(case_row.event_id, p_correlation_id);
  end if;
  return public.list_event_cases_command(p_actor_id, case_row.event_id);
end;
$$;

-- Account-wide restriction set by an elevated platform administrator; slice
-- 4b adds the commands. Declared here so local reviewers cannot override it.
create table app_private.platform_account_restrictions (
  id uuid primary key default extensions.gen_random_uuid(),
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  created_by_account_id uuid references public.profiles (account_id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  lifted_at timestamptz,
  lifted_by_account_id uuid references public.profiles (account_id) on delete set null
);
create unique index platform_account_restrictions_active on app_private.platform_account_restrictions (account_id)
  where lifted_at is null;
alter table app_private.platform_account_restrictions enable row level security;
alter table app_private.platform_account_restrictions force row level security;
revoke all on app_private.platform_account_restrictions from public, anon, authenticated;

-- Event-team moderation of one participation: hide or restore listing text
-- or an item, suspend (keeps the place) or reinstate. Reasons are required.
create function public.moderate_participation_command(
  p_actor_id uuid, p_participation_id uuid, p_action text, p_item_id uuid, p_reason text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare participation public.seller_participations;
begin
  select * into participation from public.seller_participations where id = p_participation_id;
  if participation.id is null or not exists (select 1 from public.event_memberships
    where event_id = participation.event_id and account_id = p_actor_id and role in ('owner', 'co_host', 'moderator'))
  then raise exception 'Participation not found'; end if;
  if participation.account_id = p_actor_id then raise exception 'Cannot decide own participation'; end if;
  perform 1 from public.events where id = participation.event_id for update;
  select * into participation from public.seller_participations where id = p_participation_id for update;
  if p_action not in ('hide_listing', 'restore_listing', 'hide_item', 'restore_item', 'suspend', 'reinstate')
    or char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500
  then raise exception 'Invalid moderation action'; end if;

  if p_action = 'hide_listing' then
    update public.seller_listings set hidden_at = clock_timestamp(), hidden_reason = btrim(p_reason)
    where participation_id = p_participation_id and hidden_at is null;
    if not found then raise exception 'Invalid moderation action'; end if;
  elsif p_action = 'restore_listing' then
    update public.seller_listings set hidden_at = null, hidden_reason = null
    where participation_id = p_participation_id and hidden_at is not null;
    if not found then raise exception 'Invalid moderation action'; end if;
  elsif p_action in ('hide_item', 'restore_item') then
    update public.highlighted_items
    set hidden_at = case when p_action = 'hide_item' then clock_timestamp() end
    where id = p_item_id and participation_id = p_participation_id
      and (hidden_at is null) = (p_action = 'hide_item');
    if not found then raise exception 'Invalid moderation action'; end if;
  elsif p_action = 'suspend' then
    if participation.state <> 'approved' then raise exception 'Invalid moderation action'; end if;
    update public.seller_participations set state = 'suspended', decided_by_account_id = p_actor_id,
      version = version + 1 where id = p_participation_id;
  else
    if participation.state <> 'suspended' then raise exception 'Invalid moderation action'; end if;
    if exists (select 1 from app_private.platform_account_restrictions
      where account_id = participation.account_id and lifted_at is null)
    then raise exception 'Platform restriction applies'; end if;
    update public.seller_participations set state = 'approved', decided_by_account_id = p_actor_id,
      version = version + 1 where id = p_participation_id;
  end if;

  perform app_private.record_moderation_action(participation.event_id, null, p_participation_id,
    participation.location_id, p_item_id, p_action, p_reason, p_actor_id);
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'moderation.' || p_action, 'seller_participation', p_participation_id,
    participation.event_id, '{}'::jsonb);
  select * into participation from public.seller_participations where id = p_participation_id;
  return app_private.seller_participation_summary(participation, true);
end;
$$;

-- Seller-facing view of moderation that affected them (no reporter data).
create function public.list_my_moderation_command(p_actor_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'eventId', a.event_id, 'eventTitle', e.title, 'action', a.action,
      'reason', a.reason, 'createdAt', a.created_at) order by a.created_at desc), '[]'::jsonb)
  from app_private.moderation_actions a join public.events e on e.id = a.event_id
  where a.affected_account_id = p_actor_id
    and a.action in ('quarantine', 'uphold_removal', 'hide_listing', 'hide_item', 'suspend', 'revoke');
$$;

-- Quarantine and hiding surface to the seller through their own views.
create or replace function app_private.seller_participation_summary(
  p_participation public.seller_participations, p_include_address boolean
)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_participation.id,
    'eventId', p_participation.event_id,
    'state', p_participation.state,
    'displayName', p_participation.display_name,
    'geographicException', p_participation.geographic_exception,
    'appliedAt', p_participation.applied_at,
    'version', p_participation.version,
    'decisionReason', case when p_participation.state in ('rejected', 'revoked') then p_participation.decision_reason end,
    'location', case when p_include_address then (
      select jsonb_build_object(
        'id', l.id,
        'addressLine', l.address_line, 'postalCode', l.postal_code, 'locality', l.locality,
        'longitude', extensions.st_x(l.point), 'latitude', extensions.st_y(l.point),
        'placement', l.placement, 'insideBoundary', l.inside_boundary, 'needsReview', l.needs_review,
        'quarantined', l.quarantined_at is not null,
        'sellerCount', (select count(*) from public.seller_participations s where s.location_id = l.id))
      from public.event_locations l where l.id = p_participation.location_id) end);
$$;

create or replace function app_private.seller_listing_summary(p_participation_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'version', coalesce(l.version, 0),
    'title', l.title,
    'description', coalesce(l.description, ''),
    'hidden', l.hidden_at is not null,
    'hiddenReason', l.hidden_reason,
    'accessibility', jsonb_build_object('stepFree', l.step_free, 'stairs', l.has_stairs,
      'elevator', l.has_elevator, 'setting', l.setting, 'strollerFriendly', l.stroller_friendly),
    'earlyVisibilityOptOut', coalesce(l.early_visibility_opt_out, false),
    'categoryIds', coalesce((select jsonb_agg(category_id order by position)
      from public.seller_category_assignments where participation_id = p_participation_id), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(display order by position)
      from public.seller_tags where participation_id = p_participation_id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'categoryId', category_id,
        'status', status, 'priceMinor', price_minor, 'currency', currency, 'hidden', hidden_at is not null) order by position)
      from public.highlighted_items where participation_id = p_participation_id), '[]'::jsonb),
    'availability', coalesce((select jsonb_agg(jsonb_build_object('startsAt', starts_at, 'endsAt', ends_at) order by starts_at)
      from public.seller_availability where participation_id = p_participation_id), '[]'::jsonb),
    'liveStatus', (select jsonb_build_object('status', s.status, 'until', s.until, 'setAt', s.set_at)
      from public.seller_live_status s where s.participation_id = p_participation_id))
  from (select p_participation_id as id) requested
  left join public.seller_listings l on l.participation_id = requested.id;
$$;

create function app_private.purge_report_rate_buckets_command()
returns void language sql security definer set search_path = '' as $$
  delete from app_private.report_rate_buckets where window_start < clock_timestamp() - interval '2 hours';
$$;
select cron.schedule('promenadis-purge-report-rate-buckets', '47 * * * *',
  'select app_private.purge_report_rate_buckets_command();');

revoke all on function app_private.take_report_budget(text, integer) from public, anon, authenticated;
revoke all on function app_private.record_moderation_action(uuid, uuid, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function app_private.purge_report_rate_buckets_command() from public, anon, authenticated;
revoke all on function public.submit_report_command(uuid, text, uuid, text, text, text, boolean, text, text, uuid) from public, anon, authenticated;
revoke all on function public.list_event_cases_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.review_moderation_case_command(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.moderate_participation_command(uuid, uuid, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.list_my_moderation_command(uuid) from public, anon, authenticated;
grant execute on function public.submit_report_command(uuid, text, uuid, text, text, text, boolean, text, text, uuid) to service_role;
grant execute on function public.list_event_cases_command(uuid, uuid) to service_role;
grant execute on function public.review_moderation_case_command(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.moderate_participation_command(uuid, uuid, text, uuid, text, uuid) to service_role;
grant execute on function public.list_my_moderation_command(uuid) to service_role;
