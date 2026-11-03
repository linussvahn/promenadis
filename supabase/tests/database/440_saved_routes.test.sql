-- Signed-in route sync: own-only storage by private ID, optimistic versions,
-- tombstones, survival across link replacement and the 24-hour purge.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1108-7100-8000-00000000000'||n)::uuid, 'route-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,5) n;
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1108-7100-8000-00000000000'||p)::uuid $$;
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Route Owner','Route Fixture','','Europe/Stockholm','unlisted',
  now()+interval '1 day', now()+interval '1 day 5 hours',gen_random_uuid());
create temporary table fixture as select id as event_id from public.events where title='Route Fixture';
create function pg_temp.ev() returns public.events language sql as $$ select * from public.events where id=(select event_id from fixture) $$;
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select event_id from fixture),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  gen_random_uuid());
update public.events set admission_mode='auto_inside' where id=(select event_id from fixture);
select public.apply_to_event_command(pg_temp.uid(n),(select event_id from fixture),'Seller '||n,'Testgatan '||n,'','',
  18.061+n*0.0003,59.331,'manual',null,true,gen_random_uuid()) from generate_series(2,3) n;
update public.events set state='published' where id=(select event_id from fixture);
update public.events set state='active' where id=(select event_id from fixture);
create function pg_temp.seller(p int) returns text language sql as $$
  select app_private.public_id(pg_temp.ev(),'seller',id) from public.seller_participations where account_id=pg_temp.uid(p) $$;
create function pg_temp.stop(p int) returns text language sql as $$
  select app_private.public_id(pg_temp.ev(),'stop',location_id) from public.seller_participations where account_id=pg_temp.uid(p) $$;
create function pg_temp.body() returns jsonb language sql as $$
  select jsonb_build_object('selected',jsonb_build_array(pg_temp.seller(2),pg_temp.seller(3),'ffffffffffffffffffffffff'),
    'mustSee',jsonb_build_array(pg_temp.seller(2)),'visitedSellers',jsonb_build_array(pg_temp.seller(2)),
    'visitedStops',jsonb_build_array(pg_temp.stop(2)),'skipped',jsonb_build_array(pg_temp.stop(3)),
    'preferences',jsonb_build_object('mode','shortest','pace','quick','returnToStart',true)) $$;
create function pg_temp.save(p int, v int) returns jsonb language sql as $$
  select public.save_saved_route_command(pg_temp.uid(p),'unlisted',(pg_temp.ev()).public_key,v,pg_temp.body()) $$;

select is(public.get_saved_route_command(pg_temp.uid(4),'unlisted',(pg_temp.ev()).public_key)->'route','null'::jsonb,
  'nothing is stored until a signed-in visitor saves');
select is(pg_temp.save(4,0)->'route'->>'version','1','the first save creates version 1');
select is(jsonb_array_length(public.get_saved_route_command(pg_temp.uid(4),'unlisted',(pg_temp.ev()).public_key)->'route'->'selected'),2,
  'unknown seller IDs are dropped');
select is(public.get_saved_route_command(pg_temp.uid(4),'unlisted',(pg_temp.ev()).public_key)->'route'->'visitedStops',
  jsonb_build_array(pg_temp.stop(2)),'progress comes back as public stop IDs');
select is(public.get_saved_route_command(pg_temp.uid(5),'unlisted',(pg_temp.ev()).public_key)->'route','null'::jsonb,
  'another account never sees the route');
select is(public.get_saved_route_command(pg_temp.uid(4),'public',(pg_temp.ev()).public_key)->>'status','not_found',
  'the key must match the event visibility');
select is(pg_temp.save(4,0)->>'status','conflict','a stale version does not overwrite');
select is(pg_temp.save(4,0)->'route'->>'version','1','and returns the current route to merge');
select is(pg_temp.save(4,1)->'route'->>'version','2','the current version saves');
select ok(not exists (select 1 from information_schema.columns where table_schema='app_private' and table_name='saved_routes'
  and column_name ~ '(latitude|longitude|lng|position|accuracy|start_point|start_kind)'),'no position or start point column exists');

-- A replaced link keeps the synced route under the new key.
update public.events set public_key=encode(extensions.gen_random_bytes(16),'hex') where id=(select event_id from fixture);
select is(jsonb_array_length(public.get_saved_route_command(pg_temp.uid(4),'unlisted',(pg_temp.ev()).public_key)->'route'->'selected'),2,
  'the route survives a replaced link');

-- Early deletion leaves only a tombstone.
select is(public.delete_saved_route_command(pg_temp.uid(4),'unlisted',(pg_temp.ev()).public_key)->'route'->>'deleted','true',
  'early deletion returns a tombstone');
select ok((select cardinality(selected_participation_ids)+cardinality(visited_location_ids) from app_private.saved_routes
  where account_id=pg_temp.uid(4))=0,'the tombstone holds no stops or progress');

-- Ended events refuse saves and are purged 23 hours later.
select pg_temp.save(4,3);
update public.events set state='ended' where id=(select event_id from fixture);
update public.events set state_changed_at=now()-interval '22 hours' where id=(select event_id from fixture);
select is(pg_temp.save(4,4)->>'status','closed','an ended event accepts no saves');
select app_private.purge_saved_routes_command();
select is((select count(*) from app_private.saved_routes),1::bigint,'routes stay for a while after the end');
update public.events set state_changed_at=now()-interval '23 hours 1 minute' where id=(select event_id from fixture);
select app_private.purge_saved_routes_command();
select is((select count(*) from app_private.saved_routes),0::bigint,'and are erased within 24 hours');
select * from finish();
rollback;
