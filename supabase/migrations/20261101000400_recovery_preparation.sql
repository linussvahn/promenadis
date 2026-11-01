-- Preparation is deliberately not permission to mutate Auth. No dispatcher or
-- completion endpoint exists yet. Deleting/rotating/expiring the claim removes
-- this intent immediately, and no email or credential is copied into it.
create table app_private.account_recovery_preparations (
  claim_id uuid primary key references app_private.account_recovery_claims(id) on delete cascade,
  operation_id uuid not null unique default extensions.gen_random_uuid(),
  prepared_at timestamptz not null default clock_timestamp()
);
alter table app_private.account_recovery_preparations enable row level security;
alter table app_private.account_recovery_preparations force row level security;
revoke all on app_private.account_recovery_preparations from public,anon,authenticated;

create function public.prepare_account_recovery_command(
  p_claim_id uuid, p_verification_token text, p_correlation_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  recovery app_private.account_recovery_codes;
  claim app_private.account_recovery_claims;
  operation uuid;
  current_email text;
begin
  if p_verification_token is null or p_verification_token !~ '^[A-Za-z0-9_-]{43}$'
    or p_correlation_id is null then raise exception 'Recovery claim unavailable'; end if;

  -- Same lock order as confirmation, cancellation and code rotation.
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
  where id=claim.account_id and email_confirmed_at is not null for share;
  if current_email is distinct from claim.original_email
    or exists (select 1 from auth.users where lower(email)=claim.new_email)
  then raise exception 'Recovery claim unavailable'; end if;

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
revoke all on function public.prepare_account_recovery_command(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_account_recovery_command(uuid,text,uuid) to service_role;
comment on function public.prepare_account_recovery_command(uuid,text,uuid) is
  'Internal idempotent preparation only. Not an Auth mutation capability; dispatch and completion remain absent.';
