begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
select ok(not has_function_privilege('anon','public.resolve_public_report_subject_command(text,text,text)','EXECUTE'),
  'public report resolution goes through the BFF');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1104-7300-8000-00000000000'||n)::uuid, 'map-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,3) n;
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1104-7300-8000-00000000000'||p)::uuid $$;
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Map Owner','Map Fixture','','Europe/Stockholm','public',
  now()+interval '1 day', now()+interval '1 day 5 hours',gen_random_uuid());
create temporary table fixture as select id as event_id from public.events where title='Map Fixture';
create function pg_temp.ev() returns public.events language sql as $$ select * from public.events where id=(select event_id from fixture) $$;
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select event_id from fixture),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  gen_random_uuid());
update public.events set admission_mode='auto_inside' where id=(select event_id from fixture);
select public.apply_to_event_command(pg_temp.uid(n),(select event_id from fixture),'Seller '||n,'Testgatan '||n,'','',
  18.061+n*0.0003,59.331,'manual',null,true,gen_random_uuid()) from generate_series(2,3) n;
create function pg_temp.p(p int) returns public.seller_participations language sql as $$
select * from public.seller_participations where account_id=pg_temp.uid(p) $$;
create function pg_temp.seller_key(p int) returns text language sql as $$
  select app_private.public_id(pg_temp.ev(),'seller',(pg_temp.p(p)).id) $$;
create function pg_temp.feed() returns jsonb language sql as $$
  select public.public_event_safety_feed_command('public',(pg_temp.ev()).public_key)->'feed' $$;
update public.events set state='published' where id=(select event_id from fixture);
update public.events set state='active' where id=(select event_id from fixture);
select app_private.refresh_public_snapshots_command();

-- Removals stay listed after a rebuild, for pages holding an older snapshot.
select public.set_seller_live_status_command(pg_temp.uid(3),(pg_temp.p(3)).id,'closed_early',null,null,gen_random_uuid());
select app_private.refresh_public_snapshots_command();
select is(pg_temp.feed()->'removedSellerIds',jsonb_build_array(pg_temp.seller_key(3)),
  'a removal survives the rebuild that already excludes the seller');
select public.set_seller_live_status_command(pg_temp.uid(1),(pg_temp.p(3)).id,'open',null,'Reopened by the host',gen_random_uuid());
select is(pg_temp.feed()->'removedSellerIds','[]'::jsonb,'a reopened seller is no longer removed');

-- Public-ID report resolution.
select is(public.resolve_public_report_subject_command((pg_temp.ev()).public_key,'participation',pg_temp.seller_key(2))->>'subjectId',
  (pg_temp.p(2)).id::text,'a public seller ID resolves to its participation');
select is(public.resolve_public_report_subject_command((pg_temp.ev()).public_key,'location',
  app_private.public_id(pg_temp.ev(),'stop',(pg_temp.p(2)).location_id))->>'subjectId',
  (pg_temp.p(2)).location_id::text,'a public stop ID resolves to its location');
select ok(public.resolve_public_report_subject_command((pg_temp.ev()).public_key,'participation','0'||repeat('a',23)) is null,
  'unknown public IDs resolve to nothing');
select ok(public.resolve_public_report_subject_command(repeat('b',32),'participation',pg_temp.seller_key(2)) is null,
  'a public ID never resolves under another event key');
select ok(public.resolve_public_report_subject_command((pg_temp.ev()).public_key,'item',pg_temp.seller_key(2)) is null,
  'only stops and sellers are reportable by public ID');
update public.events set state='ended' where id=(select event_id from fixture);
select ok(public.resolve_public_report_subject_command((pg_temp.ev()).public_key,'participation',pg_temp.seller_key(2)) is null,
  'nothing resolves once the event is over');
select * from finish();
rollback;
