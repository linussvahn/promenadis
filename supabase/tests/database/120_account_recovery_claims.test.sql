begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  not has_table_privilege('authenticated', 'app_private.account_recovery_claims', 'SELECT'),
  'authenticated clients cannot read recovery claims directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.initiate_account_recovery_claim_command(text,text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass recovery initiation'
);
select ok(
  to_regprocedure('public.finalize_account_recovery_command(uuid,text,uuid)') is null,
  'Auth rebinding is absent from this local verification slice'
);

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values (
  '01992026-0909-7200-8000-000000000101',
  'recovery-owner@example.invalid', now(), now(), now()
);
select public.create_organizer_profile_command(
  '01992026-0909-7200-8000-000000000101',
  'Recovery Owner', 'individual', '', '',
  '01992026-0909-7200-8000-000000000111'
);
select public.create_scheduled_draft_event_command(
  '01992026-0909-7200-8000-000000000101',
  (select id from public.organizer_profiles where display_name = 'Recovery Owner'),
  '', 'Account Recovery Fixture', '', 'Europe/Stockholm', 'unlisted',
  '2031-09-09 10:00:00+02', '2031-09-09 15:00:00+02',
  '01992026-0909-7200-8000-000000000112'
);
select public.enroll_account_recovery_code_command(
  '01992026-0909-7200-8000-000000000101',
  'ABCD-EFGH-JKLM-NPQR-STUV', 0, now(),
  '01992026-0909-7200-8000-000000000113'
);

select throws_ok(
  $$select public.initiate_account_recovery_claim_command(
    'recovery-owner@example.invalid', '2345-6789-ABCD-EFGH-JKLM', null,
    'replacement@example.invalid', repeat('x', 43),
    '01992026-0909-7200-8000-000000000114'
  )$$,
  'P0001', 'Invalid recovery request',
  'an incorrect recovery code is rejected generically'
);
select lives_ok(
  $$select public.initiate_account_recovery_claim_command(
    'recovery-owner@example.invalid', 'ABCD-EFGH-JKLM-NPQR-STUV', null,
    'replacement@example.invalid', repeat('x', 43),
    '01992026-0909-7200-8000-000000000115'
  )$$,
  'a valid owner recovery request starts'
);
select ok(
  (select verification_token_hash <> repeat('x', 43)
   from app_private.account_recovery_claims),
  'the email-verification token is stored only as a hash'
);
select ok(
  (select ready_at >= initiated_at + interval '24 hours'
   from app_private.account_recovery_claims),
  'recovery cannot mature before 24 hours'
);
select ok(
  (select expires_at <= initiated_at + interval '7 days 1 minute'
   from app_private.account_recovery_claims),
  'recovery expires within seven days'
);
select ok(
  (select used_at is null from app_private.account_recovery_codes),
  'initiation does not consume the recovery code before email verification'
);
select is(
  public.get_account_security_command('01992026-0909-7200-8000-000000000101')
    #>> '{pendingClaim,newEmailMasked}',
  'r***@example.invalid',
  'the signed-in owner sees only a masked replacement email'
);
select is(
  (select count(*) from app_private.notification_jobs
   where template_key = 'account_recovery_verify_new_email'),
  1::bigint,
  'one new-email verification intent is queued without a copied recipient email'
);
select throws_ok(
  $$select public.confirm_account_recovery_email_command(
    (select id from app_private.account_recovery_claims), repeat('y', 43),
    '01992026-0909-7200-8000-000000000116'
  )$$,
  'P0001', 'Recovery claim unavailable',
  'an incorrect verification token is rejected'
);
select lives_ok(
  $$select public.confirm_account_recovery_email_command(
    (select id from app_private.account_recovery_claims), repeat('x', 43),
    '01992026-0909-7200-8000-000000000117'
  )$$,
  'the emailed token verifies the replacement address'
);
select ok(
  (select used_at is not null from app_private.account_recovery_codes),
  'email verification consumes the single-use recovery code'
);

select ok(
  (select ready_at >= email_verified_at + interval '24 hours' from app_private.account_recovery_claims),
  'the full waiting period begins at email verification'
);
select throws_ok(
  $$select public.confirm_account_recovery_email_command(
    (select id from app_private.account_recovery_claims), null, gen_random_uuid()
  )$$, 'P0001', 'Recovery claim unavailable', 'null cannot bypass token verification'
);
select lives_ok(
  $$select public.confirm_account_recovery_email_command(
    (select id from app_private.account_recovery_claims), repeat('x',43), gen_random_uuid()
  )$$, 'email verification is idempotent'
);
select throws_ok(
  $$select public.cancel_account_recovery_claim_command(
    '01992026-0909-7200-8000-000000000101',
    (select id from app_private.account_recovery_claims),
    now() - interval '1 day', gen_random_uuid()
  )$$, 'P0001', 'Recent authentication required', 'cancellation requires recent authentication'
);
select throws_ok(
  $$select public.cancel_account_recovery_claim_command(
    '01992026-0909-7200-8000-000000000999',
    (select id from app_private.account_recovery_claims), now(), gen_random_uuid()
  )$$, 'P0001', 'Recovery claim unavailable', 'another account cannot cancel the request'
);
select lives_ok(
  $$select public.cancel_account_recovery_claim_command(
    '01992026-0909-7200-8000-000000000101',
    (select id from app_private.account_recovery_claims), now(), gen_random_uuid()
  )$$, 'the signed-in owner can cancel a verified request'
);
select is((select count(*) from app_private.account_recovery_claims), 0::bigint,
  'cancellation immediately deletes the replacement email and token hash');
select ok((select used_at is not null from app_private.account_recovery_codes),
  'cancellation does not reactivate a consumed code');
select is((select email from auth.users where id='01992026-0909-7200-8000-000000000101'),
  'recovery-owner@example.invalid', 'verification never changes the Auth email');

select public.enroll_account_recovery_code_command(
  '01992026-0909-7200-8000-000000000101', '2345-6789-ABCD-EFGH-JKLM', 1, now(), gen_random_uuid()
);
select public.initiate_account_recovery_claim_command(
  'recovery-owner@example.invalid', '2345-6789-ABCD-EFGH-JKLM', null,
  'replacement@example.invalid', repeat('x',43), gen_random_uuid()
);
select public.enroll_account_recovery_code_command(
  '01992026-0909-7200-8000-000000000101', 'ABCD-EFGH-JKLM-NPQR-STUV', 2, now(), gen_random_uuid()
);
select is((select count(*) from app_private.account_recovery_claims), 0::bigint,
  'code rotation invalidates and deletes unverified requests');
select public.initiate_account_recovery_claim_command(
  'recovery-owner@example.invalid', 'ABCD-EFGH-JKLM-NPQR-STUV', null,
  'replacement@example.invalid', repeat('x',43), gen_random_uuid()
);
select public.confirm_account_recovery_email_command(
  (select id from app_private.account_recovery_claims), repeat('x',43), gen_random_uuid()
);
select public.enroll_account_recovery_code_command(
  '01992026-0909-7200-8000-000000000101', '2345-6789-ABCD-EFGH-JKLM', 3, now(), gen_random_uuid()
);
select is((select count(*) from app_private.account_recovery_claims), 0::bigint,
  'code rotation also deletes verified pending requests');
select public.initiate_account_recovery_claim_command(
  'recovery-owner@example.invalid', '2345-6789-ABCD-EFGH-JKLM', null,
  'replacement@example.invalid', repeat('x',43), gen_random_uuid()
);
update app_private.account_recovery_claims set
  initiated_at=clock_timestamp()-interval '6 days 12 hours',
  ready_at=clock_timestamp()-interval '5 days',
  expires_at=clock_timestamp()+interval '12 hours';
select throws_ok(
  $$select public.confirm_account_recovery_email_command(
    (select id from app_private.account_recovery_claims), repeat('x',43), gen_random_uuid()
  )$$, 'P0001', 'Recovery claim unavailable', 'late verification cannot shorten the waiting period'
);
update app_private.account_recovery_claims set
  initiated_at=clock_timestamp()-interval '8 days',
  ready_at=clock_timestamp()-interval '7 days',
  expires_at=clock_timestamp()-interval '2 days';
select app_private.purge_expired_account_recovery_claims_command();
select is((select count(*) from app_private.account_recovery_claims), 0::bigint,
  'expiry purges the replacement email and hash');
select ok(not exists (
  select 1 from app_private.audit_events where action like 'account.recovery%'
  and (safe_summary::text like '%@%' or safe_summary::text like '%ABCD%' or safe_summary::text like '%xxxx%')
), 'audit summaries contain no email, code, or verification secret');
select public.consume_local_recovery_budget_command() from generate_series(1,60);
select is(public.consume_local_recovery_budget_command(),false,'the local budget limits expensive anonymous work');
update app_private.local_recovery_budget set window_started_at=clock_timestamp()-interval '11 minutes';
select is(public.consume_local_recovery_budget_command(),true,'the local budget resets without retaining identities');

select * from finish();
rollback;
