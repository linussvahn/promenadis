begin;
create extension if not exists pgtap with schema extensions;
select plan(28);
select ok(not has_table_privilege('authenticated','app_private.geocode_cache','SELECT'),'geocode cache private');
select ok(not has_function_privilege('authenticated','public.reserve_geocode_request_command(uuid,uuid)','EXECUTE'),'browser cannot spend geocoding budget');
select ok(not has_function_privilege('authenticated','public.correct_location_pin_command(uuid,uuid,double precision,double precision,text,timestamptz,uuid)','EXECUTE'),'browser cannot move pins');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1103-7100-8000-00000000000'||n)::uuid, 'shared-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,6) n;
-- 1 owner, 2 moderator, 3-6 sellers
select public.create_scheduled_draft_event_command('01992026-1103-7100-8000-000000000001',null,
  'Shared Owner','Shared Fixture','','Europe/Stockholm','unlisted',
  '2031-09-09 10:00:00+02','2031-09-09 15:00:00+02','01992026-1103-7100-8000-000000000011');
create temporary table fixture as select id as event_id from public.events where title='Shared Fixture';
insert into public.event_memberships(event_id,account_id,role,display_name)
values ((select event_id from fixture),'01992026-1103-7100-8000-000000000002','moderator','Moderator');
select public.upsert_draft_event_boundary_command('01992026-1103-7100-8000-000000000001',
  (select event_id from fixture),null,'Synthetic shared area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  '01992026-1103-7100-8000-000000000012');
update public.events set admission_mode='auto_inside' where id=(select event_id from fixture);

create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1103-7100-8000-00000000000'||p)::uuid $$;
create function pg_temp.apply(p_seller int, p_address text, p_shares boolean, p_lng double precision default 18.062) returns jsonb language sql as $$
select public.apply_to_event_command(pg_temp.uid(p_seller),(select event_id from fixture),'Seller '||p_seller,
  p_address,'113 45','Stockholm',p_lng,59.331,'manual',p_shares,true,gen_random_uuid());
$$;
create function pg_temp.p(p_seller int) returns public.seller_participations language sql as $$
select * from public.seller_participations where account_id=pg_temp.uid(p_seller);
$$;
create function pg_temp.review(p_actor int, p_action text, p_location uuid, p_target uuid, p_participation uuid) returns jsonb language sql as $$
select public.review_event_location_command(pg_temp.uid(p_actor),(select event_id from fixture),p_action,p_location,p_target,p_participation,gen_random_uuid());
$$;

-- Geocoding budget and cache.
select public.reserve_geocode_request_command(pg_temp.uid(3),(select event_id from fixture)) from generate_series(1,10);
select throws_ok($$select public.reserve_geocode_request_command(pg_temp.uid(3),(select event_id from fixture))$$,
  'P0001','Geocoding limit reached','ten lookups a minute per account');
select lives_ok($$select public.reserve_geocode_request_command(pg_temp.uid(4),(select event_id from fixture))$$,'another account still has budget');
select public.store_geocode_cache_command(repeat('a',64),'fixture',18.061,59.331);
select is(public.read_geocode_cache_command(repeat('a',64))->>'latitude','59.331','cached lookup returned');
update app_private.geocode_cache set expires_at=now()-interval '1 second';
select is(public.read_geocode_cache_command(repeat('a',64)),null,'expired cache ignored');

-- Shared stops.
select is(pg_temp.apply(3,'Testgatan 1',null)->>'state','approved','first seller at an address');
select throws_ok($$select pg_temp.apply(4,' testgatan  1 ',null)$$,'P0001','Shared entrance question',
  'a second seller at the same normalized address must answer the shared-entrance question');
select is((pg_temp.apply(4,'Testgatan 1',true)->'location'->>'sellerCount')::int,2,'shared entrance joins the stop');
select is((pg_temp.p(4)).location_id,(pg_temp.p(3)).location_id,'one stop for both sellers');
select ok((pg_temp.apply(5,'Testgatan 1',false,18.0621)->'location'->>'needsReview')::boolean,'separate entrance is flagged for the host');
select is((public.list_event_sellers_command(pg_temp.uid(1),(select event_id from fixture))->>'locationCount')::int,2,
  'three seller places, two map locations');
select is((public.list_event_sellers_command(pg_temp.uid(1),(select event_id from fixture))->>'placesUsed')::int,3,
  'each seller takes a place even at a shared stop');

select throws_ok($$select pg_temp.review(2,'confirm_separate',(pg_temp.p(5)).location_id,null,null)$$,
  'P0001','Actor cannot review locations','moderators cannot merge or split');
select pg_temp.review(1,'confirm_separate',(pg_temp.p(5)).location_id,null,null);
select ok(not (select needs_review from public.event_locations where id=(pg_temp.p(5)).location_id),'host confirms a separate stop');
create temporary table merged_from as select (pg_temp.p(5)).location_id as id;
select pg_temp.review(1,'merge',(pg_temp.p(5)).location_id,(pg_temp.p(3)).location_id,null);
select is((pg_temp.p(5)).location_id,(pg_temp.p(3)).location_id,'merge moves the sellers to one stop');
select is((select count(*) from public.event_locations where id=(select id from merged_from)),0::bigint,'the emptied stop is deleted');
select pg_temp.review(1,'split',(pg_temp.p(4)).location_id,null,(pg_temp.p(4)).id);
select isnt((pg_temp.p(4)).location_id,(pg_temp.p(3)).location_id,'split gives one seller their own stop');

-- Address change after approval.
select is(public.change_participation_address_command(pg_temp.uid(3),(pg_temp.p(3)).id,(pg_temp.p(3)).version,
  'Provgatan 9','113 45','Stockholm',18.063,59.332,'manual',null,true,gen_random_uuid())->>'state',
  'pending_address_change','an approved seller who moves needs the host again');
select ok(exists(select 1 from public.event_locations where id=(pg_temp.p(5)).location_id),'the other seller keeps the old stop');
select is((public.list_event_sellers_command(pg_temp.uid(1),(select event_id from fixture))->>'placesUsed')::int,3,
  'address review keeps the place');
update public.event_entitlements set seller_limit=3 where event_id=(select event_id from fixture);
select is(public.decide_seller_participation_command(pg_temp.uid(2),(pg_temp.p(3)).id,(pg_temp.p(3)).version,'approve',null,gen_random_uuid())->>'state',
  'approved','approving the new address needs no free place');

-- Pin corrections.
create function pg_temp.correct(p_actor int, p_lng double precision, p_auth timestamptz default now()) returns jsonb language sql as $$
select public.correct_location_pin_command(pg_temp.uid(p_actor),(pg_temp.p(3)).location_id,p_lng,59.332,'Pin on the wrong side of the house',p_auth,gen_random_uuid());
$$;
select throws_ok($$select pg_temp.correct(6,18.0631)$$,'P0001','Location not found','sellers cannot correct pins');
select throws_ok($$select pg_temp.correct(1,18.0631,now()-interval '1 hour')$$,'P0001','Recent authentication required','corrections need a recent sign-in');
select throws_ok($$select pg_temp.correct(1,18.0640)$$,'P0001','Pin correction too large','more than 25 metres is refused');
select pg_temp.correct(2,18.0631);
select is((select placement from public.event_locations where id=(pg_temp.p(3)).location_id),'corrected','moderator corrects within 25 m');
select is((select count(*) from app_private.audit_events where action='location.pin_corrected'
  and safe_summary ? 'distanceMeters' and not safe_summary::text like '%18.06%'),1::bigint,'audit keeps distance, not coordinates');
select * from finish();
rollback;
