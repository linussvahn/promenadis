-- Milestone 2, slice 4b: appeals decided by an elevated platform administrator
-- (a different one from the original decision-maker whenever another exists),
-- account-wide platform restrictions whose reversal needs a second admin once
-- two exist, reason-gated reads of reporter contact, and seller invitations
-- for invite-only events.

create table app_private.moderation_appeals (
  id uuid primary key default extensions.gen_random_uuid(),
  action_id uuid not null unique references app_private.moderation_actions (id) on delete cascade,
  appellant_account_id uuid not null references public.profiles (account_id) on delete cascade,
  statement text not null check (char_length(btrim(statement)) between 10 and 1000),
  state text not null default 'pending' check (state in ('pending', 'upheld', 'reversed')),
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  decided_by_account_id uuid references public.profiles (account_id) on delete set null,
  decision_reason text check (decision_reason is null or char_length(btrim(decision_reason)) between 3 and 500),
  independent boolean,
  check ((state = 'pending') = (decided_at is null))
);

-- Configured high-risk admin actions wait here for a distinct approver.
create table app_private.admin_action_approvals (
  id uuid primary key default extensions.gen_random_uuid(),
  action_type text not null check (action_type in ('lift_platform_restriction')),
  target_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  initiated_by_account_id uuid references public.profiles (account_id) on delete set null,
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected')),
  decided_by_account_id uuid references public.profiles (account_id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz
);
create unique index admin_action_approvals_one_pending on app_private.admin_action_approvals (action_type, target_id)
  where state = 'pending';

create table public.seller_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  invited_by_account_id uuid references public.profiles (account_id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  unique (event_id, email)
);

alter table app_private.moderation_appeals enable row level security;
alter table app_private.moderation_appeals force row level security;
alter table app_private.admin_action_approvals enable row level security;
alter table app_private.admin_action_approvals force row level security;
alter table public.seller_invites enable row level security;
alter table public.seller_invites force row level security;
revoke all on app_private.moderation_appeals, app_private.admin_action_approvals, public.seller_invites
  from public, anon, authenticated;
grant select, insert, update, delete on public.seller_invites to service_role;

-- Seller view now carries the appeal state.
create or replace function public.list_my_moderation_command(p_actor_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'eventId', a.event_id, 'eventTitle', e.title, 'action', a.action,
      'reason', a.reason, 'createdAt', a.created_at,
      'appeal', (select jsonb_build_object('state', ap.state, 'decisionReason', ap.decision_reason,
          'independent', ap.independent)
        from app_private.moderation_appeals ap where ap.action_id = a.id)) order by a.created_at desc), '[]'::jsonb)
  from app_private.moderation_actions a join public.events e on e.id = a.event_id
  where a.affected_account_id = p_actor_id
    and a.action in ('quarantine', 'uphold_removal', 'hide_listing', 'hide_item', 'suspend', 'revoke');
$$;

create function public.submit_appeal_command(
  p_actor_id uuid, p_action_id uuid, p_statement text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare action_row app_private.moderation_actions;
begin
  select * into action_row from app_private.moderation_actions where id = p_action_id;
  if action_row.id is null or action_row.affected_account_id is distinct from p_actor_id
    or action_row.action not in ('quarantine', 'uphold_removal', 'hide_listing', 'hide_item', 'suspend', 'revoke')
  then raise exception 'Action not found'; end if;
  if action_row.created_at < clock_timestamp() - interval '30 days' then raise exception 'Appeal window closed'; end if;
  if exists (select 1 from app_private.moderation_appeals where action_id = p_action_id) then
    raise exception 'Already appealed';
  end if;
  if char_length(btrim(coalesce(p_statement, ''))) not between 10 and 1000 then raise exception 'Invalid appeal'; end if;
  insert into app_private.moderation_appeals (action_id, appellant_account_id, statement)
  values (p_action_id, p_actor_id, btrim(p_statement));
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'moderation.appeal_submitted', 'moderation_action', p_action_id,
    action_row.event_id, jsonb_build_object('action', action_row.action));
  return public.list_my_moderation_command(p_actor_id);
end;
$$;

create function public.list_appeals_command(p_actor_id uuid, p_auth_session_id uuid, p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', ap.id, 'action', a.action, 'actionReason', a.reason, 'actionAt', a.created_at,
      'eventTitle', e.title, 'statement', ap.statement, 'createdAt', ap.created_at,
      'ownDecision', a.actor_account_id = p_actor_id) order by ap.created_at), '[]'::jsonb)
  into result
  from app_private.moderation_appeals ap
  join app_private.moderation_actions a on a.id = ap.action_id
  join public.events e on e.id = a.event_id
  where ap.state = 'pending';
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.appeal_queue_read', 'account', p_actor_id,
    jsonb_build_object('count', jsonb_array_length(result)));
  return result;
end;
$$;

-- Reversal undoes what can be undone: show hidden text, reinstate a
-- suspension, lift a quarantine. A removal erased the address, so reversing it
-- deletes the closed participation and the seller may apply again.
create function public.decide_appeal_command(
  p_actor_id uuid, p_auth_session_id uuid, p_appeal_id uuid, p_decision text, p_reason text,
  p_correlation_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  appeal app_private.moderation_appeals;
  action_row app_private.moderation_actions;
  independent_value boolean;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  select * into appeal from app_private.moderation_appeals where id = p_appeal_id for update;
  if appeal.id is null or appeal.state <> 'pending' then raise exception 'Appeal unavailable'; end if;
  if p_decision not in ('uphold', 'reverse') or char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Invalid appeal decision';
  end if;
  select * into action_row from app_private.moderation_actions where id = appeal.action_id;
  independent_value := action_row.actor_account_id is distinct from p_actor_id;
  if not independent_value and (select count(*) from app_private.platform_admins) > 1 then
    raise exception 'Different reviewer required';
  end if;

  if p_decision = 'reverse' then
    if action_row.action = 'hide_listing' then
      update public.seller_listings set hidden_at = null, hidden_reason = null where participation_id = action_row.participation_id;
    elsif action_row.action = 'hide_item' then
      update public.highlighted_items set hidden_at = null where id = action_row.item_id;
    elsif action_row.action = 'suspend' then
      -- A platform restriction is lifted on its own path, never by an appeal.
      if exists (select 1 from app_private.platform_account_restrictions
          where account_id = action_row.affected_account_id and lifted_at is null)
      then raise exception 'Platform restriction applies'; end if;
      update public.seller_participations set state = 'approved', version = version + 1
      where id = action_row.participation_id and state = 'suspended';
    elsif action_row.action = 'quarantine' then
      update public.event_locations set quarantined_at = null, quarantine_case_id = null
      where id = action_row.location_id and quarantine_case_id = action_row.case_id;
      update app_private.moderation_cases set state = 'closed', closed_at = clock_timestamp(), outcome = 'restored'
      where id = action_row.case_id and state = 'open';
    else
      delete from public.seller_participations
      where id = action_row.participation_id and state in ('withdrawn', 'rejected', 'revoked');
    end if;
  end if;
  update app_private.moderation_appeals
  set state = case p_decision when 'reverse' then 'reversed' else 'upheld' end, decided_at = clock_timestamp(),
    decided_by_account_id = p_actor_id, decision_reason = btrim(p_reason), independent = independent_value
  where id = p_appeal_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.appeal_decided', 'moderation_appeal', p_appeal_id, action_row.event_id,
    jsonb_build_object('decision', p_decision, 'action', action_row.action, 'independent', independent_value));
end;
$$;

-- Reason-gated private reads for elevated admins.
create function public.admin_find_account_command(
  p_actor_id uuid, p_auth_session_id uuid, p_email text, p_reason text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account_value uuid;
  result jsonb;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Reason required'; end if;
  select id into account_value from auth.users where lower(email) = lower(btrim(p_email));
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.account_lookup', 'account', coalesce(account_value, p_actor_id),
    jsonb_build_object('found', account_value is not null, 'reason', btrim(p_reason)));
  if account_value is null then raise exception 'Account not found'; end if;
  select jsonb_build_object(
    'accountId', p.account_id, 'displayName', p.display_name,
    'restriction', (select jsonb_build_object('id', r.id, 'reason', r.reason, 'createdAt', r.created_at,
        'pendingLift', exists (select 1 from app_private.admin_action_approvals a
          where a.action_type = 'lift_platform_restriction' and a.target_id = r.id and a.state = 'pending'))
      from app_private.platform_account_restrictions r where r.account_id = p.account_id and r.lifted_at is null))
  into result from public.profiles p where p.account_id = account_value;
  return result;
end;
$$;

create function public.admin_read_report_contact_command(
  p_actor_id uuid, p_auth_session_id uuid, p_report_id uuid, p_reason text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare report_row app_private.reports;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Reason required'; end if;
  select * into report_row from app_private.reports where id = p_report_id;
  if report_row.id is null then raise exception 'Report not found'; end if;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.report_contact_read', 'report', p_report_id,
    jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('contact', report_row.reporter_contact);
end;
$$;

-- Platform-wide view of open cases for escalation.
create function public.admin_list_cases_command(p_actor_id uuid, p_auth_session_id uuid, p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'eventTitle', e.title, 'subjectType', c.subject_type, 'openedAt', c.opened_at,
      'quarantined', exists (select 1 from public.event_locations l where l.quarantine_case_id = c.id),
      'reports', (select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'details', r.details,
          'hasContact', r.reporter_contact is not null, 'createdAt', r.created_at) order by r.created_at)
        from app_private.reports r where r.case_id = c.id)) order by c.opened_at), '[]'::jsonb)
  into result
  from app_private.moderation_cases c join public.events e on e.id = c.event_id
  where c.state = 'open';
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.case_queue_read', 'account', p_actor_id,
    jsonb_build_object('count', jsonb_array_length(result)));
  return result;
end;
$$;

-- Emergency restriction is immediate and suspends the account's approved
-- participations everywhere.
create function public.restrict_account_command(
  p_actor_id uuid, p_auth_session_id uuid, p_account_id uuid, p_reason text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare participation record;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  if p_account_id = p_actor_id then raise exception 'Cannot restrict own account'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Reason required'; end if;
  if exists (select 1 from app_private.platform_account_restrictions where account_id = p_account_id and lifted_at is null)
  then raise exception 'Already restricted'; end if;
  insert into app_private.platform_account_restrictions (account_id, reason, created_by_account_id)
  values (p_account_id, btrim(p_reason), p_actor_id);
  for participation in
    select p.id, p.event_id, p.location_id from public.seller_participations p
    join public.events e on e.id = p.event_id
    where p.account_id = p_account_id and p.state = 'approved' and e.state not in ('ended', 'cancelled', 'archived')
  loop
    update public.seller_participations set state = 'suspended', version = version + 1 where id = participation.id;
    perform app_private.record_moderation_action(participation.event_id, null, participation.id,
      participation.location_id, null, 'suspend', 'Platform restriction', p_actor_id);
  end loop;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.account_restricted', 'account', p_account_id,
    jsonb_build_object('reason', btrim(p_reason)));
  return (select jsonb_build_object('accountId', p.account_id, 'displayName', p.display_name,
      'restriction', jsonb_build_object('id', r.id, 'reason', r.reason, 'createdAt', r.created_at, 'pendingLift', false))
    from public.profiles p join app_private.platform_account_restrictions r
      on r.account_id = p.account_id and r.lifted_at is null
    where p.account_id = p_account_id);
end;
$$;

create function app_private.apply_restriction_lift(p_restriction_id uuid, p_actor_id uuid)
returns void language sql security definer set search_path = '' as $$
  update app_private.platform_account_restrictions set lifted_at = clock_timestamp(), lifted_by_account_id = p_actor_id
  where id = p_restriction_id and lifted_at is null;
$$;

-- With two or more admins, lifting waits for a different admin's approval;
-- a solo admin may lift so a legitimate user is not blocked by staffing.
create function public.request_restriction_lift_command(
  p_actor_id uuid, p_auth_session_id uuid, p_restriction_id uuid, p_reason text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  restriction app_private.platform_account_restrictions;
  needs_approval boolean;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Reason required'; end if;
  select * into restriction from app_private.platform_account_restrictions where id = p_restriction_id for update;
  if restriction.id is null or restriction.lifted_at is not null then raise exception 'Restriction not found'; end if;
  needs_approval := (select count(*) from app_private.platform_admins) > 1;
  if needs_approval then
    insert into app_private.admin_action_approvals (action_type, target_id, reason, initiated_by_account_id)
    values ('lift_platform_restriction', p_restriction_id, btrim(p_reason), p_actor_id)
    on conflict (action_type, target_id) where state = 'pending' do nothing;
  else
    perform app_private.apply_restriction_lift(p_restriction_id, p_actor_id);
  end if;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.restriction_lift_requested', 'account', restriction.account_id,
    jsonb_build_object('reason', btrim(p_reason), 'pendingApproval', needs_approval, 'independent', false));
  return jsonb_build_object('pendingApproval', needs_approval);
end;
$$;

create function public.list_admin_approvals_command(p_actor_id uuid, p_auth_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'actionType', a.action_type, 'reason', a.reason, 'createdAt', a.created_at,
      'ownRequest', a.initiated_by_account_id = p_actor_id) order by a.created_at)
    from app_private.admin_action_approvals a where a.state = 'pending'), '[]'::jsonb);
end;
$$;

create function public.decide_admin_approval_command(
  p_actor_id uuid, p_auth_session_id uuid, p_approval_id uuid, p_approve boolean, p_correlation_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare approval app_private.admin_action_approvals;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  select * into approval from app_private.admin_action_approvals where id = p_approval_id for update;
  if approval.id is null or approval.state <> 'pending' then raise exception 'Approval unavailable'; end if;
  if approval.initiated_by_account_id = p_actor_id then raise exception 'Different approver required'; end if;
  update app_private.admin_action_approvals
  set state = case when p_approve then 'approved' else 'rejected' end, decided_by_account_id = p_actor_id,
    decided_at = clock_timestamp()
  where id = p_approval_id;
  if p_approve and approval.action_type = 'lift_platform_restriction' then
    perform app_private.apply_restriction_lift(approval.target_id, p_actor_id);
  end if;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.approval_decided', 'admin_action_approval', p_approval_id,
    jsonb_build_object('approved', p_approve, 'actionType', approval.action_type));
end;
$$;

-- Seller invitations. They never reserve a place before acceptance.
create function public.invite_seller_command(
  p_actor_id uuid, p_event_id uuid, p_email text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare normalized text := lower(btrim(coalesce(p_email, '')));
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Actor cannot invite sellers'; end if;
  if not exists (select 1 from public.events where id = p_event_id and state in ('draft', 'published')) then
    raise exception 'Event is closed';
  end if;
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(normalized) > 320 then raise exception 'Invalid invitation'; end if;
  if (select count(*) from public.seller_invites where event_id = p_event_id) >= 60 then
    raise exception 'Invitation limit reached';
  end if;
  insert into public.seller_invites (event_id, email, invited_by_account_id) values (p_event_id, normalized, p_actor_id)
  on conflict (event_id, email) do update set expires_at = clock_timestamp() + interval '7 days',
    invited_by_account_id = excluded.invited_by_account_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'seller.invited', 'event', p_event_id, p_event_id, '{}'::jsonb);
  return public.list_seller_invites_command(p_actor_id, p_event_id);
end;
$$;

create function public.list_seller_invites_command(p_actor_id uuid, p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Actor cannot invite sellers'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'email', email, 'expiresAt', expires_at)
      order by created_at)
    from public.seller_invites where event_id = p_event_id and expires_at > clock_timestamp()), '[]'::jsonb);
end;
$$;

create function public.cancel_seller_invite_command(p_actor_id uuid, p_invite_id uuid, p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invite public.seller_invites;
begin
  select * into invite from public.seller_invites where id = p_invite_id;
  if invite.id is null or not exists (select 1 from public.event_memberships
    where event_id = invite.event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Invitation not found'; end if;
  delete from public.seller_invites where id = p_invite_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'seller.invite_cancelled', 'event', invite.event_id, invite.event_id, '{}'::jsonb);
  return public.list_seller_invites_command(p_actor_id, invite.event_id);
end;
$$;

create function public.get_incoming_seller_invites_command(p_actor_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'eventId', e.id, 'eventTitle', e.title,
      'organizerDisplayName', o.display_name, 'expiresAt', i.expires_at) order by i.created_at), '[]'::jsonb)
  from public.seller_invites i
  join public.events e on e.id = i.event_id
  join public.organizer_profiles o on o.id = e.organizer_profile_id
  join auth.users u on u.id = p_actor_id and u.email_confirmed_at is not null and lower(u.email) = i.email
  where i.expires_at > clock_timestamp() and e.state in ('draft', 'published')
    and not exists (select 1 from public.seller_participations p where p.event_id = e.id and p.account_id = p_actor_id);
$$;

-- An invitation is the host's selection: approved while places remain,
-- otherwise waitlisted. The address follows the normal location rules.
create function public.accept_seller_invite_command(
  p_actor_id uuid, p_invite_id uuid, p_display_name text, p_address_line text, p_postal_code text,
  p_locality text, p_longitude double precision, p_latitude double precision, p_placement text,
  p_shares_entrance boolean, p_right_to_use_attested boolean, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  invite public.seller_invites;
  event_row public.events;
  placed record;
  initial_state text;
  participation public.seller_participations;
begin
  select i.* into invite from public.seller_invites i
  join auth.users u on u.id = p_actor_id and u.email_confirmed_at is not null and lower(u.email) = i.email
  where i.id = p_invite_id and i.expires_at > clock_timestamp();
  if invite.id is null then raise exception 'Invitation not found'; end if;
  select * into event_row from public.events where id = invite.event_id for update;
  if event_row.state not in ('draft', 'published') then raise exception 'Event is closed'; end if;
  if exists (select 1 from public.seller_participations where event_id = invite.event_id and account_id = p_actor_id) then
    raise exception 'Already applied';
  end if;
  if exists (select 1 from app_private.platform_account_restrictions where account_id = p_actor_id and lifted_at is null)
  then raise exception 'Platform restriction applies'; end if;
  if p_right_to_use_attested is not true then raise exception 'Right to use the location must be confirmed'; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 80 then raise exception 'Invalid application'; end if;

  select * into placed from app_private.place_participation_location(invite.event_id, null, p_address_line,
    p_postal_code, p_locality, p_longitude, p_latitude, p_placement, p_shares_entrance);
  initial_state := case when app_private.seller_places_available(invite.event_id) then 'approved' else 'waitlisted' end;
  insert into public.seller_participations (event_id, account_id, location_id, state, display_name,
    geographic_exception, address_attested_at)
  values (invite.event_id, p_actor_id, placed.placed_location_id, initial_state, btrim(p_display_name),
    not placed.placed_inside, clock_timestamp())
  returning * into participation;
  delete from public.seller_invites where id = p_invite_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'seller.invite_accepted', 'seller_participation', participation.id,
    invite.event_id, jsonb_build_object('state', initial_state, 'insideBoundary', placed.placed_inside));
  return app_private.seller_participation_summary(participation, true);
end;
$$;

-- Same decisions as before; a revocation is now recorded for appeal.
create or replace function public.decide_seller_participation_command(
  p_actor_id uuid, p_participation_id uuid, p_expected_version integer, p_decision text,
  p_reason text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  participation public.seller_participations;
  event_row public.events;
begin
  select event_id into participation.event_id from public.seller_participations where id = p_participation_id;
  if participation.event_id is null or not exists (select 1 from public.event_memberships
    where event_id = participation.event_id and account_id = p_actor_id and role in ('owner', 'co_host', 'moderator'))
  then raise exception 'Participation not found'; end if;
  select * into event_row from public.events where id = participation.event_id for update;
  select * into participation from public.seller_participations where id = p_participation_id for update;
  if participation.version is distinct from p_expected_version then raise exception 'Participation version conflict'; end if;
  if event_row.state in ('ended', 'cancelled', 'archived') then raise exception 'Event is closed'; end if;
  if participation.account_id = p_actor_id then raise exception 'Cannot decide own participation'; end if;

  if p_decision = 'approve' then
    if participation.state not in ('pending', 'waitlisted', 'pending_address_change') then
      raise exception 'Invalid seller decision';
    end if;
    if participation.state <> 'pending_address_change' and not app_private.seller_places_available(participation.event_id) then
      raise exception 'Seller places are full';
    end if;
    update public.seller_participations set state = 'approved', decided_by_account_id = p_actor_id,
      decision_reason = null, version = version + 1 where id = p_participation_id;
  elsif p_decision = 'waitlist' then
    if participation.state <> 'pending' then raise exception 'Invalid seller decision'; end if;
    update public.seller_participations set state = 'waitlisted', decided_by_account_id = p_actor_id,
      version = version + 1 where id = p_participation_id;
  elsif p_decision in ('reject', 'revoke') then
    if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500
      or (p_decision = 'reject' and participation.state not in ('pending', 'waitlisted'))
      or (p_decision = 'revoke' and participation.state not in ('approved', 'suspended', 'pending_address_change'))
    then raise exception 'Invalid seller decision'; end if;
    -- A revocation is a moderation decision the seller can appeal.
    if p_decision = 'revoke' then
      perform app_private.record_moderation_action(participation.event_id, null, p_participation_id,
        participation.location_id, null, 'revoke', p_reason, p_actor_id);
    end if;
    perform app_private.close_participation(p_participation_id, case p_decision when 'reject' then 'rejected' else 'revoked' end,
      p_actor_id, p_reason);
  else
    raise exception 'Invalid seller decision';
  end if;

  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'seller.decided', 'seller_participation', p_participation_id,
    participation.event_id, jsonb_build_object('decision', p_decision, 'fromState', participation.state));
  if p_decision = 'revoke' then
    perform app_private.promote_waitlisted_sellers(participation.event_id, p_correlation_id);
  end if;
  select * into participation from public.seller_participations where id = p_participation_id;
  return app_private.seller_participation_summary(participation, true);
end;
$$;

-- Platform restriction also blocks new applications.
create function app_private.refuse_restricted_applicant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from app_private.platform_account_restrictions where account_id = new.account_id and lifted_at is null)
  then raise exception 'Platform restriction applies'; end if;
  return new;
end;
$$;
create trigger seller_participations_refuse_restricted
before insert on public.seller_participations
for each row execute function app_private.refuse_restricted_applicant();

create function app_private.purge_expired_seller_invites_command()
returns void language sql security definer set search_path = '' as $$
  delete from public.seller_invites where expires_at <= clock_timestamp();
$$;
select cron.schedule('promenadis-purge-seller-invites', '53 * * * *',
  'select app_private.purge_expired_seller_invites_command();');

revoke all on function public.submit_appeal_command(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.list_appeals_command(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.decide_appeal_command(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_find_account_command(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_read_report_contact_command(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_list_cases_command(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.restrict_account_command(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function app_private.apply_restriction_lift(uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_restriction_lift_command(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.list_admin_approvals_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.decide_admin_approval_command(uuid, uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.invite_seller_command(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.list_seller_invites_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_seller_invite_command(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_incoming_seller_invites_command(uuid) from public, anon, authenticated;
revoke all on function public.accept_seller_invite_command(uuid, uuid, text, text, text, text, double precision, double precision, text, boolean, boolean, uuid) from public, anon, authenticated;
revoke all on function app_private.refuse_restricted_applicant() from public, anon, authenticated;
revoke all on function app_private.purge_expired_seller_invites_command() from public, anon, authenticated;
grant execute on function public.submit_appeal_command(uuid, uuid, text, uuid) to service_role;
grant execute on function public.list_appeals_command(uuid, uuid, uuid) to service_role;
grant execute on function public.decide_appeal_command(uuid, uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.admin_find_account_command(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.admin_read_report_contact_command(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.admin_list_cases_command(uuid, uuid, uuid) to service_role;
grant execute on function public.restrict_account_command(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.request_restriction_lift_command(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.list_admin_approvals_command(uuid, uuid) to service_role;
grant execute on function public.decide_admin_approval_command(uuid, uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.invite_seller_command(uuid, uuid, text, uuid) to service_role;
grant execute on function public.list_seller_invites_command(uuid, uuid) to service_role;
grant execute on function public.cancel_seller_invite_command(uuid, uuid, uuid) to service_role;
grant execute on function public.get_incoming_seller_invites_command(uuid) to service_role;
grant execute on function public.accept_seller_invite_command(uuid, uuid, text, text, text, text, double precision, double precision, text, boolean, boolean, uuid) to service_role;
