begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
select ok(not has_function_privilege('authenticated','public.record_account_mfa_event_command(uuid,text,uuid)','EXECUTE'),'browser cannot write MFA audit');
select ok(not has_function_privilege('authenticated','public.assert_recent_authentication_command(timestamptz)','EXECUTE'),'browser cannot call the freshness gate');
select throws_ok($$select public.assert_recent_authentication_command(now()-interval '16 minutes')$$,'P0001','Recent authentication required','stale sign-in rejected');
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
values ('01992026-1101-7500-8000-000000000001','mfa-audit@example.invalid',now(),now(),now());
select throws_ok($$select public.record_account_mfa_event_command('01992026-1101-7500-8000-000000000001','account.anything',gen_random_uuid())$$,
  'P0001','Unsupported MFA audit action','only MFA actions can be recorded');
select public.record_account_mfa_event_command('01992026-1101-7500-8000-000000000001','account.mfa_totp_removed',gen_random_uuid());
select is((select safe_summary from app_private.audit_events where action='account.mfa_totp_removed'
  and target_id='01992026-1101-7500-8000-000000000001'),'{}'::jsonb,'MFA audit stores no factor details');
select * from finish();
rollback;
