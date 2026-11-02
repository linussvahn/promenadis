-- TOTP as an additional account-recovery factor. The owner who lost their
-- email proves possession of their verified authenticator instead of the saved
-- recovery code; the new-email verification, 24-hour wait, notices, fenced
-- dispatch and session revocation are unchanged.
--
-- The code is checked inside Postgres against Auth's stored factor secret with
-- pgcrypto, so the secret never leaves the database. Only a plain base32 secret
-- is accepted: an encrypted secret (as a hosted deployment may configure) fails
-- closed and needs a reviewed replacement before hosted recovery is enabled.

alter table app_private.account_recovery_claims
  add column method text not null default 'recovery_code' check (method in ('recovery_code', 'totp')),
  alter column code_version drop not null,
  add constraint account_recovery_claims_method_code check (
    (method = 'recovery_code') = (code_version is not null)
  );

create function app_private.base32_decode(p_value text)
returns bytea language plpgsql immutable set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  clean text := rtrim(upper(p_value), '=');
  buffer bigint := 0;
  bits integer := 0;
  output bytea := ''::bytea;
  position integer;
begin
  if clean !~ '^[A-Z2-7]+$' then return null; end if;
  for index in 1..char_length(clean) loop
    position := strpos(alphabet, substr(clean, index, 1)) - 1;
    buffer := (buffer << 5) | position;
    bits := bits + 5;
    if bits >= 8 then
      output := output || set_byte('\x00'::bytea, 0, ((buffer >> (bits - 8)) & 255)::integer);
      bits := bits - 8;
      buffer := buffer & ((1::bigint << bits) - 1);
    end if;
  end loop;
  return output;
end;
$$;

-- RFC 6238 (SHA-1, 30 s, 6 digits) for one time step.
create function app_private.totp_code(p_key bytea, p_step bigint)
returns text language plpgsql immutable set search_path = '' as $$
declare
  digest bytea;
  offset_value integer;
  binary_value bigint;
begin
  digest := extensions.hmac(int8send(p_step), p_key, 'sha1');
  offset_value := get_byte(digest, 19) & 15;
  binary_value := ((get_byte(digest, offset_value) & 127)::bigint << 24)
    | (get_byte(digest, offset_value + 1)::bigint << 16)
    | (get_byte(digest, offset_value + 2)::bigint << 8)
    | get_byte(digest, offset_value + 3)::bigint;
  return lpad((binary_value % 1000000)::text, 6, '0');
end;
$$;

-- Per-account brute-force fence: five wrong codes lock TOTP recovery for 24
-- hours; an accepted time step can never be reused. Holds no secret or code.
create table app_private.recovery_totp_attempts (
  account_id uuid primary key references public.profiles (account_id) on delete cascade,
  window_started_at timestamptz not null,
  failures integer not null default 0 check (failures >= 0),
  last_step bigint not null default 0
);
alter table app_private.recovery_totp_attempts enable row level security;
alter table app_private.recovery_totp_attempts force row level security;
revoke all on app_private.recovery_totp_attempts from public, anon, authenticated;

create function app_private.has_verified_totp(p_account_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.mfa_factors
    where user_id = p_account_id and factor_type = 'totp' and status = 'verified');
$$;

-- True only for a fresh, unused code within one step of now, while not locked.
-- Callers must commit the attempt row even when this returns false.
create function app_private.consume_recovery_totp(p_account_id uuid, p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  attempts app_private.recovery_totp_attempts;
  now_step bigint := floor(extract(epoch from clock_timestamp()) / 30)::bigint;
  matched_step bigint;
begin
  insert into app_private.recovery_totp_attempts (account_id, window_started_at)
  values (p_account_id, clock_timestamp()) on conflict (account_id) do nothing;
  select * into attempts from app_private.recovery_totp_attempts where account_id = p_account_id for update;
  if attempts.window_started_at <= clock_timestamp() - interval '24 hours' then
    update app_private.recovery_totp_attempts set window_started_at = clock_timestamp(), failures = 0
    where account_id = p_account_id returning * into attempts;
  end if;
  if attempts.failures >= 5 then return false; end if;
  if p_code ~ '^[0-9]{6}$' then
    select step into matched_step
    from auth.mfa_factors f
    cross join lateral (values (now_step - 1), (now_step), (now_step + 1)) as candidates(step)
    where f.user_id = p_account_id and f.factor_type = 'totp' and f.status = 'verified'
      and app_private.base32_decode(f.secret) is not null
      and step > attempts.last_step
      and app_private.totp_code(app_private.base32_decode(f.secret), step) = p_code
    order by step desc limit 1;
  end if;
  if matched_step is null then
    update app_private.recovery_totp_attempts set failures = failures + 1 where account_id = p_account_id;
    return false;
  end if;
  update app_private.recovery_totp_attempts set last_step = matched_step where account_id = p_account_id;
  return true;
end;
$$;

drop function public.initiate_account_recovery_claim_command(text,text,text,text,uuid);

-- Exactly one factor: the saved recovery code or a current authenticator code.
-- A wrong TOTP code returns an error object instead of raising, so the
-- per-account failure count commits; every other refusal raises as before.
create function public.initiate_account_recovery_claim_command(
  p_current_email text,
  p_recovery_code text,
  p_totp_code text,
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
  use_totp boolean := p_totp_code is not null;
  target_account_id uuid;
  recovery app_private.account_recovery_codes;
  existing_claim app_private.account_recovery_claims;
  claim app_private.account_recovery_claims;
  now_value timestamptz := clock_timestamp();
begin
  if normalized_current !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or normalized_new !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or normalized_current = normalized_new
    or (p_recovery_code is null) = (p_totp_code is null)
    or (not use_totp and normalized_code !~ '^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){4}$')
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

  -- Same lock order as confirmation, cancellation and rotation: code, then claim.
  select * into recovery from app_private.account_recovery_codes
  where account_id = target_account_id for update;
  if use_totp then
    if not app_private.consume_recovery_totp(target_account_id, p_totp_code) then
      return jsonb_build_object('error', 'invalid_recovery');
    end if;
  elsif recovery.account_id is null or recovery.used_at is not null
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
    account_id, method, code_version, new_email, verification_token_hash, initiated_at, ready_at, expires_at
  ) values (
    target_account_id, case when use_totp then 'totp' else 'recovery_code' end,
    case when use_totp then null else recovery.version end, normalized_new,
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
    'account_recovery_claim', claim.id,
    jsonb_build_object('method', claim.method, 'codeVersion', claim.code_version)
  );
  return app_private.account_recovery_claim_summary(claim);
end;
$$;

-- A recovery-code claim consumes the code on verification; a TOTP claim
-- instead requires the factor to still be verified.
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
  select * into recovery from app_private.account_recovery_codes
  where account_id = (select account_id from app_private.account_recovery_claims where id = p_claim_id)
  for update;
  select * into claim from app_private.account_recovery_claims
  where id = p_claim_id and expires_at > clock_timestamp() for update;
  if claim.id is null or p_verification_token is null
    or extensions.crypt(p_verification_token, claim.verification_token_hash)
      is distinct from claim.verification_token_hash
    or (claim.method = 'recovery_code' and (recovery.account_id is null
      or recovery.version is distinct from claim.code_version or recovery.invalidated_at is not null))
    or (claim.method = 'totp' and not app_private.has_verified_totp(claim.account_id))
  then raise exception 'Recovery claim unavailable'; end if;
  if claim.email_verified_at is null then
    if now_value + interval '24 hours' >= claim.expires_at then
      raise exception 'Recovery claim unavailable';
    end if;
    if claim.method = 'recovery_code' then
      update app_private.account_recovery_codes set used_at = clock_timestamp()
      where account_id = claim.account_id and version = claim.code_version
        and used_at is null and invalidated_at is null;
      if not found then raise exception 'Recovery claim unavailable'; end if;
    end if;
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

create or replace function app_private.lock_eligible_recovery_claim(p_claim_id uuid, p_verification_token text)
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
  if claim.id is null
    or claim.original_email is null or claim.email_verified_at is null
    or claim.ready_at > clock_timestamp() or claim.expires_at <= clock_timestamp()
    or (claim.method = 'recovery_code' and (recovery.account_id is null
      or recovery.version is distinct from claim.code_version
      or recovery.used_at is null or recovery.invalidated_at is not null))
    or (claim.method = 'totp' and not app_private.has_verified_totp(claim.account_id))
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

-- Removing or unverifying the factor withdraws a TOTP-based claim, just as
-- rotating the recovery code withdraws a code-based one.
create function app_private.cancel_totp_recovery_on_factor_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  account uuid := coalesce(old.user_id, new.user_id);
  claim_id uuid;
begin
  if app_private.has_verified_totp(account) then return null; end if;
  select id into claim_id from app_private.account_recovery_claims
  where account_id = account and method = 'totp' for update;
  if claim_id is not null then
    update app_private.notification_jobs set cancelled_at = clock_timestamp()
    where source_id = claim_id and completed_at is null and cancelled_at is null;
    delete from app_private.account_recovery_claims where id = claim_id;
    insert into app_private.audit_events (
      correlation_id, actor_account_id, action, target_type, target_id, safe_summary
    ) values (
      extensions.gen_random_uuid(), null, 'account.recovery_claim_cancelled',
      'account_recovery_claim', claim_id, '{"reason":"totp_removed"}'::jsonb
    );
  end if;
  return null;
end;
$$;
create trigger promenadis_cancel_totp_recovery
after delete or update of status on auth.mfa_factors
for each row execute function app_private.cancel_totp_recovery_on_factor_change();

revoke all on function app_private.base32_decode(text) from public,anon,authenticated;
revoke all on function app_private.totp_code(bytea,bigint) from public,anon,authenticated;
revoke all on function app_private.has_verified_totp(uuid) from public,anon,authenticated;
revoke all on function app_private.consume_recovery_totp(uuid,text) from public,anon,authenticated;
revoke all on function app_private.cancel_totp_recovery_on_factor_change() from public,anon,authenticated;
revoke all on function public.initiate_account_recovery_claim_command(text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.initiate_account_recovery_claim_command(text,text,text,text,text,uuid) to service_role;
