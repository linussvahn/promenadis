begin;
create extension if not exists pgtap with schema extensions;
select plan(31);
select ok(not has_table_privilege('authenticated','app_private.public_snapshots','SELECT'),'snapshot store private');
select ok(not has_function_privilege('anon','public.public_snapshot_command(uuid)','EXECUTE'),'snapshots served through the BFF');
select ok(not has_function_privilege('authenticated','public.set_early_location_visibility_command(uuid,uuid,integer,boolean,uuid)','EXECUTE'),
  'browser cannot change early visibility directly');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1104-7200-8000-00000000000'||n)::uuid, 'snapshot-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,5) n;
-- 1 owner, 2 moderator, 3-5 sellers
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1104-7200-8000-00000000000'||p)::uuid $$;
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Snapshot Owner','Snapshot Fixture','','Europe/Stockholm','unlisted',
  now()+interval '1 day', now()+interval '1 day 5 hours',gen_random_uuid());
create temporary table fixture as select id as event_id from public.events where title='Snapshot Fixture';
create function pg_temp.ev() returns public.events language sql as $$ select * from public.events where id=(select event_id from fixture) $$;
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select event_id from fixture),null,'Gården',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  gen_random_uuid());
update public.events set admission_mode='auto_inside' where id=(select event_id from fixture);
create function pg_temp.apply(p int) returns jsonb language sql as $$
select public.apply_to_event_command(pg_temp.uid(p),(select event_id from fixture),'Seller '||p,'Testgatan '||p,'11122','Stockholm',
  18.061+p*0.0003,59.331,'manual',null,true,gen_random_uuid());
$$;
create function pg_temp.p(p int) returns public.seller_participations language sql as $$
select * from public.seller_participations where account_id=pg_temp.uid(p) and event_id=(select event_id from fixture);
$$;
select pg_temp.apply(3); select pg_temp.apply(4); select pg_temp.apply(5);
select public.save_seller_listing_command(pg_temp.uid(3),(pg_temp.p(3)).id,0,'Books','Crime novels',
  array['0199a000-0000-7000-8000-000000000005'::uuid],'{vinyl}',true,null,null,'outdoor',null,false,
  '[{"name":"Atlas","categoryId":"0199a000-0000-7000-8000-000000000005","status":"available","priceMinor":5000,"currency":"SEK"}]','[]',gen_random_uuid());
select public.save_seller_listing_command(pg_temp.uid(4),(pg_temp.p(4)).id,0,'Toys',null,array['0199a000-0000-7000-8000-000000000006'::uuid],'{}',null,null,null,null,null,true,'[]','[]',gen_random_uuid());
create function pg_temp.manifest() returns jsonb language sql as $$
  select public.public_event_manifest_command('unlisted',(pg_temp.ev()).public_key)->'manifest' $$;
create function pg_temp.feed() returns jsonb language sql as $$
  select public.public_event_safety_feed_command('unlisted',(pg_temp.ev()).public_key)->'feed' $$;
create function pg_temp.body() returns jsonb language sql as $$
  select (public.public_snapshot_command((pg_temp.manifest()->'snapshot'->>'id')::uuid)->>'body')::jsonb $$;
create function pg_temp.seller_id(p int) returns text language sql as $$
  select app_private.public_id(pg_temp.ev(),'seller',(pg_temp.p(p)).id) $$;

select is(public.get_event_publication_readiness_command(pg_temp.uid(1),(select event_id from fixture))->'blockers' ? 'public_delivery_not_ready',
  false,'public delivery no longer blocks publication');
select ok(not exists (select 1 from app_private.public_event_publications where event_id=(select event_id from fixture)),'drafts publish nothing');
select is(public.public_event_manifest_command('unlisted',(pg_temp.ev()).public_key)->>'status','not_found','no manifest for drafts');

-- Published before the event: no locations unless the host opts in.
update public.events set state='published' where id=(select event_id from fixture);
select app_private.refresh_public_snapshots_command();
select is(jsonb_array_length(pg_temp.body()->'sellers'),0,'locations hidden before event day by default');
select throws_ok($$select public.set_early_location_visibility_command(pg_temp.uid(2),(select event_id from fixture),(pg_temp.ev()).version,true,gen_random_uuid())$$,
  'P0001','Actor cannot manage admission','only hosts choose early visibility');
select public.set_early_location_visibility_command(pg_temp.uid(1),(select event_id from fixture),(pg_temp.ev()).version,true,gen_random_uuid());
select app_private.refresh_public_snapshots_command();
select is((select array_agg(s->>'displayName' order by s->>'displayName') from jsonb_array_elements(pg_temp.body()->'sellers') s),
  array['Seller 3','Seller 5'],'early visibility shows approved sellers except those who opted out');

-- Active: everyone approved, with only allowlisted fields.
update public.events set state='active' where id=(select event_id from fixture);
select app_private.refresh_public_snapshots_command();
select is(jsonb_array_length(pg_temp.body()->'sellers'),3,'all approved sellers public during the event');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.body()) k),
  array['categories','counts','event','eventKey','expiresAt','generatedAt','revision','schemaVersion','sellers','stops'],'top-level allowlist');
select is((select array_agg(k order by k) from jsonb_object_keys((select s from jsonb_array_elements(pg_temp.body()->'sellers') s
    where s->>'displayName'='Seller 3')) k),
  array['accessibility','availability','categoryIds','description','displayName','id','items','status','stopId','tags','title'],'seller allowlist');
select ok(position('Testgatan' in (public.public_snapshot_command((pg_temp.manifest()->'snapshot'->>'id')::uuid)->>'body')) = 0
  and position('11122' in (public.public_snapshot_command((pg_temp.manifest()->'snapshot'->>'id')::uuid)->>'body')) = 0,
  'no address text in the snapshot');
select ok(position((pg_temp.p(3)).id::text in (public.public_snapshot_command((pg_temp.manifest()->'snapshot'->>'id')::uuid)->>'body')) = 0
  and position(pg_temp.uid(3)::text in (public.public_snapshot_command((pg_temp.manifest()->'snapshot'->>'id')::uuid)->>'body')) = 0,
  'no private participation or account IDs');
select is(pg_temp.seller_id(3) ~ '^[0-9a-f]{24}$',true,'public IDs are opaque');
select is(encode(extensions.digest(convert_to(public.public_snapshot_command((pg_temp.manifest()->'snapshot'->>'id')::uuid)->>'body','UTF8'),'sha256'),'hex'),
  pg_temp.manifest()->'snapshot'->>'sha256','manifest hash matches the stored bytes');
select is((pg_temp.body()->'counts'->>'sellers')::int,3,'aggregate seller count');
select is((pg_temp.body()->'counts'->'byCategory'->>'0199a000-0000-7000-8000-000000000005')::int,1,'per-category counts');
select ok(pg_temp.body()->'stops'->0->'cluster' ? 'z15','stops carry cluster hints');
select is(jsonb_array_length(pg_temp.body()->'categories'),14,'taxonomy labels for offline search');
select throws_like($$select app_private.assert_public_snapshot_safe('{"sellers":[{"ownerEmail":"x"}]}'::jsonb)$$,
  'Snapshot contains a denied field%','denylist backstop rejects sensitive keys');

-- Safety feed reacts before any rebuild.
create temporary table seq as select (pg_temp.feed()->>'sequence')::bigint as before;
select public.set_seller_live_status_command(pg_temp.uid(4),(pg_temp.p(4)).id,'away',null,null,gen_random_uuid());
select ok((pg_temp.feed()->>'sequence')::bigint > (select before from seq),'urgent changes bump the sequence in the same transaction');
select is(pg_temp.feed()->'awaySellerIds',jsonb_build_array(pg_temp.seller_id(4)),'away sellers listed');
select public.set_seller_live_status_command(pg_temp.uid(4),(pg_temp.p(4)).id,'closed_early',null,null,gen_random_uuid());
select is(pg_temp.feed()->'removedSellerIds',jsonb_build_array(pg_temp.seller_id(4)),'early close removes the seller immediately');
select public.submit_report_command((select event_id from fixture),'location',(pg_temp.p(5)).location_id,'unauthorized_address',
  'I live here and never agreed to a stall at my door.','resident',true,null,'net-s',gen_random_uuid());
select is(jsonb_array_length(pg_temp.feed()->'removedStopIds'),2,'quarantine removes the stop immediately');
select ok(position('"latitude"' in pg_temp.feed()::text) = 0 and position('"longitude"' in pg_temp.feed()::text) = 0,
  'safety feed is coordinate-free');

-- Rebuild: the predecessor stays 60 seconds, then disappears.
create temporary table old_snapshot as select (pg_temp.manifest()->'snapshot'->>'id')::uuid as id;
select app_private.refresh_public_snapshots_command();
select is(jsonb_array_length(pg_temp.body()->'sellers'),1,'rebuilt snapshot drops removed sellers');
select ok(public.public_snapshot_command((select id from old_snapshot)) is not null,'predecessor served during the handover');
update app_private.public_snapshots set superseded_at=now()-interval '61 seconds' where id=(select id from old_snapshot);
select app_private.refresh_public_snapshots_command();
select ok(not exists (select 1 from app_private.public_snapshots where id=(select id from old_snapshot)),'predecessor deleted after 60 seconds');

-- Ending writes a tombstone at once.
update public.events set state='ended' where id=(select event_id from fixture);
select is(pg_temp.manifest()->>'state','ended','tombstone manifest');
select ok(pg_temp.manifest()->'snapshot' = 'null'::jsonb
  and not exists (select 1 from app_private.public_snapshots where event_id=(select event_id from fixture)),'snapshot bytes deleted at end');
select * from finish();
rollback;
