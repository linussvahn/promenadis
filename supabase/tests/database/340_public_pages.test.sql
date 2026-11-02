begin;
create extension if not exists pgtap with schema extensions;
select plan(28);
select ok(not has_function_privilege('anon','public.public_event_landing_command(text,text)','EXECUTE'),
  'landing reads go through the BFF');
select ok(not has_function_privilege('authenticated','public.rotate_unlisted_link_command(uuid,uuid,integer,text,timestamptz,uuid)','EXECUTE'),
  'browser cannot rotate directly');
select ok(not has_table_privilege('authenticated','public.retired_event_keys','SELECT'),'retired keys private');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1104-7100-8000-00000000000'||n)::uuid, 'public-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,2) n;
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1104-7100-8000-00000000000'||p)::uuid $$;
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Garden Club','Public Fixture','Books and plants','Europe/Stockholm','public',
  '2031-09-09 10:00:00+02','2031-09-09 15:00:00+02',gen_random_uuid());
select public.create_scheduled_draft_event_command(pg_temp.uid(1),
  (select organizer_profile_id from public.events where title='Public Fixture'),'','Unlisted Fixture','Quiet street','Europe/Stockholm','unlisted',
  '2031-09-10 10:00:00+02','2031-09-10 15:00:00+02',gen_random_uuid());
create function pg_temp.ev(p text) returns public.events language sql as $$ select * from public.events where title=p $$;
create function pg_temp.landing(p_route text, p_title text) returns jsonb language sql as $$
  select public.public_event_landing_command(p_route,(pg_temp.ev(p_title)).public_key) $$;
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(pg_temp.ev('Public Fixture')).id,null,'Söder',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  gen_random_uuid());

select ok((pg_temp.ev('Public Fixture')).public_key ~ '^[0-9a-f]{32}$','every event has a 128-bit key');
select is(pg_temp.landing('public','Public Fixture')->>'status','not_found','drafts are not public');
select is(public.public_event_landing_command('public','not-a-key')->>'status','not_found','malformed keys are unknown');
select is(jsonb_array_length(public.public_list_events_command(null,false,null,null,20)->'events'),0,'no drafts in discovery');

update public.events set state='published' where title in ('Public Fixture','Unlisted Fixture');
select is(pg_temp.landing('public','Public Fixture')->>'status','ok','published public event is reachable');
select is(pg_temp.landing('public','Public Fixture')->'event'->>'areaLabel','Söder','area label shown');
select ok((pg_temp.landing('public','Public Fixture')->'event'->>'indexable')::boolean,'public event is indexable');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.landing('public','Public Fixture')->'event') k),
  array['areaLabel','description','indexable','intervals','organizer','originalStartsAt','publicKey','publicNotice','state',
    'timezone','title','updatedAt','visibility'],'landing exposes only allowlisted event fields');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.landing('public','Public Fixture')->'event'->'organizer') k),
  array['displayName','locality','publicKey','verified'],'organizer fields are allowlisted');
select is(pg_temp.landing('unlisted','Public Fixture')->>'status','not_found','public keys do not open the unlisted path');
select is(pg_temp.landing('public','Unlisted Fixture')->>'status','not_found','unlisted keys do not open the public path');
select ok(not (pg_temp.landing('unlisted','Unlisted Fixture')->'event'->>'indexable')::boolean,'unlisted events are never indexable');
select ok(pg_temp.landing('unlisted','Unlisted Fixture')->'event'->'organizer'->'publicKey' = 'null'::jsonb,
  'unlisted events do not link the organizer page');

select is((select array_agg(e->>'title') from jsonb_array_elements(public.public_list_events_command(null,false,null,null,20)->'events') e),
  array['Public Fixture'],'discovery lists public events only');
select is(jsonb_array_length(public.public_list_events_command('PLANTS söder',false,null,null,20)->'events'),1,
  'every search word matches title, description, organizer or area');
select is(jsonb_array_length(public.public_list_events_command('fiskar',false,null,null,20)->'events'),0,'non-matching search is empty');
select is(jsonb_array_length(public.public_list_events_command(null,true,null,null,20)->'events'),0,'live filter excludes upcoming');

select is(public.public_organizer_page_command((select public_key from public.organizer_profiles where id=(pg_temp.ev('Public Fixture')).organizer_profile_id))
  ->'organizer'->'events'->0->>'title','Public Fixture','organizer page lists only public events');
select is(jsonb_array_length(public.public_organizer_page_command((select public_key from public.organizer_profiles where id=(pg_temp.ev('Public Fixture')).organizer_profile_id))
  ->'organizer'->'events'),1,'unlisted events stay off the organizer page');
select is(jsonb_array_length(public.public_sitemap_command()->'events'),1,'sitemap holds the public event only');

-- Rotation of an unlisted link.
create temporary table old_key as select public_key from public.events where title='Unlisted Fixture';
select throws_ok($$select public.rotate_unlisted_link_command(pg_temp.uid(1),(pg_temp.ev('Public Fixture')).id,(pg_temp.ev('Public Fixture')).version,null,now(),gen_random_uuid())$$,
  'P0001','Only unlisted links can be rotated','public links are stable');
select public.rotate_unlisted_link_command(pg_temp.uid(1),(pg_temp.ev('Unlisted Fixture')).id,(pg_temp.ev('Unlisted Fixture')).version,null,now(),gen_random_uuid());
select is(public.public_event_landing_command('unlisted',(select public_key from old_key))->>'status','gone','the old link answers 410');
select is(pg_temp.landing('unlisted','Unlisted Fixture')->>'status','ok','the new link works');
update public.events set state='active' where title='Unlisted Fixture';
select throws_ok($$select public.rotate_unlisted_link_command(pg_temp.uid(1),(pg_temp.ev('Unlisted Fixture')).id,(pg_temp.ev('Unlisted Fixture')).version,'',now(),gen_random_uuid())$$,
  'P0001','Safety reason required','rotation during the event needs a safety reason');

-- Archive keeps a minimal shell that is no longer indexable.
update public.events set state='cancelled', public_notice='Storm' where title='Public Fixture';
update public.events set state='archived' where title='Public Fixture';
select ok(not (pg_temp.landing('public','Public Fixture')->'event'->>'indexable')::boolean
  and pg_temp.landing('public','Public Fixture')->'event'->>'description' = '','archived page is a minimal non-indexable shell');
select * from finish();
rollback;
