-- Whole-schema authorization audit: any new table or function that skips the
-- service-only pattern fails here, naming the offender.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is(array(select n.nspname||'.'||c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','app_private') and c.relkind in ('r','p') and not c.relrowsecurity order by 1),
  '{}'::text[],'every table has row-level security enabled');

select is(array(select table_schema||'.'||table_name||':'||grantee||':'||privilege_type
  from information_schema.role_table_grants
  where table_schema in ('public','app_private') and grantee in ('anon','authenticated','PUBLIC') order by 1),
  '{}'::text[],'browser roles hold no table, view or sequence-backed grants');

select is(array(select n.nspname||'.'||c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','app_private') and c.relkind='S'
    and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('authenticated', c.oid, 'USAGE')) order by 1),
  '{}'::text[],'browser roles cannot use sequences');

select is(array(select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','app_private') and p.prokind='f' and p.prorettype <> 'trigger'::regtype
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  order by 1),
  '{}'::text[],'browser roles cannot execute any command or helper; the BFF is the only caller');

select is(array(select n.nspname||'.'||p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','app_private') and p.prokind in ('f','p')
    and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%') order by 1),
  '{}'::text[],'every function pins its search_path');

select is(array(select n.nspname||'.'||p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','app_private') and p.prosecdef
    and not ('search_path=""' = any (coalesce(p.proconfig,'{}'))) order by 1),
  '{}'::text[],'security-definer functions resolve nothing through a caller-controlled path');
select * from finish();
rollback;
