begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
select ok(not has_function_privilege('authenticated','app_private.replay_erasure_tombstones()','EXECUTE'),'replay is not callable by browsers');
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
values ('01992026-1106-7500-8000-000000000001','replay@example.invalid',now(),now(),now());
insert into app_private.erasure_tombstones(subject_type,subject_id) values ('account','01992026-1106-7500-8000-000000000001');
select is((app_private.replay_erasure_tombstones()->>'accountsRemoved')::int,1,'a tombstoned account restored from an older archive is removed');
select ok(not exists (select 1 from auth.users where id='01992026-1106-7500-8000-000000000001'),'and stays gone');
select ok(app_private.backup_manifest_counts() ?& array['accounts','events','participations','tombstones','tombstoneWatermark','migration'],
  'manifest counts cover the drill comparison');
select * from finish();
rollback;
