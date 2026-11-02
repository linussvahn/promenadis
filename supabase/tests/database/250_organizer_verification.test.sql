begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
select ok(not has_table_privilege('authenticated','app_private.organizer_verifications','SELECT'),'verification records private');
select ok(not has_function_privilege('authenticated','public.decide_organizer_verification_command(uuid,uuid,uuid,text,text,boolean,boolean,text,uuid)','EXECUTE'),'browser cannot decide verification');
select ok(app_private.valid_organization_number('556016-0680'),'valid organization number accepted');
select ok(not app_private.valid_organization_number('556016-0681'),'bad checksum rejected');
select ok(not app_private.valid_organization_number('811218-9876'),'personal identity number shape rejected');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values
  ('01992026-1102-7100-8000-000000000001','verify-manager@example.invalid',now(),now(),now()),
  ('01992026-1102-7100-8000-000000000002','verify-admin@example.invalid',now(),now(),now()),
  ('01992026-1102-7100-8000-000000000003','verify-outsider@example.invalid',now(),now(),now());
select public.create_organizer_profile_command('01992026-1102-7100-8000-000000000001',
  'Verify Association','association','Stockholm','https://example.invalid','01992026-1102-7100-8000-000000000011');
select public.create_organizer_profile_command('01992026-1102-7100-8000-000000000001',
  'Verify Group','informal_group','','','01992026-1102-7100-8000-000000000012');
create temporary table org as select id from public.organizer_profiles where display_name='Verify Association';
insert into app_private.platform_admins(account_id) values ('01992026-1102-7100-8000-000000000002');
select public.start_admin_elevation_command('01992026-1102-7100-8000-000000000002','01992026-1102-7100-8000-000000000021',gen_random_uuid());

create function pg_temp.request(p_actor uuid, p_org uuid, p_number text) returns jsonb language sql as $$
select public.request_organizer_verification_command(p_actor,p_org,p_number,'official_website','https://example.invalid',gen_random_uuid());
$$;
create function pg_temp.decide(p_decision text, p_name text, p_active boolean, p_control boolean, p_reason text) returns void language sql as $$
select public.decide_organizer_verification_command('01992026-1102-7100-8000-000000000002','01992026-1102-7100-8000-000000000021',
  (select id from org),p_decision,p_name,p_active,p_control,p_reason,gen_random_uuid());
$$;

select throws_ok($$select pg_temp.request('01992026-1102-7100-8000-000000000003',(select id from org),'556016-0680')$$,
  'P0001','Organizer profile not found','non-managers cannot request');
select throws_ok($$select pg_temp.request('01992026-1102-7100-8000-000000000001',(select id from public.organizer_profiles where display_name='Verify Group'),'556016-0680')$$,
  'P0001','Only associations and companies can be verified','informal groups get no badge');
select throws_ok($$select pg_temp.request('01992026-1102-7100-8000-000000000001',(select id from org),'811218-9876')$$,
  'P0001','Invalid organization number','personal numbers refused');
select is(pg_temp.request('01992026-1102-7100-8000-000000000001',(select id from org),'556016-0680')->>'status','pending','manager requests verification');
select throws_ok($$select pg_temp.request('01992026-1102-7100-8000-000000000001',(select id from org),'556016-0680')$$,
  'P0001','Verification already requested','no duplicate request');
select is(jsonb_array_length(public.list_organizer_verifications_command('01992026-1102-7100-8000-000000000002','01992026-1102-7100-8000-000000000021',gen_random_uuid())),
  1,'elevated admin sees the request');
select throws_ok($$select pg_temp.decide('verified','Example Förening',false,true,null)$$,'P0001','Invalid verification decision','inactive registry status cannot verify');
select throws_ok($$select pg_temp.decide('verified','Example Förening',true,false,null)$$,'P0001','Invalid verification decision','unconfirmed control cannot verify');

insert into public.organizer_profile_memberships(organizer_profile_id,account_id,role,display_name)
values ((select id from org),'01992026-1102-7100-8000-000000000002','manager','Admin Manager');
select throws_ok($$select pg_temp.decide('verified','Example Förening',true,true,null)$$,'P0001','Cannot review own organizer','conflict of interest refused');
delete from public.organizer_profile_memberships where account_id='01992026-1102-7100-8000-000000000002';

select pg_temp.decide('verified','Example Förening',true,true,null);
select is((public.get_organizer_verification_command('01992026-1102-7100-8000-000000000001',(select id from org))->>'badge'),'true','verified organizer has the badge');
select ok((select recheck_due_at <= now()+interval '1 year 1 minute' from app_private.organizer_verifications where organizer_profile_id=(select id from org)),
  'badge needs an annual recheck');
update app_private.organizer_verifications set recheck_due_at=now()-interval '1 second' where organizer_profile_id=(select id from org);
select is((public.get_organizer_verification_command('01992026-1102-7100-8000-000000000001',(select id from org))->>'badge'),'false','overdue recheck removes the badge');
update app_private.organizer_verifications set recheck_due_at=now()+interval '1 year' where organizer_profile_id=(select id from org);

update public.organizer_profiles set display_name='Renamed Association' where id=(select id from org);
select is((public.get_organizer_verification_command('01992026-1102-7100-8000-000000000001',(select id from org))->>'status'),'pending','a rename sends the badge back for review');

select pg_temp.decide('verified','Example Förening',true,true,null);
select throws_ok($$select pg_temp.decide('revoked','Example Förening',true,true,'')$$,'P0001','Invalid verification decision','revocation needs a reason');
select pg_temp.decide('revoked',null,null,null,'Registry shows the organization as dissolved');
select is((public.get_organizer_verification_command('01992026-1102-7100-8000-000000000001',(select id from org))->>'reason'),
  'Registry shows the organization as dissolved','managers see the revocation reason');
update app_private.organizer_verifications set decided_at=now()-interval '31 days' where organizer_profile_id=(select id from org);
select app_private.purge_closed_organizer_verifications_command();
select is((select count(*) from app_private.organizer_verifications where organizer_profile_id=(select id from org)),0::bigint,
  'closed outcomes purged after 30 days');
select is((select count(*) from app_private.audit_events where action='admin.organizer_verification_decided'),3::bigint,'decisions audited');
select * from finish();
rollback;
