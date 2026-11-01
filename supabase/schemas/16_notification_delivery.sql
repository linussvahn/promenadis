-- Delivery bookkeeping contains no addresses, message bodies or provider errors.
alter table app_private.notification_jobs
  add column delivery_lease_id uuid,
  add column delivery_lease_until timestamptz,
  add constraint notification_delivery_lease_pair check (
    (delivery_lease_id is null) = (delivery_lease_until is null)
  );

-- Verification links use the existing explicit adapter; never claim them here.
create function public.claim_security_notification_jobs(p_limit integer default 10)
returns table(job_id uuid, lease_id uuid, template_key text, recipient_account_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 25 then
    raise exception 'Invalid notification batch size';
  end if;
  return query
  with candidates as (
    select j.id from app_private.notification_jobs j
    where j.recipient_account_id is not null
      and j.template_key <> 'account_recovery_verify_new_email'
      and j.cancelled_at is null and j.completed_at is null
      and j.expires_at > clock_timestamp()
      and j.available_at <= clock_timestamp()
      and j.attempt_count < 5
      and (j.delivery_lease_until is null or j.delivery_lease_until <= clock_timestamp())
    order by j.available_at, j.id
    limit p_limit for update skip locked
  )
  update app_private.notification_jobs j
  set delivery_lease_id = extensions.gen_random_uuid(),
      delivery_lease_until = clock_timestamp() + interval '2 minutes',
      attempt_count = j.attempt_count + 1
  from candidates c where j.id = c.id
  returning j.id, j.delivery_lease_id, j.template_key, j.recipient_account_id;
end;
$$;

-- A stable job ID is the delivery idempotency key. Provider acceptance followed
-- by a lost acknowledgement can still duplicate mail without provider dedupe.
create function public.finish_security_notification_job(
  p_job_id uuid, p_lease_id uuid, p_delivered boolean
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if p_delivered is null then return false; end if;
  update app_private.notification_jobs j
  set completed_at = case when p_delivered then clock_timestamp() else null end,
      available_at = case when p_delivered then j.available_at
        else clock_timestamp() + interval '1 minute' * power(2, j.attempt_count - 1) end,
      delivery_lease_id = null, delivery_lease_until = null
  where j.id = p_job_id and j.delivery_lease_id = p_lease_id
    and j.delivery_lease_until > clock_timestamp()
    and j.expires_at > clock_timestamp()
    and j.cancelled_at is null and j.completed_at is null;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.claim_security_notification_jobs(integer) from public, anon, authenticated;
revoke all on function public.finish_security_notification_job(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_security_notification_jobs(integer) to service_role;
grant execute on function public.finish_security_notification_job(uuid,uuid,boolean) to service_role;
