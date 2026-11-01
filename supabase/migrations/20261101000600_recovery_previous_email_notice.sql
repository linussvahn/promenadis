-- After a recovery applies, the previous address is the only channel left to
-- reach a legitimate owner who was locked out. Keep that one address only for
-- one completion notice: deleted on delivery, cancellation or job removal, and
-- never longer than 72 hours. The outbox row itself still holds no address.
alter table app_private.notification_jobs
  drop constraint notification_jobs_template_key_check;
alter table app_private.notification_jobs
  add constraint notification_jobs_template_key_check check (
    template_key in (
      'event_emergency_claim_started',
      'event_emergency_claim_ready',
      'event_emergency_claim_cancelled',
      'event_emergency_claim_completed',
      'event_emergency_claim_expired',
      'account_recovery_verify_new_email',
      'account_recovery_started',
      'account_recovery_cancelled',
      'account_recovery_completed',
      'account_recovery_completed_previous_email',
      'account_recovery_expired'
    )
  );

create table app_private.recovery_previous_email_notices (
  job_id uuid primary key references app_private.notification_jobs (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '72 hours')
);
create index recovery_previous_email_notices_expiry
on app_private.recovery_previous_email_notices (expires_at);
alter table app_private.recovery_previous_email_notices enable row level security;
alter table app_private.recovery_previous_email_notices force row level security;
revoke all on app_private.recovery_previous_email_notices from public, anon, authenticated;

-- Fires when an applied recovery erases its claim: after resolution has
-- cancelled the claim's outstanding jobs, while the original email still exists.
create function app_private.queue_recovery_previous_email_notice()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  dispatch app_private.account_recovery_dispatches;
  job uuid;
begin
  select * into dispatch from app_private.account_recovery_dispatches
  where claim_id = old.id and state = 'applied';
  if dispatch.id is null or old.original_email is null then return old; end if;
  insert into app_private.notification_jobs (
    correlation_id, source_id, event_id, recipient_account_id,
    template_key, available_at, created_at, expires_at
  ) values (
    dispatch.operation_id, old.id, null, old.account_id,
    'account_recovery_completed_previous_email', clock_timestamp(), clock_timestamp(),
    clock_timestamp() + interval '72 hours'
  ) returning id into job;
  insert into app_private.recovery_previous_email_notices (job_id, email, expires_at)
  values (job, old.original_email, clock_timestamp() + interval '72 hours');
  return old;
end;
$$;
-- Runs after account_recovery_claims_block_delete_during_dispatch (name order).
create trigger account_recovery_claims_queue_previous_email
before delete on app_private.account_recovery_claims
for each row execute function app_private.queue_recovery_previous_email_notice();

create function app_private.erase_recovery_previous_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from app_private.recovery_previous_email_notices where job_id = new.id;
  return new;
end;
$$;
create trigger notification_jobs_erase_previous_email
after update of completed_at, cancelled_at on app_private.notification_jobs
for each row when (new.template_key = 'account_recovery_completed_previous_email'
  and (new.completed_at is not null or new.cancelled_at is not null))
execute function app_private.erase_recovery_previous_email();

create function app_private.purge_expired_recovery_previous_emails_command()
returns void language sql security definer set search_path = '' as $$
  delete from app_private.recovery_previous_email_notices where expires_at <= clock_timestamp();
$$;
select cron.schedule(
  'promenadis-purge-expired-recovery-previous-emails',
  '17 * * * *',
  'select app_private.purge_expired_recovery_previous_emails_command();'
);

-- The previous-address notice resolves only from its private binding; every
-- other template keeps its existing recipient rules.
create or replace function public.resolve_security_notification_recipient(p_job_id uuid,p_lease_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'email', case
      when j.template_key = 'account_recovery_completed_previous_email' then b.email
      when j.template_key = 'account_recovery_started' and c.account_id = j.recipient_account_id
      then c.original_email else u.email end,
    'locale', p.preferred_locale)
  from app_private.notification_jobs j
  join auth.users u on u.id = j.recipient_account_id
  join public.profiles p on p.account_id = u.id
  left join app_private.account_recovery_claims c on c.id = j.source_id
  left join app_private.recovery_previous_email_notices b on b.job_id = j.id
  where j.id = p_job_id and j.delivery_lease_id = p_lease_id
    and j.delivery_lease_until > clock_timestamp() and j.expires_at > clock_timestamp()
    and j.cancelled_at is null and j.completed_at is null
    and (
      (j.template_key = 'account_recovery_completed_previous_email'
        and b.job_id is not null and b.expires_at > clock_timestamp())
      or (j.template_key <> 'account_recovery_completed_previous_email'
        and u.email_confirmed_at is not null and u.email is not null
        and (j.template_key <> 'account_recovery_started' or
          (c.id is not null and c.original_email is not null and c.expires_at > clock_timestamp())))
    );
$$;

revoke all on function app_private.queue_recovery_previous_email_notice() from public,anon,authenticated;
revoke all on function app_private.erase_recovery_previous_email() from public,anon,authenticated;
revoke all on function app_private.purge_expired_recovery_previous_emails_command() from public,anon,authenticated;
revoke all on function public.resolve_security_notification_recipient(uuid,uuid) from public,anon,authenticated;
grant execute on function public.resolve_security_notification_recipient(uuid,uuid) to service_role;

comment on table app_private.recovery_previous_email_notices is
  'Previous sign-in address for one post-recovery notice; erased on delivery/cancellation, at most 72 hours.';
