# Promenadis data classification, retention, and erasure matrix

Status: discovery sign-off baseline; implementation mapping updated 2026-09-09

This matrix operationalizes the privacy-first retention policy. Periods are
maximums, not targets. Swedish launch counsel may shorten them or change the
working legal-basis analysis before real public/unlisted use.

## 1. Classification levels

| Level | Meaning | Examples | Default handling |
| --- | --- | --- | --- |
| `P0` | Durable public/non-personal | Canonical taxonomy, non-personal build manifest | Public or internal as designed; integrity still protected |
| `P1` | Public but time/scenario bounded | Published seller text, exact event pin, unlisted event data | Explicit publication state, field allowlist, hard expiry, cache invalidation |
| `C1` | Private ordinary personal data | Email, private profile, attendance, saved route | Authenticated field-scoped access; encrypted managed storage; short retention |
| `C2` | Restricted location/operational data | Unpublished address, unit/entrance detail, private application | Event-scoped least privilege; no broad client select; sensitive logging ban |
| `C3` | Restricted case/audit/security data | Reporter contact, moderation evidence, admin audit | Separate authorization, reason where required, access auditing, case retention |
| `S` | Secret or authentication material | Session/token, service key, recovery secret, backup private key | Never public/logged; secret store or one-way hash; rotate/revoke on exposure |

The same field can move between `C2` and `P1` as publication state changes. A
public event pin remains personal data even when the formatted address is hidden.

## 2. Working purposes and legal bases

The product requires a purpose and legal basis per processing activity. The
following are design candidates for counsel review, not final legal conclusions:

- Contract/requested service for account, organizer, seller participation,
  route sync, attendance, and operational delivery chosen by the person.
- Legitimate interests for narrowly necessary security, abuse prevention,
  service integrity, audit, and aggregate operations, balanced against users.
- Legal obligation where a binding reporting, accounting, authority, or notice
  duty actually applies.
- Consent only when it is genuinely optional and revocable without degrading an
  unrelated service; do not use consent as a blanket basis.

No data is retained merely because it might become useful later.

## 3. Data inventory and lifecycle

| Data category | Class | Public exposure / authorized access | Maximum retention | Erasure/expiry mechanism |
| --- | --- | --- | --- | --- |
| Canonical taxonomy labels/synonyms/IDs | P0 | Public in relevant event snapshot | Indefinite version history; IDs never reused | Deprecate, never mutate historical identity |
| Organizer-suggested event tags | P1 | Public only with the related published event | Delete with event-authored tag content no later than the 14-day post-event grace | Event-relative cleanup; do not retain raw frequency analytics |
| Event title, organizer display profile, locality, schedule, status | P0/P1 | Public while published; minimal non-indexed history shell may remain | History shell may remain without seller/location data | Lifecycle removes discovery/sitemap; delete event on valid owner request unless justified shell remains |
| Unlisted event token | S/P1 capability | Link holder can access public-equivalent event data | Until rotation, deletion, or event expiry | Rotate atomically; old known URL returns `410`. Implemented as `events.public_key` (128 bits); retired keys keep only the key and reason in `retired_event_keys` |
| Precise seller address/coordinates | C2 -> P1 when validly published | Seller and authorized event team; anonymous only in consented publication window | Non-public immediately at end/cancel/withdrawal/etc.; delete after 14-day post-event grace | Authoritative state change, urgent feed/snapshot invalidation, scheduled row erasure, tombstone |
| Private unit/entrance discriminator | C2 | Seller and authorized reviewers only; never public | Only while needed to distinguish/review, never beyond location's 14-day grace | Field/row erasure with location cleanup |
| Geocoder normalized result/provenance | C2 | Authorized location workflow | Same lifecycle as precise location unless non-personal provider metadata is separable | Delete address/geometry/provider result with location; retain only non-personal service metrics if justified |
| Geocode cache (SHA-256 of normalized query, coordinates, provider) | C2 pseudonymous | Service only | At most 7 days | Hourly purge; no address text stored |
| Geocode request budget rows (account, event, time) | C1 | Service only | At most 2 days | Hourly purge |
| Pending seller invitation email | C1 | Event owner/co-host; intended verified account sees a field-scoped invitation DTO | At most seven days; earlier on acceptance or withdrawal | Transactional deletion on accept/withdraw; hourly expiry purge; audit never copies email |
| Event seller history counts (`events.seller_history`) | P0 aggregate | Event team | Event lifetime | Written when seller data is erased; no personal data |
| Retention heartbeat (job, last run, erased and overdue counts) | P0 operational | Operators only | Overwritten each run | No personal data |
| Anonymous report rate buckets (HMAC of network prefix or subject, hour, count) | C1 pseudonymous | Service only | At most 2 hours after the window | Hourly purge; raw IP never stored |
| Team pin correction (before/after point, distance, reason, actor) | C2 | Service only; audit keeps distance and action only | Same lifecycle as the location | Cascade-deleted with the location |
| Public snapshot bytes and manifest pointer (`app_private.public_snapshots`, `public_event_publications`) | P1 | Anonymous holders of the event key while the event is published/active | Active snapshot plus predecessor for at most 60 seconds; deleted at hard expiry or the moment an event is postponed, ended, cancelled or archived | 30-second worker purge and tombstone in the committing transaction; no address text, account or participation IDs (allowlist plus denylist check) |
| Seller title, description, tags, categories, items, accessibility facts | C1/P1 | Public only with valid participation/publication state | 14-day post-event grace | Unpublish immediately, delete listing rows on event-relative job |
| Seller participation/application state | C1/C2 | Seller and authorized event team; public status only through DTO | Delete/pseudonymize personal link after 14-day grace; minimal non-personal aggregate may remain | Event-relative cleanup and erasure tombstone |
| Seller availability/live status | C1/P1 | Public only while participation is publishable | 14-day post-event grace | Scheduled/unpublication transition and row cleanup |
| Account Auth identity/email | C1/S | Account and narrowly authorized operations | Account lifetime plus seven-day deletion recovery; provider suppression exceptions below | Disable/hide, recovery window, delete/pseudonymize through Auth and app lifecycle |
| Minimal account profile | C1 | Own account; admin only with reason where necessary | Account lifetime plus seven-day recovery | Delete/pseudonymize and detach public shells |
| Hashed owner recovery code | S | Verification path only; never readable | Until used, rotated, invalidated, or no owned events remain | One-way hash; delete/invalidate record |
| Pending account recovery original/replacement email | C1 | Private claim and service-only delivery resolver; never browser/logs | Claim lifetime, at most seven days | Erased with cancellation, rotation, expiry or account deletion; original email is not copied into notification jobs |
| Previous sign-in email after completed recovery | C1 | Service-only delivery resolver; never browser/logs/outbox rows | Until the one completion notice is accepted or cancelled, at most 72 hours | Deleted by delivery trigger or hourly purge; cascades with the job |
| Account deletion request | C1 | Service-only | Seven-day recovery window, then removed with the erased account | Cascades on erasure; cancellation deletes it |
| Erasure tombstone | C1 (opaque ID) | Service/backup restore only | While any backup that may contain the account can be restored (14 days minimum) | Replayed before a restored environment serves data; purge policy pending backup implementation |
| First-event review (versions, decision, reviewer reference, reason) | C1 | Event team sees status and rejection reason; elevated admins see the queue | While the event exists; reviewer reference nulled on reviewer account erasure | Cascades with event deletion; review legal retention pending counsel |
| Platform-admin eligibility and elevation sessions | C1 | Service-only | Eligibility while granted; elevation rows for the account lifetime (audit covers history) | Cascades on account erasure; pruning of ended elevations still to define |
| TOTP recovery attempt fence | C1 | Service-only | Rolling 24-hour failure window plus last accepted time step, for the account lifetime | Cascades on account erasure; holds no code or secret |
| Recovery dispatch fence record | C1 | Service-only | Lease of at most two minutes, then a 24-hour tombstone holding only IDs, state and timestamps | Purged by the per-minute reconciler; cascades with account deletion |
| TOTP secret/recovery codes | S | Auth subsystem only; the TOTP secret/QR is returned to the browser once at setup (no-store) and never logged or stored by Promenadis | While active; recovery codes until used/rotated | Revoke/rotate; never copy to logs/backups outside Auth scope |
| Browser session vault (2026-09-15 local implementation) | S/C1 | Private BFF only; browser has opaque HttpOnly handle and identity DTO | Authenticated: 12 hours absolute; pending email/PKCE: 15 minutes or five attempts | Hash cookie handles; encrypt credential payloads; delete on applicable login replacement/logout/account erasure; reject at expiry and erase minutely |
| Underlying Supabase Auth session/token material | S | Auth subsystem and encrypted BFF vault only; never browser JavaScript | While active under Auth policy; BFF access additionally bounded by its 12-hour absolute expiry | Revoke current Auth session on logout; validate live Auth session binding; exclude vault from independent exports and invalidate all sessions before restore serves traffic (hosted gate) |
| Emergency-successor designation | C1 | Current event team through a field-scoped DTO; owner alone may change it | While the designation and event are active; no later than event/account erasure | Clear automatically when the co-host role, approved organizer access, or ownership changes; delete with event/account lifecycle |
| Pending emergency-successor claim | C1/C3 | Current event team through a field-scoped DTO; only the owner and designated successor may cancel, and only the successor may complete | At most seven days, including the mandatory first 24 hours of delay | Transactional deletion on completion/cancellation; hourly idempotent expiry purge; safe audit follows the audit schedule |
| Publication owner attestation | C1/C3 | Current event team sees readiness only; owner alone creates the attestation | Current event configuration lifetime; no later than event erasure, with the separate safe audit event following its audit schedule | Replace on re-attestation; stale versions cease satisfying readiness; delete with event/account lifecycle |
| Organizer-profile private memberships | C1 | Profile managers; enforcement/admin scope | While relationship/profile is active; erase account link on deletion/transfer where possible | Transfer/detach/pseudonymize membership |
| Pending organizer-manager invitation email | C1 | Organizer owner; intended verified account sees a field-scoped invitation DTO | At most seven days; earlier on acceptance or cancellation | Transactional deletion on accept/cancel; hourly idempotent expiry purge; audit never copies email |
| Pending event-team invitation email | C1 | Event owner; intended verified account sees a field-scoped invitation DTO | At most seven days; earlier on acceptance or cancellation | Transactional deletion on accept/cancel; hourly idempotent expiry purge; audit never copies email |
| Pending planned event-ownership transfer | C1 | Current event team through field-scoped DTO; only owner and intended co-host may act | At most seven days; earlier on acceptance or cancellation | Transactional deletion on accept/cancel; hourly idempotent expiry purge; audit retains only safe role and organizer-change outcome |
| Organization verification core record | C1 | Profile managers and reviewers; public badge/status only | While badge/profile active; recheck annually/material change; rejected/revoked outcomes 30 days | Revoke/delete when no longer substantiated; confirmation message content in 30 days (none is stored locally) |
| Attendance interested/going | C1 | Own user only; event team sees aggregate | Within 24 hours after event end/cancel once final notice is queued/abandoned | Event-relative deletion; irreversible aggregate may remain |
| Saved route, selected stops, progress | C1 | Own user; anonymous state stays local | Within 24 hours after end/cancel; earlier user deletion | Server cleanup plus client hard expiry |
| Visitor current GPS/accuracy/manual start | C2 if stored, therefore prohibited | Browser transient state only | Never stored/uploaded/logged/synced/analyzed | Discard browser state/watch when hidden/ended |
| Anonymous rate-limit network key | C1 pseudonymous | Abuse subsystem only | Within 24 hours | Daily HMAC-key rotation and row TTL; raw IP never stored |
| Report without contact | C3 | Authorized event reviewer/platform admin according to scope | Ordinary: 6 months after final decision; serious: 12 months after closure, review at 6 months | Case cleanup preserving only irreversible aggregate |
| Reporter contact/evidence | C3 | Restricted reviewers only; never reported user/event owner unless independently authorized | Same case limit, but delete earlier when no longer needed | Field-level deletion or case cleanup; legal hold only for linked case |
| Moderation decision and appeal | C3 | Affected party receives scoped reason/status; reviewers see case | Ordinary: 6 months after final decision; serious: 12 months after closure | Delete personal evidence; non-personal counts may remain |
| Platform-admin audit history (including the internal reason for an event intervention) | C3 | Restricted admins; access itself audited | 12 months | Scheduled deletion/pseudonymization unless linked legal hold |
| Ordinary auth/security events | C3 | Security operations only | 30 days unless attached to active incident | Partition/TTL deletion; case promotion copies only minimal evidence |
| Allowlisted operational logs/alert records | C3/P0 metrics | Operators only; external monitor receives generic status | 30 days raw | Provider/app TTL; no bodies, addresses, coordinates, email, UGC, tokens, full URLs |
| Public non-personal status history | P0 | Public status page | 12 months | Status-provider lifecycle |
| Notification job | C1 | Worker/authorized user status | Delete completed job promptly; unresolved jobs no later than 30 days | Account-referenced structured intent without a copied email address; ack/cleanup worker |
| Notification delivery metadata/in-app content | C1/C3 | Own recipient/operations | 30 days unless attached to unresolved case | Scheduled deletion; no message-body copies in logs |
| Organizer-relay body | C1/C3 | Thread participants/authorized abuse handling | 30 days after delivery | Body TTL |
| Organizer-relay routing metadata | C1 | Delivery subsystem | 14 days after event end/cancel | Event-relative cleanup |
| Email suppression | C1 pseudonymous | Mail subsystem only | While address remains referenced/current suppression needed; delete within 30 days after last reference or valid re-verification/resubscription | HMACed app record plus controllable SES suppression deletion |
| Support request | C1/C3 | Human support/safety/legal scope | Use relay/case schedule according to content; ordinary correspondence should not exceed 30 days after resolution | Mailbox/form deletion and sanitized engineering reproduction |
| Optional raw pilot feedback | C1 if text identifies a person; otherwise aggregate | Product operator only | No later than 90 days and within 30 days after synthesis, whichever is earlier | Scheduled deletion; durable summary contains no personal/rare identifying detail |
| Optional feedback follow-up contact | C1 | Product operator only, stored separately | Resolution or 30 days, whichever comes first | Field/record deletion |
| Limited CSV export | C2 | Authorized owner/co-host through single-purpose URL | Object deleted within 24 hours | Storage lifecycle plus signed URL expiry; request audited |
| Public full snapshot | P1 | Anonymous/link holder while valid | Active plus predecessor for at most 60 seconds; optional private diagnostic copy 24 hours | Pointer transition, object deletion, CDN invalidation, hard expiry |
| Coordinate-free safety feed/manifest | P0/P1 | Public while event valid | Replaced/tombstoned immediately at terminal/safety state | Short expiry and monotonic version |
| Visitor route, start point and progress (`localStorage` `promenadis-route:{eventKey}`) | C1 device-local | The visitor's browser only; never uploaded, logged or synced | Until the event's hard expiry, or earlier on "end the walk" or "clear saved data" | Expired entries are removed when read; a reset button clears them |
| Offline event copy (IndexedDB `promenadis-offline`: manifest, snapshot, feed, package) | P1 device-local | The visitor's browser only, after they start a walk | Until hard expiry; least-recently-used eviction beyond 50 MiB, never the active walk | Refused after expiry; evicted or reset on the device; cannot be withdrawn remotely before reconnection |
| Live position and accuracy | C2 transient | Browser memory only while requested | Not stored | Cleared when hidden, ended or unmounted |
| Walking package | P0 street data with event scope | Public while selected by valid manifest | Current plus two predecessors while active; all objects within 24 hours after end/cancel | Storage lifecycle/CDN invalidation; non-personal build/license manifest may remain |
| Walking overrides | P0/C3 action metadata | Public effect in graph; restricted reason/actor | Override expires with event; non-personal license/build summary may remain | Remove event package/override; audit follows applicable history |
| Independent encrypted backup | Mixed encrypted | Restore operators only; writer cannot read | 14 days under governance Object Lock | S3 lifecycle expiry; restore replays erasure tombstones |
| Provider credentials/deployment secrets | S | Scoped workload/CI only | Until rotated, revoked, or provider removed | Secret-store versioning and revocation; never application data |

## 4. Publication and erasure choreography

For withdrawal, quarantine, suspension/revocation, early close, postponement,
cancellation, or event end:

1. Commit the authoritative state change and new safety sequence in one
   transaction.
2. Exclude the seller/location from new BFF decisions immediately.
3. Publish/tombstone the coordinate-free safety feed and trigger urgent full-
   snapshot regeneration/invalidation.
4. Clients apply the feed before older content; disconnected clients remain an
   accepted limitation until reconnect/hard expiry.
5. Delete public snapshot objects at terminal state and enforce hard client
   expiry.
6. Run the event-relative private-data deletion job at the applicable deadline.
7. Write an erasure tombstone/watermark so imports and backup restore cannot
   resurrect the record.
8. Verify completion through a privacy-minimized heartbeat/alert.

Deletion jobs are idempotent and retryable. A failed provider/CDN call cannot
extend server authorization or a hard expiry.

## 5. Backups, legal holds, and subject requests

- Backups are not edited in place. They expire after 14 days; a restore first
  replays erasure tombstones before any environment can serve data.
- A legal hold is case-specific, documented with scope, basis, owner, start,
  review date, and release condition. It cannot extend unrelated data.
- Subject access/export does not reveal other sellers at a shared address,
  reporter identity, event-team information outside allowed audit history, or
  security information that must lawfully remain restricted.
- Account deletion first hides public content and disables access. After seven
  days, erase or irreversibly pseudonymize except for explicitly justified case,
  audit, legal, or suppression records.
- Provider-held records, mail suppression, CDN objects, logs, and recovery
  environments are part of the lifecycle and cannot be declared out of scope.

## 6. Implementation controls

- Every table/field receives a classification annotation or documented mapping
  to this matrix during schema review.
- Every event-relative record has an explicit deadline source and indexed expiry
  path; no periodic job infers expiry from ambiguous text.
- Public DTO schemas are allowlists plus a sensitive-key denylist. Contract tests
  fail if a private field can enter a snapshot, SSR document, analytics event,
  log, export, or provider request.
- CI tests deletion at exact boundary, retry, duplicate delivery, partial CDN
  failure, postponement, cancellation, shared location, and backup restore.
- Retention periods live in reviewed typed configuration/migrations, not scattered
  magic numbers.
- Changes to a purpose, field, recipient, provider, retention period, or public
  exposure update this matrix, privacy notice, threat model, tests, and counsel
  packet where applicable.
