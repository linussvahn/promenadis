begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
select ok(not has_function_privilege('authenticated','public.request_account_deletion_command(uuid,timestamptz,text,uuid)','EXECUTE'),'browser deletion request denied');
select ok(not has_function_privilege('authenticated','public.cancel_account_deletion_command(uuid,uuid)','EXECUTE'),'browser deletion cancel denied');
select ok(not has_table_privilege('authenticated','app_private.account_deletion_requests','SELECT'),'deletion requests private');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values
  ('01992026-1101-7300-8000-000000000001','delete-owner@example.invalid',now(),now(),now()),
  ('01992026-1101-7300-8000-000000000002','delete-manager@example.invalid',now(),now(),now());
select public.create_organizer_profile_command('01992026-1101-7300-8000-000000000001',
  'Delete Owner','individual','','','01992026-1101-7300-8000-000000000011');
select public.create_scheduled_draft_event_command('01992026-1101-7300-8000-000000000001',
  (select id from public.organizer_profiles where display_name='Delete Owner'),
  '','Deletion Fixture','','Europe/Stockholm','unlisted',
  '2031-09-09 10:00:00+02','2031-09-09 15:00:00+02','01992026-1101-7300-8000-000000000012');
insert into auth.sessions(id,user_id,created_at,updated_at)
values ('01992026-1101-7300-8000-000000000021','01992026-1101-7300-8000-000000000001',now(),now());

create function pg_temp.request(p_at timestamptz, p_email text) returns jsonb language sql as $$
select public.request_account_deletion_command('01992026-1101-7300-8000-000000000001',p_at,p_email,extensions.gen_random_uuid());
$$;

select is((public.get_account_deletion_command('01992026-1101-7300-8000-000000000001')->'blockers'->0->>'kind'),'owned_event','live owned event is a blocker');
select throws_ok($$select pg_temp.request(now()-interval '1 hour','delete-owner@example.invalid')$$,'P0001','Recent authentication required','stale session cannot delete');
select throws_ok($$select pg_temp.request(now(),'someone@example.invalid')$$,'P0001','Deletion confirmation mismatch','confirmation must match account email');
select throws_ok($$select pg_temp.request(now(),'delete-owner@example.invalid')$$,'P0001','Account deletion blocked','owned live event blocks deletion');

-- Shared organizer with another manager also blocks.
insert into public.organizer_profiles(id,organizer_type,display_name,created_by_account_id)
values ('01992026-1101-7300-8000-000000000031','association','Shared Association','01992026-1101-7300-8000-000000000001');
insert into public.organizer_profile_memberships(organizer_profile_id,account_id,role,display_name) values
  ('01992026-1101-7300-8000-000000000031','01992026-1101-7300-8000-000000000001','owner','Owner'),
  ('01992026-1101-7300-8000-000000000031','01992026-1101-7300-8000-000000000002','manager','Manager');
select ok((public.get_account_deletion_command('01992026-1101-7300-8000-000000000001')->'blockers') @> '[{"kind":"shared_organizer"}]','shared organizer is a blocker');
delete from public.organizer_profile_memberships where account_id='01992026-1101-7300-8000-000000000002';

-- The event ends: it becomes a history shell and no longer blocks.
update public.events set state='published' where title='Deletion Fixture';
update public.events set state='active' where title='Deletion Fixture';
update public.events set state='ended' where title='Deletion Fixture';
select is(jsonb_array_length(public.get_account_deletion_command('01992026-1101-7300-8000-000000000001')->'blockers'),0,'finished history no longer blocks');
select is((pg_temp.request(now(),' Delete-Owner@example.invalid ')->>'pending'),'true','confirmed deletion request accepted');
select is((select count(*) from auth.sessions where user_id='01992026-1101-7300-8000-000000000001'),0::bigint,'every session revoked');
select ok(public.account_deletion_pending('01992026-1101-7300-8000-000000000001'),'account disabled while pending');
select throws_ok($$select pg_temp.request(now(),'delete-owner@example.invalid')$$,'P0001','Account deletion already requested','duplicate request rejected');

select is((public.cancel_account_deletion_command('01992026-1101-7300-8000-000000000001',extensions.gen_random_uuid())->>'pending'),'false','owner can cancel within the window');
select throws_ok($$select public.cancel_account_deletion_command('01992026-1101-7300-8000-000000000001',extensions.gen_random_uuid())$$,'P0001','Account deletion not pending','cancel needs a pending request');

select pg_temp.request(now(),'delete-owner@example.invalid');
select is(app_private.erase_due_accounts_command(),0,'nothing is erased before seven days');
update app_private.account_deletion_requests set requested_at=now()-interval '8 days', erase_after=now()-interval '1 day'
where account_id='01992026-1101-7300-8000-000000000001';
select is(app_private.erase_due_accounts_command(),1,'due account erased');
select is((select count(*) from auth.users where id='01992026-1101-7300-8000-000000000001'),0::bigint,'Auth identity erased');
select is((select count(*) from public.events where title='Deletion Fixture' and created_by_account_id is null),1::bigint,'history shell kept without account link');
select ok((select detached_at is not null from public.organizer_profiles where display_name='Delete Owner'),'referenced organizer hidden and detached');
select is((select count(*) from public.organizer_profiles where display_name='Shared Association'),0::bigint,'unreferenced sole-owned organizer deleted');
select is((select count(*) from app_private.erasure_tombstones where subject_id='01992026-1101-7300-8000-000000000001'),1::bigint,'erasure tombstone recorded');
select * from finish();
rollback;
