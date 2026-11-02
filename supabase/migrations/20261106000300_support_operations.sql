-- Milestone 5, slice 3a: first-party support forms, post-event feedback,
-- job heartbeats with a sanitized health read, and incident switches.
create table app_private.instance_settings (
  name text primary key,
  value text not null
);
-- The single monitored mailbox; changed per environment, never per request.
insert into app_private.instance_settings (name, value) values ('support_mailbox', 'support@promenadis.local');
alter table app_private.instance_settings enable row level security;
revoke all on app_private.instance_settings from public, anon, authenticated;

-- Support: one form, five routes into one mailbox. Contact is optional.
create table app_private.support_requests (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (topic in ('support', 'accessibility', 'privacy', 'safety', 'legal')),
  body text not null check (char_length(btrim(body)) between 10 and 2000),
  contact text check (contact is null or (contact ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(contact) <= 320)),
  network_bucket text not null,
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz
);
alter table app_private.notification_outbox
  add column recipient_support_request_id uuid references app_private.support_requests (id) on delete cascade,
  drop constraint notification_outbox_template_check,
  add constraint notification_outbox_template_check check (template in (
    'seller_approved', 'seller_waitlisted', 'seller_rejected', 'seller_revoked', 'seller_suspended',
    'seller_reinstated', 'address_change_approved', 'event_cancelled', 'event_postponed',
    'event_rescheduled', 'location_quarantined', 'location_restored', 'appeal_decided',
    'seller_invited', 'team_invited', 'unlisted_link_rotated', 'report_reviewed', 'event_reminder',
    'relay_to_organizer', 'relay_to_visitor', 'support_request')),
  drop constraint notification_outbox_recipient,
  add constraint notification_outbox_recipient check (num_nonnulls(recipient_account_id, recipient_seller_invite_id,
    recipient_team_invite_id, recipient_report_id, recipient_relay_thread_id, recipient_support_request_id) = 1);

-- Post-event feedback: no account, network or event-team link. A follow-up
-- address, when given, is kept in its own table and expires sooner.
create table app_private.event_feedback (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1000),
  created_at timestamptz not null default clock_timestamp()
);
create table app_private.feedback_followups (
  feedback_id uuid primary key references app_private.event_feedback (id) on delete cascade,
  contact text not null check (contact ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(contact) <= 320),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz
);
create table app_private.feedback_rate_buckets (
  network_bucket text not null,
  event_id uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (network_bucket, event_id)
);

-- Incident switches: safety and abuse levers that act at once.
create table app_private.kill_switches (
  key text primary key check (key in ('public_locations', 'seller_applications', 'organizer_relay', 'exports', 'support_forms')),
  enabled boolean not null default false,
  reason text,
  changed_by_account_id uuid references public.profiles (account_id) on delete set null,
  changed_at timestamptz
);
insert into app_private.kill_switches (key)
values ('public_locations'), ('seller_applications'), ('organizer_relay'), ('exports'), ('support_forms');

alter table app_private.support_requests enable row level security;
alter table app_private.event_feedback enable row level security;
alter table app_private.feedback_followups enable row level security;
alter table app_private.feedback_rate_buckets enable row level security;
alter table app_private.kill_switches enable row level security;
revoke all on app_private.support_requests, app_private.event_feedback, app_private.feedback_followups,
  app_private.feedback_rate_buckets, app_private.kill_switches from public, anon, authenticated;

create function app_private.switch_on(p_key text)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select enabled from app_private.kill_switches where key = p_key), false);
$$;

create function public.submit_support_request_command(
  p_topic text, p_body text, p_contact text, p_network_bucket text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  if app_private.switch_on('support_forms') then raise exception 'Support form paused'; end if;
  if p_topic not in ('support', 'accessibility', 'privacy', 'safety', 'legal')
    or char_length(btrim(coalesce(p_body, ''))) not between 10 and 2000
    or (nullif(btrim(p_contact), '') is not null and btrim(p_contact) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  then raise exception 'Invalid request'; end if;
  if (select count(*) from app_private.support_requests where network_bucket = p_network_bucket
      and created_at > clock_timestamp() - interval '1 hour') >= 5
  then raise exception 'Request limit reached'; end if;
  insert into app_private.support_requests (topic, body, contact, network_bucket)
  values (p_topic, btrim(p_body), nullif(lower(btrim(p_contact)), ''), p_network_bucket)
  returning id into request_id;
  insert into app_private.notification_outbox (template, priority, recipient_support_request_id, payload, dedupe_key)
  values ('support_request', 'required', request_id, jsonb_build_object('topic', p_topic), 'support:' || request_id);
  return jsonb_build_object('received', true);
end;
$$;

create function public.list_support_requests_command(p_actor_id uuid, p_auth_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'topic', r.topic, 'body', r.body,
      'hasContact', r.contact is not null, 'createdAt', r.created_at, 'resolvedAt', r.resolved_at)
    order by r.resolved_at nulls first, r.created_at desc)
    from app_private.support_requests r), '[]'::jsonb);
end;
$$;

create function public.resolve_support_request_command(
  p_actor_id uuid, p_auth_session_id uuid, p_request_id uuid, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  update app_private.support_requests set resolved_at = coalesce(resolved_at, clock_timestamp()) where id = p_request_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'support.request_resolved', 'support_request', p_request_id, '{}'::jsonb);
  return public.list_support_requests_command(p_actor_id, p_auth_session_id);
end;
$$;

-- Feedback opens when the event ends and closes 14 days later (archive).
create function public.submit_event_feedback_command(
  p_event_key text, p_rating integer, p_comment text, p_followup_contact text, p_network_bucket text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  feedback_id uuid;
begin
  select * into event_row from public.events where public_key = p_event_key and state = 'ended';
  if event_row.id is null then raise exception 'Feedback closed'; end if;
  if p_rating not between 1 and 5 or char_length(coalesce(p_comment, '')) > 1000
    or (nullif(btrim(p_followup_contact), '') is not null and btrim(p_followup_contact) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  then raise exception 'Invalid feedback'; end if;
  insert into app_private.feedback_rate_buckets (network_bucket, event_id)
  values (p_network_bucket, event_row.id) on conflict do nothing;
  if not found then raise exception 'Feedback already sent'; end if;
  insert into app_private.event_feedback (event_id, rating, comment)
  values (event_row.id, p_rating, btrim(coalesce(p_comment, ''))) returning id into feedback_id;
  if nullif(btrim(p_followup_contact), '') is not null then
    insert into app_private.feedback_followups (feedback_id, contact) values (feedback_id, lower(btrim(p_followup_contact)));
  end if;
  return jsonb_build_object('received', true);
end;
$$;

-- The team sees aggregates only; comments are for the operator's synthesis.
create function public.event_feedback_summary_command(p_actor_id uuid, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.event_memberships where event_id = p_event_id and account_id = p_actor_id)
  then raise exception 'Actor is not an event team member'; end if;
  return (select jsonb_build_object('responses', count(*), 'averageRating', round(avg(rating), 1),
    'ratings', jsonb_build_array(
      count(*) filter (where rating = 1), count(*) filter (where rating = 2), count(*) filter (where rating = 3),
      count(*) filter (where rating = 4), count(*) filter (where rating = 5)))
    from app_private.event_feedback where event_id = p_event_id);
end;
$$;

-- Heartbeats for scheduled work, reusing the retention heartbeat table.
create function app_private.beat(p_job text)
returns void language sql security definer set search_path = '' as $$
  insert into app_private.retention_heartbeats (job, last_run_at, erased_count, overdue_count)
  values (p_job, clock_timestamp(), 0, 0)
  on conflict (job) do update set last_run_at = excluded.last_run_at;
$$;
select cron.schedule('promenadis-refresh-public-snapshots', '30 seconds',
  'select app_private.refresh_public_snapshots_command(); select app_private.beat(''public_snapshots'');');
select cron.schedule('promenadis-advance-event-lifecycle', '* * * * *',
  'select app_private.advance_event_lifecycle_command(); select app_private.beat(''event_lifecycle'');');
select cron.schedule('promenadis-routing-retention', '17 * * * *',
  'select app_private.enforce_routing_retention_command(); select app_private.beat(''routing_retention'');');
select cron.schedule('promenadis-notification-retention', '23 * * * *',
  'select app_private.enforce_notification_retention_command(); select app_private.beat(''notification_retention'');');
select cron.schedule('promenadis-relay-export-retention', '29 * * * *',
  'select app_private.enforce_relay_export_retention_command(); select app_private.beat(''relay_export_retention'');');

-- Detailed checks for elevated admins; monitors get only the overall state.
create function app_private.operations_checks()
returns jsonb language sql stable set search_path = '' as $$
  with beats as (select job, last_run_at from app_private.retention_heartbeats),
  queue as (select public.notification_queue_health_command() as q)
  select jsonb_build_object(
    'publicSnapshots', coalesce((select last_run_at > clock_timestamp() - interval '3 minutes' from beats where job = 'public_snapshots'), false),
    'eventLifecycle', coalesce((select last_run_at > clock_timestamp() - interval '5 minutes' from beats where job = 'event_lifecycle'), false),
    'eventRetention', coalesce((select last_run_at > clock_timestamp() - interval '2 hours' from beats where job = 'event_seller_data'), false),
    'notificationQueue', (select (q->>'deadLettered')::int = 0 and (q->>'oldestQueuedMinutes')::int < 30 from queue),
    'switches', (select coalesce(jsonb_object_agg(key, enabled), '{}'::jsonb) from app_private.kill_switches)
  );
$$;

create function public.operations_status_command()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', case when (c->>'publicSnapshots')::boolean and (c->>'eventLifecycle')::boolean
    and (c->>'notificationQueue')::boolean then 'ok' else 'degraded' end)
  from app_private.operations_checks() c;
$$;

create function public.admin_operations_command(p_actor_id uuid, p_auth_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  return app_private.operations_checks();
end;
$$;

create function public.set_kill_switch_command(
  p_actor_id uuid, p_auth_session_id uuid, p_key text, p_enabled boolean, p_reason text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then raise exception 'Reason required'; end if;
  update app_private.kill_switches set enabled = p_enabled, reason = btrim(p_reason),
    changed_by_account_id = p_actor_id, changed_at = clock_timestamp()
  where key = p_key;
  if not found then raise exception 'Unknown switch'; end if;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, safe_summary)
  values (p_correlation_id, p_actor_id, 'operations.kill_switch_set', 'kill_switch',
    jsonb_build_object('key', p_key, 'enabled', p_enabled, 'reason', btrim(p_reason)));
  -- Hiding locations must reach open maps at once.
  if p_key = 'public_locations' then
    update app_private.public_event_publications set safety_sequence = safety_sequence + 1, updated_at = clock_timestamp();
  end if;
  return app_private.operations_checks();
end;
$$;

-- Enforcement in the database for the paths that live there.
create or replace function app_private.publishable_participations(p_event_id uuid)
returns setof public.seller_participations language sql stable set search_path = '' as $$
  select p.* from public.seller_participations p
  join public.events e on e.id = p.event_id
  join public.event_locations l on l.id = p.location_id
  left join public.seller_listings sl on sl.participation_id = p.id
  left join public.seller_live_status s on s.participation_id = p.id
  where p.event_id = p_event_id
    and not app_private.switch_on('public_locations')
    and p.state = 'approved'
    and l.quarantined_at is null
    and (l.inside_boundary or p.geographic_exception)
    and coalesce(s.status, 'open') <> 'closed_early'
    and (
      e.state = 'active'
      or (e.state = 'published' and e.early_location_visibility and not coalesce(sl.early_visibility_opt_out, false))
    )
    and clock_timestamp() < app_private.public_expiry(p_event_id);
$$;

create function app_private.guard_switches()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'seller_participations' and app_private.switch_on('seller_applications') then
    raise exception 'Applications paused';
  elsif tg_table_name = 'relay_messages' and app_private.switch_on('organizer_relay') then
    raise exception 'Relay closed';
  elsif tg_table_name = 'event_exports' and app_private.switch_on('exports') then
    raise exception 'Exports paused';
  end if;
  return new;
end;
$$;
create trigger seller_participations_guard_switch before insert on public.seller_participations
for each row execute function app_private.guard_switches();
create trigger relay_messages_guard_switch before insert on app_private.relay_messages
for each row execute function app_private.guard_switches();
create trigger event_exports_guard_switch before insert on app_private.event_exports
for each row execute function app_private.guard_switches();

-- Support and feedback resolution for the worker.
create or replace function public.resolve_application_recipient(p_job_id uuid, p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job app_private.notification_outbox;
  email text;
  locale text;
  reason text;
  body text;
  extra jsonb := '{}'::jsonb;
begin
  select * into job from app_private.notification_outbox
  where id = p_job_id and lease_id = p_lease_id and lease_until > clock_timestamp() for update;
  if job.id is null then return null; end if;
  if job.recipient_account_id is not null then
    select u.email, p.preferred_locale into email, locale
    from auth.users u join public.profiles p on p.account_id = u.id
    where u.id = job.recipient_account_id and u.deleted_at is null;
  elsif job.recipient_seller_invite_id is not null then
    select i.email into email from public.seller_invites i where i.id = job.recipient_seller_invite_id;
  elsif job.recipient_team_invite_id is not null then
    select i.invited_email into email from public.event_invites i where i.id = job.recipient_team_invite_id;
  elsif job.recipient_relay_thread_id is not null then
    select t.visitor_email into email from app_private.relay_threads t where t.id = job.recipient_relay_thread_id;
  elsif job.recipient_support_request_id is not null then
    -- The operator mailbox; the requester's address is only a reply hint.
    select (select value from app_private.instance_settings where name = 'support_mailbox'), r.body,
      jsonb_build_object('topic', r.topic, 'replyTo', r.contact)
    into email, body, extra
    from app_private.support_requests r where r.id = job.recipient_support_request_id;
    locale := 'en';
  else
    select r.reporter_contact into email from app_private.reports r
    where r.id = job.recipient_report_id and r.reporter_contact ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  end if;
  if job.relay_message_id is not null then
    select m.body into body from app_private.relay_messages m where m.id = job.relay_message_id;
    if body is null then email := null; end if;
  end if;
  if email is null then
    reason := 'recipient_gone';
  elsif job.recipient_support_request_id is null
    and exists (select 1 from app_private.email_suppressions where email_hash = app_private.email_hash(email)) then
    reason := 'suppressed';
  elsif job.priority = 'optional' and not coalesce((select n.event_reminders
      from app_private.notification_preferences n where n.account_id = job.recipient_account_id), false) then
    reason := 'preference';
  end if;
  if reason is not null then
    update app_private.notification_outbox set cancelled_at = clock_timestamp(), cancel_reason = reason,
      payload = null, lease_id = null, lease_until = null where id = p_job_id;
    return null;
  end if;
  if job.relay_message_id is not null then
    update app_private.relay_messages set delivered_at = coalesce(delivered_at, clock_timestamp())
    where id = job.relay_message_id;
  end if;
  return jsonb_build_object('email', email, 'locale', coalesce(locale, 'both'))
    || coalesce(extra, '{}'::jsonb)
    || case when body is not null then jsonb_build_object('body', body) else '{}'::jsonb end
    || case when job.relay_message_id is not null then jsonb_build_object('threadId',
      coalesce(job.recipient_relay_thread_id, (select thread_id from app_private.relay_messages where id = job.relay_message_id)))
    else '{}'::jsonb end
    || case when job.recipient_relay_thread_id is not null then jsonb_build_object('threadToken',
      (select extensions.pgp_sym_decrypt(t.token_cipher, app_private.relay_key())
       from app_private.relay_threads t where t.id = job.recipient_relay_thread_id))
    else '{}'::jsonb end;
end;
$$;

-- Hourly: support correspondence 30 days after resolution (90 at most);
-- feedback 90 days, follow-up contact 30 days; rate buckets after a day.
create function app_private.enforce_support_retention_command()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from app_private.support_requests
  where resolved_at <= clock_timestamp() - interval '30 days' or created_at <= clock_timestamp() - interval '90 days';
  get diagnostics removed = row_count;
  delete from app_private.event_feedback where created_at <= clock_timestamp() - interval '90 days';
  delete from app_private.feedback_followups
  where created_at <= clock_timestamp() - interval '30 days' or resolved_at is not null;
  delete from app_private.feedback_rate_buckets where created_at <= clock_timestamp() - interval '1 day';
  perform app_private.beat('support_retention');
  return removed;
end;
$$;
select cron.schedule('promenadis-support-retention', '37 * * * *', 'select app_private.enforce_support_retention_command();');

revoke all on function app_private.switch_on(text) from public, anon, authenticated;
revoke all on function app_private.beat(text) from public, anon, authenticated;
revoke all on function app_private.operations_checks() from public, anon, authenticated;
revoke all on function app_private.guard_switches() from public, anon, authenticated;
revoke all on function app_private.enforce_support_retention_command() from public, anon, authenticated;
revoke all on function public.submit_support_request_command(text, text, text, text) from public, anon, authenticated;
revoke all on function public.list_support_requests_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.resolve_support_request_command(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_event_feedback_command(text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.event_feedback_summary_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.operations_status_command() from public, anon, authenticated;
revoke all on function public.admin_operations_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_kill_switch_command(uuid, uuid, text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.submit_support_request_command(text, text, text, text) to service_role;
grant execute on function public.list_support_requests_command(uuid, uuid) to service_role;
grant execute on function public.resolve_support_request_command(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.submit_event_feedback_command(text, integer, text, text, text) to service_role;
grant execute on function public.event_feedback_summary_command(uuid, uuid) to service_role;
grant execute on function public.operations_status_command() to service_role;
grant execute on function public.admin_operations_command(uuid, uuid) to service_role;
grant execute on function public.set_kill_switch_command(uuid, uuid, text, boolean, text, uuid) to service_role;
