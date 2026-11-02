begin;
create extension if not exists pgtap with schema extensions;
select plan(34);
select ok(not has_table_privilege('authenticated','public.seller_participations','SELECT'),'participations private');
select ok(not has_table_privilege('authenticated','public.event_locations','SELECT'),'addresses private');
select ok(not has_table_privilege('anon','public.event_locations','SELECT'),'addresses hidden from anonymous');
select ok(not has_function_privilege('authenticated','public.apply_to_event_command(uuid,uuid,text,text,text,text,double precision,double precision,text,boolean,boolean,uuid)','EXECUTE'),'browser cannot apply directly');
select ok(not has_function_privilege('authenticated','public.decide_seller_participation_command(uuid,uuid,integer,text,text,uuid)','EXECUTE'),'browser cannot decide directly');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1103-7000-8000-00000000000'||n)::uuid, 'seller-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,7) n;
-- 1 owner, 2 co-host, 3 moderator, 4-7 sellers
select public.create_scheduled_draft_event_command('01992026-1103-7000-8000-000000000001',null,
  'Admission Owner','Admission Fixture','','Europe/Stockholm','unlisted',
  '2031-09-09 10:00:00+02','2031-09-09 15:00:00+02','01992026-1103-7000-8000-000000000011');
create temporary table fixture as select id as event_id from public.events where title='Admission Fixture';
insert into public.event_memberships(event_id,account_id,role,display_name) values
  ((select event_id from fixture),'01992026-1103-7000-8000-000000000002','co_host','Co-host'),
  ((select event_id from fixture),'01992026-1103-7000-8000-000000000003','moderator','Moderator');

-- Inside: around (18.062, 59.331). Outside: (18.10, 59.35).
create function pg_temp.apply(p_seller int, p_lng double precision, p_attest boolean default true) returns jsonb language sql as $$
select public.apply_to_event_command(('01992026-1103-7000-8000-00000000000'||p_seller)::uuid,(select event_id from fixture),
  'Seller '||p_seller,'Testgatan '||p_seller,'113 45','Stockholm',p_lng,59.331,'manual',null,p_attest,gen_random_uuid());
$$;
create function pg_temp.p(p_seller int) returns public.seller_participations language sql as $$
select * from public.seller_participations where account_id=('01992026-1103-7000-8000-00000000000'||p_seller)::uuid;
$$;
create function pg_temp.decide(p_actor int, p_seller int, p_decision text, p_reason text default null) returns jsonb language sql as $$
select public.decide_seller_participation_command(('01992026-1103-7000-8000-00000000000'||p_actor)::uuid,
  (pg_temp.p(p_seller)).id,(pg_temp.p(p_seller)).version,p_decision,p_reason,gen_random_uuid());
$$;
create function pg_temp.admission(p_mode text) returns jsonb language sql as $$
select public.update_event_admission_command('01992026-1103-7000-8000-000000000001',(select event_id from fixture),
  (select version from public.events where id=(select event_id from fixture)),p_mode,false,gen_random_uuid());
$$;

select throws_ok($$select pg_temp.apply(4,18.062)$$,'P0001','Event area not ready','no applications before the area exists');
select public.upsert_draft_event_boundary_command('01992026-1103-7000-8000-000000000001',
  (select event_id from fixture),null,'Synthetic admission area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  '01992026-1103-7000-8000-000000000012');

select throws_ok($$select pg_temp.apply(4,18.062,false)$$,'P0001','Right to use the location must be confirmed','attestation required');
select is(pg_temp.apply(4,18.062)->>'state','pending','host approval keeps inside applications pending');
select throws_ok($$select pg_temp.apply(4,18.062)$$,'P0001','Already applied','one participation per account and event');
select throws_ok($$select public.update_event_admission_command('01992026-1103-7000-8000-000000000003',(select event_id from fixture),
  (select version from public.events where id=(select event_id from fixture)),'auto_inside',false,gen_random_uuid())$$,
  'P0001','Actor cannot manage admission','moderators cannot change admission');

update public.event_entitlements set seller_limit=1 where event_id=(select event_id from fixture);
select pg_temp.admission('auto_inside');
select is(pg_temp.apply(5,18.062)->>'state','approved','automatic events approve inside sellers');
select is(pg_temp.apply(6,18.063)->>'state','waitlisted','full events waitlist instead of rejecting');
select is((pg_temp.apply(7,18.10)->>'geographicException')::boolean,true,'outside pins become geographic exceptions');
select is((pg_temp.p(7)).state,'pending','geographic exceptions wait for the host');

select throws_ok($$select pg_temp.decide(1,4,'approve')$$,'P0001','Seller places are full','approval never exceeds the entitlement');
select throws_ok($$select pg_temp.decide(6,4,'approve')$$,'P0001','Participation not found','sellers cannot decide');
select throws_ok($$select pg_temp.decide(2,7,'reject','')$$,'P0001','Invalid seller decision','rejection needs a reason');
select is(pg_temp.decide(2,7,'reject','Outside the area')->>'state','rejected','co-host rejects a geographic exception');
select ok((pg_temp.p(7)).location_id is null,'rejection erases the address');
select is((select count(*) from public.event_locations where address_line='Testgatan 7'),0::bigint,'rejected location deleted');
select throws_ok($$update public.seller_participations set state='pending' where account_id='01992026-1103-7000-8000-000000000007'$$,
  'P0001','Participation transition rejected -> pending is not allowed','closed participations stay closed');

select throws_ok($$select public.withdraw_participation_command('01992026-1103-7000-8000-000000000005',(pg_temp.p(5)).id,
  (pg_temp.p(5)).version-1,gen_random_uuid())$$,'P0001','Participation version conflict','stale withdrawal refused');
select is(public.withdraw_participation_command('01992026-1103-7000-8000-000000000005',(pg_temp.p(5)).id,
  (pg_temp.p(5)).version,gen_random_uuid())->>'state','withdrawn','seller withdraws');
select is((pg_temp.p(6)).state,'approved','the freed place promotes the earliest waitlisted seller');
select is((select count(*) from app_private.audit_events where action='seller.promoted' and event_id=(select event_id from fixture)),
  1::bigint,'promotion audited');

select is((public.list_event_sellers_command('01992026-1103-7000-8000-000000000003',(select event_id from fixture))->>'placesUsed')::int,
  1,'moderator sees one place used');
select is((public.list_event_sellers_command('01992026-1103-7000-8000-000000000003',(select event_id from fixture))->>'locationCount')::int,
  1,'and one map location');
select throws_ok($$select public.list_event_sellers_command('01992026-1103-7000-8000-000000000004',(select event_id from fixture))$$,
  'P0001','Actor is not an event team member','sellers cannot list other sellers');
select is((public.get_event_for_seller_command('01992026-1103-7000-8000-000000000006',(select event_id from fixture))
  ->'participation'->'location'->>'addressLine'),'Testgatan 6','seller reads their own address');
select ok((public.get_event_for_seller_command('01992026-1103-7000-8000-000000000004',(select event_id from fixture))->>'placesFull')::boolean,
  'applicants see that places are full');

-- Revocation frees the place but never promotes a pending (non-waitlisted) seller.
select is(pg_temp.decide(1,6,'revoke','Repeated no-show')->>'state','revoked','owner revokes');
select is((pg_temp.p(4)).state,'pending','pending applications are not auto-promoted');
select is(pg_temp.decide(3,4,'approve')->>'state','approved','moderator approves once a place is free');

update public.event_registration_settings set opens_at=now()-interval '2 days', closes_at=now()-interval '1 day'
where event_id=(select event_id from fixture);
delete from public.seller_participations where account_id='01992026-1103-7000-8000-000000000005';
select throws_ok($$select pg_temp.apply(5,18.062)$$,'P0001','Registration is closed','closed registration refuses applications');
select * from finish();
rollback;
