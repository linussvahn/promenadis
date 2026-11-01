begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select ok(
  exists (select 1 from pg_extension where extname = 'postgis'),
  'PostGIS is installed'
);
select ok(
  exists (select 1 from pg_namespace where nspname = 'app_private'),
  'private application schema exists'
);
select ok(
  not has_schema_privilege('anon', 'app_private', 'USAGE'),
  'anonymous clients cannot use the private schema'
);
select ok(
  not has_schema_privilege('authenticated', 'app_private', 'USAGE'),
  'authenticated clients cannot use the private schema'
);
select ok(
  not has_table_privilege('anon', 'app_private.feature_flags', 'SELECT'),
  'anonymous clients cannot read capability configuration'
);
select ok(
  not has_table_privilege('authenticated', 'app_private.feature_flags', 'SELECT'),
  'authenticated clients cannot read capability configuration'
);
select ok(
  has_table_privilege('service_role', 'app_private.feature_flags', 'SELECT'),
  'the server service role can read capability configuration'
);

select * from finish();
rollback;
