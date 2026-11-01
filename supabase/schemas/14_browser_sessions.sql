-- Browser credentials never enter public tables or browser-readable storage.
create table app_private.browser_sessions (
  session_hash text primary key check (session_hash ~ '^[a-f0-9]{64}$'),
  kind text not null check (kind in ('pending', 'authenticated')),
  encrypted_payload text not null check (char_length(encrypted_payload) between 40 and 24000),
  account_id uuid references public.profiles(account_id) on delete cascade,
  auth_session_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  lease_id uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  check ((kind = 'pending' and account_id is null and auth_session_id is null)
    or (kind = 'authenticated' and account_id is not null and auth_session_id is not null)),
  check (expires_at > created_at and expires_at <= created_at + interval '12 hours 1 minute')
);
alter table app_private.browser_sessions enable row level security;
alter table app_private.browser_sessions force row level security;
revoke all on app_private.browser_sessions from public, anon, authenticated;
create index browser_sessions_expiry on app_private.browser_sessions(expires_at);

create function public.store_browser_session_command(
  p_hash text, p_kind text, p_payload text, p_account_id uuid, p_auth_session_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Bound local pending-state growth; production needs per-subject admission limits.
  perform pg_advisory_xact_lock(91015, 1);
  delete from app_private.browser_sessions where expires_at <= clock_timestamp();
  if (select count(*) from app_private.browser_sessions) >= 1000 then
    raise exception 'Session capacity reached';
  end if;
  if p_kind = 'authenticated' and not exists (
    select 1 from auth.sessions where id = p_auth_session_id and user_id = p_account_id
  ) then raise exception 'Auth session unavailable'; end if;
  insert into app_private.browser_sessions(
    session_hash,kind,encrypted_payload,account_id,auth_session_id,expires_at
  ) values (
    p_hash,p_kind,p_payload,p_account_id,p_auth_session_id,
    clock_timestamp() + case when p_kind='pending' then interval '15 minutes' else interval '12 hours' end
  );
end;
$$;

create function public.take_browser_session_command(p_hash text, p_kind text, p_lease uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s app_private.browser_sessions;
begin
  select * into s from app_private.browser_sessions where session_hash=p_hash and kind=p_kind for update;
  if s.session_hash is null then return jsonb_build_object('state','missing'); end if;
  if s.expires_at <= clock_timestamp() or (s.kind='pending' and s.attempts >= 5)
    or (s.kind='authenticated' and not exists (
      select 1 from auth.sessions where id=s.auth_session_id and user_id=s.account_id
    )) then
    delete from app_private.browser_sessions where session_hash=p_hash;
    return jsonb_build_object('state','missing');
  end if;
  if s.lease_until > clock_timestamp() then return jsonb_build_object('state','busy'); end if;
  update app_private.browser_sessions set lease_id=p_lease, lease_until=clock_timestamp()+interval '30 seconds',
    attempts=attempts+case when kind='pending' then 1 else 0 end
  where session_hash=p_hash;
  return jsonb_build_object('state','ok','payload',s.encrypted_payload,
    'accountId',s.account_id,'authSessionId',s.auth_session_id);
end;
$$;

create function public.release_browser_session_command(p_hash text,p_lease uuid,p_payload text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update app_private.browser_sessions
  set encrypted_payload=coalesce(p_payload,encrypted_payload),lease_id=null,lease_until=null
  where session_hash=p_hash and lease_id=p_lease and lease_until > clock_timestamp()
    and expires_at > clock_timestamp();
  return found;
end;
$$;

create function public.delete_browser_session_command(p_hash text)
returns void language sql security definer set search_path = '' as $$
  delete from app_private.browser_sessions where session_hash=p_hash;
$$;

create function app_private.purge_expired_browser_sessions()
returns void language sql security definer set search_path = '' as $$
  delete from app_private.browser_sessions where expires_at <= clock_timestamp();
$$;
select cron.schedule('promenadis-browser-session-expiry','* * * * *',
  'select app_private.purge_expired_browser_sessions();');

revoke all on function public.store_browser_session_command(text,text,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.take_browser_session_command(text,text,uuid) from public,anon,authenticated;
revoke all on function public.release_browser_session_command(text,uuid,text) from public,anon,authenticated;
revoke all on function public.delete_browser_session_command(text) from public,anon,authenticated;
revoke all on function app_private.purge_expired_browser_sessions() from public,anon,authenticated;
grant execute on function public.store_browser_session_command(text,text,text,uuid,uuid) to service_role;
grant execute on function public.take_browser_session_command(text,text,uuid) to service_role;
grant execute on function public.release_browser_session_command(text,uuid,text) to service_role;
grant execute on function public.delete_browser_session_command(text) to service_role;
