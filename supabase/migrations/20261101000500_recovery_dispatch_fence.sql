-- Durable recovery dispatch fence. Supabase Auth writes to this same database,
-- so the Auth email update is fenced by a trigger on auth.users and its outcome
-- is always observable by reading auth.users after the dispatch row lock. A
-- lease therefore fences the external service: a late Auth request after lease
-- expiry or resolution is rejected inside Auth's own transaction.
--
-- Lock order everywhere: recovery code -> claim -> dispatch. The auth.users
-- trigger takes only the dispatch row (FOR SHARE) and resolution never locks
-- auth.users/auth.identities, so an in-flight Auth update and a resolver
-- serialize on the dispatch row without deadlocking.

create table app_private.account_recovery_dispatches (
  id uuid primary key default extensions.gen_random_uuid(),
  -- No FK: the row must survive claim deletion as a short-lived fence tombstone.
  claim_id uuid not null,
  account_id uuid not null references public.profiles (account_id) on delete cascade,
  operation_id uuid not null,
  state text not null default 'dispatching'
    check (state in ('dispatching', 'applied', 'not_applied')),
  started_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz not null,
  resolved_at timestamptz,
  check (lease_until > started_at and lease_until <= started_at + interval '2 minutes 1 second'),
  check ((state = 'dispatching') = (resolved_at is null))
);
create unique index account_recovery_dispatches_one_active
on app_private.account_recovery_dispatches (account_id) where state = 'dispatching';
create index account_recovery_dispatches_latest
on app_private.account_recovery_dispatches (account_id, started_at desc);
alter table app_private.account_recovery_dispatches enable row level security;
alter table app_private.account_recovery_dispatches force row level security;
revoke all on app_private.account_recovery_dispatches from public, anon, authenticated;

-- Shared eligibility check for preparation and dispatch. Locks code then claim.
create function app_private.lock_eligible_recovery_claim(p_claim_id uuid, p_verification_token text)
returns app_private.account_recovery_claims
language plpgsql security definer set search_path = '' as $$
declare
  recovery app_private.account_recovery_codes;
  claim app_private.account_recovery_claims;
  current_email text;
begin
  if p_verification_token is null or p_verification_token !~ '^[A-Za-z0-9_-]{43}$'
  then raise exception 'Recovery claim unavailable'; end if;
  select * into recovery from app_private.account_recovery_codes
  where account_id = (select account_id from app_private.account_recovery_claims where id=p_claim_id)
  for update;
  select * into claim from app_private.account_recovery_claims where id=p_claim_id for update;
  if claim.id is null or recovery.account_id is null
    or claim.original_email is null or claim.email_verified_at is null
    or claim.ready_at > clock_timestamp() or claim.expires_at <= clock_timestamp()
    or recovery.version is distinct from claim.code_version
    or recovery.used_at is null or recovery.invalidated_at is not null
    or extensions.crypt(p_verification_token,claim.verification_token_hash)
      is distinct from claim.verification_token_hash
    or not public.account_recovery_notices_accepted(claim.id)
  then raise exception 'Recovery claim unavailable'; end if;

  select lower(email) into current_email from auth.users
  where id=claim.account_id and email_confirmed_at is not null;
  if current_email is distinct from claim.original_email
    or exists (select 1 from auth.users where lower(email)=claim.new_email)
  then raise exception 'Recovery claim unavailable'; end if;
  return claim;
end;
$$;

create or replace function public.prepare_account_recovery_command(
  p_claim_id uuid, p_verification_token text, p_correlation_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  claim app_private.account_recovery_claims;
  operation uuid;
begin
  if p_correlation_id is null then raise exception 'Recovery claim unavailable'; end if;
  claim := app_private.lock_eligible_recovery_claim(p_claim_id, p_verification_token);
  insert into app_private.account_recovery_preparations(claim_id)
  values(claim.id) on conflict (claim_id) do nothing
  returning operation_id into operation;
  if operation is not null then
    insert into app_private.audit_events(correlation_id,action,target_type,target_id,safe_summary)
    values(p_correlation_id,'account.recovery_prepared','account_recovery_claim',claim.id,'{}'::jsonb);
  else
    select operation_id into operation from app_private.account_recovery_preparations where claim_id=claim.id;
  end if;
  return operation;
end;
$$;

-- Resolve one dispatch from authoritative Auth state. While the lease is live
-- and Auth has not applied the change, the outcome is still undecided.
create function app_private.resolve_recovery_dispatch(p_dispatch_id uuid, p_correlation_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  dispatch app_private.account_recovery_dispatches;
  claim app_private.account_recovery_claims;
  current_email text;
  revoked integer;
begin
  select * into dispatch from app_private.account_recovery_dispatches where id = p_dispatch_id;
  if dispatch.id is null then raise exception 'Recovery dispatch unavailable'; end if;
  perform 1 from app_private.account_recovery_codes where account_id = dispatch.account_id for update;
  select * into claim from app_private.account_recovery_claims where id = dispatch.claim_id for update;
  -- Waits for any Auth transaction that passed the fence trigger to finish.
  select * into dispatch from app_private.account_recovery_dispatches where id = p_dispatch_id for update;
  if dispatch.state <> 'dispatching' then return dispatch.state; end if;

  select lower(email) into current_email from auth.users where id = dispatch.account_id;
  if claim.id is not null and current_email = claim.new_email then
    -- Old access ends with the email change. Refresh tokens cascade from
    -- sessions; the BFF rejects access JWTs whose session no longer exists.
    delete from auth.sessions where user_id = dispatch.account_id;
    get diagnostics revoked = row_count;
    delete from app_private.browser_sessions where account_id = dispatch.account_id;
    update app_private.account_recovery_dispatches
    set state = 'applied', resolved_at = clock_timestamp() where id = dispatch.id;

    update app_private.notification_jobs set cancelled_at = clock_timestamp()
    where source_id = claim.id and completed_at is null and cancelled_at is null;
    insert into app_private.notification_jobs (
      correlation_id, source_id, event_id, recipient_account_id,
      template_key, available_at, created_at, expires_at
    )
    select distinct p_correlation_id, claim.id, null::uuid, membership.account_id,
      'account_recovery_completed', clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '30 days'
    from public.event_memberships as owner_membership
    join public.event_memberships as membership on membership.event_id = owner_membership.event_id
    where owner_membership.account_id = dispatch.account_id and owner_membership.role = 'owner'
    union
    select p_correlation_id, claim.id, null::uuid, dispatch.account_id,
      'account_recovery_completed', clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '30 days';

    insert into app_private.audit_events(correlation_id,actor_account_id,action,target_type,target_id,safe_summary)
    values(p_correlation_id, null, 'account.recovery_completed', 'account_recovery_claim', claim.id,
      jsonb_build_object('revokedSessions', revoked));
    delete from app_private.account_recovery_claims where id = claim.id;
    return 'applied';
  end if;

  if dispatch.lease_until > clock_timestamp() then return 'dispatching'; end if;
  -- Lease expired and Auth unchanged: the fence now rejects any late request.
  update app_private.account_recovery_dispatches
  set state = 'not_applied', resolved_at = clock_timestamp() where id = dispatch.id;
  insert into app_private.audit_events(correlation_id,actor_account_id,action,target_type,target_id,safe_summary)
  values(p_correlation_id, null, 'account.recovery_dispatch_not_applied', 'account_recovery_claim',
    dispatch.claim_id, '{}'::jsonb);
  return 'not_applied';
end;
$$;

-- The only path that authorizes an Auth email update. Every gate is rechecked
-- under locks; a prepared operation ID alone grants nothing.
create function public.begin_account_recovery_dispatch_command(
  p_claim_id uuid, p_verification_token text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  claim app_private.account_recovery_claims;
  operation uuid;
  previous uuid;
  dispatch app_private.account_recovery_dispatches;
begin
  if p_correlation_id is null then raise exception 'Recovery claim unavailable'; end if;
  claim := app_private.lock_eligible_recovery_claim(p_claim_id, p_verification_token);
  select operation_id into operation from app_private.account_recovery_preparations where claim_id = claim.id;
  if operation is null or claim.expires_at <= clock_timestamp() + interval '5 minutes'
  then raise exception 'Recovery claim unavailable'; end if;

  select id into previous from app_private.account_recovery_dispatches
  where account_id = claim.account_id and state = 'dispatching';
  -- Eligibility proved Auth still holds the original email, so a previous
  -- dispatch can only resolve to not_applied here.
  if previous is not null
    and app_private.resolve_recovery_dispatch(previous, p_correlation_id) <> 'not_applied'
  then raise exception 'Recovery dispatch in progress'; end if;

  insert into app_private.account_recovery_dispatches(claim_id, account_id, operation_id, lease_until)
  values (claim.id, claim.account_id, operation, clock_timestamp() + interval '2 minutes')
  returning * into dispatch;
  insert into app_private.audit_events(correlation_id,action,target_type,target_id,safe_summary)
  values(p_correlation_id,'account.recovery_dispatch_started','account_recovery_claim',claim.id,'{}'::jsonb);
  return jsonb_build_object(
    'dispatchId', dispatch.id,
    'accountId', claim.account_id,
    'newEmail', claim.new_email,
    'leaseUntil', dispatch.lease_until
  );
end;
$$;

create function public.finish_account_recovery_dispatch_command(p_dispatch_id uuid, p_correlation_id uuid)
returns text language sql security definer set search_path = '' as $$
  select app_private.resolve_recovery_dispatch(p_dispatch_id, p_correlation_id);
$$;

-- Resolves expired leases (worker crash, lost response) and drops tombstones.
create function public.reconcile_account_recovery_dispatches_command()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  dispatch_id uuid;
  resolved integer := 0;
begin
  -- Ids are read without locks; resolution then locks in the global order.
  for dispatch_id in select id from app_private.account_recovery_dispatches
    where state = 'dispatching' and lease_until <= clock_timestamp()
  loop
    if app_private.resolve_recovery_dispatch(dispatch_id, extensions.gen_random_uuid()) <> 'dispatching'
    then resolved := resolved + 1; end if;
  end loop;
  delete from app_private.account_recovery_dispatches
  where state <> 'dispatching' and resolved_at <= clock_timestamp() - interval '24 hours';
  return resolved;
end;
$$;

-- Fence for every path that changes an Auth email, including late requests.
create function app_private.fence_recovery_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare dispatch app_private.account_recovery_dispatches;
begin
  select * into dispatch from app_private.account_recovery_dispatches
  where account_id = new.id order by started_at desc limit 1 for share;
  if dispatch.id is null or dispatch.state = 'applied'
    or (dispatch.state = 'not_applied' and dispatch.resolved_at <= clock_timestamp() - interval '24 hours')
  then return new; end if;
  if dispatch.state = 'dispatching' and dispatch.lease_until > clock_timestamp()
    and lower(new.email) = (select new_email from app_private.account_recovery_claims where id = dispatch.claim_id)
  then return new; end if;
  raise exception 'Recovery email change fenced';
end;
$$;
create trigger promenadis_fence_recovery_email_change
before update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function app_private.fence_recovery_email_change();

-- Never delete the claim (and the evidence reconciliation needs) mid-dispatch.
-- Cancellation, rotation, expiry and account deletion all fail closed instead.
create function app_private.block_claim_delete_during_dispatch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from app_private.account_recovery_dispatches
    where claim_id = old.id and state = 'dispatching')
  then raise exception 'Recovery completing'; end if;
  return old;
end;
$$;
create trigger account_recovery_claims_block_delete_during_dispatch
before delete on app_private.account_recovery_claims
for each row execute function app_private.block_claim_delete_during_dispatch();

-- Expiry resolves dispatches first and skips any still inside a live lease
-- (at most two minutes), so one stuck row cannot abort the whole purge.
create or replace function app_private.purge_expired_account_recovery_claims_command()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare claim app_private.account_recovery_claims;
begin
  perform public.reconcile_account_recovery_dispatches_command();
  for claim in select c.* from app_private.account_recovery_claims c
    where c.expires_at <= clock_timestamp()
      and not exists (select 1 from app_private.account_recovery_dispatches d
        where d.claim_id = c.id and d.state = 'dispatching')
    for update of c skip locked
  loop
    update app_private.notification_jobs set cancelled_at = clock_timestamp()
    where source_id = claim.id and completed_at is null and cancelled_at is null;
    insert into app_private.audit_events (
      correlation_id, actor_account_id, action, target_type, target_id, safe_summary
    ) values (
      extensions.gen_random_uuid(), claim.account_id, 'account.recovery_claim_expired',
      'account_recovery_claim', claim.id, '{}'::jsonb
    );
    delete from app_private.account_recovery_claims where id = claim.id;
  end loop;
end;
$$;

select cron.schedule(
  'promenadis-reconcile-account-recovery-dispatches',
  '* * * * *',
  'select public.reconcile_account_recovery_dispatches_command();'
);

revoke all on function app_private.lock_eligible_recovery_claim(uuid,text) from public,anon,authenticated;
revoke all on function app_private.resolve_recovery_dispatch(uuid,uuid) from public,anon,authenticated;
revoke all on function app_private.fence_recovery_email_change() from public,anon,authenticated;
revoke all on function app_private.block_claim_delete_during_dispatch() from public,anon,authenticated;
revoke all on function public.begin_account_recovery_dispatch_command(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.finish_account_recovery_dispatch_command(uuid,uuid) from public,anon,authenticated;
revoke all on function public.reconcile_account_recovery_dispatches_command() from public,anon,authenticated;
grant execute on function public.begin_account_recovery_dispatch_command(uuid,text,uuid) to service_role;
grant execute on function public.finish_account_recovery_dispatch_command(uuid,uuid) to service_role;
grant execute on function public.reconcile_account_recovery_dispatches_command() to service_role;
-- Auth runs as supabase_auth_admin; the security-definer trigger needs no grant.

comment on table app_private.account_recovery_dispatches is
  'Recovery Auth-dispatch fence: no email/token copies; resolved rows are 24-hour tombstones that keep rejecting late Auth requests.';
comment on function public.begin_account_recovery_dispatch_command(uuid,text,uuid) is
  'Rechecks every recovery gate under locks and opens a two-minute lease that alone permits the Auth email update.';
