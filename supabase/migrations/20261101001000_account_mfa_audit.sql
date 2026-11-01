-- TOTP factors live in Supabase Auth. Promenadis only gates changes on recent
-- authentication and audits them; no secret, code or factor ID is copied.
create function public.assert_recent_authentication_command(p_authenticated_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_recent_authentication(p_authenticated_at);
end;
$$;

create function public.record_account_mfa_event_command(
  p_actor_id uuid, p_action text, p_correlation_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_action not in ('account.mfa_totp_enrollment_started', 'account.mfa_totp_verified',
    'account.mfa_totp_removed')
  then raise exception 'Unsupported MFA audit action'; end if;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, p_action, 'account', p_actor_id, '{}'::jsonb);
end;
$$;

revoke all on function public.assert_recent_authentication_command(timestamptz) from public,anon,authenticated;
revoke all on function public.record_account_mfa_event_command(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.assert_recent_authentication_command(timestamptz) to service_role;
grant execute on function public.record_account_mfa_event_command(uuid,text,uuid) to service_role;
