begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
select ok(not has_table_privilege('authenticated','app_private.recovery_previous_email_notices','SELECT'),'previous address private');
select ok(not has_table_privilege('service_role','app_private.recovery_previous_email_notices','SELECT'),'previous address not directly readable by service');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
values ('01992026-1101-7100-8000-000000000001','previous-owner@example.invalid',now(),now(),now());
update public.profiles set preferred_locale='sv' where account_id='01992026-1101-7100-8000-000000000001';
-- An owned event lists the owner as a team member too; completion must still
-- queue exactly one notice per recipient.
select public.create_organizer_profile_command('01992026-1101-7100-8000-000000000001',
  'Previous Owner','individual','','','01992026-1101-7100-8000-000000000011');
select public.create_scheduled_draft_event_command('01992026-1101-7100-8000-000000000001',
  (select id from public.organizer_profiles where display_name='Previous Owner'),
  '','Previous Email Fixture','','Europe/Stockholm','unlisted',
  '2031-09-09 10:00:00+02','2031-09-09 15:00:00+02','01992026-1101-7100-8000-000000000012');
insert into app_private.account_recovery_codes(account_id,code_hash,issued_at,used_at)
values ('01992026-1101-7100-8000-000000000001',repeat('x',60),now()-interval '3 days',now()-interval '2 days');
insert into app_private.account_recovery_claims(id,account_id,new_email,verification_token_hash,initiated_at,email_verified_at,ready_at,expires_at,code_version)
values ('01992026-1101-7100-8000-000000000002','01992026-1101-7100-8000-000000000001','previous-new@example.invalid',
  extensions.crypt(repeat('x',43),extensions.gen_salt('bf',4)),now()-interval '2 days',now()-interval '2 days'+interval '1 minute',
  now()-interval '23 hours',now()+interval '4 days',1);
insert into app_private.notification_jobs(correlation_id,source_id,recipient_account_id,template_key,completed_at)
values (extensions.gen_random_uuid(),'01992026-1101-7100-8000-000000000002','01992026-1101-7100-8000-000000000001','account_recovery_started',now());
select public.prepare_account_recovery_command('01992026-1101-7100-8000-000000000002',repeat('x',43),extensions.gen_random_uuid());
create temporary table dispatch as
select public.begin_account_recovery_dispatch_command('01992026-1101-7100-8000-000000000002',repeat('x',43),extensions.gen_random_uuid()) as d;
update auth.users set email='previous-new@example.invalid' where id='01992026-1101-7100-8000-000000000001';
select is(public.finish_account_recovery_dispatch_command((select (d->>'dispatchId')::uuid from dispatch),extensions.gen_random_uuid()),'applied','recovery applied');

select is((select count(*) from app_private.notification_jobs where source_id='01992026-1101-7100-8000-000000000002'
  and template_key='account_recovery_completed'),1::bigint,'event owner gets one completion notice');
create temporary table notice as
select id from app_private.notification_jobs
where source_id='01992026-1101-7100-8000-000000000002' and template_key='account_recovery_completed_previous_email';
select is((select count(*) from notice),1::bigint,'previous-address notice queued once');
select is((select cancelled_at from app_private.notification_jobs where id=(select id from notice)),null,'notice is not cancelled by resolution');
select ok((select expires_at <= clock_timestamp()+interval '72 hours' from app_private.recovery_previous_email_notices where job_id=(select id from notice)),'binding lives at most 72 hours');
select is((select count(*) from app_private.account_recovery_claims where id='01992026-1101-7100-8000-000000000002'),0::bigint,'claim erased');

create temporary table lease as select * from public.claim_security_notification_jobs(25) where job_id=(select id from notice);
select is(public.resolve_security_notification_recipient((select job_id from lease),(select lease_id from lease)),
  '{"email":"previous-owner@example.invalid","locale":"sv"}'::jsonb,'notice resolves to previous address, not the current one');
select ok((select public.finish_security_notification_job(job_id,lease_id,true) from lease),'delivery acknowledged');
select is((select count(*) from app_private.recovery_previous_email_notices),0::bigint,'previous address erased on delivery');

-- Expiry purge for an undelivered binding.
insert into app_private.notification_jobs(id,correlation_id,source_id,recipient_account_id,template_key,expires_at)
values ('01992026-1101-7100-8000-000000000003',extensions.gen_random_uuid(),'01992026-1101-7100-8000-000000000004',
  '01992026-1101-7100-8000-000000000001','account_recovery_completed_previous_email',now()+interval '1 hour');
insert into app_private.recovery_previous_email_notices(job_id,email,created_at,expires_at)
values ('01992026-1101-7100-8000-000000000003','previous-owner@example.invalid',now()-interval '72 hours',now()-interval '1 second');
select app_private.purge_expired_recovery_previous_emails_command();
select is((select count(*) from app_private.recovery_previous_email_notices),0::bigint,'expired binding purged');
select is((select count(*) from public.claim_security_notification_jobs(25) c
  where public.resolve_security_notification_recipient(c.job_id,c.lease_id) is not null
    and c.job_id='01992026-1101-7100-8000-000000000003'),0::bigint,'notice without binding cannot resolve a recipient');
select * from finish();
rollback;
