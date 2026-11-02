-- Optional "Registered organization verified" badge for association/company
-- organizers. A reviewer checks the official register by hand and confirms the
-- claimant's control; Promenadis stores only the outcome, never documents or
-- confirmation-message content. The badge proves that check, nothing more.

-- Same rule as packages/domain organization-number.ts: ten digits, Luhn, and
-- third digit >= 2 so a personal identity number is never accepted.
create function app_private.valid_organization_number(p_value text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  digits text := replace(coalesce(p_value, ''), '-', '');
  total integer := 0;
  product integer;
begin
  if p_value !~ '^[0-9]{6}-[0-9]{4}$' or substr(digits, 3, 1)::integer < 2 then return false; end if;
  for position in 1..9 loop
    product := substr(digits, position, 1)::integer * case when position % 2 = 1 then 2 else 1 end;
    total := total + case when product > 9 then product - 9 else product end;
  end loop;
  return (10 - total % 10) % 10 = substr(digits, 10, 1)::integer;
end;
$$;

create table app_private.organizer_verifications (
  organizer_profile_id uuid primary key references public.organizer_profiles (id) on delete cascade,
  organization_number text not null check (app_private.valid_organization_number(organization_number)),
  control_method text not null check (control_method in ('organization_email', 'official_website', 'official_contact')),
  -- A domain, website or where the official contact was sourced. Not message content.
  control_reference text not null check (char_length(btrim(control_reference)) between 3 and 200),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected', 'revoked')),
  requested_at timestamptz not null default clock_timestamp(),
  requested_by_account_id uuid references public.profiles (account_id) on delete set null,
  registered_name text check (registered_name is null or char_length(btrim(registered_name)) between 1 and 200),
  registry_source text check (registry_source is null or registry_source = 'bolagsverket'),
  decided_at timestamptz,
  reviewer_account_id uuid references public.profiles (account_id) on delete set null,
  reason text check (reason is null or char_length(btrim(reason)) between 3 and 500),
  recheck_due_at timestamptz,
  check ((status = 'pending') = (decided_at is null)),
  check (status <> 'verified' or (registered_name is not null and registry_source is not null and recheck_due_at is not null)),
  check (status not in ('rejected', 'revoked') or reason is not null)
);
alter table app_private.organizer_verifications enable row level security;
alter table app_private.organizer_verifications force row level security;
revoke all on app_private.organizer_verifications from public, anon, authenticated;

create function app_private.organizer_verification_status(p_organizer_profile_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', coalesce(v.status, 'none'),
    'badge', coalesce(v.status = 'verified' and v.recheck_due_at > clock_timestamp(), false),
    'organizationNumber', v.organization_number,
    'registeredName', case when v.status = 'verified' then v.registered_name end,
    'recheckDueAt', case when v.status = 'verified' then v.recheck_due_at end,
    'reason', case when v.status in ('rejected', 'revoked') then v.reason end)
  from (select p_organizer_profile_id as id) as requested
  left join app_private.organizer_verifications v on v.organizer_profile_id = requested.id;
$$;

create function public.get_organizer_verification_command(p_actor_id uuid, p_organizer_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizer_profile_memberships
    where organizer_profile_id = p_organizer_profile_id and account_id = p_actor_id)
  then raise exception 'Organizer profile not found'; end if;
  return app_private.organizer_verification_status(p_organizer_profile_id);
end;
$$;

create function public.request_organizer_verification_command(
  p_actor_id uuid, p_organizer_profile_id uuid, p_organization_number text,
  p_control_method text, p_control_reference text, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  organizer public.organizer_profiles;
  existing app_private.organizer_verifications;
begin
  if not exists (select 1 from public.organizer_profile_memberships
    where organizer_profile_id = p_organizer_profile_id and account_id = p_actor_id)
  then raise exception 'Organizer profile not found'; end if;
  select * into organizer from public.organizer_profiles where id = p_organizer_profile_id for update;
  if organizer.organizer_type not in ('association', 'company') then
    raise exception 'Only associations and companies can be verified';
  end if;
  if not app_private.valid_organization_number(p_organization_number) then
    raise exception 'Invalid organization number';
  end if;
  select * into existing from app_private.organizer_verifications
  where organizer_profile_id = p_organizer_profile_id for update;
  if existing.status in ('pending', 'verified') then raise exception 'Verification already requested'; end if;
  insert into app_private.organizer_verifications (
    organizer_profile_id, organization_number, control_method, control_reference, requested_by_account_id
  ) values (p_organizer_profile_id, p_organization_number, p_control_method, btrim(p_control_reference), p_actor_id)
  on conflict (organizer_profile_id) do update set
    organization_number = excluded.organization_number, control_method = excluded.control_method,
    control_reference = excluded.control_reference, requested_by_account_id = excluded.requested_by_account_id,
    status = 'pending', requested_at = clock_timestamp(), registered_name = null, registry_source = null,
    decided_at = null, reviewer_account_id = null, reason = null, recheck_due_at = null;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'organizer.verification_requested', 'organizer_profile', p_organizer_profile_id,
    jsonb_build_object('controlMethod', p_control_method));
  return app_private.organizer_verification_status(p_organizer_profile_id);
end;
$$;

create function public.list_organizer_verifications_command(
  p_actor_id uuid, p_auth_session_id uuid, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  select coalesce(jsonb_agg(jsonb_build_object(
      'organizerProfileId', o.id, 'displayName', o.display_name, 'organizerType', o.organizer_type,
      'website', o.website, 'organizationNumber', v.organization_number,
      'controlMethod', v.control_method, 'controlReference', v.control_reference,
      'requestedAt', v.requested_at,
      'ownOrganizer', exists (select 1 from public.organizer_profile_memberships m
        where m.organizer_profile_id = o.id and m.account_id = p_actor_id))
    order by v.requested_at), '[]'::jsonb)
  into result
  from app_private.organizer_verifications v
  join public.organizer_profiles o on o.id = v.organizer_profile_id
  where v.status = 'pending';
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.organizer_verification_queue_read', 'account', p_actor_id,
    jsonb_build_object('count', jsonb_array_length(result)));
  return result;
end;
$$;

-- Verify needs the registry name, an active registry status and confirmed
-- control; reject/revoke need a reason. Managers of the organizer cannot decide.
create function public.decide_organizer_verification_command(
  p_actor_id uuid, p_auth_session_id uuid, p_organizer_profile_id uuid, p_decision text,
  p_registered_name text, p_registry_active boolean, p_control_confirmed boolean,
  p_reason text, p_correlation_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare verification app_private.organizer_verifications;
begin
  perform app_private.require_admin_elevation(p_actor_id, p_auth_session_id);
  if exists (select 1 from public.organizer_profile_memberships
    where organizer_profile_id = p_organizer_profile_id and account_id = p_actor_id)
  then raise exception 'Cannot review own organizer'; end if;
  select * into verification from app_private.organizer_verifications
  where organizer_profile_id = p_organizer_profile_id for update;
  if verification.organizer_profile_id is null then raise exception 'Verification unavailable'; end if;
  if p_decision = 'verified' then
    if verification.status <> 'pending' or char_length(btrim(coalesce(p_registered_name, ''))) not between 1 and 200
      or p_registry_active is not true or p_control_confirmed is not true
    then raise exception 'Invalid verification decision'; end if;
    update app_private.organizer_verifications set status = 'verified', registered_name = btrim(p_registered_name),
      registry_source = 'bolagsverket', decided_at = clock_timestamp(), reviewer_account_id = p_actor_id,
      reason = null, recheck_due_at = clock_timestamp() + interval '1 year'
    where organizer_profile_id = p_organizer_profile_id;
  elsif p_decision in ('rejected', 'revoked') then
    if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500
      or (p_decision = 'rejected' and verification.status <> 'pending')
      or (p_decision = 'revoked' and verification.status <> 'verified')
    then raise exception 'Invalid verification decision'; end if;
    update app_private.organizer_verifications set status = p_decision, decided_at = clock_timestamp(),
      reviewer_account_id = p_actor_id, reason = btrim(p_reason), recheck_due_at = null
    where organizer_profile_id = p_organizer_profile_id;
  else
    raise exception 'Invalid verification decision';
  end if;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'admin.organizer_verification_decided', 'organizer_profile',
    p_organizer_profile_id, jsonb_build_object('decision', p_decision));
end;
$$;

-- A material change to a verified identity sends it back for review.
create function app_private.recheck_verification_on_material_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.display_name is distinct from old.display_name or new.organizer_type is distinct from old.organizer_type then
    update app_private.organizer_verifications set status = 'pending', requested_at = clock_timestamp(),
      decided_at = null, reviewer_account_id = null, reason = null, recheck_due_at = null
    where organizer_profile_id = new.id and status = 'verified';
  end if;
  return new;
end;
$$;
create trigger organizer_profiles_verification_recheck
after update of display_name, organizer_type on public.organizer_profiles
for each row execute function app_private.recheck_verification_on_material_change();

-- Rejected/revoked outcomes are kept 30 days so the managers can read the reason.
create function app_private.purge_closed_organizer_verifications_command()
returns void language sql security definer set search_path = '' as $$
  delete from app_private.organizer_verifications
  where status in ('rejected', 'revoked') and decided_at <= clock_timestamp() - interval '30 days';
$$;
select cron.schedule('promenadis-purge-closed-organizer-verifications', '29 * * * *',
  'select app_private.purge_closed_organizer_verifications_command();');

revoke all on function app_private.valid_organization_number(text) from public,anon,authenticated;
revoke all on function app_private.organizer_verification_status(uuid) from public,anon,authenticated;
revoke all on function app_private.recheck_verification_on_material_change() from public,anon,authenticated;
revoke all on function app_private.purge_closed_organizer_verifications_command() from public,anon,authenticated;
revoke all on function public.get_organizer_verification_command(uuid,uuid) from public,anon,authenticated;
revoke all on function public.request_organizer_verification_command(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.list_organizer_verifications_command(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.decide_organizer_verification_command(uuid,uuid,uuid,text,text,boolean,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.get_organizer_verification_command(uuid,uuid) to service_role;
grant execute on function public.request_organizer_verification_command(uuid,uuid,text,text,text,uuid) to service_role;
grant execute on function public.list_organizer_verifications_command(uuid,uuid,uuid) to service_role;
grant execute on function public.decide_organizer_verification_command(uuid,uuid,uuid,text,text,boolean,boolean,text,uuid) to service_role;

comment on table app_private.organizer_verifications is
  'Registered-organization check outcome only: number, control method/reference, registry name/source, reviewer and dates. No documents or message content.';
