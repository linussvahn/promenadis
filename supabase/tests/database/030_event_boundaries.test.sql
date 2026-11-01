begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.event_boundaries'::regclass),
  'event boundaries has row-level security enabled'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.event_boundaries'::regclass),
  'event boundaries forces row-level security'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_boundaries', 'SELECT'),
  'authenticated clients cannot read event boundaries directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_boundaries', 'INSERT'),
  'authenticated clients cannot write event boundaries directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.upsert_draft_event_boundary_command(uuid,uuid,integer,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the BFF boundary command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.upsert_draft_event_boundary_command(uuid,uuid,integer,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'the BFF service role may execute the boundary command'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('01992026-0907-7000-8000-000000000005', 'boundary-owner@example.invalid', now(), now()),
  ('01992026-0907-7000-8000-000000000006', 'boundary-other@example.invalid', now(), now());

select lives_ok(
  $$
    select public.create_organizer_profile_command(
      '01992026-0907-7000-8000-000000000005',
      'Boundary Test Organizer',
      'individual',
      '',
      '',
      '01992026-0907-7000-8000-000000000301'
    )
  $$,
  'the boundary owner can create its organizer fixture'
);
select lives_ok(
  $$
    select public.create_draft_event_command(
      '01992026-0907-7000-8000-000000000005',
      (select id from public.organizer_profiles where display_name = 'Boundary Test Organizer'),
      'Boundary Test Event',
      '',
      'Europe/Stockholm',
      'unlisted',
      '01992026-0907-7000-8000-000000000302'
    )
  $$,
  'the boundary owner can create its event fixture'
);
select lives_ok(
  $$
    select public.upsert_draft_event_boundary_command(
      '01992026-0907-7000-8000-000000000005',
      (select id from public.events where title = 'Boundary Test Event'),
      null,
      'Synthetic test area',
      '{"type":"Polygon","coordinates":[[[18,59],[18.01,59],[18.01,59.01],[18,59]]]}'::jsonb,
      '01992026-0907-7000-8000-000000000303'
    )
  $$,
  'an owner can save a valid draft boundary'
);
select is(
  (select version from public.event_boundaries),
  1,
  'the first boundary version is one'
);
select ok(
  (select area_square_meters between 100000 and 1000000 from public.event_boundaries),
  'PostGIS computes a plausible geodesic boundary area'
);
select ok(
  (select span_meters between 1000 and 2000 from public.event_boundaries),
  'PostGIS computes a plausible maximum vertex span'
);
select is(
  (select display_label from public.event_boundaries),
  'Synthetic test area',
  'the optional display label is normalized and stored'
);
select ok(
  (select extensions.st_isvalid(boundary) from public.event_boundaries),
  'the canonical stored boundary is a valid PostGIS polygon'
);
select ok(
  not exists (
    select 1
    from app_private.audit_events
    where action = 'event.boundary_saved'
      and (safe_summary ? 'ring' or safe_summary ? 'coordinates')
  ),
  'boundary audit summaries do not copy coordinates'
);
select is(
  public.get_identity_dashboard_command('01992026-0907-7000-8000-000000000005')
    #>> '{events,0,boundary,version}',
  '1',
  'the allowlisted dashboard includes the saved boundary version'
);
select lives_ok(
  $$
    select public.upsert_draft_event_boundary_command(
      '01992026-0907-7000-8000-000000000005',
      (select id from public.events where title = 'Boundary Test Event'),
      1,
      'Updated test area',
      '{"type":"Polygon","coordinates":[[[18,59],[18.012,59],[18.012,59.01],[18,59]]]}'::jsonb,
      '01992026-0907-7000-8000-000000000304'
    )
  $$,
  'the current expected version can be updated'
);
select is(
  (select version from public.event_boundaries),
  2,
  'a successful update increments the boundary version'
);
select throws_ok(
  $$
    select public.upsert_draft_event_boundary_command(
      '01992026-0907-7000-8000-000000000005',
      (select id from public.events where title = 'Boundary Test Event'),
      1,
      '',
      '{"type":"Polygon","coordinates":[[[18,59],[18.01,59],[18.01,59.01],[18,59]]]}'::jsonb,
      '01992026-0907-7000-8000-000000000305'
    )
  $$,
  'P0001',
  'Event boundary version conflict',
  'a stale editor cannot overwrite a newer boundary'
);
select throws_ok(
  $$
    select public.upsert_draft_event_boundary_command(
      '01992026-0907-7000-8000-000000000006',
      (select id from public.events where title = 'Boundary Test Event'),
      2,
      '',
      '{"type":"Polygon","coordinates":[[[18,59],[18.01,59],[18.01,59.01],[18,59]]]}'::jsonb,
      '01992026-0907-7000-8000-000000000306'
    )
  $$,
  'P0001',
  'Actor cannot manage event boundary',
  'an unrelated account cannot edit the boundary'
);
select throws_ok(
  $$
    select public.upsert_draft_event_boundary_command(
      '01992026-0907-7000-8000-000000000005',
      (select id from public.events where title = 'Boundary Test Event'),
      2,
      '',
      '{"type":"Polygon","coordinates":[[[18,59],[18.01,59.01],[18,59.01],[18.01,59],[18,59]]]}'::jsonb,
      '01992026-0907-7000-8000-000000000307'
    )
  $$,
  'P0001',
  'Invalid event boundary',
  'a self-intersecting polygon is rejected'
);
select throws_ok(
  $$
    select public.upsert_draft_event_boundary_command(
      '01992026-0907-7000-8000-000000000005',
      (select id from public.events where title = 'Boundary Test Event'),
      2,
      '',
      '{"type":"Polygon","coordinates":[[[18,59],[18.07,59],[18.07,59.07],[18,59.07],[18,59]]]}'::jsonb,
      '01992026-0907-7000-8000-000000000308'
    )
  $$,
  'P0001',
  'Event boundary exceeds maximum area',
  'a polygon over 25 square kilometres is rejected'
);
select throws_ok(
  $$
    select public.upsert_draft_event_boundary_command(
      '01992026-0907-7000-8000-000000000005',
      (select id from public.events where title = 'Boundary Test Event'),
      2,
      '',
      '{"type":"Polygon","coordinates":[[[18,59],[18.2,59],[18.2,59.005],[18,59.005],[18,59]]]}'::jsonb,
      '01992026-0907-7000-8000-000000000309'
    )
  $$,
  'P0001',
  'Event boundary exceeds maximum span',
  'a narrow polygon spanning over 10 kilometres is rejected'
);

update public.events set state = 'published' where title = 'Boundary Test Event';

select throws_ok(
  $$
    select public.upsert_draft_event_boundary_command(
      '01992026-0907-7000-8000-000000000005',
      (select id from public.events where title = 'Boundary Test Event'),
      2,
      '',
      '{"type":"Polygon","coordinates":[[[18,59],[18.01,59],[18.01,59.01],[18,59]]]}'::jsonb,
      '01992026-0907-7000-8000-000000000310'
    )
  $$,
  'P0001',
  'Only draft event boundaries can be edited directly',
  'published boundaries require the later revision workflow'
);
select is(
  (select count(*) from public.event_boundaries),
  1::bigint,
  'failed commands leave the last valid boundary intact'
);

select * from finish();
rollback;
