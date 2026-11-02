-- Milestone 6: the snapshot read also checks the event's current hard
-- expiry, not only the expiry stored when the snapshot was built, so a
-- schedule shortened after a build never serves locations past the new end.
create or replace function public.public_snapshot_command(p_snapshot_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('body', s.body, 'sha256', s.sha256,
    'expiresAt', least(s.expires_at, app_private.public_expiry(s.event_id)),
    'unlisted', e.visibility = 'unlisted')
  from app_private.public_snapshots s join public.events e on e.id = s.event_id
  where s.id = p_snapshot_id and s.expires_at > clock_timestamp()
    and clock_timestamp() < app_private.public_expiry(s.event_id)
    and (s.superseded_at is null or s.superseded_at > clock_timestamp() - interval '60 seconds')
    and e.state in ('published', 'active');
$$;
