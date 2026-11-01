begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.update_draft_event_visibility_command(uuid,uuid,integer,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the BFF visibility command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.update_draft_event_visibility_command(uuid,uuid,integer,text,uuid)',
    'EXECUTE'
  ),
  'the BFF service role may execute the visibility command'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.delete_draft_event_command(uuid,uuid,integer,text,timestamptz,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the BFF deletion command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.delete_draft_event_command(uuid,uuid,integer,text,timestamptz,uuid)',
    'EXECUTE'
  ),
  'the BFF service role may execute the deletion command'
);

insert into auth.users (id, email, created_at, updated_at)
values
  ('01992026-0908-7000-8000-000000000021', 'controls-owner@example.invalid', now(), now()),
  ('01992026-0908-7000-8000-000000000022', 'controls-cohost@example.invalid', now(), now()),
  ('01992026-0908-7000-8000-000000000023', 'controls-moderator@example.invalid', now(), now()),
  ('01992026-0908-7000-8000-000000000024', 'controls-outsider@example.invalid', now(), now());

select lives_ok(
  $$
    select public.create_organizer_profile_command(
      '01992026-0908-7000-8000-000000000021',
      'Controls Test Organizer',
      'individual',
      '',
      '',
      '01992026-0908-7000-8000-000000000401'
    )
  $$,
  'the event owner can create the organizer fixture'
);
select lives_ok(
  $$
    select public.create_scheduled_draft_event_command(
      '01992026-0908-7000-8000-000000000021',
      (select id from public.organizer_profiles where display_name = 'Controls Test Organizer'),
      '',
      'Visibility Controls Event',
      '',
      'Europe/Stockholm',
      'unlisted',
      '2030-09-08 10:00:00+02',
      '2030-09-08 15:00:00+02',
      '01992026-0908-7000-8000-000000000402'
    )
  $$,
  'the owner can create the visibility fixture'
);
select lives_ok(
  $$
    select public.create_scheduled_draft_event_command(
      '01992026-0908-7000-8000-000000000021',
      (select id from public.organizer_profiles where display_name = 'Controls Test Organizer'),
      '',
      'Delete Controls Event',
      '',
      'Europe/Stockholm',
      'unlisted',
      '2030-10-08 10:00:00+02',
      '2030-10-08 15:00:00+02',
      '01992026-0908-7000-8000-000000000403'
    )
  $$,
  'the owner can create the deletion fixture'
);
select is(
  (select version from public.events where title = 'Visibility Controls Event'),
  1,
  'new events begin at version one'
);
select is(
  public.get_identity_dashboard_command('01992026-0908-7000-8000-000000000021')
    #>> '{events,0,version}',
  '1',
  'the allowlisted dashboard includes the event version'
);

insert into public.event_memberships (event_id, account_id, role)
select id, '01992026-0908-7000-8000-000000000022', 'co_host'
from public.events
where title in ('Visibility Controls Event', 'Delete Controls Event');
insert into public.event_memberships (event_id, account_id, role)
select id, '01992026-0908-7000-8000-000000000023', 'moderator'
from public.events
where title = 'Visibility Controls Event';

select lives_ok(
  $$
    select public.update_draft_event_visibility_command(
      '01992026-0908-7000-8000-000000000021',
      (select id from public.events where title = 'Visibility Controls Event'),
      1,
      'public',
      '01992026-0908-7000-8000-000000000404'
    )
  $$,
  'an owner can change draft visibility'
);
select is(
  (select visibility from public.events where title = 'Visibility Controls Event'),
  'public',
  'the new visibility is stored'
);
select is(
  (select version from public.events where title = 'Visibility Controls Event'),
  2,
  'a visibility change increments the event version'
);
select is(
  (
    select count(*)
    from app_private.audit_events
    where action = 'event.visibility_changed'
      and safe_summary = '{"after":"public","before":"unlisted","version":2}'::jsonb
  ),
  1::bigint,
  'a visibility change records only its safe transition summary'
);
select lives_ok(
  $$
    select public.update_draft_event_visibility_command(
      '01992026-0908-7000-8000-000000000021',
      (select id from public.events where title = 'Visibility Controls Event'),
      2,
      'public',
      '01992026-0908-7000-8000-000000000405'
    )
  $$,
  'saving the existing visibility is an idempotent success'
);
select is(
  (select version from public.events where title = 'Visibility Controls Event'),
  2,
  'an idempotent visibility save does not increment the version'
);
select is(
  (select count(*) from app_private.audit_events where action = 'event.visibility_changed'),
  1::bigint,
  'an idempotent visibility save does not create an audit event'
);
select lives_ok(
  $$
    select public.update_draft_event_visibility_command(
      '01992026-0908-7000-8000-000000000022',
      (select id from public.events where title = 'Visibility Controls Event'),
      2,
      'unlisted',
      '01992026-0908-7000-8000-000000000406'
    )
  $$,
  'a co-host can change draft visibility'
);
select is(
  (select version from public.events where title = 'Visibility Controls Event'),
  3,
  'the co-host visibility change increments the version'
);
select throws_ok(
  $$
    select public.update_draft_event_visibility_command(
      '01992026-0908-7000-8000-000000000023',
      (select id from public.events where title = 'Visibility Controls Event'),
      3,
      'public',
      '01992026-0908-7000-8000-000000000407'
    )
  $$,
  'P0001',
  'Actor cannot manage event visibility',
  'a moderator cannot change event visibility'
);
select throws_ok(
  $$
    select public.update_draft_event_visibility_command(
      '01992026-0908-7000-8000-000000000024',
      (select id from public.events where title = 'Visibility Controls Event'),
      3,
      'public',
      '01992026-0908-7000-8000-000000000408'
    )
  $$,
  'P0001',
  'Actor cannot manage event visibility',
  'an unrelated account cannot change event visibility'
);
select throws_ok(
  $$
    select public.update_draft_event_visibility_command(
      '01992026-0908-7000-8000-000000000021',
      (select id from public.events where title = 'Visibility Controls Event'),
      2,
      'public',
      '01992026-0908-7000-8000-000000000409'
    )
  $$,
  'P0001',
  'Event version conflict',
  'a stale editor cannot overwrite a newer visibility'
);

update public.events set state = 'published' where title = 'Visibility Controls Event';
select throws_ok(
  $$
    select public.update_draft_event_visibility_command(
      '01992026-0908-7000-8000-000000000021',
      (select id from public.events where title = 'Visibility Controls Event'),
      3,
      'public',
      '01992026-0908-7000-8000-000000000410'
    )
  $$,
  'P0001',
  'Only draft event visibility can be edited directly',
  'published visibility requires the later revision workflow'
);

create temporary table deleted_fixture_id as
select id from public.events where title = 'Delete Controls Event';

select throws_ok(
  $$
    select public.delete_draft_event_command(
      '01992026-0908-7000-8000-000000000022',
      (select id from deleted_fixture_id),
      1,
      'Delete Controls Event',
      now(),
      '01992026-0908-7000-8000-000000000411'
    )
  $$,
  'P0001',
  'Only the event owner can delete a draft',
  'a co-host cannot delete a draft'
);
select throws_ok(
  $$
    select public.delete_draft_event_command(
      '01992026-0908-7000-8000-000000000021',
      (select id from deleted_fixture_id),
      1,
      'Wrong title',
      now(),
      '01992026-0908-7000-8000-000000000412'
    )
  $$,
  'P0001',
  'Event title confirmation does not match',
  'deletion requires the exact event title'
);
select throws_ok(
  $$
    select public.delete_draft_event_command(
      '01992026-0908-7000-8000-000000000021',
      (select id from deleted_fixture_id),
      2,
      'Delete Controls Event',
      now(),
      '01992026-0908-7000-8000-000000000413'
    )
  $$,
  'P0001',
  'Event version conflict',
  'deletion rejects a stale event version'
);
select throws_ok(
  $$
    select public.delete_draft_event_command(
      '01992026-0908-7000-8000-000000000021',
      (select id from deleted_fixture_id),
      1,
      'Delete Controls Event',
      now() - interval '16 minutes',
      '01992026-0908-7000-8000-000000000414'
    )
  $$,
  'P0001',
  'Recent authentication required',
  'deletion requires authentication within fifteen minutes'
);
select lives_ok(
  $$
    select public.delete_draft_event_command(
      '01992026-0908-7000-8000-000000000021',
      (select id from deleted_fixture_id),
      1,
      'Delete Controls Event',
      now(),
      '01992026-0908-7000-8000-000000000415'
    )
  $$,
  'the owner can delete a confirmed draft after recent authentication'
);
select is(
  (select count(*) from public.events where id = (select id from deleted_fixture_id)),
  0::bigint,
  'the draft is deleted'
);
select is(
  (
    select count(*)
    from public.event_registration_settings
    where event_id = (select id from deleted_fixture_id)
  ),
  0::bigint,
  'draft-owned registration settings are deleted with the draft'
);
select is(
  (
    select count(*)
    from app_private.audit_events
    where action = 'event.draft_deleted'
      and target_id = (select id from deleted_fixture_id)
      and event_id is null
      and safe_summary = '{"state":"draft","version":1,"visibility":"unlisted"}'::jsonb
  ),
  1::bigint,
  'the deletion audit survives without retaining user-authored event content'
);

select * from finish();
rollback;
