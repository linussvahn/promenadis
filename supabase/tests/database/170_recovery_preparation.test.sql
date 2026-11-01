begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
select ok(not has_function_privilege('anon','public.prepare_account_recovery_command(uuid,text,uuid)','EXECUTE'),'anonymous preparation denied');
select ok(not has_function_privilege('authenticated','public.prepare_account_recovery_command(uuid,text,uuid)','EXECUTE'),'browser preparation denied');
select ok(not has_table_privilege('authenticated','app_private.account_recovery_preparations','SELECT'),'preparation state private');
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
values ('01992026-0907-7000-8000-000000000001','prepare-owner@example.invalid',now(),now(),now());
insert into app_private.account_recovery_codes(account_id,code_hash,issued_at,used_at)
values ('01992026-0907-7000-8000-000000000001',repeat('x',60),now()-interval '3 days',now()-interval '2 days');
insert into app_private.account_recovery_claims(id,account_id,new_email,verification_token_hash,initiated_at,ready_at,expires_at,code_version)
values ('01992026-0907-7000-8000-000000000002','01992026-0907-7000-8000-000000000001','prepare-new@example.invalid',extensions.crypt(repeat('x',43),extensions.gen_salt('bf',4)),now()-interval '2 days',now()-interval '23 hours',now()+interval '4 days',1);
create function pg_temp.prepare() returns uuid language sql as $$
select public.prepare_account_recovery_command('01992026-0907-7000-8000-000000000002',repeat('x',43),extensions.gen_random_uuid());
$$;
select throws_ok('select pg_temp.prepare()','P0001','Recovery claim unavailable','unverified destination rejected');
update app_private.account_recovery_claims set email_verified_at=now()-interval '2 days'+interval '1 minute',ready_at=now()+interval '1 hour';
select throws_ok('select pg_temp.prepare()','P0001','Recovery claim unavailable','waiting period enforced');
update app_private.account_recovery_claims set ready_at=now()-interval '23 hours';
select throws_ok('select pg_temp.prepare()','P0001','Recovery claim unavailable','missing notice evidence rejected');
insert into app_private.notification_jobs(correlation_id,source_id,recipient_account_id,template_key,completed_at)
values (extensions.gen_random_uuid(),'01992026-0907-7000-8000-000000000002','01992026-0907-7000-8000-000000000001','account_recovery_started',now());
select throws_ok($$select public.prepare_account_recovery_command('01992026-0907-7000-8000-000000000002',repeat('z',43),extensions.gen_random_uuid())$$,'P0001','Recovery claim unavailable','wrong proof rejected');
create temporary table prepared as select pg_temp.prepare() as id;
select ok((select id is not null from prepared),'eligible claim prepares');
select is(pg_temp.prepare(),(select id from prepared),'retry returns same operation');
select is((select count(*) from app_private.audit_events where action='account.recovery_prepared'),1::bigint,'retry does not duplicate audit');
select is((select email from auth.users where id='01992026-0907-7000-8000-000000000001'),'prepare-owner@example.invalid','preparation never changes Auth');
update auth.users set email='changed@example.invalid' where id='01992026-0907-7000-8000-000000000001';
select throws_ok('select pg_temp.prepare()','P0001','Recovery claim unavailable','retry rechecks original identity');
update auth.users set email='prepare-owner@example.invalid' where id='01992026-0907-7000-8000-000000000001';
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
values ('01992026-0907-7000-8000-000000000003','prepare-new@example.invalid',now(),now(),now());
select throws_ok('select pg_temp.prepare()','P0001','Recovery claim unavailable','replacement collision rejected');
delete from auth.users where id='01992026-0907-7000-8000-000000000003';
update app_private.account_recovery_codes set invalidated_at=now();
select throws_ok('select pg_temp.prepare()','P0001','Recovery claim unavailable','invalidated recovery code rejected');
update app_private.account_recovery_codes set invalidated_at=null;
select public.cancel_account_recovery_claim_command('01992026-0907-7000-8000-000000000001','01992026-0907-7000-8000-000000000002',now(),extensions.gen_random_uuid());
select is((select count(*) from app_private.account_recovery_preparations),0::bigint,'cancellation erases prepared intent');
select throws_ok('select pg_temp.prepare()','P0001','Recovery claim unavailable','cancelled operation cannot be prepared again');
select ok(to_regprocedure('public.finalize_account_recovery_command(uuid,text,uuid)') is null,'Auth completion remains absent');
select * from finish();
rollback;
