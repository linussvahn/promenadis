-- Milestone 5, slice 1: application notifications.
--
-- Structured templates only: hosts never compose mail or upload recipient
-- lists. Domain transitions enqueue a fixed template with an allowlisted
-- payload (event title and state) in the committing transaction. Each job
-- names its recipient by reference (account, seller or team invitation, or
-- a report's optional contact); the address is resolved only at send time.
-- Required mail is claimed before optional reminders, sends are capped per
-- minute so a cancellation burst drains steadily, failures back off and
-- dead-letter after six attempts, and bounces/complaints suppress an address
-- by HMAC. Accounts also get an in-app copy for 30 days.
create table app_private.instance_secrets (
  name text primary key,
  value bytea not null
);
insert into app_private.instance_secrets (name, value)
values ('email_suppression_hmac', extensions.gen_random_bytes(32));
alter table app_private.instance_secrets enable row level security;
revoke all on app_private.instance_secrets from public, anon, authenticated;

create function app_private.email_hash(p_email text)
returns text language sql stable set search_path = '' as $$
  select encode(extensions.hmac(convert_to(lower(btrim(p_email)), 'UTF8'),
    (select value from app_private.instance_secrets where name = 'email_suppression_hmac'), 'sha256'), 'hex');
$$;

create table app_private.email_suppressions (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('bounce', 'complaint')),
  created_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp()
);

create table app_private.notification_preferences (
  account_id uuid primary key references public.profiles (account_id) on delete cascade,
  event_reminders boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);

create table app_private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  template text not null check (template in (
    'seller_approved', 'seller_waitlisted', 'seller_rejected', 'seller_revoked', 'seller_suspended',
    'seller_reinstated', 'address_change_approved', 'event_cancelled', 'event_postponed',
    'event_rescheduled', 'location_quarantined', 'location_restored', 'appeal_decided',
    'seller_invited', 'team_invited', 'unlisted_link_rotated', 'report_reviewed', 'event_reminder')),
  priority text not null check (priority in ('required', 'optional')),
  event_id uuid references public.events (id) on delete cascade,
  recipient_account_id uuid references public.profiles (account_id) on delete cascade,
  recipient_seller_invite_id uuid references public.seller_invites (id) on delete cascade,
  recipient_team_invite_id uuid references public.event_invites (id) on delete cascade,
  recipient_report_id uuid references app_private.reports (id) on delete cascade,
  -- Event title and state only; cleared once delivered.
  payload jsonb,
  dedupe_key text not null unique,
  available_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '7 days',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_id uuid,
  lease_until timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or cancel_reason in ('suppressed', 'recipient_gone', 'preference')),
  dead_lettered_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (num_nonnulls(recipient_account_id, recipient_seller_invite_id, recipient_team_invite_id, recipient_report_id) = 1),
  check ((lease_id is null) = (lease_until is null))
);
create index notification_outbox_ready on app_private.notification_outbox (priority, available_at)
  where completed_at is null and cancelled_at is null and dead_lettered_at is null;

-- In-app copy for accounts; expires after 30 days.
create table public.account_notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  template text not null,
  event_id uuid references public.events (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz
);
create index account_notifications_account on public.account_notifications (account_id, created_at desc);

alter table app_private.email_suppressions enable row level security;
alter table app_private.notification_preferences enable row level security;
alter table app_private.notification_outbox enable row level security;
alter table public.account_notifications enable row level security;
revoke all on app_private.email_suppressions, app_private.notification_preferences,
  app_private.notification_outbox, public.account_notifications from public, anon, authenticated;

create function app_private.enqueue_notification(
  p_template text, p_event_id uuid, p_dedupe_key text,
  p_account_id uuid default null, p_seller_invite_id uuid default null,
  p_team_invite_id uuid default null, p_report_id uuid default null,
  p_priority text default 'required'
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  payload jsonb;
  inserted boolean;
begin
  select jsonb_build_object('eventTitle', e.title, 'eventState', e.state) into payload
  from public.events e where e.id = p_event_id;
  insert into app_private.notification_outbox (template, priority, event_id, recipient_account_id,
    recipient_seller_invite_id, recipient_team_invite_id, recipient_report_id, payload, dedupe_key)
  values (p_template, p_priority, p_event_id, p_account_id, p_seller_invite_id, p_team_invite_id,
    p_report_id, coalesce(payload, '{}'::jsonb), p_dedupe_key)
  on conflict (dedupe_key) do nothing
  returning true into inserted;
  if inserted and p_account_id is not null then
    insert into public.account_notifications (account_id, template, event_id, payload)
    values (p_account_id, p_template, p_event_id, coalesce(payload, '{}'::jsonb));
  end if;
end;
$$;

-- Seller decisions and status changes.
create function app_private.notify_participation_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare template text;
begin
  if new.state = old.state then return null; end if;
  template := case
    when new.state = 'approved' and old.state = 'pending_address_change' then 'address_change_approved'
    when new.state = 'approved' and old.state = 'suspended' then 'seller_reinstated'
    when new.state = 'approved' and old.state in ('pending', 'waitlisted') then 'seller_approved'
    when new.state = 'waitlisted' and old.state = 'pending' then 'seller_waitlisted'
    when new.state = 'rejected' then 'seller_rejected'
    when new.state = 'revoked' then 'seller_revoked'
    when new.state = 'suspended' then 'seller_suspended'
  end;
  if template is not null then
    perform app_private.enqueue_notification(template, new.event_id,
      template || ':' || new.id || ':' || new.version, p_account_id => new.account_id);
  end if;
  return null;
end;
$$;
create trigger seller_participations_notify after update of state on public.seller_participations
for each row execute function app_private.notify_participation_change();

-- Event cancellation, postponement and rescheduling reach sellers; the team
-- also hears about cancellation.
create function app_private.notify_event_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  template text;
  recipient record;
begin
  if new.state = old.state then return null; end if;
  template := case
    when new.state = 'cancelled' then 'event_cancelled'
    when new.state = 'postponed' then 'event_postponed'
    when new.state = 'published' and old.state = 'postponed' then 'event_rescheduled'
  end;
  if template is null then return null; end if;
  for recipient in
    select distinct p.account_id from public.seller_participations p
    where p.event_id = new.id and p.state not in ('withdrawn', 'rejected', 'revoked')
    union
    select m.account_id from public.event_memberships m
    where m.event_id = new.id and template = 'event_cancelled'
  loop
    perform app_private.enqueue_notification(template, new.id,
      template || ':' || new.id || ':' || new.version || ':' || recipient.account_id,
      p_account_id => recipient.account_id);
  end loop;
  return null;
end;
$$;
create trigger events_notify after update of state on public.events
for each row execute function app_private.notify_event_change();

create function app_private.notify_quarantine_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  template text;
  recipient record;
begin
  template := case
    when old.quarantined_at is null and new.quarantined_at is not null then 'location_quarantined'
    when old.quarantined_at is not null and new.quarantined_at is null then 'location_restored'
  end;
  if template is null then return null; end if;
  for recipient in
    select p.account_id from public.seller_participations p where p.location_id = new.id
  loop
    perform app_private.enqueue_notification(template, new.event_id,
      template || ':' || new.id || ':' || extract(epoch from clock_timestamp())::bigint || ':' || recipient.account_id,
      p_account_id => recipient.account_id);
  end loop;
  return null;
end;
$$;
create trigger event_locations_notify after update of quarantined_at on public.event_locations
for each row execute function app_private.notify_quarantine_change();

create function app_private.notify_appeal_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.state = 'pending' and new.state <> 'pending' then
    perform app_private.enqueue_notification('appeal_decided',
      (select a.event_id from app_private.moderation_actions a where a.id = new.action_id),
      'appeal_decided:' || new.id, p_account_id => new.appellant_account_id);
  end if;
  return null;
end;
$$;
create trigger moderation_appeals_notify after update of state on app_private.moderation_appeals
for each row execute function app_private.notify_appeal_decision();

create function app_private.notify_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'seller_invites' then
    perform app_private.enqueue_notification('seller_invited', new.event_id, 'seller_invited:' || new.id,
      p_seller_invite_id => new.id);
  else
    perform app_private.enqueue_notification('team_invited', new.event_id, 'team_invited:' || new.id,
      p_team_invite_id => new.id);
  end if;
  return null;
end;
$$;
create trigger seller_invites_notify after insert on public.seller_invites
for each row execute function app_private.notify_invitation();
create trigger event_invites_notify after insert on public.event_invites
for each row execute function app_private.notify_invitation();

create function app_private.notify_link_rotation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recipient record;
begin
  if new.reason <> 'rotated' or new.event_id is null then return null; end if;
  for recipient in
    select p.account_id from public.seller_participations p
    where p.event_id = new.event_id and p.state in ('approved', 'pending', 'waitlisted', 'suspended')
    union
    select m.account_id from public.event_memberships m where m.event_id = new.event_id
  loop
    perform app_private.enqueue_notification('unlisted_link_rotated', new.event_id,
      'unlisted_link_rotated:' || new.public_key || ':' || recipient.account_id,
      p_account_id => recipient.account_id);
  end loop;
  return null;
end;
$$;
create trigger retired_event_keys_notify after insert on public.retired_event_keys
for each row execute function app_private.notify_link_rotation();

-- Reporters who left a contact learn only that the report was reviewed,
-- never what happened to the subject.
create function app_private.notify_report_review()
returns trigger language plpgsql security definer set search_path = '' as $$
declare report record;
begin
  if old.state = new.state or new.state <> 'closed' then return null; end if;
  for report in select r.id from app_private.reports r where r.case_id = new.id and r.reporter_contact is not null
  loop
    perform app_private.enqueue_notification('report_reviewed', new.event_id, 'report_reviewed:' || report.id,
      p_report_id => report.id);
  end loop;
  return null;
end;
$$;
create trigger moderation_cases_notify after update of state on app_private.moderation_cases
for each row execute function app_private.notify_report_review();

-- Hourly: optional reminders a day before the event, for sellers who opted in.
create function app_private.enqueue_event_reminders_command()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  queued integer := 0;
  recipient record;
begin
  for recipient in
    select p.account_id, p.event_id, p.id from public.seller_participations p
    join public.events e on e.id = p.event_id and e.state = 'published'
    join app_private.notification_preferences n on n.account_id = p.account_id and n.event_reminders
    where p.state = 'approved'
      and (select min(i.starts_at) from public.event_intervals i where i.event_id = e.id)
        between clock_timestamp() + interval '20 hours' and clock_timestamp() + interval '26 hours'
  loop
    perform app_private.enqueue_notification('event_reminder', recipient.event_id,
      'event_reminder:' || recipient.id, p_account_id => recipient.account_id, p_priority => 'optional');
    queued := queued + 1;
  end loop;
  return queued;
end;
$$;
select cron.schedule('promenadis-event-reminders', '7 * * * *', 'select app_private.enqueue_event_reminders_command();');

-- Worker (local Node script now, SES sender later). Required first, at most
-- 60 sends per minute across the instance.
create function public.claim_application_notifications(p_limit integer default 10)
returns table(job_id uuid, lease_id uuid, template text, payload jsonb)
language plpgsql security definer set search_path = '' as $$
declare room integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 25 then raise exception 'Invalid notification batch size'; end if;
  room := greatest(0, 60 - (select count(*)::int from app_private.notification_outbox
    where completed_at > clock_timestamp() - interval '1 minute'));
  return query
  with candidates as (
    select o.id from app_private.notification_outbox o
    where o.completed_at is null and o.cancelled_at is null and o.dead_lettered_at is null
      and o.expires_at > clock_timestamp() and o.available_at <= clock_timestamp()
      and (o.lease_until is null or o.lease_until <= clock_timestamp())
    order by o.priority = 'optional', o.available_at, o.id
    limit least(p_limit, room) for update skip locked
  )
  update app_private.notification_outbox o
  set lease_id = extensions.gen_random_uuid(), lease_until = clock_timestamp() + interval '2 minutes',
      attempt_count = o.attempt_count + 1
  from candidates c where o.id = c.id
  returning o.id, o.lease_id, o.template, o.payload;
end;
$$;

-- Resolves the address at send time; a suppressed, departed or opted-out
-- recipient cancels the job instead.
create function public.resolve_application_recipient(p_job_id uuid, p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job app_private.notification_outbox;
  email text;
  locale text;
  reason text;
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
  else
    select r.reporter_contact into email from app_private.reports r
    where r.id = job.recipient_report_id and r.reporter_contact ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  end if;
  if email is null then
    reason := 'recipient_gone';
  elsif exists (select 1 from app_private.email_suppressions where email_hash = app_private.email_hash(email)) then
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
  return jsonb_build_object('email', email, 'locale', coalesce(locale, 'both'));
end;
$$;

create function public.finish_application_notification(p_job_id uuid, p_lease_id uuid, p_delivered boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if p_delivered is null then return false; end if;
  update app_private.notification_outbox o set
    completed_at = case when p_delivered then clock_timestamp() end,
    payload = case when p_delivered then null else o.payload end,
    dead_lettered_at = case when not p_delivered and o.attempt_count >= 6 then clock_timestamp() end,
    available_at = case when p_delivered then o.available_at
      else clock_timestamp() + interval '1 minute' * power(2, o.attempt_count - 1) end,
    lease_id = null, lease_until = null
  where o.id = p_job_id and o.lease_id = p_lease_id and o.lease_until > clock_timestamp()
    and o.completed_at is null and o.cancelled_at is null;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

-- Provider feedback (SES notifications later; a local script now).
create function public.record_email_feedback_command(p_email text, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_kind not in ('bounce', 'complaint') or p_email is null then raise exception 'Invalid feedback'; end if;
  insert into app_private.email_suppressions (email_hash, reason)
  values (app_private.email_hash(p_email), p_kind)
  on conflict (email_hash) do update set
    reason = case when app_private.email_suppressions.reason = 'complaint' then 'complaint' else excluded.reason end,
    last_seen_at = clock_timestamp();
end;
$$;

-- Health for monitors: counts only, no identities.
create function public.notification_queue_health_command()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'queued', count(*) filter (where completed_at is null and cancelled_at is null and dead_lettered_at is null),
    'deadLettered', count(*) filter (where dead_lettered_at is not null),
    'oldestQueuedMinutes', coalesce(extract(epoch from clock_timestamp() - min(created_at) filter (
      where completed_at is null and cancelled_at is null and dead_lettered_at is null)) / 60, 0)::int)
  from app_private.notification_outbox;
$$;

-- Hourly: delivery metadata and in-app notices go after 30 days; an address
-- suppression goes 30 days after nothing references that address any more.
create function app_private.enforce_notification_retention_command()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from app_private.notification_outbox
  where created_at <= clock_timestamp() - interval '30 days'
     or (expires_at <= clock_timestamp() and completed_at is null);
  get diagnostics removed = row_count;
  delete from public.account_notifications where created_at <= clock_timestamp() - interval '30 days';
  delete from app_private.email_suppressions s
  where s.last_seen_at <= clock_timestamp() - interval '30 days'
    and not exists (select 1 from auth.users u where app_private.email_hash(u.email) = s.email_hash)
    and not exists (select 1 from public.seller_invites i where app_private.email_hash(i.email) = s.email_hash)
    and not exists (select 1 from public.event_invites i where app_private.email_hash(i.invited_email) = s.email_hash);
  return removed;
end;
$$;
select cron.schedule('promenadis-notification-retention', '23 * * * *',
  'select app_private.enforce_notification_retention_command();');

create function public.list_account_notifications_command(p_actor_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'template', n.template, 'eventId', n.event_id,
      'eventTitle', n.payload->>'eventTitle', 'createdAt', n.created_at, 'read', n.read_at is not null)
    order by n.created_at desc), '[]'::jsonb)
  from (select * from public.account_notifications where account_id = p_actor_id
    order by created_at desc limit 50) n;
$$;

create function public.mark_account_notifications_read_command(p_actor_id uuid, p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.account_notifications set read_at = coalesce(read_at, clock_timestamp())
  where account_id = p_actor_id and (p_notification_id is null or id = p_notification_id);
  return public.list_account_notifications_command(p_actor_id);
end;
$$;

create function public.get_notification_preferences_command(p_actor_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('eventReminders', coalesce((select event_reminders
    from app_private.notification_preferences where account_id = p_actor_id), false));
$$;

create function public.set_notification_preferences_command(p_actor_id uuid, p_event_reminders boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  insert into app_private.notification_preferences (account_id, event_reminders)
  values (p_actor_id, coalesce(p_event_reminders, false))
  on conflict (account_id) do update set event_reminders = excluded.event_reminders, updated_at = clock_timestamp();
  return public.get_notification_preferences_command(p_actor_id);
end;
$$;

revoke all on function app_private.email_hash(text) from public, anon, authenticated;
revoke all on function app_private.enqueue_notification(text, uuid, text, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function app_private.notify_participation_change() from public, anon, authenticated;
revoke all on function app_private.notify_event_change() from public, anon, authenticated;
revoke all on function app_private.notify_quarantine_change() from public, anon, authenticated;
revoke all on function app_private.notify_appeal_decision() from public, anon, authenticated;
revoke all on function app_private.notify_invitation() from public, anon, authenticated;
revoke all on function app_private.notify_link_rotation() from public, anon, authenticated;
revoke all on function app_private.notify_report_review() from public, anon, authenticated;
revoke all on function app_private.enqueue_event_reminders_command() from public, anon, authenticated;
revoke all on function app_private.enforce_notification_retention_command() from public, anon, authenticated;
revoke all on function public.claim_application_notifications(integer) from public, anon, authenticated;
revoke all on function public.resolve_application_recipient(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_application_notification(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.record_email_feedback_command(text, text) from public, anon, authenticated;
revoke all on function public.notification_queue_health_command() from public, anon, authenticated;
revoke all on function public.list_account_notifications_command(uuid) from public, anon, authenticated;
revoke all on function public.mark_account_notifications_read_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_notification_preferences_command(uuid) from public, anon, authenticated;
revoke all on function public.set_notification_preferences_command(uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_application_notifications(integer) to service_role;
grant execute on function public.resolve_application_recipient(uuid, uuid) to service_role;
grant execute on function public.finish_application_notification(uuid, uuid, boolean) to service_role;
grant execute on function public.record_email_feedback_command(text, text) to service_role;
grant execute on function public.notification_queue_health_command() to service_role;
grant execute on function public.list_account_notifications_command(uuid) to service_role;
grant execute on function public.mark_account_notifications_read_command(uuid, uuid) to service_role;
grant execute on function public.get_notification_preferences_command(uuid) to service_role;
grant execute on function public.set_notification_preferences_command(uuid, boolean) to service_role;
