begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
select ok(not has_function_privilege('anon','public.resolve_security_notification_recipient(uuid,uuid)','EXECUTE'),'anonymous recipient lookup denied');
select ok(not has_function_privilege('authenticated','public.resolve_security_notification_recipient(uuid,uuid)','EXECUTE'),'browser recipient lookup denied');
select ok(not has_function_privilege('authenticated','public.account_recovery_notices_accepted(uuid)','EXECUTE'),'browser evidence lookup denied');
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values
('01992026-0907-7000-8000-000000000001','old@example.invalid',now(),now(),now()),
('01992026-0907-7000-8000-000000000002','team@example.invalid',now(),now(),now());
insert into app_private.account_recovery_claims(id,account_id,new_email,verification_token_hash,ready_at,expires_at,code_version)
values ('01992026-0907-7000-8000-000000000003','01992026-0907-7000-8000-000000000001','replacement@example.invalid',repeat('x',60),now()+interval '25 hours',now()+interval '7 days',1);
select is((select original_email from app_private.account_recovery_claims),'old@example.invalid','claim captures original email');
select is(public.account_recovery_notices_accepted('01992026-0907-7000-8000-000000000003'),false,'zero recipients fails closed');
insert into app_private.notification_jobs(id,correlation_id,source_id,recipient_account_id,template_key,delivery_lease_id,delivery_lease_until) values
('01992026-0907-7000-8000-000000000004',extensions.gen_random_uuid(),'01992026-0907-7000-8000-000000000003','01992026-0907-7000-8000-000000000001','account_recovery_started','01992026-0907-7000-8000-000000000006',now()+interval '2 minutes'),
('01992026-0907-7000-8000-000000000005',extensions.gen_random_uuid(),'01992026-0907-7000-8000-000000000003','01992026-0907-7000-8000-000000000002','account_recovery_started','01992026-0907-7000-8000-000000000007',now()+interval '2 minutes');
select is((select required_notice_count from app_private.account_recovery_claims),2,'required set counted');
update auth.users set email='changed@example.invalid' where id='01992026-0907-7000-8000-000000000001';
select is(public.resolve_security_notification_recipient('01992026-0907-7000-8000-000000000004','01992026-0907-7000-8000-000000000006')->>'email','old@example.invalid','owner notification remains bound after email change');
select is(public.resolve_security_notification_recipient('01992026-0907-7000-8000-000000000005','01992026-0907-7000-8000-000000000007')->>'email','team@example.invalid','team recipient resolved separately');
select is(public.resolve_security_notification_recipient('01992026-0907-7000-8000-000000000004',extensions.gen_random_uuid()),null::jsonb,'wrong lease cannot resolve recipient');
select public.finish_security_notification_job('01992026-0907-7000-8000-000000000004','01992026-0907-7000-8000-000000000006',true);
select is(public.account_recovery_notices_accepted('01992026-0907-7000-8000-000000000003'),false,'owner-only delivery insufficient');
select public.finish_security_notification_job('01992026-0907-7000-8000-000000000005','01992026-0907-7000-8000-000000000007',true);
select is(public.account_recovery_notices_accepted('01992026-0907-7000-8000-000000000003'),true,'all required mail accepted');
delete from app_private.notification_jobs where id='01992026-0907-7000-8000-000000000005';
select is(public.account_recovery_notices_accepted('01992026-0907-7000-8000-000000000003'),false,'deleted job cannot weaken requirement');
update app_private.account_recovery_claims set original_email=null;
update app_private.notification_jobs set completed_at=null,
  delivery_lease_id='01992026-0907-7000-8000-000000000006',
  delivery_lease_until=now()+interval '2 minutes';
select is(public.resolve_security_notification_recipient('01992026-0907-7000-8000-000000000004','01992026-0907-7000-8000-000000000006'),null::jsonb,'legacy unbound claim fails closed');
select is(public.account_recovery_notices_accepted('01992026-0907-7000-8000-000000000003'),false,'legacy claim has no accepted prerequisite');
delete from app_private.account_recovery_claims;
select is(public.account_recovery_notices_accepted('01992026-0907-7000-8000-000000000003'),false,'removed claim cannot pass');
select is((select count(*) from app_private.account_recovery_claims),0::bigint,'original email erased with claim');
select * from finish();
rollback;
