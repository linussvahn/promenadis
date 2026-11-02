begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
select ok(not has_table_privilege('authenticated','app_private.recovery_totp_attempts','SELECT'),'attempt fence private');
select ok(not has_function_privilege('authenticated','app_private.consume_recovery_totp(uuid,text)','EXECUTE'),'browser cannot test codes');
select is(app_private.totp_code(app_private.base32_decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'),1),'287082','RFC 6238 vector at T=59');
select is(app_private.totp_code(convert_to('12345678901234567890','UTF8'),37037036),'081804','RFC 6238 vector at T=1111111109');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
values ('01992026-1102-7200-8000-000000000001','totp-owner@example.invalid',now(),now(),now());
select public.create_organizer_profile_command('01992026-1102-7200-8000-000000000001',
  'Totp Owner','individual','','','01992026-1102-7200-8000-000000000011');
select public.create_scheduled_draft_event_command('01992026-1102-7200-8000-000000000001',
  (select id from public.organizer_profiles where display_name='Totp Owner'),
  '','Totp Fixture','','Europe/Stockholm','unlisted',
  '2031-09-09 10:00:00+02','2031-09-09 15:00:00+02','01992026-1102-7200-8000-000000000012');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
values ('01992026-1102-7200-8000-000000000021','01992026-1102-7200-8000-000000000001','Synthetic','totp','verified',now(),now(),
  'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');

create function pg_temp.code(p_offset integer default 0) returns text language sql as $$
select app_private.totp_code(app_private.base32_decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'),
  floor(extract(epoch from clock_timestamp())/30)::bigint + p_offset);
$$;
create function pg_temp.initiate(p_totp text, p_recovery text default null) returns jsonb language sql as $$
select public.initiate_account_recovery_claim_command('totp-owner@example.invalid',p_recovery,p_totp,
  'totp-new@example.invalid',repeat('x',43),gen_random_uuid());
$$;

select throws_ok($$select pg_temp.initiate(null)$$,'P0001','Invalid recovery request','one factor is required');
select throws_ok($$select pg_temp.initiate('123456','ABCD-EFGH-JKLM-NPQR-STUV')$$,'P0001','Invalid recovery request','only one factor at a time');
select is(pg_temp.initiate(case when pg_temp.code()='000000' then '111111' else '000000' end)->>'error','invalid_recovery','wrong code refused without raising');
select is((select failures from app_private.recovery_totp_attempts where account_id='01992026-1102-7200-8000-000000000001'),1,'wrong code counted');
select is((select count(*) from app_private.account_recovery_claims),0::bigint,'no claim from a wrong code');

create temporary table claim as select pg_temp.initiate(pg_temp.code()) as summary;
select ok((select summary ? 'id' from claim),'current authenticator code starts recovery');
select is((select method from app_private.account_recovery_claims where account_id='01992026-1102-7200-8000-000000000001'),'totp','claim records the TOTP method');
delete from app_private.notification_jobs where source_id=(select (summary->>'id')::uuid from claim);
delete from app_private.account_recovery_claims;
select is(pg_temp.initiate(pg_temp.code())->>'error','invalid_recovery','an accepted code cannot be replayed');

select pg_temp.initiate(pg_temp.code(1));
select is((select email_verified_at is not null from app_private.account_recovery_claims) ,false,'claim starts unverified');
select lives_ok($$select public.confirm_account_recovery_email_command((select id from app_private.account_recovery_claims),repeat('x',43),gen_random_uuid())$$,
  'TOTP claim verifies the new email without any recovery code');
select ok((select ready_at >= email_verified_at + interval '24 hours' from app_private.account_recovery_claims),'the full 24-hour wait still applies');

delete from auth.mfa_factors where id='01992026-1102-7200-8000-000000000021';
select is((select count(*) from app_private.account_recovery_claims),0::bigint,'removing the factor withdraws the TOTP claim');

-- Lockout and fail-closed secrets.
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
values ('01992026-1102-7200-8000-000000000022','01992026-1102-7200-8000-000000000001','Synthetic 2','totp','verified',now(),now(),
  'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
update app_private.recovery_totp_attempts set failures=5, last_step=0 where account_id='01992026-1102-7200-8000-000000000001';
select is(pg_temp.initiate(pg_temp.code())->>'error','invalid_recovery','five failures lock even a correct code');
update app_private.recovery_totp_attempts set window_started_at=now()-interval '25 hours' where account_id='01992026-1102-7200-8000-000000000001';
select ok(pg_temp.initiate(pg_temp.code()) ? 'id','lockout ends after 24 hours');
delete from app_private.notification_jobs;
delete from app_private.account_recovery_claims;
update auth.mfa_factors set secret='{"key_id":"k","alg":"aes-gcm-hkdf","data":"opaque"}' where id='01992026-1102-7200-8000-000000000022';
update app_private.recovery_totp_attempts set last_step=0;
select is(pg_temp.initiate(pg_temp.code())->>'error','invalid_recovery','an encrypted secret fails closed');
select is((select count(*) from app_private.audit_events where action='account.recovery_claim_initiated'
  and safe_summary->>'method'='totp'),3::bigint,'TOTP initiations audited with their method');
select * from finish();
rollback;
