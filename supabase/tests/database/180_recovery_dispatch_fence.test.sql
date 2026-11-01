begin;
create extension if not exists pgtap with schema extensions;
select plan(29);
select ok(not has_function_privilege('anon','public.begin_account_recovery_dispatch_command(uuid,text,uuid)','EXECUTE'),'anonymous dispatch denied');
select ok(not has_function_privilege('authenticated','public.begin_account_recovery_dispatch_command(uuid,text,uuid)','EXECUTE'),'browser dispatch denied');
select ok(not has_function_privilege('authenticated','public.finish_account_recovery_dispatch_command(uuid,uuid)','EXECUTE'),'browser resolution denied');
select ok(not has_function_privilege('authenticated','public.reconcile_account_recovery_dispatches_command()','EXECUTE'),'browser reconciliation denied');
select ok(not has_table_privilege('authenticated','app_private.account_recovery_dispatches','SELECT'),'dispatch state private');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
values ('01992026-1101-7000-8000-000000000001','dispatch-owner@example.invalid',now(),now(),now());
insert into app_private.account_recovery_codes(account_id,code_hash,issued_at,used_at)
values ('01992026-1101-7000-8000-000000000001',repeat('x',60),now()-interval '3 days',now()-interval '2 days');
insert into app_private.account_recovery_claims(id,account_id,new_email,verification_token_hash,initiated_at,email_verified_at,ready_at,expires_at,code_version)
values ('01992026-1101-7000-8000-000000000002','01992026-1101-7000-8000-000000000001','dispatch-new@example.invalid',
  extensions.crypt(repeat('x',43),extensions.gen_salt('bf',4)),now()-interval '2 days',now()-interval '2 days'+interval '1 minute',
  now()-interval '23 hours',now()+interval '4 days',1);
insert into app_private.notification_jobs(correlation_id,source_id,recipient_account_id,template_key,completed_at)
values (extensions.gen_random_uuid(),'01992026-1101-7000-8000-000000000002','01992026-1101-7000-8000-000000000001','account_recovery_started',now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values ('01992026-1101-7000-8000-000000000003','01992026-1101-7000-8000-000000000001',now(),now());
insert into auth.refresh_tokens(token,user_id,session_id,revoked,created_at,updated_at)
values ('dispatch-refresh','01992026-1101-7000-8000-000000000001','01992026-1101-7000-8000-000000000003',false,now(),now());
insert into app_private.browser_sessions(session_hash,kind,encrypted_payload,account_id,auth_session_id,expires_at)
values (repeat('a',64),'authenticated',repeat('p',40),'01992026-1101-7000-8000-000000000001','01992026-1101-7000-8000-000000000003',now()+interval '1 hour');

create function pg_temp.begin_dispatch() returns jsonb language sql as $$
select public.begin_account_recovery_dispatch_command('01992026-1101-7000-8000-000000000002',repeat('x',43),extensions.gen_random_uuid());
$$;
create function pg_temp.set_email(p_email text) returns void language sql as $$
update auth.users set email=p_email where id='01992026-1101-7000-8000-000000000001';
$$;
create function pg_temp.expire_lease() returns void language sql as $$
update app_private.account_recovery_dispatches set started_at=now()-interval '3 minutes',lease_until=now()-interval '1 minute'
where account_id='01992026-1101-7000-8000-000000000001' and state='dispatching';
$$;

select throws_ok('select pg_temp.begin_dispatch()','P0001','Recovery claim unavailable','unprepared claim cannot dispatch');
select public.prepare_account_recovery_command('01992026-1101-7000-8000-000000000002',repeat('x',43),extensions.gen_random_uuid());
select throws_ok($$select public.begin_account_recovery_dispatch_command('01992026-1101-7000-8000-000000000002',repeat('z',43),extensions.gen_random_uuid())$$,
  'P0001','Recovery claim unavailable','dispatch rechecks proof');
create temporary table first_dispatch as select pg_temp.begin_dispatch() as d;
select is((select d->>'newEmail' from first_dispatch),'dispatch-new@example.invalid','dispatch returns verified destination');
select throws_ok('select pg_temp.begin_dispatch()','P0001','Recovery dispatch in progress','duplicate dispatch rejected');
select throws_ok($$select public.cancel_account_recovery_claim_command('01992026-1101-7000-8000-000000000001','01992026-1101-7000-8000-000000000002',now(),extensions.gen_random_uuid())$$,
  'P0001','Recovery completing','cancellation cannot erase evidence mid-dispatch');
update app_private.account_recovery_claims set expires_at=now()-interval '1 minute' where id='01992026-1101-7000-8000-000000000002';
select app_private.purge_expired_account_recovery_claims_command();
select is((select count(*) from app_private.account_recovery_claims where id='01992026-1101-7000-8000-000000000002'),1::bigint,'expiry waits for live lease');
update app_private.account_recovery_claims set expires_at=now()+interval '4 days' where id='01992026-1101-7000-8000-000000000002';
select throws_ok($$select pg_temp.set_email('other@example.invalid')$$,'P0001','Recovery email change fenced','lease permits only the verified destination');
select is(public.finish_account_recovery_dispatch_command((select (d->>'dispatchId')::uuid from first_dispatch),extensions.gen_random_uuid()),
  'dispatching','unchanged Auth inside lease stays undecided');

select pg_temp.expire_lease();
select throws_ok($$select pg_temp.set_email('dispatch-new@example.invalid')$$,'P0001','Recovery email change fenced','late Auth update after lease expiry rejected');
select is(public.reconcile_account_recovery_dispatches_command(),1,'reconciler resolves expired lease');
select is((select state from app_private.account_recovery_dispatches where id=(select (d->>'dispatchId')::uuid from first_dispatch)),'not_applied','unchanged Auth resolves not applied');
select is((select count(*) from app_private.account_recovery_claims where id='01992026-1101-7000-8000-000000000002'),1::bigint,'not applied keeps claim for retry or cancellation');
select throws_ok($$select pg_temp.set_email('dispatch-new@example.invalid')$$,'P0001','Recovery email change fenced','tombstone keeps rejecting late requests');

create temporary table second_dispatch as select pg_temp.begin_dispatch() as d;
select lives_ok($$select pg_temp.set_email('dispatch-new@example.invalid')$$,'live lease permits Auth update');
select is(public.finish_account_recovery_dispatch_command((select (d->>'dispatchId')::uuid from second_dispatch),extensions.gen_random_uuid()),
  'applied','applied Auth change completes recovery');
select is((select count(*) from auth.sessions where user_id='01992026-1101-7000-8000-000000000001'),0::bigint,'old Auth sessions revoked');
select is((select count(*) from auth.refresh_tokens where token='dispatch-refresh'),0::bigint,'old refresh tokens revoked');
select is((select count(*) from app_private.browser_sessions where account_id='01992026-1101-7000-8000-000000000001'),0::bigint,'old browser sessions revoked');
select is((select count(*) from app_private.account_recovery_claims where id='01992026-1101-7000-8000-000000000002'),0::bigint,'claim and replacement email erased');
select is((select count(*) from app_private.notification_jobs where source_id='01992026-1101-7000-8000-000000000002' and template_key='account_recovery_completed'),
  1::bigint,'completion notice queued');
select is(public.finish_account_recovery_dispatch_command((select (d->>'dispatchId')::uuid from second_dispatch),extensions.gen_random_uuid()),
  'applied','late duplicate resolution is idempotent');
select is((select count(*) from app_private.audit_events where action='account.recovery_completed' and target_id='01992026-1101-7000-8000-000000000002'),
  1::bigint,'completion audited once');
select lives_ok($$select pg_temp.set_email('later@example.invalid')$$,'completed recovery does not fence later changes');

update app_private.account_recovery_dispatches set resolved_at=now()-interval '25 hours' where account_id='01992026-1101-7000-8000-000000000001';
select public.reconcile_account_recovery_dispatches_command();
select is((select count(*) from app_private.account_recovery_dispatches where account_id='01992026-1101-7000-8000-000000000001'),0::bigint,'tombstones purged after 24 hours');
select * from finish();
rollback;
