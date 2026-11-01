begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
select ok(not has_function_privilege('anon','public.read_account_recovery_claim_command(uuid,text)','EXECUTE'),'anonymous status read denied');
select ok(not has_function_privilege('authenticated','public.read_account_recovery_claim_command(uuid,text)','EXECUTE'),'browser status read denied');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
values ('01992026-1101-7200-8000-000000000001','status-owner@example.invalid',now(),now(),now());
insert into app_private.account_recovery_codes(account_id,code_hash,issued_at)
values ('01992026-1101-7200-8000-000000000001',repeat('x',60),now()-interval '1 day');
insert into app_private.account_recovery_claims(id,account_id,new_email,verification_token_hash,initiated_at,ready_at,expires_at,code_version)
values ('01992026-1101-7200-8000-000000000002','01992026-1101-7200-8000-000000000001','status-new@example.invalid',
  extensions.crypt(repeat('x',43),extensions.gen_salt('bf',4)),now(),now()+interval '24 hours',now()+interval '7 days',1);

select is((public.read_account_recovery_claim_command('01992026-1101-7200-8000-000000000002',repeat('x',43))->>'emailVerified'),
  'false','unverified claim reported');
select is((select used_at from app_private.account_recovery_codes where account_id='01992026-1101-7200-8000-000000000001'),
  null,'reading never consumes the code');
select is((select email_verified_at from app_private.account_recovery_claims where id='01992026-1101-7200-8000-000000000002'),
  null,'reading never verifies');
select is((select count(*) from app_private.audit_events where target_id='01992026-1101-7200-8000-000000000002'),
  0::bigint,'reading writes no audit');
select throws_ok($$select public.read_account_recovery_claim_command('01992026-1101-7200-8000-000000000002',repeat('z',43))$$,
  'P0001','Recovery claim unavailable','wrong proof rejected');
update app_private.account_recovery_claims set expires_at=now()-interval '1 second', ready_at=now()-interval '1 day',
  initiated_at=now()-interval '2 days' where id='01992026-1101-7200-8000-000000000002';
select throws_ok($$select public.read_account_recovery_claim_command('01992026-1101-7200-8000-000000000002',repeat('x',43))$$,
  'P0001','Recovery claim unavailable','expired claim unavailable');
select * from finish();
rollback;
