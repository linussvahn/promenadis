begin;
create extension if not exists pgtap with schema extensions;
select plan(32);
select ok(not has_table_privilege('authenticated','app_private.routing_packages','SELECT'),'packages private');
select ok(not has_table_privilege('authenticated','public.routing_overrides','SELECT'),'overrides private');
select ok(not has_function_privilege('authenticated','public.complete_routing_build_command(uuid,text,jsonb)','EXECUTE'),
  'only the compiler identity completes builds');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1105-7100-8000-00000000000'||n)::uuid, 'route-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,4) n;
-- 1 owner, 2 moderator, 3-4 sellers
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1105-7100-8000-00000000000'||p)::uuid $$;
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Route Owner','Route Fixture','','Europe/Stockholm','public',
  now()+interval '2 days', now()+interval '2 days 5 hours',gen_random_uuid());
create temporary table fixture as select id as event_id from public.events where title='Route Fixture';
create function pg_temp.ev() returns public.events language sql as $$ select * from public.events where id=(select event_id from fixture) $$;
insert into public.event_memberships(event_id,account_id,role,display_name) values ((select event_id from fixture),pg_temp.uid(2),'moderator','Mod');
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select event_id from fixture),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3100],[18.0720,59.3100],[18.0720,59.3160],[18.0600,59.3160],[18.0600,59.3100]]]}'::jsonb,
  gen_random_uuid());
update public.events set admission_mode='auto_inside' where id=(select event_id from fixture);
select public.apply_to_event_command(pg_temp.uid(n),(select event_id from fixture),'Seller '||n,'Testgatan '||n,'','',
  18.062+n*0.001,59.312,'manual',null,true,gen_random_uuid()) from generate_series(3,4) n;
create function pg_temp.loc(p int) returns uuid language sql as $$
  select location_id from public.seller_participations where account_id=pg_temp.uid(p) $$;
create function pg_temp.start() returns jsonb language sql as $$
  select public.start_routing_build_command(pg_temp.uid(1),(select event_id from fixture),repeat('a',64),
    '{"name":"fixture"}'::jsonb,'promenadis-routing/1',gen_random_uuid()) $$;
create function pg_temp.diag(p_island_status text) returns jsonb language sql as $$
  select jsonb_build_object('componentCount',2,'nodeCount',10,'edgeCount',9,'mainComponentNodes',8,
    'rejectedConnectors','[]'::jsonb,'warnings','[]'::jsonb,
    'locations',jsonb_build_array(
      jsonb_build_object('id',pg_temp.loc(3),'status','connected','snapMeters',12,'component',0,'detourRatio',null),
      jsonb_build_object('id',pg_temp.loc(4),'status',p_island_status,'snapMeters',8,'component',1,'detourRatio',null))) $$;
create function pg_temp.blockers() returns jsonb language sql as $$
  select public.get_event_publication_readiness_command(pg_temp.uid(1),(select event_id from fixture))->'blockers' $$;

select ok(pg_temp.blockers() ? 'routing_not_ready','publication waits for walking routes');
select throws_ok($$select public.start_routing_build_command(pg_temp.uid(2),(select event_id from fixture),repeat('a',64),'{}'::jsonb,'x',gen_random_uuid())$$,
  'P0001','Actor cannot manage walking routes','moderators cannot build');
create temporary table started as select pg_temp.start() as r;
create temporary table b1 as select (r->>'buildId')::uuid as id from started;
select is(jsonb_array_length((select r from started)->'locations'),2,'compiler receives the active locations');
select throws_ok($$select pg_temp.start()$$,'P0001','Build already running','one build at a time');
select public.complete_routing_build_command((select id from b1),'{"schemaVersion":"1.0"}',pg_temp.diag('disconnected'));
select is((select state from public.routing_builds where id=(select id from b1)),'awaiting_host_preview','build waits for host preview');
select is((public.get_event_routing_command(pg_temp.uid(2),(select event_id from fixture))->'latest'->'locations'->0->'sellerNames'->>0),
  'Seller 4','team preview names the sellers at each location');
select throws_ok($$select public.confirm_routing_build_command(pg_temp.uid(1),(select event_id from fixture),(select id from b1),gen_random_uuid())$$,
  'P0001','Disconnected locations need a decision','unexplained disconnects block readiness');

-- Overrides.
select throws_ok($$select public.add_routing_override_command(pg_temp.uid(1),(select event_id from fixture),'connector',null,null,
  '[18.0610,59.3110]','[18.0630,59.3110]','Gate path',true,now(),gen_random_uuid())$$,'P0001','Connector longer than 100 metres','connectors are at most 100 m');
select throws_ok($$select public.add_routing_override_command(pg_temp.uid(1),(select event_id from fixture),'connector',null,null,
  '[18.0610,59.3110]','[18.0615,59.3110]','Gate path',false,now(),gen_random_uuid())$$,'P0001','Safe walking attestation required','connectors need the attestation');
select throws_ok($$select public.add_routing_override_command(pg_temp.uid(1),(select event_id from fixture),'connector',null,null,
  '[18.1000,59.3110]','[18.1005,59.3110]','Far away',true,now(),gen_random_uuid())$$,'P0001','Connector outside the event area','connectors stay in the buffered area');
select throws_ok($$select public.add_routing_override_command(pg_temp.uid(1),(select event_id from fixture),'entrance',null,pg_temp.loc(3),
  '[18.0700,59.3120]',null,'Gate',false,now(),gen_random_uuid())$$,'P0001','Entrance must be within 25 metres of the pin','entrance corrections are same-address');
select throws_ok($$select public.add_routing_override_command(pg_temp.uid(1),(select event_id from fixture),'block_edge','12-13',null,null,null,'',false,now(),gen_random_uuid())$$,
  'P0001','Reason required','every override has a reason');
select throws_ok($$select public.add_routing_override_command(pg_temp.uid(1),(select event_id from fixture),'manual_access',null,pg_temp.loc(4),
  null,null,'Courtyard',false,now()-interval '1 hour',gen_random_uuid())$$,'P0001','Recent authentication required','graph changes need a recent sign-in');
select public.add_routing_override_command(pg_temp.uid(1),(select event_id from fixture),'manual_access',null,pg_temp.loc(4),
  null,null,'Courtyard reached through the gate',false,now(),gen_random_uuid());
select ok(exists (select 1 from app_private.audit_events where action='routing.override_added' and event_id=(select event_id from fixture)),
  'overrides are audited');
select throws_ok($$select public.confirm_routing_build_command(pg_temp.uid(1),(select event_id from fixture),(select id from b1),gen_random_uuid())$$,
  'P0001','Build is out of date','a changed override set needs a new build');
create temporary table b2 as select (pg_temp.start()->>'buildId')::uuid as id;
select public.complete_routing_build_command((select id from b2),'{"schemaVersion":"1.0","v":2}',pg_temp.diag('manual_access'));
select is((select state from public.routing_builds where id=(select id from b1)),'superseded','only the newest preview is kept');
select ok((select package_id is null from public.routing_builds where id=(select id from b1)),'the old preview package is deleted');
select is((public.confirm_routing_build_command(pg_temp.uid(1),(select event_id from fixture),(select id from b2),gen_random_uuid())->>'ready')::boolean,
  true,'manual access is an accepted decision');
select ok(not pg_temp.blockers() ? 'routing_not_ready','a confirmed build opens the routing gate');
select is(pg_temp.start()->>'reused','true','identical inputs reuse the confirmed build');

-- Public delivery.
update public.events set state='published' where id=(select event_id from fixture);
select is(public.public_event_manifest_command('public',(pg_temp.ev()).public_key)->'manifest'->'routing'->>'id',
  (select package_id::text from public.routing_builds where id=(select id from b2)),'manifest names the routing package');
select is(public.public_routing_package_command((select package_id from public.routing_builds where id=(select id from b2)))->>'body',
  '{"schemaVersion":"1.0","v":2}','the confirmed package is public');
select ok(public.public_routing_package_command((select package_id from public.routing_builds where id=(select id from b1))) is null,
  'previews are never public');
update public.events set state='active' where id=(select event_id from fixture);
select throws_ok($$select public.add_routing_override_command(pg_temp.uid(1),(select event_id from fixture),'connector',null,null,
  '[18.0610,59.3110]','[18.0615,59.3110]','Gate path',true,now(),gen_random_uuid())$$,'P0001','Only safety blocks during the event',
  'new connectors need preview and wait until after the event');
select public.add_routing_override_command(pg_temp.uid(1),(select event_id from fixture),'block_edge','41-42',null,null,null,
  'Scaffolding over the pavement',false,null,gen_random_uuid());
select is(public.public_event_safety_feed_command('public',(pg_temp.ev()).public_key)->'feed'->'blockedEdgeIds','["41-42"]'::jsonb,
  'an unsafe edge during the event reaches clients through the feed');
select is(public.public_event_safety_feed_command('public',(pg_temp.ev()).public_key)->'feed'->>'requiredGraphVersion',
  (select package_id::text from public.routing_builds where id=(select id from b2)),'feed names the required graph');

-- Retention after the event.
update public.events set state='ended' where id=(select event_id from fixture);
select ok(public.public_routing_package_command((select package_id from public.routing_builds where id=(select id from b2))) is null,
  'packages stop being served at the end');
update public.events set state_changed_at=now()-interval '25 hours' where id=(select event_id from fixture);
select app_private.enforce_routing_retention_command();
select ok(not exists (select 1 from app_private.routing_packages where event_id=(select event_id from fixture))
  and not exists (select 1 from public.routing_overrides where event_id=(select event_id from fixture)),
  'packages and overrides deleted within 24 hours after the end');
select ok((select source_metadata is not null from public.routing_builds where id=(select id from b2)),
  'non-personal build metadata remains');
select * from finish();
rollback;
