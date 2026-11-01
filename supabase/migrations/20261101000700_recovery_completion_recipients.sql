-- Fix: completion recipients were deduplicated by UNION over rows that also
-- carried clock_timestamp(), which differs per row, so an owner who is also
-- listed through their own event membership got two jobs and completion failed
-- on the per-recipient unique key. Deduplicate account IDs before stamping.
create or replace function app_private.resolve_recovery_dispatch(p_dispatch_id uuid, p_correlation_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  dispatch app_private.account_recovery_dispatches;
  claim app_private.account_recovery_claims;
  current_email text;
  revoked integer;
begin
  select * into dispatch from app_private.account_recovery_dispatches where id = p_dispatch_id;
  if dispatch.id is null then raise exception 'Recovery dispatch unavailable'; end if;
  perform 1 from app_private.account_recovery_codes where account_id = dispatch.account_id for update;
  select * into claim from app_private.account_recovery_claims where id = dispatch.claim_id for update;
  -- Waits for any Auth transaction that passed the fence trigger to finish.
  select * into dispatch from app_private.account_recovery_dispatches where id = p_dispatch_id for update;
  if dispatch.state <> 'dispatching' then return dispatch.state; end if;

  select lower(email) into current_email from auth.users where id = dispatch.account_id;
  if claim.id is not null and current_email = claim.new_email then
    -- Old access ends with the email change. Refresh tokens cascade from
    -- sessions; the BFF rejects access JWTs whose session no longer exists.
    delete from auth.sessions where user_id = dispatch.account_id;
    get diagnostics revoked = row_count;
    delete from app_private.browser_sessions where account_id = dispatch.account_id;
    update app_private.account_recovery_dispatches
    set state = 'applied', resolved_at = clock_timestamp() where id = dispatch.id;

    update app_private.notification_jobs set cancelled_at = clock_timestamp()
    where source_id = claim.id and completed_at is null and cancelled_at is null;
    insert into app_private.notification_jobs (
      correlation_id, source_id, event_id, recipient_account_id,
      template_key, available_at, created_at, expires_at
    )
    select p_correlation_id, claim.id, null::uuid, recipient.account_id,
      'account_recovery_completed', clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '30 days'
    from (
      select membership.account_id
      from public.event_memberships as owner_membership
      join public.event_memberships as membership on membership.event_id = owner_membership.event_id
      where owner_membership.account_id = dispatch.account_id and owner_membership.role = 'owner'
      union
      select dispatch.account_id
    ) as recipient;

    insert into app_private.audit_events(correlation_id,actor_account_id,action,target_type,target_id,safe_summary)
    values(p_correlation_id, null, 'account.recovery_completed', 'account_recovery_claim', claim.id,
      jsonb_build_object('revokedSessions', revoked));
    delete from app_private.account_recovery_claims where id = claim.id;
    return 'applied';
  end if;

  if dispatch.lease_until > clock_timestamp() then return 'dispatching'; end if;
  -- Lease expired and Auth unchanged: the fence now rejects any late request.
  update app_private.account_recovery_dispatches
  set state = 'not_applied', resolved_at = clock_timestamp() where id = dispatch.id;
  insert into app_private.audit_events(correlation_id,actor_account_id,action,target_type,target_id,safe_summary)
  values(p_correlation_id, null, 'account.recovery_dispatch_not_applied', 'account_recovery_claim',
    dispatch.claim_id, '{}'::jsonb);
  return 'not_applied';
end;
$$;
