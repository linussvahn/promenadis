begin;
create extension if not exists pgtap with schema extensions;
select plan(31);
select ok(not has_table_privilege('authenticated','public.seller_listings','SELECT'),'listings private until publication');
select ok(not has_table_privilege('anon','public.taxonomy_categories','SELECT'),'taxonomy read through the BFF');
select is((select count(*) from public.taxonomy_categories where version_id='0199a000-0000-7000-8000-000000000100'),14::bigint,
  'flea-market-v1 has fourteen categories');
select is((select label from public.taxonomy_category_localizations where category_id='0199a000-0000-7000-8000-000000000005' and locale='sv'),
  'Böcker & media','stable IDs carry Swedish labels');
select is((select count(*) from public.taxonomy_category_localizations),28::bigint,'every category has Swedish and English');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1103-7200-8000-00000000000'||n)::uuid, 'listing-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,5) n;
-- 1 owner, 2 co-host, 3 moderator, 4 seller, 5 outsider
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1103-7200-8000-00000000000'||p)::uuid $$;
create function pg_temp.cat(p int) returns uuid language sql as $$ select ('0199a000-0000-7000-8000-0000000000'||lpad(p::text,2,'0'))::uuid $$;
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Listing Owner','Listing Fixture','','Europe/Stockholm','unlisted',
  '2031-09-09 10:00:00+02','2031-09-09 15:00:00+02','01992026-1103-7200-8000-000000000011');
create temporary table fixture as select id as event_id from public.events where title='Listing Fixture';
insert into public.event_memberships(event_id,account_id,role,display_name) values
  ((select event_id from fixture),pg_temp.uid(2),'co_host','Co-host'),
  ((select event_id from fixture),pg_temp.uid(3),'moderator','Moderator');
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select event_id from fixture),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  gen_random_uuid());
update public.events set admission_mode='auto_inside' where id=(select event_id from fixture);

select is(cardinality((select enabled_category_ids from public.event_taxonomies where event_id=(select event_id from fixture))),14,
  'new events enable every category');
create function pg_temp.save_taxonomy(p_actor int, p_categories uuid[], p_tags text[]) returns jsonb language sql as $$
select public.save_event_taxonomy_command(pg_temp.uid(p_actor),(select event_id from fixture),
  (select version from public.event_taxonomies where event_id=(select event_id from fixture)),p_categories,p_tags,gen_random_uuid());
$$;
select throws_ok($$select pg_temp.save_taxonomy(3,array[pg_temp.cat(1)],'{}')$$,'P0001','Actor cannot configure categories','moderators cannot configure');
select throws_ok($$select pg_temp.save_taxonomy(1,array[pg_temp.cat(1)],array['Verifierad säljare'])$$,'P0001','Invalid category settings',
  'suggested tags cannot look like platform badges');
select throws_ok($$select pg_temp.save_taxonomy(1,array[pg_temp.cat(1)],array['Vinyl','vinyl '])$$,'P0001','Invalid category settings',
  'duplicate suggestions refused');
select is(jsonb_array_length(pg_temp.save_taxonomy(2,array[pg_temp.cat(5),pg_temp.cat(1),pg_temp.cat(14)],array['Vinyl','Retro'])->'suggestedTags'),2,
  'co-host enables a subset with suggestions');
select is((app_private.event_taxonomy_summary((select event_id from fixture))->'categories'->0->>'id')::uuid,pg_temp.cat(5),
  'the event order comes first');

select public.apply_to_event_command(pg_temp.uid(4),(select event_id from fixture),'Seller','Testgatan 1','','',18.062,59.331,'manual',null,true,gen_random_uuid());
create temporary table seller as select id from public.seller_participations where account_id=pg_temp.uid(4);
create function pg_temp.save_listing(p_categories uuid[], p_description text, p_tags text[], p_items jsonb default '[]', p_slots jsonb default '[]',
  p_version int default null) returns jsonb language sql as $$
select public.save_seller_listing_command(pg_temp.uid(4),(select id from seller),
  coalesce(p_version,(select coalesce(max(version),0) from public.seller_listings where participation_id=(select id from seller))),
  'Vinyl corner',p_description,p_categories,p_tags,true,false,null,'outdoor',true,false,p_items,p_slots,gen_random_uuid());
$$;
select throws_ok($$select pg_temp.save_listing(array[pg_temp.cat(7)],'Records','{}')$$,'P0001','Invalid listing','only enabled categories');
select throws_ok($$select pg_temp.save_listing('{}','Records','{}')$$,'P0001','Invalid listing','at least one category');
select throws_ok($$select pg_temp.save_listing(array[pg_temp.cat(14)],'Odd','{}')$$,'P0001','Describe what Other means','Other needs a description');
select throws_ok($$select pg_temp.save_listing(array[pg_temp.cat(5)],'Records',array['Trappfritt'])$$,'P0001','Invalid listing',
  'tags cannot claim accessibility');
select throws_ok($$select pg_temp.save_listing(array[pg_temp.cat(5)],'Records','{}','[]',
  '[{"startsAt":"2031-09-09T07:00:00Z","endsAt":"2031-09-09T09:00:00Z"}]')$$,'P0001','Availability must be within the event','availability inside the event');
select throws_ok($$select pg_temp.save_listing(array[pg_temp.cat(5)],'Records','{}','[]',
  '[{"startsAt":"2031-09-09T08:00:00Z","endsAt":"2031-09-09T10:00:00Z"},{"startsAt":"2031-09-09T09:00:00Z","endsAt":"2031-09-09T11:00:00Z"}]')$$,
  'P0001','Availability must be within the event','no overlapping availability');
select is((pg_temp.save_listing(array[pg_temp.cat(5),pg_temp.cat(1)],'Records and jackets',array['Vinyl','Jazz'],
  ('[{"name":"Blue Note LP","categoryId":"'||pg_temp.cat(5)||'","priceMinor":15000},{"name":"Denim jacket","categoryId":"'||pg_temp.cat(1)||'","status":"sold"}]')::jsonb,
  '[{"startsAt":"2031-09-09T08:00:00Z","endsAt":"2031-09-09T11:00:00Z"}]')->>'version')::int,1,'seller saves a full listing');
select is((select price_minor||' '||currency from public.highlighted_items where name='Blue Note LP'),'15000 SEK','prices in minor units with a currency');
select is((select status from public.highlighted_items where name='Denim jacket'),'sold','sold status kept');
select throws_ok($$select pg_temp.save_listing(array[pg_temp.cat(5)],'Records','{}','[]','[]',0)$$,'P0001','Listing version conflict','stale listing refused');
select is(jsonb_array_length(public.get_seller_listing_command(pg_temp.uid(3),(select id from seller))->'items'),2,'the team reads the listing');
select throws_ok($$select public.get_seller_listing_command(pg_temp.uid(5),(select id from seller))$$,'P0001','Participation not found','outsiders cannot');

-- Live status and taxonomy pinning.
create function pg_temp.live(p_actor int, p_status text, p_reason text default null) returns jsonb language sql as $$
select public.set_seller_live_status_command(pg_temp.uid(p_actor),(select id from seller),p_status,null,p_reason,gen_random_uuid());
$$;
select throws_ok($$select pg_temp.live(4,'away')$$,'P0001','Live status only during the event','no live status before the event');
update public.events set state='published' where id=(select event_id from fixture);
select throws_ok($$select pg_temp.save_taxonomy(1,array[pg_temp.cat(5)],'{}')$$,'P0001','Categories are pinned after publication',
  'published events pin their categories');
update public.events set state='active' where id=(select event_id from fixture);
select is(pg_temp.live(4,'away')->'liveStatus'->>'status','away','seller marks themselves away');
select throws_ok($$select pg_temp.live(2,'closed_early')$$,'P0001','Reason required','the team needs a reason to act on behalf');
select is(pg_temp.live(2,'closed_early','Seller phoned in sick')->'liveStatus'->>'status','closed_early','co-host closes early on behalf');
select throws_ok($$select pg_temp.live(4,'open')$$,'P0001','Closed for the day','closing early is final for the seller');
select is((public.list_event_sellers_command(pg_temp.uid(1),(select event_id from fixture))->>'placesUsed')::int,1,'closing early keeps the place');
select is((select count(*) from app_private.audit_events where action='seller.live_status' and safe_summary->>'reason'='Seller phoned in sick'),
  1::bigint,'on-behalf changes audited with the reason');
select * from finish();
rollback;
