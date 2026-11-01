-- Read-only, token-proved claim state so a reopened emailed link can show the
-- wait or finish step without repeating verification. Never consumes the code,
-- changes timestamps or writes audit; failures are indistinguishable.
create function public.read_account_recovery_claim_command(
  p_claim_id uuid, p_verification_token text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare claim app_private.account_recovery_claims;
begin
  select * into claim from app_private.account_recovery_claims
  where id = p_claim_id and expires_at > clock_timestamp();
  if claim.id is null or p_verification_token is null
    or p_verification_token !~ '^[A-Za-z0-9_-]{43}$'
    or extensions.crypt(p_verification_token, claim.verification_token_hash)
      is distinct from claim.verification_token_hash
  then raise exception 'Recovery claim unavailable'; end if;
  return app_private.account_recovery_claim_summary(claim);
end;
$$;
revoke all on function public.read_account_recovery_claim_command(uuid,text) from public,anon,authenticated;
grant execute on function public.read_account_recovery_claim_command(uuid,text) to service_role;
