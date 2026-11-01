-- Keep the original destination only for the lifetime of the private claim
-- (at most seven days). Do not guess historical addresses for existing claims.
alter table app_private.account_recovery_claims
  add column original_email text,
  add column required_notice_count integer not null default 0 check (required_notice_count >= 0);

create function app_private.bind_recovery_original_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select lower(u.email) into new.original_email from auth.users u
  where u.id = new.account_id and u.email_confirmed_at is not null for share;
  if new.original_email is null then raise exception 'Invalid recovery request'; end if;
  new.required_notice_count := 0;
  return new;
end;
$$;
create trigger recovery_claim_bind_original_email
before insert on app_private.account_recovery_claims
for each row execute function app_private.bind_recovery_original_email();

-- Counting the initial recipient set prevents deletion of a job from silently
-- weakening the delivery prerequisite. No extra copy of team identities.
create function app_private.record_recovery_notice_requirement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.template_key = 'account_recovery_started' then
    update app_private.account_recovery_claims
    set required_notice_count = required_notice_count + 1
    where id = new.source_id and original_email is not null;
  end if;
  return new;
end;
$$;
create trigger recovery_notice_requirement
after insert on app_private.notification_jobs
for each row execute function app_private.record_recovery_notice_requirement();

create function public.resolve_security_notification_recipient(p_job_id uuid,p_lease_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'email', case when j.template_key = 'account_recovery_started' and c.account_id = j.recipient_account_id
      then c.original_email else u.email end,
    'locale', p.preferred_locale)
  from app_private.notification_jobs j
  join auth.users u on u.id = j.recipient_account_id
  join public.profiles p on p.account_id = u.id
  left join app_private.account_recovery_claims c on c.id = j.source_id
  where j.id = p_job_id and j.delivery_lease_id = p_lease_id
    and j.delivery_lease_until > clock_timestamp() and j.expires_at > clock_timestamp()
    and j.cancelled_at is null and j.completed_at is null
    and u.email_confirmed_at is not null and u.email is not null
    and (j.template_key <> 'account_recovery_started' or
      (c.id is not null and c.original_email is not null and c.expires_at > clock_timestamp()));
$$;

-- Mail acceptance evidence only. This does NOT authorize Auth mutation, prove
-- inbox receipt, or replace the verification/delay/revocation/concurrency gates.
create function public.account_recovery_notices_accepted(p_claim_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from app_private.account_recovery_claims c
    where c.id = p_claim_id and c.original_email is not null
      and c.expires_at > clock_timestamp() and c.required_notice_count > 0
      and c.required_notice_count = (
        select count(*) from app_private.notification_jobs j
        where j.source_id = c.id and j.template_key = 'account_recovery_started'
          and j.completed_at >= c.initiated_at and j.cancelled_at is null
      )
      and exists (
        select 1 from app_private.notification_jobs j
        where j.source_id = c.id and j.template_key = 'account_recovery_started'
          and j.recipient_account_id = c.account_id and j.completed_at >= c.initiated_at
          and j.cancelled_at is null
      )
  );
$$;

revoke all on function app_private.bind_recovery_original_email() from public,anon,authenticated;
revoke all on function app_private.record_recovery_notice_requirement() from public,anon,authenticated;
revoke all on function public.resolve_security_notification_recipient(uuid,uuid) from public,anon,authenticated;
revoke all on function public.account_recovery_notices_accepted(uuid) from public,anon,authenticated;
grant execute on function public.resolve_security_notification_recipient(uuid,uuid) to service_role;
grant execute on function public.account_recovery_notices_accepted(uuid) to service_role;
