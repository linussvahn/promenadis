-- Milestone 5, slice 2: the organizer contact relay and the limited export.
--
-- Relay: a visitor writes to the event team from the public page. Neither
-- side sees the other's address. Owners and co-hosts read and answer in the
-- app; the visitor follows the thread through a private link (a 128-bit
-- token, stored hashed). Plain text, no attachments. Bodies expire 30 days
-- after delivery; the visitor's address and thread go 14 days after the
-- event ends or is cancelled.
--
-- Export: owners and co-hosts download a CSV of approved sellers' public
-- operational fields (address, name, title, hours, categories, status) with
-- formula cells neutralized. Recent sign-in, one active export per event,
-- three per event and account per day, capped at the entitlement; the
-- download is single-purpose and the file is deleted within 24 hours.
create table app_private.relay_threads (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  visitor_email text not null check (visitor_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(visitor_email) <= 320),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- The link token, encrypted with an instance secret, so a reply mail can
  -- carry the visitor's private thread link. Deleted with the thread.
  token_cipher bytea not null,
  network_bucket text not null,
  created_at timestamptz not null default clock_timestamp(),
  last_message_at timestamptz not null default clock_timestamp()
);
create table app_private.relay_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references app_private.relay_threads (id) on delete cascade,
  direction text not null check (direction in ('visitor', 'organizer')),
  author_account_id uuid references public.profiles (account_id) on delete set null,
  body text not null check (char_length(btrim(body)) between 10 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  delivered_at timestamptz
);
create index relay_threads_event on app_private.relay_threads (event_id, last_message_at desc);

create table app_private.event_exports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  requested_by_account_id uuid references public.profiles (account_id) on delete set null,
  csv text,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  row_count integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '24 hours',
  downloaded_at timestamptz
);
alter table app_private.relay_threads enable row level security;
alter table app_private.relay_messages enable row level security;
alter table app_private.event_exports enable row level security;
revoke all on app_private.relay_threads, app_private.relay_messages, app_private.event_exports
  from public, anon, authenticated;

-- Relay mail carries the message body; it is read from the message at send
-- time, never copied into the outbox.
alter table app_private.notification_outbox
  add column recipient_relay_thread_id uuid references app_private.relay_threads (id) on delete cascade,
  add column relay_message_id uuid references app_private.relay_messages (id) on delete cascade,
  drop constraint notification_outbox_template_check,
  add constraint notification_outbox_template_check check (template in (
    'seller_approved', 'seller_waitlisted', 'seller_rejected', 'seller_revoked', 'seller_suspended',
    'seller_reinstated', 'address_change_approved', 'event_cancelled', 'event_postponed',
    'event_rescheduled', 'location_quarantined', 'location_restored', 'appeal_decided',
    'seller_invited', 'team_invited', 'unlisted_link_rotated', 'report_reviewed', 'event_reminder',
    'relay_to_organizer', 'relay_to_visitor')),
  drop constraint notification_outbox_check,
  add constraint notification_outbox_recipient check (num_nonnulls(recipient_account_id, recipient_seller_invite_id,
    recipient_team_invite_id, recipient_report_id, recipient_relay_thread_id) = 1);

insert into app_private.instance_secrets (name, value)
values ('relay_token_key', extensions.gen_random_bytes(32));

create function app_private.relay_key()
returns text language sql stable set search_path = '' as $$
  select encode(value, 'hex') from app_private.instance_secrets where name = 'relay_token_key';
$$;

create function app_private.token_hash(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

create function app_private.relay_thread_summary(p_thread app_private.relay_threads, p_for_team boolean)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_thread.id,
    'eventTitle', (select title from public.events where id = p_thread.event_id),
    'createdAt', p_thread.created_at,
    'lastMessageAt', p_thread.last_message_at,
    -- Neither side's address is ever returned.
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'direction', m.direction,
        'body', m.body, 'createdAt', m.created_at) order by m.created_at)
      from app_private.relay_messages m where m.thread_id = p_thread.id), '[]'::jsonb)
  );
$$;

create function app_private.queue_relay_message(p_thread app_private.relay_threads, p_message_id uuid, p_direction text)
returns void language plpgsql security definer set search_path = '' as $$
declare recipient record;
begin
  if p_direction = 'visitor' then
    for recipient in
      select m.account_id from public.event_memberships m
      join auth.users u on u.id = m.account_id and u.email_confirmed_at is not null
      where m.event_id = p_thread.event_id and m.role in ('owner', 'co_host')
    loop
      insert into app_private.notification_outbox (template, priority, event_id, recipient_account_id,
        relay_message_id, payload, dedupe_key)
      values ('relay_to_organizer', 'required', p_thread.event_id, recipient.account_id, p_message_id,
        jsonb_build_object('eventTitle', (select title from public.events where id = p_thread.event_id)),
        'relay:' || p_message_id || ':' || recipient.account_id);
      insert into public.account_notifications (account_id, template, event_id, payload)
      values (recipient.account_id, 'relay_to_organizer', p_thread.event_id,
        jsonb_build_object('eventTitle', (select title from public.events where id = p_thread.event_id)));
    end loop;
  else
    insert into app_private.notification_outbox (template, priority, event_id, recipient_relay_thread_id,
      relay_message_id, payload, dedupe_key)
    values ('relay_to_visitor', 'required', p_thread.event_id, p_thread.id, p_message_id,
      jsonb_build_object('eventTitle', (select title from public.events where id = p_thread.event_id)),
      'relay:' || p_message_id);
  end if;
end;
$$;

-- Anonymous: 3 new threads per hour per network prefix, 50 per event per day.
create function public.start_relay_thread_command(
  p_event_key text, p_visitor_email text, p_body text, p_token text, p_network_bucket text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  event_row public.events;
  thread app_private.relay_threads;
  message_id uuid;
begin
  select * into event_row from public.events where public_key = p_event_key and state in ('published', 'active', 'postponed');
  if event_row.id is null then raise exception 'Event not found'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 10 and 1000
    or coalesce(p_visitor_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(p_token) < 32
  then raise exception 'Invalid message'; end if;
  if (select count(*) from app_private.relay_threads where network_bucket = p_network_bucket
      and created_at > clock_timestamp() - interval '1 hour') >= 3
    or (select count(*) from app_private.relay_threads where event_id = event_row.id
      and created_at > clock_timestamp() - interval '1 day') >= 50
  then raise exception 'Message limit reached'; end if;
  insert into app_private.relay_threads (event_id, visitor_email, token_hash, token_cipher, network_bucket)
  values (event_row.id, lower(btrim(p_visitor_email)), app_private.token_hash(p_token),
    extensions.pgp_sym_encrypt(p_token, app_private.relay_key()), p_network_bucket)
  returning * into thread;
  insert into app_private.relay_messages (thread_id, direction, body)
  values (thread.id, 'visitor', btrim(p_body)) returning id into message_id;
  perform app_private.queue_relay_message(thread, message_id, 'visitor');
  return jsonb_build_object('threadId', thread.id);
end;
$$;

create function public.read_relay_thread_command(p_thread_id uuid, p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select app_private.relay_thread_summary(t, false) from app_private.relay_threads t
  where t.id = p_thread_id and t.token_hash = app_private.token_hash(p_token);
$$;

create function public.reply_relay_thread_command(
  p_actor_id uuid, p_thread_id uuid, p_token text, p_body text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  thread app_private.relay_threads;
  direction text;
  message_id uuid;
begin
  select * into thread from app_private.relay_threads where id = p_thread_id for update;
  if thread.id is null then raise exception 'Thread not found'; end if;
  if p_actor_id is not null then
    if not exists (select 1 from public.event_memberships where event_id = thread.event_id
      and account_id = p_actor_id and role in ('owner', 'co_host'))
    then raise exception 'Thread not found'; end if;
    direction := 'organizer';
  elsif thread.token_hash = app_private.token_hash(coalesce(p_token, '')) then
    direction := 'visitor';
  else
    raise exception 'Thread not found';
  end if;
  if not exists (select 1 from public.events where id = thread.event_id and state in ('published', 'active', 'postponed'))
  then raise exception 'Relay closed'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 10 and 1000 then raise exception 'Invalid message'; end if;
  if (select count(*) from app_private.relay_messages where thread_id = thread.id
      and created_at > clock_timestamp() - interval '1 hour') >= 10
  then raise exception 'Message limit reached'; end if;
  insert into app_private.relay_messages (thread_id, direction, author_account_id, body)
  values (thread.id, direction, p_actor_id, btrim(p_body)) returning id into message_id;
  update app_private.relay_threads set last_message_at = clock_timestamp() where id = thread.id;
  perform app_private.queue_relay_message(thread, message_id, direction);
  return app_private.relay_thread_summary((select t from app_private.relay_threads t where t.id = thread.id), p_actor_id is not null);
end;
$$;

create function public.list_relay_threads_command(p_actor_id uuid, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.event_memberships where event_id = p_event_id
    and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Actor cannot read organizer messages'; end if;
  return coalesce((select jsonb_agg(app_private.relay_thread_summary(t, true) order by t.last_message_at desc)
    from app_private.relay_threads t where t.event_id = p_event_id), '[]'::jsonb);
end;
$$;

-- The relay recipient resolves like other notices, plus the message body.
create or replace function public.resolve_application_recipient(p_job_id uuid, p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job app_private.notification_outbox;
  email text;
  locale text;
  reason text;
  body text;
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
  if job.relay_message_id is not null then
    update app_private.relay_messages set delivered_at = coalesce(delivered_at, clock_timestamp())
    where id = job.relay_message_id;
  end if;
  return jsonb_build_object('email', email, 'locale', coalesce(locale, 'both'))
    || case when body is not null then jsonb_build_object('body', body,
      'threadId', coalesce(job.recipient_relay_thread_id, (select thread_id from app_private.relay_messages where id = job.relay_message_id)))
    else '{}'::jsonb end
    -- Only the visitor's own mail carries the private thread link.
    || case when job.recipient_relay_thread_id is not null then jsonb_build_object('threadToken',
      (select extensions.pgp_sym_decrypt(t.token_cipher, app_private.relay_key())
       from app_private.relay_threads t where t.id = job.recipient_relay_thread_id))
    else '{}'::jsonb end;
end;
$$;

-- Export.
create function app_private.csv_cell(p_value text)
returns text language sql immutable set search_path = '' as $$
  -- Formula-looking cells are prefixed so spreadsheets treat them as text.
  select '"' || replace(case when coalesce(p_value, '') ~ '^[=+\-@\t\r]' then '''' || p_value else coalesce(p_value, '') end,
    '"', '""') || '"';
$$;

create function public.request_event_export_command(
  p_actor_id uuid, p_event_id uuid, p_token text, p_authenticated_at timestamptz, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  export_id uuid;
  body text;
  row_total integer;
  limit_rows integer;
begin
  if not exists (select 1 from public.event_memberships where event_id = p_event_id
    and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Actor cannot export'; end if;
  perform app_private.require_recent_authentication(p_authenticated_at);
  perform 1 from public.events where id = p_event_id for update;
  if exists (select 1 from app_private.event_exports where event_id = p_event_id
    and expires_at > clock_timestamp() and downloaded_at is null)
  then raise exception 'Export already active'; end if;
  if (select count(*) from app_private.event_exports where event_id = p_event_id
      and requested_by_account_id = p_actor_id and created_at > clock_timestamp() - interval '1 day') >= 3
  then raise exception 'Export limit reached'; end if;
  limit_rows := coalesce((select seller_limit from public.event_entitlements where event_id = p_event_id), 30);
  with chosen as (
    select p.*, l.address_line, l.postal_code, l.locality, sl.title, s.status as live_status
    from public.seller_participations p
    join public.event_locations l on l.id = p.location_id
    left join public.seller_listings sl on sl.participation_id = p.id
    left join public.seller_live_status s on s.participation_id = p.id
    where p.event_id = p_event_id and p.state = 'approved'
    order by l.address_line, p.display_name
    limit limit_rows
  )
  select count(*), string_agg(concat_ws(',',
      app_private.csv_cell(c.address_line), app_private.csv_cell(c.postal_code), app_private.csv_cell(c.locality),
      app_private.csv_cell(c.display_name), app_private.csv_cell(c.title),
      app_private.csv_cell((select string_agg(to_char(a.starts_at at time zone e.timezone, 'YYYY-MM-DD HH24:MI') || '–'
        || to_char(a.ends_at at time zone e.timezone, 'HH24:MI'), '; ' order by a.starts_at)
        from public.seller_availability a where a.participation_id = c.id)),
      app_private.csv_cell((select string_agg(x.label, '; ' order by sca.position)
        from public.seller_category_assignments sca
        join public.taxonomy_category_localizations x on x.category_id = sca.category_id and x.locale = 'sv'
        where sca.participation_id = c.id)),
      app_private.csv_cell(coalesce(c.live_status, 'open'))), E'\r\n')
  into row_total, body
  from chosen c join public.events e on e.id = c.event_id;
  insert into app_private.event_exports (event_id, requested_by_account_id, csv, token_hash, row_count)
  values (p_event_id, p_actor_id,
    concat_ws(E'\r\n', 'address,postal_code,locality,seller,title,hours,categories,status', body) || E'\r\n',
    app_private.token_hash(p_token), coalesce(row_total, 0))
  returning id into export_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.export_created', 'event_export', export_id, p_event_id,
    jsonb_build_object('rows', coalesce(row_total, 0)));
  return jsonb_build_object('exportId', export_id, 'rows', coalesce(row_total, 0),
    'expiresAt', clock_timestamp() + interval '24 hours');
end;
$$;

-- Single purpose: the requester, the token, before expiry, once.
create function public.download_event_export_command(p_actor_id uuid, p_export_id uuid, p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare export_row app_private.event_exports;
begin
  select * into export_row from app_private.event_exports
  where id = p_export_id and requested_by_account_id = p_actor_id
    and token_hash = app_private.token_hash(coalesce(p_token, ''))
    and expires_at > clock_timestamp() and downloaded_at is null and csv is not null
  for update;
  if export_row.id is null then raise exception 'Export unavailable'; end if;
  if not exists (select 1 from public.event_memberships where event_id = export_row.event_id
    and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Export unavailable'; end if;
  update app_private.event_exports set downloaded_at = clock_timestamp(), csv = null where id = p_export_id;
  return export_row.csv;
end;
$$;

-- Hourly: exports after 24 hours, relay bodies 30 days after delivery,
-- relay threads (with the visitor address) 14 days after the event ends.
create function app_private.enforce_relay_export_retention_command()
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from app_private.event_exports where expires_at <= clock_timestamp();
  get diagnostics removed = row_count;
  delete from app_private.relay_messages where delivered_at <= clock_timestamp() - interval '30 days'
    or created_at <= clock_timestamp() - interval '37 days';
  delete from app_private.relay_threads t using public.events e
  where e.id = t.event_id and e.state in ('ended', 'cancelled', 'archived')
    and e.state_changed_at <= clock_timestamp() - interval '14 days';
  return removed;
end;
$$;
select cron.schedule('promenadis-relay-export-retention', '29 * * * *',
  'select app_private.enforce_relay_export_retention_command();');

revoke all on function app_private.token_hash(text) from public, anon, authenticated;
revoke all on function app_private.relay_key() from public, anon, authenticated;
revoke all on function app_private.relay_thread_summary(app_private.relay_threads, boolean) from public, anon, authenticated;
revoke all on function app_private.queue_relay_message(app_private.relay_threads, uuid, text) from public, anon, authenticated;
revoke all on function app_private.csv_cell(text) from public, anon, authenticated;
revoke all on function app_private.enforce_relay_export_retention_command() from public, anon, authenticated;
revoke all on function public.start_relay_thread_command(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.read_relay_thread_command(uuid, text) from public, anon, authenticated;
revoke all on function public.reply_relay_thread_command(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_relay_threads_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_event_export_command(uuid, uuid, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.download_event_export_command(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.start_relay_thread_command(text, text, text, text, text) to service_role;
grant execute on function public.read_relay_thread_command(uuid, text) to service_role;
grant execute on function public.reply_relay_thread_command(uuid, uuid, text, text) to service_role;
grant execute on function public.list_relay_threads_command(uuid, uuid) to service_role;
grant execute on function public.request_event_export_command(uuid, uuid, text, timestamptz, uuid) to service_role;
grant execute on function public.download_event_export_command(uuid, uuid, text) to service_role;
