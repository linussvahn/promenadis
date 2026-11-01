begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid='app_private.browser_sessions'::regclass), 'session vault forces RLS');
select ok(not has_table_privilege('authenticated','app_private.browser_sessions','SELECT'), 'no browser vault reads');
select ok(not has_function_privilege('anon','public.take_browser_session_command(text,text,uuid)','EXECUTE'), 'no anonymous token lookup');
select ok(not has_function_privilege('authenticated','public.store_browser_session_command(text,text,text,uuid,uuid)','EXECUTE'), 'no browser session creation');
select ok(has_function_privilege('service_role','public.take_browser_session_command(text,text,uuid)','EXECUTE'), 'backend can lease credentials');
select public.store_browser_session_command(repeat('a',64),'pending',repeat('x',40),null,null);
select ok((select expires_at <= created_at + interval '15 minutes 1 second'
  from app_private.browser_sessions where session_hash=repeat('a',64)), 'pending lifetime bounded');
select is(public.take_browser_session_command(repeat('a',64),'pending','01992026-0907-7000-8000-000000000001')->>'state',
  'ok', 'first request takes lease');
select is(public.take_browser_session_command(repeat('a',64),'pending','01992026-0907-7000-8000-000000000002')->>'state',
  'busy', 'concurrent request cannot consume same credentials');
select is(public.release_browser_session_command(repeat('a',64),'01992026-0907-7000-8000-000000000002',null),
  false, 'other lease cannot overwrite credentials');
select is(public.release_browser_session_command(repeat('a',64),'01992026-0907-7000-8000-000000000001',null),
  true, 'lease owner releases');
update app_private.browser_sessions set attempts=5 where session_hash=repeat('a',64);
select is(public.take_browser_session_command(repeat('a',64),'pending','01992026-0907-7000-8000-000000000001')->>'state',
  'missing', 'five attempts exhaust pending login');
select is((select count(*) from app_private.browser_sessions where session_hash=repeat('a',64)),0::bigint,'exhausted secret erased');
insert into auth.users(id,email,created_at,updated_at)
  values ('01992026-0907-7000-8000-000000000001','vault@example.invalid',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
  values ('01992026-0907-7000-8000-000000000003','01992026-0907-7000-8000-000000000001',now(),now());
select public.store_browser_session_command(repeat('b',64),'authenticated',repeat('y',40),
  '01992026-0907-7000-8000-000000000001','01992026-0907-7000-8000-000000000003');
select ok((select expires_at <= created_at + interval '12 hours 1 second'
  from app_private.browser_sessions where session_hash=repeat('b',64)), 'authenticated lifetime bounded');
delete from auth.sessions where id='01992026-0907-7000-8000-000000000003';
select is(public.take_browser_session_command(repeat('b',64),'authenticated','01992026-0907-7000-8000-000000000001')->>'state',
  'missing', 'revoked Auth session cannot authenticate with unexpired JWT');
select public.store_browser_session_command(repeat('c',64),'pending',repeat('z',40),null,null);
update app_private.browser_sessions set created_at=clock_timestamp()-interval '16 minutes',
  expires_at=clock_timestamp()-interval '1 minute' where session_hash=repeat('c',64);
select app_private.purge_expired_browser_sessions();
select is((select count(*) from app_private.browser_sessions where session_hash=repeat('c',64)),0::bigint,'expiry worker erases encrypted material');
select public.store_browser_session_command(repeat('d',64),'pending',repeat('z',40),null,null);
select public.delete_browser_session_command(repeat('d',64));
select is(public.take_browser_session_command(repeat('d',64),'pending','01992026-0907-7000-8000-000000000001')->>'state',
  'missing','deleted handle cannot be replayed');
select is((select count(*) from cron.job where jobname='promenadis-browser-session-expiry'
  and schedule='* * * * *'),1::bigint,'expiry sweep scheduled each minute');
select * from finish();
rollback;
