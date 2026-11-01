-- Account deletion: a seven-day disabled recovery window, then erasure.
-- A request is refused while the account still owns a live event or a shared
-- organizer identity; ended/cancelled/archived history shells survive without
-- a personal-account link.

-- History shells may outlive their creator and their erased owner.
alter table public.events alter column created_by_account_id drop not null;
alter table public.events drop constraint events_created_by_account_id_fkey;
alter table public.events add constraint events_created_by_account_id_fkey
  foreign key (created_by_account_id) references public.profiles (account_id) on delete set null;
alter table public.organizer_profiles alter column created_by_account_id drop not null;
alter table public.organizer_profiles drop constraint organizer_profiles_created_by_account_id_fkey;
alter table public.organizer_profiles add constraint organizer_profiles_created_by_account_id_fkey
  foreign key (created_by_account_id) references public.profiles (account_id) on delete set null;
-- Hidden and detached from the erased owner; kept only for history shells.
alter table public.organizer_profiles add column detached_at timestamptz;

create or replace function app_private.enforce_exactly_one_event_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected_event_id uuid := coalesce(new.event_id, old.event_id);
  event_state text;
  owners bigint;
begin
  select state into event_state from public.events where id = affected_event_id;
  if event_state is null then return null; end if;
  select count(*) into owners from public.event_memberships
  where event_id = affected_event_id and role = 'owner';
  -- Finished history shells may lose an erased owner, never gain a second.
  if owners > 1 or (owners = 0 and event_state not in ('ended', 'cancelled', 'archived')) then
    raise exception 'Every event must have exactly one owner';
  end if;
  return null;
end;
$$;

create table app_private.account_deletion_requests (
  account_id uuid primary key references public.profiles (account_id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp(),
  erase_after timestamptz not null,
  check (erase_after = requested_at + interval '7 days')
);
alter table app_private.account_deletion_requests enable row level security;
alter table app_private.account_deletion_requests force row level security;
revoke all on app_private.account_deletion_requests from public, anon, authenticated;

-- Backup restores replay these before serving data. Holds only the opaque ID.
create table app_private.erasure_tombstones (
  subject_type text not null check (subject_type = 'account'),
  subject_id uuid not null,
  erased_at timestamptz not null default clock_timestamp(),
  primary key (subject_type, subject_id)
);
alter table app_private.erasure_tombstones enable row level security;
alter table app_private.erasure_tombstones force row level security;
revoke all on app_private.erasure_tombstones from public, anon, authenticated;

create function app_private.account_deletion_blockers(p_account_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(blocker order by blocker->>'kind', blocker->>'title'), '[]'::jsonb)
  from (
    select jsonb_build_object('kind', 'owned_event', 'id', e.id, 'title', e.title, 'state', e.state) as blocker
    from public.event_memberships m
    join public.events e on e.id = m.event_id
    where m.account_id = p_account_id and m.role = 'owner'
      and e.state not in ('ended', 'cancelled', 'archived')
    union all
    select jsonb_build_object('kind', 'shared_organizer', 'id', o.id, 'title', o.display_name, 'state', null)
    from public.organizer_profile_memberships m
    join public.organizer_profiles o on o.id = m.organizer_profile_id
    where m.account_id = p_account_id and m.role = 'owner'
      and exists (select 1 from public.organizer_profile_memberships other
        where other.organizer_profile_id = o.id and other.account_id <> p_account_id)
  ) as blockers;
$$;

create function app_private.account_deletion_status(p_account_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pending', r.account_id is not null,
    'requestedAt', r.requested_at,
    'eraseAfter', r.erase_after,
    'blockers', app_private.account_deletion_blockers(p_account_id)
  )
  from (select p_account_id as account_id) as requested
  left join app_private.account_deletion_requests r on r.account_id = requested.account_id;
$$;

create function public.account_deletion_pending(p_account_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app_private.account_deletion_requests where account_id = p_account_id);
$$;

create function public.get_account_deletion_command(p_actor_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select app_private.account_deletion_status(p_actor_id);
$$;

create function public.request_account_deletion_command(
  p_actor_id uuid, p_authenticated_at timestamptz, p_confirmation_email text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  claim_id uuid;
  revoked integer;
  now_value timestamptz := clock_timestamp();
begin
  perform app_private.require_recent_authentication(p_authenticated_at);
  -- Serialize with other account-scoped commands.
  perform 1 from public.profiles where account_id = p_actor_id for update;
  if not found then raise exception 'Account unavailable'; end if;
  if lower(btrim(coalesce(p_confirmation_email, ''))) is distinct from
    (select lower(email) from auth.users where id = p_actor_id)
  then raise exception 'Deletion confirmation mismatch'; end if;
  if exists (select 1 from app_private.account_deletion_requests where account_id = p_actor_id)
  then raise exception 'Account deletion already requested'; end if;
  if jsonb_array_length(app_private.account_deletion_blockers(p_actor_id)) > 0
  then raise exception 'Account deletion blocked'; end if;

  -- A pending recovery would otherwise rebind an account that is being erased.
  perform 1 from app_private.account_recovery_codes where account_id = p_actor_id for update;
  select id into claim_id from app_private.account_recovery_claims where account_id = p_actor_id for update;
  if claim_id is not null then
    update app_private.notification_jobs set cancelled_at = clock_timestamp()
    where source_id = claim_id and completed_at is null and cancelled_at is null;
    delete from app_private.account_recovery_claims where id = claim_id;
  end if;

  insert into app_private.account_deletion_requests (account_id, requested_at, erase_after)
  values (p_actor_id, now_value, now_value + interval '7 days');
  -- Disabled: every session ends; signing in again only reaches cancellation.
  delete from auth.sessions where user_id = p_actor_id;
  get diagnostics revoked = row_count;
  delete from app_private.browser_sessions where account_id = p_actor_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'account.deletion_requested', 'account', p_actor_id,
    jsonb_build_object('revokedSessions', revoked));
  return app_private.account_deletion_status(p_actor_id);
end;
$$;

create function public.cancel_account_deletion_command(p_actor_id uuid, p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  delete from app_private.account_deletion_requests where account_id = p_actor_id;
  if not found then raise exception 'Account deletion not pending'; end if;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'account.deletion_cancelled', 'account', p_actor_id, '{}'::jsonb);
  return app_private.account_deletion_status(p_actor_id);
end;
$$;

-- Hourly. A request that gained a blocker is skipped (fail closed) and retried.
create function app_private.erase_due_accounts_command()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  request app_private.account_deletion_requests;
  erased integer := 0;
begin
  for request in select * from app_private.account_deletion_requests
    where erase_after <= clock_timestamp() for update skip locked
  loop
    if jsonb_array_length(app_private.account_deletion_blockers(request.account_id)) > 0 then
      insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
      values (extensions.gen_random_uuid(), null, 'account.erasure_blocked', 'account', request.account_id, '{}'::jsonb);
      continue;
    end if;
    -- Sole-owned organizer identities: delete when unused, otherwise hide and
    -- keep only for the history shells that still reference them.
    delete from public.organizer_profiles o
    where exists (select 1 from public.organizer_profile_memberships m
        where m.organizer_profile_id = o.id and m.account_id = request.account_id and m.role = 'owner')
      and not exists (select 1 from public.events e where e.organizer_profile_id = o.id);
    update public.organizer_profiles o set detached_at = clock_timestamp()
    where exists (select 1 from public.organizer_profile_memberships m
        where m.organizer_profile_id = o.id and m.account_id = request.account_id and m.role = 'owner');
    insert into app_private.erasure_tombstones (subject_type, subject_id)
    values ('account', request.account_id) on conflict do nothing;
    insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
    values (extensions.gen_random_uuid(), null, 'account.erased', 'account', request.account_id, '{}'::jsonb);
    -- Cascades the profile, memberships, codes, sessions, identities and the request.
    delete from auth.users where id = request.account_id;
    erased := erased + 1;
  end loop;
  return erased;
end;
$$;

select cron.schedule(
  'promenadis-erase-due-accounts',
  '23 * * * *',
  'select app_private.erase_due_accounts_command();'
);

revoke all on function app_private.account_deletion_blockers(uuid) from public,anon,authenticated;
revoke all on function app_private.account_deletion_status(uuid) from public,anon,authenticated;
revoke all on function app_private.erase_due_accounts_command() from public,anon,authenticated;
revoke all on function public.account_deletion_pending(uuid) from public,anon,authenticated;
revoke all on function public.get_account_deletion_command(uuid) from public,anon,authenticated;
revoke all on function public.request_account_deletion_command(uuid,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.cancel_account_deletion_command(uuid,uuid) from public,anon,authenticated;
grant execute on function public.account_deletion_pending(uuid) to service_role;
grant execute on function public.get_account_deletion_command(uuid) to service_role;
grant execute on function public.request_account_deletion_command(uuid,timestamptz,text,uuid) to service_role;
grant execute on function public.cancel_account_deletion_command(uuid,uuid) to service_role;

comment on table app_private.account_deletion_requests is
  'Seven-day disabled recovery window before hourly erasure; no copied personal data.';
comment on table app_private.erasure_tombstones is
  'Opaque erased-account IDs replayed before any restored backup may serve data.';
