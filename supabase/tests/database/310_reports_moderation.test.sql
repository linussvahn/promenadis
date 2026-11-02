begin;
create extension if not exists pgtap with schema extensions;
select plan(30);
select ok(not has_table_privilege('authenticated','app_private.reports','SELECT'),'reports private');
select ok(not has_function_privilege('anon','public.submit_report_command(uuid,text,uuid,text,text,text,boolean,text,text,uuid)','EXECUTE'),
  'anonymous reports go through the BFF');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1103-7300-8000-00000000000'||n)::uuid, 'moderation-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,5) n;
-- 1 owner, 2 moderator, 3-5 sellers
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1103-7300-8000-00000000000'||p)::uuid $$;
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Moderation Owner','Moderation Fixture','','Europe/Stockholm','unlisted',
  '2031-09-09 10:00:00+02','2031-09-09 15:00:00+02',gen_random_uuid());
create temporary table fixture as select id as event_id from public.events where title='Moderation Fixture';
insert into public.event_memberships(event_id,account_id,role,display_name)
values ((select event_id from fixture),pg_temp.uid(2),'moderator','Moderator');
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select event_id from fixture),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  gen_random_uuid());
update public.events set admission_mode='auto_inside' where id=(select event_id from fixture);
select public.apply_to_event_command(pg_temp.uid(3),(select event_id from fixture),'Seller A','Testgatan 1','','',18.061,59.331,'manual',null,true,gen_random_uuid());
select public.apply_to_event_command(pg_temp.uid(4),(select event_id from fixture),'Seller B','Testgatan 1','','',18.061,59.331,'manual',true,true,gen_random_uuid());
select public.apply_to_event_command(pg_temp.uid(5),(select event_id from fixture),'Seller C','Testgatan 9','','',18.063,59.332,'manual',null,true,gen_random_uuid());
create function pg_temp.p(p int) returns public.seller_participations language sql as $$
select * from public.seller_participations where account_id=pg_temp.uid(p);
$$;
create function pg_temp.report(p_type text, p_subject uuid, p_reason text, p_details text, p_relationship text, p_confirms boolean,
  p_bucket text default 'net-a') returns jsonb language sql as $$
select public.submit_report_command((select event_id from fixture),p_type,p_subject,p_reason,p_details,p_relationship,p_confirms,
  'reporter@example.invalid',p_bucket,gen_random_uuid());
$$;

-- Reports and quarantine.
select throws_ok($$select pg_temp.report('location',gen_random_uuid(),'safety','Something','other',false)$$,
  'P0001','Report subject not found','unknown subjects refused');
select is(pg_temp.report('participation',(pg_temp.p(5)).id,'harassment','Rude text','other',false,'net-b'),'{"received": true}'::jsonb,
  'an ordinary report is received');
select ok((select quarantined_at is null from public.event_locations where id=(pg_temp.p(5)).location_id),'one ordinary report removes nothing');
select pg_temp.report('location',(pg_temp.p(3)).location_id,'unauthorized_address','Short','resident',true,'net-c');
select ok((select quarantined_at is null from public.event_locations where id=(pg_temp.p(3)).location_id),'an incomplete report does not quarantine');
select is(pg_temp.report('location',(pg_temp.p(3)).location_id,'unauthorized_address',
  'I live here and never agreed to a stall at my door.','resident',true,'net-c'),'{"received": true}'::jsonb,
  'the answer does not reveal quarantine');
select ok((select quarantined_at is not null from public.event_locations where id=(pg_temp.p(3)).location_id),
  'a complete unauthorized-address report quarantines the location');
select ok((select quarantined_at is null from public.event_locations where id=(pg_temp.p(5)).location_id),'other locations unaffected');
select is((select count(*) from app_private.moderation_cases where subject_id=(pg_temp.p(3)).location_id),1::bigint,
  'repeated reports collapse into one case');
select is((select count(*) from app_private.moderation_actions where action='quarantine'),2::bigint,'quarantine recorded once per seller at the stop');
select pg_temp.report('location',(pg_temp.p(3)).location_id,'safety','Third this hour','other',false,'net-c');
select throws_ok($$select pg_temp.report('location',(pg_temp.p(3)).location_id,'safety','Again','other',false,'net-c')$$,
  'P0001','Report limit reached','three reports an hour per network');
select is((pg_temp.p(4)).state,'approved','quarantine does not change participation state');
select ok((app_private.seller_participation_summary(pg_temp.p(4),true)->'location'->>'quarantined')::boolean,
  'sellers at the stop see the quarantine');

-- Team review. Reporter data stays restricted.
create temporary table cases as select public.list_event_cases_command(pg_temp.uid(2),(select event_id from fixture)) as data;
select ok(not ((select data from cases)::text like '%reporter@example.invalid%'),'reporter contact never reaches the team');
select is(jsonb_array_length((select data from cases)),2,'team sees both cases');
select throws_ok($$select public.list_event_cases_command(pg_temp.uid(3),(select event_id from fixture))$$,
  'P0001','Actor is not an event team member','sellers cannot read cases');
create function pg_temp.case_for(p_subject uuid) returns uuid language sql as $$
select id from app_private.moderation_cases where subject_id=p_subject and state='open';
$$;
select throws_ok($$select public.review_moderation_case_command(pg_temp.uid(2),pg_temp.case_for((pg_temp.p(3)).location_id),'dismiss','Looks fine',gen_random_uuid())$$,
  'P0001','Restore or uphold a quarantined location','a quarantined location needs a human restore or uphold');
insert into app_private.platform_account_restrictions(account_id,reason) values (pg_temp.uid(4),'Platform enforcement');
select throws_ok($$select public.review_moderation_case_command(pg_temp.uid(2),pg_temp.case_for((pg_temp.p(3)).location_id),'restore','Checked with seller',gen_random_uuid())$$,
  'P0001','Platform restriction applies','local reviewers cannot override a platform restriction');
update app_private.platform_account_restrictions set lifted_at=now() where account_id=pg_temp.uid(4);
create temporary table quarantined_location as select (pg_temp.p(3)).location_id as id;
select lives_ok($$select public.review_moderation_case_command(pg_temp.uid(1),pg_temp.case_for((pg_temp.p(3)).location_id),'uphold','Resident confirmed no consent',gen_random_uuid())$$,
  'owner upholds the removal');
select is((pg_temp.p(3)).state||'/'||(pg_temp.p(4)).state,'revoked/revoked','every seller at the stop is revoked');
select is((select count(*) from public.event_locations where id=(select id from quarantined_location)),0::bigint,'the address is erased');
select is((select count(*) from app_private.moderation_actions where action='uphold_removal' and affected_account_id in (pg_temp.uid(3),pg_temp.uid(4))),
  2::bigint,'each affected seller has an appealable action');
select is(jsonb_array_length(public.list_my_moderation_command(pg_temp.uid(3))),2,'the seller sees quarantine and removal');

-- Direct moderation.
select public.save_seller_listing_command(pg_temp.uid(5),(pg_temp.p(5)).id,0,'Stall','Things',
  array['0199a000-0000-7000-8000-000000000005'::uuid],'{}',null,null,null,null,null,false,
  '[{"name":"LP","categoryId":"0199a000-0000-7000-8000-000000000005"}]','[]',gen_random_uuid());
select throws_ok($$select public.moderate_participation_command(pg_temp.uid(2),(pg_temp.p(5)).id,'hide_listing',null,'',gen_random_uuid())$$,
  'P0001','Invalid moderation action','hiding needs a reason');
select public.moderate_participation_command(pg_temp.uid(2),(pg_temp.p(5)).id,'hide_listing',null,'Offensive wording',gen_random_uuid());
select ok((app_private.seller_listing_summary((pg_temp.p(5)).id)->>'hidden')::boolean,'moderator hides listing text');
select is(public.moderate_participation_command(pg_temp.uid(2),(pg_temp.p(5)).id,'suspend',null,'Pending review',gen_random_uuid())->>'state',
  'suspended','moderator suspends');
select is((public.list_event_sellers_command(pg_temp.uid(1),(select event_id from fixture))->>'placesUsed')::int,1,'suspension keeps the place');
insert into app_private.platform_account_restrictions(account_id,reason) values (pg_temp.uid(5),'Platform enforcement');
select throws_ok($$select public.moderate_participation_command(pg_temp.uid(1),(pg_temp.p(5)).id,'reinstate',null,'Resolved',gen_random_uuid())$$,
  'P0001','Platform restriction applies','platform suspension cannot be lifted locally');
select is((select count(*) from app_private.audit_events where action like 'moderation.%' and safe_summary::text like '%reporter%'),0::bigint,
  'audit never carries reporter data');
select * from finish();
rollback;
