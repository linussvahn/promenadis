begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
select ok(not has_table_privilege('authenticated','app_private.notification_outbox','SELECT'),'outbox private');
select ok(not has_table_privilege('authenticated','public.account_notifications','SELECT'),'in-app notices via the BFF only');
select ok(not has_function_privilege('authenticated','public.claim_application_notifications(integer)','EXECUTE'),'only the worker claims');

insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select ('01992026-1106-7100-8000-00000000000'||n)::uuid, 'note-'||n||'@example.invalid', now(), now(), now()
from generate_series(1,4) n;
-- 1 owner, 2-4 sellers
create function pg_temp.uid(p int) returns uuid language sql as $$ select ('01992026-1106-7100-8000-00000000000'||p)::uuid $$;
select public.create_scheduled_draft_event_command(pg_temp.uid(1),null,'Note Owner','Note Fixture','','Europe/Stockholm','unlisted',
  now()+interval '1 day', now()+interval '1 day 5 hours',gen_random_uuid());
create temporary table fixture as select id as event_id from public.events where title='Note Fixture';
select public.upsert_draft_event_boundary_command(pg_temp.uid(1),(select event_id from fixture),null,'Area',
  '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
  gen_random_uuid());
update public.events set admission_mode='host_approval' where id=(select event_id from fixture);
select public.apply_to_event_command(pg_temp.uid(n),(select event_id from fixture),'Seller '||n,'Testgatan '||n,'','',
  18.061+n*0.0003,59.331,'manual',null,true,gen_random_uuid()) from generate_series(2,4) n;
create function pg_temp.p(p int) returns public.seller_participations language sql as $$
  select * from public.seller_participations where account_id=pg_temp.uid(p) $$;
create function pg_temp.jobs(p_template text) returns bigint language sql as $$
  select count(*) from app_private.notification_outbox where template=p_template and event_id=(select event_id from fixture) $$;

select is(pg_temp.jobs('seller_approved'),0::bigint,'applying sends nothing yet');
select public.decide_seller_participation_command(pg_temp.uid(1),(pg_temp.p(2)).id,(pg_temp.p(2)).version,'approve',null,gen_random_uuid());
select public.decide_seller_participation_command(pg_temp.uid(1),(pg_temp.p(3)).id,(pg_temp.p(3)).version,'reject','Outside the theme',gen_random_uuid());
select is(pg_temp.jobs('seller_approved'),1::bigint,'approval queues a notice');
select is(pg_temp.jobs('seller_rejected'),1::bigint,'rejection queues a notice');
select is((select payload from app_private.notification_outbox where template='seller_approved'),
  '{"eventState": "draft", "eventTitle": "Note Fixture"}'::jsonb,'payload holds only event title and state');
select ok(position('Outside the theme' in (select payload::text from app_private.notification_outbox where template='seller_rejected'))=0,
  'host-written reasons never enter mail');
select is((select count(*) from public.account_notifications where account_id=pg_temp.uid(2)),1::bigint,'an in-app copy for the seller');
select is((public.list_account_notifications_command(pg_temp.uid(2))->0->>'template'),'seller_approved','sellers list their notices');

-- Invitations, cancellation, link rotation and reminders.
update public.events set admission_mode='invite_only' where id=(select event_id from fixture);
select public.invite_seller_command(pg_temp.uid(1),(select event_id from fixture),'invitee@example.invalid',gen_random_uuid());
select is(pg_temp.jobs('seller_invited'),1::bigint,'seller invitations are mailed to the address');
update public.events set state='published' where id=(select event_id from fixture);
select public.rotate_unlisted_link_command(pg_temp.uid(1),(select event_id from fixture),(select version from public.events where id=(select event_id from fixture)),null,now(),gen_random_uuid());
select is(pg_temp.jobs('unlisted_link_rotated'),3::bigint,'link rotation reaches the team and current sellers');
insert into app_private.notification_preferences(account_id,event_reminders) values (pg_temp.uid(2),true);
select is(app_private.enqueue_event_reminders_command(),1,'only opted-in approved sellers get reminders');
select is((select priority from app_private.notification_outbox where template='event_reminder'),'optional','reminders are optional mail');

-- Worker order, resolution and suppression.
create temporary table claimed as select * from public.claim_application_notifications(25);
select ok((select bool_and(template<>'event_reminder') from claimed) or (select count(*) from claimed) = 
  (select count(*) from app_private.notification_outbox), 'required mail is claimed before optional reminders');
select is(public.resolve_application_recipient((select job_id from claimed where template='seller_approved'),
  (select lease_id from claimed where template='seller_approved'))->>'email','note-2@example.invalid','the address is resolved at send time');
select public.record_email_feedback_command('INVITEE@example.invalid ','bounce');
select ok(public.resolve_application_recipient((select job_id from claimed where template='seller_invited'),
  (select lease_id from claimed where template='seller_invited')) is null,'a bounced address is not mailed');
select is((select cancel_reason from app_private.notification_outbox where template='seller_invited'),'suppressed','and the job records why');
select ok(not exists (select 1 from app_private.email_suppressions where email_hash ~ 'invitee'),'suppressions store only an HMAC');
select ok(public.finish_application_notification((select job_id from claimed where template='seller_approved'),
  (select lease_id from claimed where template='seller_approved'),true),'delivery is acknowledged under the lease');
select ok((select payload is null and completed_at is not null from app_private.notification_outbox where template='seller_approved'),
  'delivered jobs drop their payload');
select public.finish_application_notification((select job_id from claimed where template='seller_rejected'),
  (select lease_id from claimed where template='seller_rejected'),false);
select ok((select available_at > now() and completed_at is null from app_private.notification_outbox where template='seller_rejected'),
  'failures back off for a retry');

-- Cancellation burst and retention.
update public.events set state='cancelled', public_notice='Storm' where id=(select event_id from fixture);
select is(pg_temp.jobs('event_cancelled'),3::bigint,'cancellation reaches the approved and pending sellers and the team');
update app_private.notification_outbox set created_at=now()-interval '31 days';
update public.account_notifications set created_at=now()-interval '31 days';
select app_private.enforce_notification_retention_command();
select ok(not exists (select 1 from app_private.notification_outbox where event_id=(select event_id from fixture))
  and not exists (select 1 from public.account_notifications where account_id=pg_temp.uid(2)),'delivery metadata and notices expire after 30 days');
select * from finish();
rollback;
