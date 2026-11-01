create table app_private.account_recovery_claims (
  id uuid primary key default extensions.gen_random_uuid(),
  account_id uuid not null unique references public.profiles (account_id) on delete cascade,
  new_email text not null,
  verification_token_hash text not null,
  initiated_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz not null,
  expires_at timestamptz not null,
  email_verified_at timestamptz,
  code_version integer not null check (code_version > 0),
  constraint account_recovery_claims_email check (
    new_email = lower(btrim(new_email)) and char_length(new_email) between 3 and 320
  ),
  constraint account_recovery_claims_token_hash check (
    char_length(verification_token_hash) between 50 and 100
  ),
  constraint account_recovery_claims_delay check (
    ready_at >= initiated_at + interval '24 hours'
  ),
  constraint account_recovery_claims_expiry check (
    expires_at > ready_at and expires_at <= initiated_at + interval '7 days 1 minute'
  ),
  constraint account_recovery_claims_timestamp_order check (
    (email_verified_at is null or email_verified_at >= initiated_at)
    and (email_verified_at is null or ready_at >= email_verified_at + interval '24 hours')
  )
);

create index account_recovery_claims_expiry
on app_private.account_recovery_claims (expires_at);

alter table app_private.account_recovery_claims enable row level security;
alter table app_private.account_recovery_claims force row level security;
revoke all on table app_private.account_recovery_claims from public, anon, authenticated;

alter table app_private.notification_jobs alter column event_id drop not null;
alter table app_private.notification_jobs alter column recipient_account_id drop not null;
alter table app_private.notification_jobs
  add column recipient_recovery_claim_id uuid
  references app_private.account_recovery_claims (id) on delete cascade;
alter table app_private.notification_jobs
  drop constraint notification_jobs_template_key_check;
alter table app_private.notification_jobs
  add constraint notification_jobs_template_key_check check (
    template_key in (
      'event_emergency_claim_started',
      'event_emergency_claim_ready',
      'event_emergency_claim_cancelled',
      'event_emergency_claim_completed',
      'event_emergency_claim_expired',
      'account_recovery_verify_new_email',
      'account_recovery_started',
      'account_recovery_cancelled',
      'account_recovery_completed',
      'account_recovery_expired'
    )
  );
alter table app_private.notification_jobs
  add constraint notification_jobs_recipient check (
    (recipient_account_id is not null)::integer
      + (recipient_recovery_claim_id is not null)::integer = 1
  );
create unique index notification_jobs_recovery_recipient
on app_private.notification_jobs (source_id, recipient_recovery_claim_id, template_key)
where recipient_recovery_claim_id is not null;

create or replace function app_private.account_recovery_claim_summary(
  p_claim app_private.account_recovery_claims
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_claim.id,
    'initiatedAt', p_claim.initiated_at,
    'readyAt', p_claim.ready_at,
    'expiresAt', p_claim.expires_at,
    'emailVerified', p_claim.email_verified_at is not null
  );
$$;

create or replace function app_private.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_email, '@', 1) = '' then '***'
    else left(split_part(p_email, '@', 1), 1) || '***@' || split_part(p_email, '@', 2)
  end;
$$;

create or replace function app_private.account_recovery_status(p_account_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'active', recovery.account_id is not null
      and recovery.used_at is null
      and recovery.invalidated_at is null,
    'issuedAt', recovery.issued_at,
    'rotatedAt', recovery.rotated_at,
    'version', coalesce(recovery.version, 0),
    'pendingClaim', case when claim.id is null then null else jsonb_build_object(
      'id', claim.id,
      'newEmailMasked', app_private.mask_email(claim.new_email),
      'initiatedAt', claim.initiated_at,
      'readyAt', claim.ready_at,
      'expiresAt', claim.expires_at,
      'emailVerified', claim.email_verified_at is not null
    ) end
  )
  from (select p_account_id as account_id) as requested
  left join app_private.account_recovery_codes as recovery
    on recovery.account_id = requested.account_id
  left join app_private.account_recovery_claims as claim
    on claim.account_id = requested.account_id and claim.expires_at > clock_timestamp();
$$;

create or replace function public.initiate_account_recovery_claim_command(
  p_current_email text,
  p_recovery_code text,
  p_new_email text,
  p_verification_token text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_current text := lower(btrim(coalesce(p_current_email, '')));
  normalized_new text := lower(btrim(coalesce(p_new_email, '')));
  normalized_code text := upper(btrim(coalesce(p_recovery_code, '')));
  target_account_id uuid;
  recovery app_private.account_recovery_codes;
  existing_claim app_private.account_recovery_claims;
  claim app_private.account_recovery_claims;
  now_value timestamptz := clock_timestamp();
begin
  if normalized_current !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or normalized_new !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or normalized_current = normalized_new
    or normalized_code !~ '^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){4}$'
    or p_verification_token is null or p_verification_token !~ '^[A-Za-z0-9_-]{43}$'
  then raise exception 'Invalid recovery request'; end if;

  select account.id into target_account_id
  from auth.users as account
  where lower(account.email) = normalized_current
    and account.email_confirmed_at is not null;
  if target_account_id is null
    or exists (select 1 from auth.users where lower(email) = normalized_new)
    or not exists (
      select 1 from public.event_memberships as membership
      join public.events as event on event.id = membership.event_id
      where membership.account_id = target_account_id
        and membership.role = 'owner'
        and event.state not in ('ended', 'cancelled', 'archived')
    )
  then raise exception 'Invalid recovery request'; end if;

  select * into recovery from app_private.account_recovery_codes
  where account_id = target_account_id for update;
  if recovery.account_id is null or recovery.used_at is not null
    or recovery.invalidated_at is not null
    or extensions.crypt(normalized_code, recovery.code_hash) <> recovery.code_hash
  then raise exception 'Invalid recovery request'; end if;

  select * into existing_claim from app_private.account_recovery_claims
  where account_id = target_account_id for update;
  if existing_claim.id is not null and existing_claim.expires_at > now_value
    and existing_claim.email_verified_at is not null
  then raise exception 'Recovery claim already pending'; end if;
  if existing_claim.id is not null then
    delete from app_private.notification_jobs where source_id = existing_claim.id;
    delete from app_private.account_recovery_claims where id = existing_claim.id;
  end if;

  insert into app_private.account_recovery_claims (
    account_id, code_version, new_email, verification_token_hash, initiated_at, ready_at, expires_at
  ) values (
    target_account_id, recovery.version, normalized_new,
    extensions.crypt(p_verification_token, extensions.gen_salt('bf', 10)),
    now_value, now_value + interval '24 hours', now_value + interval '7 days'
  ) returning * into claim;

  insert into app_private.notification_jobs (
    correlation_id, source_id, event_id, recipient_recovery_claim_id,
    template_key, available_at, created_at, expires_at
  ) values (
    p_correlation_id, claim.id, null, claim.id,
    'account_recovery_verify_new_email', now_value, now_value, now_value + interval '7 days'
  );
  insert into app_private.notification_jobs (
    correlation_id, source_id, event_id, recipient_account_id,
    template_key, available_at, created_at, expires_at
  )
  select distinct p_correlation_id, claim.id, null::uuid, membership.account_id,
    'account_recovery_started', now_value, now_value, now_value + interval '30 days'
  from public.event_memberships as owner_membership
  join public.event_memberships as membership on membership.event_id = owner_membership.event_id
  where owner_membership.account_id = target_account_id and owner_membership.role = 'owner'
  union
  select p_correlation_id, claim.id, null::uuid, target_account_id,
    'account_recovery_started', now_value, now_value, now_value + interval '30 days';

  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, safe_summary
  ) values (
    p_correlation_id, null, 'account.recovery_claim_initiated',
    'account_recovery_claim', claim.id, jsonb_build_object('codeVersion', recovery.version)
  );
  return app_private.account_recovery_claim_summary(claim);
end;
$$;

create or replace function public.confirm_account_recovery_email_command(
  p_claim_id uuid, p_verification_token text, p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim app_private.account_recovery_claims;
  recovery app_private.account_recovery_codes;
  now_value timestamptz := clock_timestamp();
begin
  -- Consistent lock order with initiation and code rotation.
  select * into recovery from app_private.account_recovery_codes
  where account_id = (select account_id from app_private.account_recovery_claims where id = p_claim_id)
  for update;
  select * into claim from app_private.account_recovery_claims
  where id = p_claim_id and expires_at > clock_timestamp() for update;
  if claim.id is null or recovery.account_id is null
    or recovery.version is distinct from claim.code_version or recovery.invalidated_at is not null
    or p_verification_token is null
    or extensions.crypt(p_verification_token, claim.verification_token_hash)
      is distinct from claim.verification_token_hash
  then raise exception 'Recovery claim unavailable'; end if;
  if claim.email_verified_at is null then
    if now_value + interval '24 hours' >= claim.expires_at then
      raise exception 'Recovery claim unavailable';
    end if;
    update app_private.account_recovery_codes set used_at = clock_timestamp()
    where account_id = claim.account_id and version = claim.code_version
      and used_at is null and invalidated_at is null;
    if not found then raise exception 'Recovery claim unavailable'; end if;
    update app_private.account_recovery_claims set email_verified_at = now_value,
      ready_at = now_value + interval '24 hours'
    where id = claim.id returning * into claim;
    insert into app_private.audit_events (
      correlation_id, actor_account_id, action, target_type, target_id, safe_summary
    ) values (
      p_correlation_id, null, 'account.recovery_email_verified',
      'account_recovery_claim', claim.id, '{}'::jsonb
    );
  end if;
  return app_private.account_recovery_claim_summary(claim);
end;
$$;

create or replace function public.cancel_account_recovery_claim_command(
  p_actor_id uuid, p_claim_id uuid, p_authenticated_at timestamptz, p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare claim app_private.account_recovery_claims;
begin
  perform app_private.require_recent_authentication(p_authenticated_at);
  perform 1 from app_private.account_recovery_codes where account_id = p_actor_id for update;
  select * into claim from app_private.account_recovery_claims
  where id = p_claim_id and account_id = p_actor_id and expires_at > clock_timestamp()
  for update;
  if claim.id is null then raise exception 'Recovery claim unavailable'; end if;
  update app_private.notification_jobs set cancelled_at = clock_timestamp()
  where source_id = claim.id and completed_at is null and cancelled_at is null;
  insert into app_private.audit_events (
    correlation_id, actor_account_id, action, target_type, target_id, safe_summary
  ) values (
    p_correlation_id, p_actor_id, 'account.recovery_claim_cancelled',
    'account_recovery_claim', claim.id, '{}'::jsonb
  );
  delete from app_private.account_recovery_claims where id = claim.id;
  return app_private.account_recovery_status(p_actor_id);
end;
$$;

create or replace function app_private.purge_expired_account_recovery_claims_command()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare claim app_private.account_recovery_claims;
begin
  for claim in select * from app_private.account_recovery_claims
    where expires_at <= clock_timestamp() for update skip locked
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

create or replace function public.complete_recovery_verification_delivery_command(
  p_claim_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update app_private.notification_jobs
  set completed_at = clock_timestamp()
  where recipient_recovery_claim_id = p_claim_id
    and template_key = 'account_recovery_verify_new_email'
    and cancelled_at is null
    and completed_at is null;
$$;

select cron.schedule(
  'promenadis-purge-expired-account-recovery-claims',
  '47 * * * *',
  'select app_private.purge_expired_account_recovery_claims_command();'
);

revoke all on function public.initiate_account_recovery_claim_command(text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.confirm_account_recovery_email_command(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.cancel_account_recovery_claim_command(uuid,uuid,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.complete_recovery_verification_delivery_command(uuid) from public, anon, authenticated;
revoke all on function app_private.purge_expired_account_recovery_claims_command() from public, anon, authenticated;
grant execute on function public.initiate_account_recovery_claim_command(text,text,text,text,uuid) to service_role;
grant execute on function public.confirm_account_recovery_email_command(uuid,text,uuid) to service_role;
grant execute on function public.cancel_account_recovery_claim_command(uuid,uuid,timestamptz,uuid) to service_role;
grant execute on function public.complete_recovery_verification_delivery_command(uuid) to service_role;

comment on table app_private.account_recovery_claims is
  'Short-lived verified-new-email account recovery state; token and recovery code are stored only as hashes.';

-- A rotated code also cancels pending requests, including verified ones. Consumption
-- does not rotate the version and must never reactivate the old code on cancellation.
create or replace function app_private.cancel_recovery_on_code_rotation()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare claim_id uuid;
begin
  if new.version is distinct from old.version then
    select id into claim_id from app_private.account_recovery_claims
    where account_id = new.account_id for update;
    if claim_id is not null then
      update app_private.notification_jobs set cancelled_at = clock_timestamp()
      where source_id = claim_id and completed_at is null and cancelled_at is null;
      delete from app_private.account_recovery_claims where id = claim_id;
      insert into app_private.audit_events (
        correlation_id, actor_account_id, action, target_type, target_id, safe_summary
      ) values (
        extensions.gen_random_uuid(), new.account_id, 'account.recovery_claim_cancelled',
        'account_recovery_claim', claim_id, '{"reason":"code_rotated"}'::jsonb
      );
    end if;
  end if;
  return new;
end;
$$;
create trigger account_recovery_codes_cancel_claim_on_rotation
after update of version on app_private.account_recovery_codes
for each row execute function app_private.cancel_recovery_on_code_rotation();

revoke all on function app_private.cancel_recovery_on_code_rotation() from public, anon, authenticated;
revoke all on function app_private.account_recovery_claim_summary(app_private.account_recovery_claims) from public, anon, authenticated;
revoke all on function app_private.mask_email(text) from public, anon, authenticated;

-- A tiny global local-preview budget: no IP addresses/emails, no unbounded key
-- growth. A production rollout requires distributed per-subject abuse controls.
create table app_private.local_recovery_budget (
  singleton boolean primary key default true check (singleton),
  window_started_at timestamptz not null,
  attempts integer not null
);
alter table app_private.local_recovery_budget enable row level security;
alter table app_private.local_recovery_budget force row level security;
revoke all on table app_private.local_recovery_budget from public, anon, authenticated;

create or replace function public.consume_local_recovery_budget_command()
returns boolean language plpgsql security definer set search_path = ''
as $$
declare count_value integer;
begin
  insert into app_private.local_recovery_budget (singleton, window_started_at, attempts)
  values (true, clock_timestamp(), 1)
  on conflict (singleton) do update
  set attempts = case when local_recovery_budget.window_started_at <= clock_timestamp() - interval '10 minutes'
      then 1 else least(local_recovery_budget.attempts + 1, 61) end,
    window_started_at = case when local_recovery_budget.window_started_at <= clock_timestamp() - interval '10 minutes'
      then clock_timestamp() else local_recovery_budget.window_started_at end
  returning attempts into count_value;
  return count_value <= 60;
end;
$$;
revoke all on function public.consume_local_recovery_budget_command() from public, anon, authenticated;
grant execute on function public.consume_local_recovery_budget_command() to service_role;
