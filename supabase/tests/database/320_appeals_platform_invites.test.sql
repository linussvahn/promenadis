begin;
create extension if not exists pgtap with schema extensions;
select plan(30);
select ok(not has_table_privilege('authenticated','app_private.moderation_appeals','SELECT'),'appeals private');
select ok(not has_table_privilege('authenticated','public.seller_invites','SELECT'),'invitation emails private');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1103-7400-8000-00000000000'||n)::uuid, 'appeal-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,7) n;
-- 1 owner, 2 moderator, 3-4 sellers, 5-6 admins, 7 invited seller
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1103-7400-8000-00000000000'||p)::uuid $$;
create function pg_temp.session(p int) returns uuid language sql as $$ select ('01992026-1103-7400-8000-0000000000'||p||'0')::uuid $$;
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Appeal Owner','Appeal Fixture','','Europe/Stockholm','unlisted',
  '2031-09-09 10:00:00+02','2031-09-09 15:00:00+02',gen_random_uuid());
create temporary table fixture as select id as event_id from public.events where title='Appeal Fixture';
insert into public.event_memberships(event_id,account_id,role,display_name)
values ((select event_id from fixture),pg_temp.uid(2),'moderator','Moderator');
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select event_id from fixture),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  gen_random_uuid());
update public.events set admission_mode='auto_inside' where id=(select event_id from fixture);
create function pg_temp.apply(p int, p_address text) returns jsonb language sql as $$
select public.apply_to_event_command(pg_temp.uid(p),(select event_id from fixture),'Seller '||p,p_address,'','',18.061,59.331,'manual',null,true,gen_random_uuid());
$$;
create function pg_temp.p(p int) returns public.seller_participations language sql as $$
select * from public.seller_participations where account_id=pg_temp.uid(p) and event_id=(select event_id from fixture);
$$;
select pg_temp.apply(3,'Testgatan 1');
select pg_temp.apply(4,'Testgatan 2');
select public.save_seller_listing_command(pg_temp.uid(3),(pg_temp.p(3)).id,0,'Stall','Things',
  array['0199a000-0000-7000-8000-000000000005'::uuid],'{}',null,null,null,null,null,false,'[]','[]',gen_random_uuid());
insert into app_private.platform_admins(account_id) values (pg_temp.uid(5)),(pg_temp.uid(6));
select public.start_admin_elevation_command(pg_temp.uid(5),pg_temp.session(5),gen_random_uuid());
select public.start_admin_elevation_command(pg_temp.uid(6),pg_temp.session(6),gen_random_uuid());
create function pg_temp.action_for(p int, p_action text) returns uuid language sql as $$
select id from app_private.moderation_actions where affected_account_id=pg_temp.uid(p) and action=p_action order by created_at desc limit 1;
$$;
create function pg_temp.appeal_for(p int, p_action text) returns uuid language sql as $$
select id from app_private.moderation_appeals where action_id=pg_temp.action_for(p,p_action);
$$;

-- Appeal of hidden listing text.
select public.moderate_participation_command(pg_temp.uid(2),(pg_temp.p(3)).id,'hide_listing',null,'Offensive wording',gen_random_uuid());
select throws_ok($$select public.submit_appeal_command(pg_temp.uid(3),pg_temp.action_for(3,'hide_listing'),'Too short',gen_random_uuid())$$,
  'P0001','Invalid appeal','appeals need a statement');
select throws_ok($$select public.submit_appeal_command(pg_temp.uid(4),pg_temp.action_for(3,'hide_listing'),'Not my listing at all.',gen_random_uuid())$$,
  'P0001','Action not found','only the affected seller can appeal');
select is(public.submit_appeal_command(pg_temp.uid(3),pg_temp.action_for(3,'hide_listing'),'The text was a book title, not abuse.',gen_random_uuid())->0->'appeal'->>'state',
  'pending','seller appeals');
select throws_ok($$select public.submit_appeal_command(pg_temp.uid(3),pg_temp.action_for(3,'hide_listing'),'Again and again please.',gen_random_uuid())$$,
  'P0001','Already appealed','one appeal per decision');
select throws_ok($$select public.list_appeals_command(pg_temp.uid(2),pg_temp.session(2),gen_random_uuid())$$,
  'P0001','Admin elevation required','event moderators do not decide appeals');
select is(jsonb_array_length(public.list_appeals_command(pg_temp.uid(5),pg_temp.session(5),gen_random_uuid())),1,'elevated admin sees the queue');
select public.decide_appeal_command(pg_temp.uid(5),pg_temp.session(5),pg_temp.appeal_for(3,'hide_listing'),'reverse','Book title, not abuse',gen_random_uuid());
select ok(not (app_private.seller_listing_summary((pg_temp.p(3)).id)->>'hidden')::boolean,'reversal shows the text again');
select is((select state||'/'||independent from app_private.moderation_appeals where id=pg_temp.appeal_for(3,'hide_listing')),
  'reversed/true','reviewed independently of the event moderator');

-- Appeal of a revocation: the address is gone, so reversal lets them apply again.
select public.decide_seller_participation_command(pg_temp.uid(1),(pg_temp.p(4)).id,(pg_temp.p(4)).version,'revoke','No-show last year',gen_random_uuid());
select is(public.submit_appeal_command(pg_temp.uid(4),pg_temp.action_for(4,'revoke'),'I was at the event, check with the host.',gen_random_uuid())->0->>'action',
  'revoke','a host revocation can be appealed');
-- Revocation by the team through a case is appealable; simulate by upholding a report.
select public.submit_report_command((select event_id from fixture),'participation',(pg_temp.p(3)).id,'fraud','Sells fake goods','other',false,null,'net-x',gen_random_uuid());
select public.review_moderation_case_command(pg_temp.uid(1),(select id from app_private.moderation_cases where subject_id=(pg_temp.p(3)).id),
  'uphold','Confirmed fake goods',gen_random_uuid());
select is((pg_temp.p(3)).state,'revoked','report upheld revokes the seller');
select public.submit_appeal_command(pg_temp.uid(3),pg_temp.action_for(3,'uphold_removal'),'The goods are genuine, here is why.',gen_random_uuid());
select public.decide_appeal_command(pg_temp.uid(6),pg_temp.session(6),pg_temp.appeal_for(3,'uphold_removal'),'reverse','Receipts shown',gen_random_uuid());
select ok((pg_temp.p(3)).id is null,'reversal clears the closed participation');
select is(pg_temp.apply(3,'Testgatan 1')->>'state','approved','the seller can apply again');

-- Platform restriction with a second approver.
select throws_ok($$select public.restrict_account_command(pg_temp.uid(5),pg_temp.session(5),pg_temp.uid(5),'Self',gen_random_uuid())$$,
  'P0001','Cannot restrict own account','admins cannot restrict themselves');
select public.restrict_account_command(pg_temp.uid(5),pg_temp.session(5),pg_temp.uid(3),'Repeated fraud across events',gen_random_uuid());
select is((pg_temp.p(3)).state,'suspended','restriction suspends approved participations');
select throws_ok($$select public.moderate_participation_command(pg_temp.uid(1),(pg_temp.p(3)).id,'reinstate',null,'We trust them',gen_random_uuid())$$,
  'P0001','Platform restriction applies','event team cannot override');
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'','Second Fixture','','Europe/Stockholm','unlisted',
  '2031-10-09 10:00:00+02','2031-10-09 15:00:00+02',gen_random_uuid());
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select id from public.events where title='Second Fixture'),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,gen_random_uuid());
select throws_ok($$select public.apply_to_event_command(pg_temp.uid(3),(select id from public.events where title='Second Fixture'),'S','Testgatan 3','','',18.061,59.331,'manual',null,true,gen_random_uuid())$$,
  'P0001','Platform restriction applies','restricted accounts cannot apply anywhere');
select public.submit_appeal_command(pg_temp.uid(3),pg_temp.action_for(3,'suspend'),'This restriction is a mistake, please check.',gen_random_uuid());
select throws_ok($$select public.decide_appeal_command(pg_temp.uid(5),pg_temp.session(5),pg_temp.appeal_for(3,'suspend'),'reverse','Own decision',gen_random_uuid())$$,
  'P0001','Different reviewer required','the original admin cannot review when another exists');
create temporary table restriction as select id from app_private.platform_account_restrictions where account_id=pg_temp.uid(3) and lifted_at is null;
select is((public.request_restriction_lift_command(pg_temp.uid(5),pg_temp.session(5),(select id from restriction),'Evidence cleared',gen_random_uuid())->>'pendingApproval')::boolean,
  true,'with two admins, lifting waits for approval');
select ok((select lifted_at is null from app_private.platform_account_restrictions where id=(select id from restriction)),'not lifted yet');
select throws_ok($$select public.decide_admin_approval_command(pg_temp.uid(5),pg_temp.session(5),(select id from app_private.admin_action_approvals where state='pending'),true,gen_random_uuid())$$,
  'P0001','Different approver required','the requester cannot approve');
select public.decide_admin_approval_command(pg_temp.uid(6),pg_temp.session(6),(select id from app_private.admin_action_approvals where state='pending'),true,gen_random_uuid());
select ok((select lifted_at is not null from app_private.platform_account_restrictions where id=(select id from restriction)),'a second admin lifts it');

-- Reason-gated reporter contact.
select public.submit_report_command((select event_id from fixture),'participation',(pg_temp.p(3)).id,'safety','Blocking the pavement','other',false,
  'witness@example.invalid','net-y',gen_random_uuid());
select throws_ok($$select public.admin_read_report_contact_command(pg_temp.uid(5),pg_temp.session(5),(select id from app_private.reports where reporter_contact is not null limit 1),'',gen_random_uuid())$$,
  'P0001','Reason required','contact reads need a reason');
select is(public.admin_read_report_contact_command(pg_temp.uid(5),pg_temp.session(5),(select id from app_private.reports where reporter_contact is not null limit 1),
  'Need to ask the reporter about the location',gen_random_uuid())->>'contact','witness@example.invalid','elevated admin reads it with a reason');

-- Seller invitations.
update public.events set admission_mode='invite_only' where id=(select event_id from fixture);
select throws_ok($$select public.invite_seller_command(pg_temp.uid(2),(select event_id from fixture),'appeal-7@example.invalid',gen_random_uuid())$$,
  'P0001','Actor cannot invite sellers','moderators cannot invite');
select is(jsonb_array_length(public.invite_seller_command(pg_temp.uid(1),(select event_id from fixture),' Appeal-7@Example.invalid ',gen_random_uuid())),1,
  'owner invites by email');
select is(public.get_incoming_seller_invites_command(pg_temp.uid(7))->0->>'eventTitle','Appeal Fixture','the invitee sees it');
select is(public.accept_seller_invite_command(pg_temp.uid(7),(select id from public.seller_invites limit 1),'Invited','Testgatan 9','','',
  18.063,59.332,'manual',null,true,gen_random_uuid())->>'state','approved','accepting an invitation takes a place');
select is((select count(*) from public.seller_invites),0::bigint,'the invitation email is deleted on acceptance');
select * from finish();
rollback;
