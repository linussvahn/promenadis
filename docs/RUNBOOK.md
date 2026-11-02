# Promenadis operations runbook

Status: local preview, 2026-11-06. Hosted monitors, SES and backups to S3
are pilot gates; the commands below exist locally and in the database.

## Health

- `GET /functions/v1/api-v1/status` answers `{"status":"ok"|"degraded"}`
  only. Point outside-in monitors here (Better Stack, the event-window
  probe). It never returns counts, topology or identifiers.
- `GET /functions/v1/api-v1/health` is the BFF readiness check.
- Elevated admins see the detail in Admin → Operations: public snapshot
  worker (30 s, late after 3 min), event lifecycle (1 min, late after
  5 min), post-event erasure (hourly, late after 2 h), mail queue (late when
  anything waits 30 min or is dead-lettered).
- Heartbeats live in `app_private.retention_heartbeats`; scheduled jobs call
  `app_private.beat(job)` after each run.

## Incident levels

- `SEV-0`: possible precise-location exposure, takeover, bulk disclosure,
  failed takedown or expiry, secret compromise. Contain first.
- `SEV-1`: material outage or safety job failure during an event.
- `SEV-2`: degradation handled in the next work period.

## Incident switches (Admin → Operations, elevated, reason required)

| Switch | Effect |
| --- | --- |
| `public_locations` | No seller or stop is publishable anywhere. The next snapshot drops them; open maps drop them through the safety feed at once. Use for any suspected location exposure (SEV-0). |
| `seller_applications` | New applications are refused on every event. |
| `organizer_relay` | New relay messages are refused. |
| `exports` | New CSV exports are refused. |
| `support_forms` | The support form refuses new requests (spam wave). |

Every change is audited (`operations.kill_switch_set`). Turn switches back
off with a reason once the cause is fixed.

## Mail

- `pnpm notifications:local` delivers security notices; `pnpm
  notifications:app` delivers application notices, relay mail and support
  requests. Both send only to local Mailpit.
- Queue health: `select public.notification_queue_health_command();`
  (counts only). Dead letters stay 30 days.
- A bounce or complaint: `select public.record_email_feedback_command(
  '<address>', 'bounce'|'complaint');` suppresses the address by HMAC.
- The support mailbox is `app_private.instance_settings.support_mailbox`.

## Status page and communication

For a confirmed user-visible incident, post affected components and impact
on the status page within 30 minutes, update at least hourly and post the
resolution. Notify affected event teams directly. Publish a blameless
summary within five business days for SEV-0 or major SEV-1 incidents.

## Backups and restore drills (local)

- `pnpm backup:keygen` (once) writes an RSA-4096 recovery pair and an
  Ed25519 signing pair to `~/.promenadis-recovery` (or
  `PROMENADIS_RECOVERY_KEYS`). Keep the recovery private key offline.
- `pnpm backup:local` exports the `public`, `app_private`, `auth` and
  `supabase_migrations` schemas without live session data, compresses and
  encrypts the dump (AES-256-GCM, key wrapped with RSA-OAEP) into
  `.local-backups/`, and writes a signed manifest with checksum, counts,
  migration and the erasure-tombstone watermark.
- `pnpm backup:restore-drill [manifest]` verifies signature and checksum,
  decrypts, restores into a throwaway database, compares counts, copies the
  live tombstones in and runs `app_private.replay_erasure_tombstones()`,
  then drops the database. Sessions are never restored, so every session is
  invalid after a real restore.
- Hosted: the same steps run as a scheduled container writing to a
  versioned, Object-Locked S3 bucket in Stockholm (pilot gate).

## Capacity checks (local)

- `pnpm test:local-load`: envelope event (500 sellers, 450 stops), size
  limits and visitor polling with conditional requests.
- `pnpm test:local-concurrency`: capacity and single-flight races.
