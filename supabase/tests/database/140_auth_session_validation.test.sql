begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
select ok(not has_function_privilege('anon','public.is_active_auth_session(uuid,uuid)','EXECUTE'),'anonymous session lookup denied');
select ok(not has_function_privilege('authenticated','public.is_active_auth_session(uuid,uuid)','EXECUTE'),'browser session lookup denied');
select ok(has_function_privilege('service_role','public.is_active_auth_session(uuid,uuid)','EXECUTE'),'BFF may validate session');
insert into auth.users(id,email,created_at,updated_at)
  values ('01992026-0907-7000-8000-000000000001','session-owner@example.invalid',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
  values ('01992026-0907-7000-8000-000000000003','01992026-0907-7000-8000-000000000001',now(),now());
select is(public.is_active_auth_session('01992026-0907-7000-8000-000000000001','01992026-0907-7000-8000-000000000003'),true,'live matching session accepted');
select is(public.is_active_auth_session('01992026-0907-7000-8000-000000000002','01992026-0907-7000-8000-000000000003'),false,'other account binding rejected');
update auth.sessions set not_after=now()-interval '1 second' where id='01992026-0907-7000-8000-000000000003';
select is(public.is_active_auth_session('01992026-0907-7000-8000-000000000001','01992026-0907-7000-8000-000000000003'),false,'explicitly expired Auth session rejected');
delete from auth.sessions where id='01992026-0907-7000-8000-000000000003';
select is(public.is_active_auth_session('01992026-0907-7000-8000-000000000001','01992026-0907-7000-8000-000000000003'),false,'revoked session rejected even with valid JWT');
select * from finish();
rollback;
