-- Applies to cookie-bridged AND direct bearer requests. A valid JWT alone is
-- insufficient after logout; no provider-managed Auth tables are modified.
create function public.is_active_auth_session(p_account_id uuid, p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions
    where id = p_session_id and user_id = p_account_id
      and (not_after is null or not_after > statement_timestamp())
  );
$$;
revoke all on function public.is_active_auth_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.is_active_auth_session(uuid,uuid) to service_role;
comment on function public.is_active_auth_session(uuid,uuid) is
  'Service-only live Auth-session/account binding; no token or identity data is returned.';
