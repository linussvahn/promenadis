# Security, privacy, moderation, and legal baseline

Status: architecture baseline, not legal advice, 2026-09-07

This document captures product controls agreed during discovery. Swedish counsel
must review the free-launch service classification, terms, privacy notice,
reporting flow, operator disclosures, and retention schedule before any real
public or unlisted pilot. Commercial/payment advice is a later gate before
charging. This remains a product baseline, not legal advice.

## 1. Security posture

Promenadis handles residential locations and event operations. Security should
be appropriate for that sensitivity without inventing unnecessary identity
collection.

Core rules:

- Deny by default and grant event-scoped capabilities explicitly.
- Enforce authorization on the server and in database RLS.
- Minimize private fields returned by every endpoint.
- Use short-lived sessions/tokens, secure cookies where applicable, CSRF
  protection, origin checks, and rate limits.
- Validate all commands with shared schemas on entry.
- Use idempotency keys for retryable state-changing operations.
- Record security-relevant and administrative changes in tamper-resistant audit
  history.
- Encrypt in transit and rely on managed encryption at rest, with keys and
  secrets kept out of the application repository.
- Run dependency, secret, and infrastructure configuration scanning in CI.
- Establish vulnerability intake, incident response, backup/restore, and access
  review procedures before public launch.
- Run authenticated/private BFF and queue-worker processing in Supabase Edge
  Functions forced to the EU Frankfurt region; Netlify receives only sanitized
  public snapshot data. Queue schemas are not exposed to browser roles.
- Define every external/API/queue/webhook JSON boundary with strict Zod runtime
  schemas. Rebuild the database from migrations in CI and test RLS, grants,
  privileged database functions, and state transitions with pgTAP. Generated
  database row types remain internal and cannot substitute for public-field
  allowlists.
- Keep local, Deploy Preview, staging, and production credentials and data
  isolated. PR previews receive no remote/provider secrets; staging contains
  deterministic synthetic identities and addresses only. Never restore, clone,
  sample, or pseudonymize production rows into staging—reproduce incidents with
  purpose-built minimal fixtures. Production and staging auth callback allowlists
  must not accept each other's origins.
- Keep production releases manual and serialized, promote only an immutable
  revision already verified in staging, and require explicit environment,
  migration, cost/headroom, and active-event-impact confirmation. CI credentials
  are environment-scoped; workflows and deployment identities receive only the
  permissions required for their stage. GitHub-to-AWS access uses short-lived
  OIDC credentials rather than stored AWS access keys.
- Use forward-only expand/contract migrations. Do not attempt a destructive
  database rollback after new writes; republish prior application code only
  while it remains compatible and repair schema/data with a reviewed corrective
  migration. Production restore remains a high-risk corruption/data-loss path,
  not a release technique.
- Feature flags and emergency kill switches are evaluated server-side for every
  permission or write decision, fail closed for sensitive capabilities, expire
  by default, and are audited when changed in production. A browser-visible flag
  never grants authorization or substitutes for RLS/state checks. Protective
  takedown, postponement, and event-end paths cannot be disabled by an ordinary
  write freeze.
- Keep provider spend caps and quotas enabled and prohibit automatic paid-tier
  activation or recharge. Cost degradation may pause optional reminders,
  geocoding, builds, and ordinary writes, but must reserve enough headroom for
  takedown, event end, hard expiry, cancellation notice, and deletion work.
  Reaching a budget threshold never permits a residential location to remain
  public longer or prevents an authorized protective command.
- An unpaid pilot may omit a calendar-based release freeze and formal approval
  board, but free service is not a lower privacy or security classification.
  Production deployment still requires green automated checks, explicit target/
  migration/active-event confirmation, forward-only migration safety, working
  expiry and urgent takedown paths, monitoring, kill switches, and a viable
  rollback or corrective-forward path. Destructive/high-risk data work retains
  backup preflight. Revisit formal change commitments before accepting payment
  or promising an SLA.

API abuse protection is layered and data-minimized:

- Do not challenge ordinary public browsing. Serve only bounded per-event
  snapshots and accept that currently public data can be copied; prevent global
  exact-location enumeration and arbitrary origin queries.
- Apply endpoint/account/event/target token buckets before writes and provider
  calls. Anonymous network identity uses a daily rotating HMAC of a coarse IP
  prefix; never retain the raw IP, user agent, or browser fingerprint in the
  application counter. Expire the counter within 24 hours unless a concrete
  incident justifies promotion of minimal evidence under the existing schedule.
- Use Cloudflare Turnstile Free managed mode for passwordless email, anonymous
  reports, and organizer relay, with mandatory server-side validation, hostname/
  action binding, isolated environment secrets, privacy disclosure, and DPA/
  subprocessor review. A direct human safety/legal contact remains available for
  accessibility or provider failure.
- Keep Supabase Auth rate limits and enumeration-resistant responses. Validate
  origin, size, schema, authorization, and idempotency before expensive work;
  signed webhooks also require timestamp/replay checks.
- Shared-network thresholds normally trigger a challenge or delay rather than a
  permanent block. Never silently discard a safety/legal report. Protective
  authenticated takedown, end, postponement, expiry, and deletion commands have
  reserved capacity outside ordinary limits.
- Do not add Redis, AWS WAF, or paid bot management at launch. Revisit only on
  measured contention or distributed abuse; threshold changes are reviewed and
  monitored configuration rather than hidden product entitlements.

## 2. Authentication and MFA

Launch authentication is verified-email passwordless magic link or OTP.

Browser-session decision, approved and implemented locally 2026-09-15:
Supabase access/refresh tokens and PKCE verifiers stay encrypted in the private
BFF session vault. Browser JavaScript receives identity only; the browser holds
an opaque HttpOnly, SameSite=Lax cookie. Protected reads/writes are fenced by the
loaded account ID, with stale UI invalidation on session change. Same-origin
headers, exact Origin checks and JSON-only mutations provide the CSRF boundary.
Tokens, cookies, OTPs, callback codes and encrypted payloads must never enter
application logs. Cookie authentication still requires XSS prevention.

Local absolute session lifetime is 12 hours; pending login lifetime is 15
minutes with at most five attempts. Expired credentials are unusable immediately
and erased by a minutely sweep. Logout deletes the opaque handle and revokes
that Supabase session; other independent sessions remain active. Live Auth
session binding is checked, not just JWT expiry. Browser storage credentials
from the old implementation are discarded, not silently trusted or migrated.

Hosted support is fail-closed until dedicated rotated encryption keys,
HTTPS/Secure host-only cookies, reviewed private routing, production admission
limits and restore-time revocation are verified. HTTP cookies and local-key
derivation are development exceptions only, not a production security baseline.
The original Zen normal/private-window account-switch report remains unresolved;
passing isolated Chromium tests is not evidence of its browser-specific cause.

- Normalize and rate-limit email login initiation and verification.
- Prevent account enumeration through response content and timing where
  practical.
- Bind redirect URLs to an allowlist.
- Invalidate or rotate sessions after sensitive account changes.
- Require recent authentication for destructive or privilege-changing actions.
- As of 2026-11-01, this means the requesting session's Auth-validated AMR
  sign-in evidence, not the account-wide last sign-in timestamp. A fresh login
  elsewhere, token refresh, unknown methods and user metadata cannot grant
  step-up. Direct bearer requests also require a live session/account binding;
  logout revocation is enforced before a new private domain request, without
  waiting for JWT expiry. Already-authorized in-flight requests are not claimed
  to be retroactively cancelled.
- Draft deletion additionally requires the current optimistic event version and
  exact-title confirmation. It is owner-only; the retained audit excludes the
  event title and all other user-authored event or location content.
- Event-team invitations, role changes, removals, and invitation cancellation
  are owner-only privilege changes and require authentication no older than 15
  minutes. Invitation acceptance instead requires the intended signed-in
  account's verified email.
- Planned ownership-transfer initiation and cancellation are owner-only and
  require authentication no older than 15 minutes. Acceptance requires the
  intended verified co-host and rechecks management of the exact organizer
  identity approved by the current owner; it does not grant that broader
  permission. Ownership and any organizer reassignment commit atomically.
- Shared-organizer manager invitation, cancellation, and removal are
  organizer-owner-only and require authentication no older than 15 minutes.
  Acceptance requires the intended signed-in account's verified email.
  Individual organizer identities cannot have managers.
- Let normal account owners opt into TOTP MFA.
- Require TOTP MFA for every platform administrator.
- Store recovery codes hashed and display them once.

Before an owner publishes an event, issue a hashed, single-use recovery code and
strongly encourage TOTP enrollment. The owner may predesignate one verified
co-host as emergency successor. Account recovery or successor transfer requires
a valid enrolled recovery method, control of a new verified email, a 24-hour
delay, notifications to the old email and event team, and an audit trail. A
successor can receive event ownership but never access the old owner's account or
private data.

The local account-recovery verification slice is not a working account-access
recovery mechanism yet. It binds requests to the recovery-code version, consumes
the code only on explicit emailed-token verification, and starts the minimum
24-hour wait then. Verification secrets are hashed at rest, omitted from
initiation responses, and removed from the browser address bar after reading
the email-link fragment. Pending replacement emails/hashes expire within seven
days and are deleted by hourly maintenance, or immediately on cancellation or
code rotation. No email/code/token is copied into audit summaries.
Old-email/team notices remain private notification intents, not delivered mail.
Auth rebinding stays disabled until these notices are delivered before the
change and session revocation, cancellation races, and ambiguous provider
outcomes have a tested, retry-safe completion protocol. The local anonymous
budget is not a substitute for production abuse controls.

Promenadis does not manually guess identity from submitted documents, social
profiles, or an emailed narrative. Without a valid recovery factor or
predesignated successor, owner-only actions remain unavailable while existing
co-host permissions continue unchanged.

Every event has exactly one active owner. A planned ownership transfer requires
recent authentication by the current owner and explicit acceptance by a verified
existing co-host, with both steps audited. A sole owner may still exercise
account deletion, but must first transfer, delete drafts, or cancel published and
active events; cancellation unpublishes seller locations before the account
recovery/erasure process begins. Platform staff do not improvise transfers for an
unreachable owner.

Pending event-team invitations store a normalized email only until acceptance,
cancellation, or their seven-day expiry. Acceptance and cancellation delete the
row transactionally; an hourly database job purges expired rows. Team audit
events retain the role and stable event-facing actor label where applicable,
never the invited email address.

Pending organizer-manager invitations follow the same seven-day maximum,
verified-email binding, transactional acceptance/cancellation deletion, redacted
audit, and hourly expiry purge. Only the organizer owner sees pending email
addresses; managers receive membership display names but not invite emails.

Pending planned ownership transfers contain only opaque event-membership and
organizer-profile references plus timestamps. They expire after at most seven days, are deleted
immediately on acceptance or cancellation, and have a separate hourly purge.
Redacted audit events retain the decision and role transition without copying
email addresses or account identifiers.

Pending emergency-successor claims follow a separate fail-closed state machine.
Only the currently designated verified co-host may initiate one; the current
owner or that successor may cancel it; and only the successor may complete it
after 24 hours. Completion transactionally rechecks the exact designation,
event roles, approved organizer management, event state, and locked team
version. The claim is deleted on completion or cancellation and expires within
seven days. Notification jobs reference recipient accounts rather than copied
email addresses. Until a narrow external-delivery worker is connected and
verified, the product describes those records only as queued notification
intents, not delivered notices.

Passkeys are preferred as a later enhancement. Passwords are not a launch
fallback, avoiding password reset and credential-storage risks.

## 3. Platform administrator elevation

An administrator uses the same account for ordinary participation and admin
work, but privileged access is never ambient.

- Default every session to normal-user mode.
- Enter admin mode through fresh TOTP verification.
- Admin elevation expires after approximately 15 minutes.
- Use a separate admin route/layout with persistent visual warning and explicit
  exit.
- Require a structured reason before sensitive private-data access.
- Audit elevation, sensitive reads, exports, moderation, restoration, and role
  changes.
- Never impersonate another user.
- For appeals, assign a different administrator than the original decision-maker
  when staffing permits. If only one administrator exists, disclose that the
  review is not independent and still record it separately.

Only a platform administrator in freshly elevated mode may reinstate a
platform-admin suspension. Require fresh TOTP, a structured reason, current case
review, and an audit event in the same transaction. Event owners, co-hosts, and
moderators cannot override the suspension.

While only one platform administrator exists, that administrator may reinstate
so a legitimate user is not permanently blocked by staffing; mark the review as
non-independent. As soon as two eligible administrators exist, a different
administrator must approve reversal of a platform-admin suspension, platform-
administrator role changes, bulk sensitive-data exports, and production restores
before the action takes effect. Emergency suspension and quarantine do not wait
for a second approval.

## 4. Audit design

Audit events should be append-oriented and capture:

- Actor account and effective role/elevation session.
- Action and target type/identifier.
- Event scope.
- Timestamp and request/correlation identifier.
- Before/after semantic state or a safe field-level change summary.
- Structured reason where required.
- Outcome, including denied sensitive operations.

Do not place magic links, access tokens, unnecessary email addresses, precise
GPS, or full user-generated content into logs. Audit retention must be separately
defined from short-lived seller content retention. Access to audit records is
restricted and itself audited.

For event-scoped audit history, the event owner may see the acting co-host or
moderator's event display name and role for team actions within that event. The
owner-facing history does not expose email addresses, authentication identifiers,
or unrelated profile data. It also does not reveal seller or reporter identities
that the owner lacks permission to see through the relevant operational workflow.
A stable historical actor label is preserved if the team member later renames
their profile or leaves the event.

Walking-network overrides are privileged event-team actions. Owners and
co-hosts must provide a reason; a proposed connector also requires an explicit
attestation that visitors may legally and safely use it. Record the actor,
affected graph elements, before/after version, reason, attestation where
applicable, and impact summary. Moderators may inspect and report network issues
but cannot publish overrides. Overrides are event-scoped, expire with the event,
and must never be represented as edits to or endorsements by OpenStreetMap.

Production graph builds do not depend on public Overpass. They use checksum-
verified, metadata-stripped Geofabrik Sweden extracts cached privately in AWS
Stockholm. Reusable source data and generated street graphs remain separate from
seller addresses and other Promenadis records. Public map/routing experiences
must visibly attribute OpenStreetMap and link to the ODbL information. Treat the
downloadable compact graph conservatively as an ODbL-governed derived database
until launch counsel confirms its classification and required share-alike
delivery method.

## 5. Privacy and data minimization

Promenadis should document its processing purposes and legal bases per data
category rather than claiming one basis for everything.

Data minimization decisions already made:

- No visitor GPS trail storage.
- Browser geolocation is requested only after an explicit visitor action.
  Coordinates, accuracy, and manually selected visitor starts stay in transient
  browser state and are never uploaded, logged, synced, or analyzed.
- No public or host-visible attendee identities; aggregate counts only.
- No birth dates; accounts are contractually 18+.
- No seller phone verification.
- No legal name required in public seller content.
- No buyer-to-seller messaging/contact details.
- No public payment QR/link at launch.
- No user-level advertising or cross-site tracking architecture.
- No photos at launch.
- No proof-of-residence document collection.
- Precise residential location is time-bounded and separated from long-lived
  event history.
- Public organizer profiles are separated from private account identities. One
  account may manage multiple profiles, but restrictions and abuse controls
  apply across the account and all associated profiles.

The public map pin is treated as address-equivalent personal data even when the
formatted address string is hidden.

Public event snapshots use stable opaque event-scoped IDs and an explicit field
allowlist plus sensitive-key denylist. They must never include account/auth IDs,
private participation IDs, contact routing, apartment/unit details, reports,
moderation/audit data, raw geocoder objects, attendance identities, or
unpublished records. Fresh clients validate a short manifest and coordinate-free
safety feed before rendering exact pins.

An unlisted event is link-accessible, not private. Its high-entropy URL reduces
guessing and it is omitted from Promenadis discovery and sitemaps, but any link
holder can view, copy, or reshare the same currently published event data as an
anonymous public visitor. Owners and sellers must receive that warning before
publication. Invite-only seller admission is unrelated to viewer privacy; a
future private event would require authenticated authorization.

Robots directives and unlisted response headers reduce unintended search
discovery but are not security controls and cannot retract data already fetched.
Map, route, seller/location, snapshot, safety, and routing resources are always
non-indexable. Only sanitized public event-level landing metadata may be indexed.
Unlisted social previews disclose the URL and sanitized event title, organizer,
date, locality, and generic branding to the chosen preview provider, never exact
locations or seller content. Changing an event from unlisted to public after a
seller joins is a material disclosure change and requires notice plus that
seller's explicit reconfirmation before republication.

Apply `Permissions-Policy: geolocation=(self)` so third-party frames cannot
request location. Stop active geolocation watches when the route view is hidden
or ended. Permission denial, unavailability, inaccuracy, and revocation must
leave all manual discovery, route planning, and progress controls usable.

PWA installation does not create a different account, permission, or data-
retention class. Offline storage is admitted only after a visitor explicitly
prepares/starts a route, stays within the managed cache budget, exposes last
refresh and stale-safety status, and remains subject to hard event expiry.
Promenadis cannot remotely retract already downloaded public information from a
disconnected device and must say so plainly. On reconnect, verify manifest and
safety state before synchronization or new exact-location access. Only visitor
progress may reconcile later; private or safety-sensitive writes require an
online authoritative response and cannot sit invisibly in a background queue.

## 6. Precise-location access rules

| Phase/state | Seller | Authorized event team | Anonymous/public |
| --- | --- | --- | --- |
| Draft application | Yes | As needed for admission | No |
| Approved, early display disabled | Yes | Yes | No |
| Approved, early display enabled, seller opted in | Yes | Yes | Exact pin |
| Active participating seller | Yes | Yes | Exact pin required |
| Withdrawn/suspended/revoked/closed | Yes as needed | Yes during grace | No |
| Event ended, within 14-day grace | Yes as needed | Restricted operational access | No |
| Postponed, awaiting replacement/reconfirmation | Yes as needed | Restricted operational access | No |
| Grace expired | Deleted | Deleted | No |

Address changes after approval first unpublish the old public participation and
require explicit review of the replacement location.

During an active event, this unpublication rule also applies to any seller-
initiated pin move. A shared location remains public for its other sellers. An
authorized event-team member may correct an obvious same-address cartographic
error by at most 25 metres without closure only after recent authentication and
with a reason, before/after geometry, seller notice, and audit event. Larger or
physical-stop changes always require unpublication and reapproval.

A seller's `temporarily_away` or `closed_early` action immediately excludes that
seller from new routes; early closure also unpublishes them. At a shared stop,
other open sellers remain public. Active clients receive urgent status updates,
while offline clients must display the last refresh time because Promenadis
cannot retract already downloaded data.

Postponement immediately makes all residential locations non-public and revokes
active route publication. A replacement date requires seller confirmation before
republishing that seller. If the event is not validly rescheduled, precise seller
data is deleted no later than 14 days after postponement; cancellation does not
restart the retention clock.

Published boundary and schedule changes use a pending revision with an impact
preview. Approved locations that fall outside a replacement boundary are hidden
until explicitly retained as geographic exceptions. Event-hour extensions never
extend an individual seller's availability or pin-publication consent without
that seller's opt-in. Boundary and core intervals cannot change after activation;
the owner must end early, postpone, or create a new duplicated event.

## 7. Retention baseline

Retention follows a privacy-first minimum: personal data is not kept merely in
case it becomes useful. Each category must have a documented purpose, legal
basis, maximum period, and automatic deletion or irreversible anonymization
rule. Where no law fixes a minimum period, Promenadis uses the shortest period
that is necessary to operate the applicable review, security, or legal process.
Case-specific extensions require a documented legal hold or active incident;
they do not extend the default retention of unrelated records.

| Data | Working retention |
| --- | --- |
| Precise seller address/coordinates | Non-public immediately at event end; delete after 14-day grace |
| Seller descriptions/highlighted items | Same 14-day post-event grace, then delete |
| Event history shell | Retain for host archive/duplication without seller/location data |
| Visitor live GPS | Never stored |
| Saved route and stop progress | Delete within 24 hours after event end or cancellation; user may delete earlier |
| Identifiable interested/going attendance | Delete within 24 hours after event end/cancellation once the final notice is queued or abandoned; anonymized aggregate may remain |
| Authentication/security events | 30 days, unless attached to an active incident |
| Raw allowlisted operational events and alert-delivery records | 30 days; never include request bodies, addresses, coordinates, email, tokens, or user-authored text |
| Ordinary moderation decisions, reports, and appeal evidence | 6 months after the final decision, then delete personal evidence; anonymized aggregate counts may remain |
| Serious safety, unauthorized-address, fraud, or legal cases | 12 months after closure, reviewed at 6 months; extend only through a documented legal hold |
| Privileged administrator audit history | 12 months; access restricted and audited |
| Completed notification jobs and delivery metadata | Delete completed jobs promptly and metadata after 30 days; do not copy message bodies into delivery logs |
| In-app notification content | 30 days unless attached to an unresolved security or moderation case |
| Organizer-relay message body | 30 days after delivery |
| Organizer-relay routing metadata | Delete 14 days after event end or cancellation |
| Optional raw pilot feedback | Delete no later than 90 days and within 30 days after synthesis, whichever is sooner; non-personal decision summaries may remain |
| Optional feedback follow-up contact | Store separately and delete after resolution or 30 days, whichever comes first |
| Application email suppression | HMAC of normalized address, reason, and timestamp while the address remains referenced; delete within 30 days after the last reference or valid resubscription/reverification and remove the controllable SES entry |
| External backups | 14 days, then expire |
| Walking-network packages | Current plus two previous successful versions while published/active; delete all package objects within 24 hours after event end/cancellation; retain non-personal build/license manifest only |
| Public event snapshots | Only active public snapshot plus predecessor for at most a 60-second transition; optional private diagnostic copy for 24 hours; delete public objects immediately at event end/cancellation and enforce hard client expiry |
| Account deletion | Seven-day recovery, then erase/pseudonymize subject to justified retention |

Independent backups are client-side encrypted to an offline recovery public key
before being written to a private, versioned S3 bucket in Stockholm. Each object
is protected by 14-day governance-mode Object Lock and then lifecycle-expired;
ordinary backup credentials cannot read, overwrite, restore, or bypass retention.
Archives exclude credentials and other secrets and carry verified checksums plus
the latest erasure-tombstone watermark. Quarterly real-data restore exercises
run only in an isolated, audited, short-lived environment with outbound delivery
disabled, replay tombstones before validation, and destroy restored data within
24 hours. The backup scope must be reviewed before any user-uploaded files ship.

These periods are provisional maximums pending Swedish legal review. Review may
shorten them. An extension applies only to records connected to a documented
active incident or legal hold and never silently extends unrelated records.
These working periods complete the discovery retention matrix. Swedish legal
review may shorten them before launch. Provider-held suppression data and other
processor records must be included in deletion procedures rather than treated as
outside Promenadis's lifecycle.

## 8. Moderation model

Sellers publish text directly unless their participation/account has a narrowly
scoped watch condition. Event teams can hide content, suspend participation,
revoke participation, and remove prohibited fields. Platform administrators
handle escalations.

Watch conditions should have:

- A reason and authorizing action.
- A defined scope (specific event, content class, or account safety issue).
- A review or expiry date.
- Restricted visibility.
- An appeal path.

Avoid an opaque permanent reputation score.

## 9. Reporting and notice-and-action

Anonymous reporting is allowed so a resident can report an unauthorized address
without creating an account. Protect it with rate limits and escalating CAPTCHA.
Reporter contact is optional unless follow-up is necessary for a legally complete
notice; it is never shown to the reported user.

Reports are structured and tied to an exact event, location, seller profile, or
highlighted item. Reasons include at least:

- Unauthorized use of a residential address.
- Immediate safety concern.
- Illegal content.
- Copyright infringement.
- Privacy violation.
- Fraud/deceptive event.
- Harassment/hateful or threatening content.
- Other terms violation.

One ordinary report does not automatically remove content. A sufficiently
complete unauthorized-address report immediately quarantines only the reported
physical location pending human review. It is removed from public discovery and
new route planning, and the seller and event owner are notified without receiving
the reporter's identity or contact details. Obviously incomplete or automated
submissions do not trigger automatic quarantine; anonymous reporting is
rate-limited and protected with escalating CAPTCHA.

Quarantine is a temporary safety measure, not a finding against the seller. Only
an authorized human reviewer may restore the location or make the removal
permanent. The system records quarantine, takedown, restriction, rejection,
restoration, legal/terms basis, and affected-user notice where appropriate.

Hosts and sellers can appeal moderation decisions. Appeals are separate records,
not edits that erase the original decision. A different platform administrator
reviews the appeal where possible.

## 10. User-generated content and photos

Text is already user-generated content and requires reporting/moderation. Photos
increase copyright, privacy, illegal-content, and operational exposure. Therefore
the launch is text-only.

Seller tags and organizer-suggested tags are also user-generated text. Enforce
the settled count, Unicode-length, normalization, and control-character rules on
the server; do not allow them to imitate platform verification badges or typed
accessibility/safety claims. Preserve authored spelling for display, do not
machine-translate it, and apply the same reporting, moderation, and 14-day
post-event deletion as the related listing/event content. Do not keep raw tag-
frequency analytics after normal content deletion merely to improve the
taxonomy. Any later aggregate analysis needs a documented purpose and controls
against rare-tag re-identification.

A future photo feature requires all of the following before activation:

- Terms requiring the uploader to possess necessary rights and permission.
- A limited license allowing Promenadis to process and display the image.
- Clear prohibited-content rules.
- Private upload quarantine.
- MIME/signature and size/dimension validation.
- Re-encoding rather than serving original bytes.
- EXIF and GPS metadata stripping.
- Processed variants only on the public CDN.
- Rapid report, quarantine, takedown, and appeal tooling.
- Defined retention and deletion for originals and derivatives.
- Abuse rate limits and storage quotas.
- A moderated pilot before general availability.

Terms can allocate contractual responsibility to an uploader but cannot waive
Promenadis's own statutory duties.

## 11. Terms and operator transparency

Before launch, publish at minimum:

- Terms of service and acceptable-use rules.
- Privacy notice with purposes, legal bases, processors, retention, transfers,
  rights, and contact details.
- Cookie/analytics disclosure; avoid consent-requiring nonessential tracking at
  launch where possible.
- Notice-and-action/reporting entry point.
- Moderation decision and appeal information.
- Operator/legal identity and reliable contact method.
- Explanation of when submitted residential locations become public.
- Explanation that unlisted links are reshareable and no-index directives do not
  make an event private or guarantee removal from third-party caches.
- Host and seller responsibilities, including authority to use a location.

Before any real public or unlisted pilot, designate the natural or legal person
that operates Promenadis and controls its processing. A persistent `Operator and
contact` page linked from every footer provides the legal name, compliant Swedish
establishment address, monitored email, and organization/VAT number or competent
authority where applicable. The privacy notice names the same controller. A
personal operator cannot remain anonymous; use a lawful business/service address
and obtain launch-counsel confirmation rather than disclosing a home address
unnecessarily. Until this is ready, remain in closed alpha.

Publish separate authority/legal, safety/privacy, and ordinary-support routes;
aliases may reach one mailbox during the pilot. Offer both direct email and an
accessible contact form, neither solely automated, and state that Swedish and
English are accepted. Keep organizer relay separate. Footer links also expose
terms, privacy, reporting/appeal, and service status.

### Accessibility baseline and claims

Promenadis adopts WCAG 2.2 Level AA as its engineering and public-pilot target
across all first-party roles and both launch languages. This target applies
regardless of whether the initial free, non-commerce service is legally within
Sweden's Act (2023:254) on accessibility of certain products and services.
Because the launch product does not form consumer contracts online, it does not
obviously match the Act's definition of an e-commerce service; the Act also
exempts services supplied by microenterprises. Launch counsel must confirm the
classification, and Promenadis must not represent this working analysis as a
legal exemption.

Before a public pilot, provide an easily found accessibility statement with the
target standard, truthful assessed status, known barriers and alternatives,
tested technology combinations, assessment/review date, and accessible feedback
routes. `Fully conformant`, certification, and legal-compliance claims require
supporting evaluation and counsel review. Accessibility intake cannot be
CAPTCHA-only and never requires disclosure of a disability. Keep identified
accessibility defects only as long as needed to resolve and verify them; do not
copy unnecessary personal or health information into issue trackers or logs.

Ordinary individual or informal-group owners require verified email, recovery
code, publication attestation, and first-event manual review, but no legal name,
phone, government ID, proof of residence, or BankID. They receive no identity-
verification badge. A registered organization badge requires an official
organization-number/name/status match plus proof of claimant control through an
organization domain/site or independently sourced official contact. It does not
endorse the event. Larger/premium events require a verified organization.

For organization verification, retain only organization number, registered
name/status, source, proof method, reviewer, and timestamps while the profile/
badge remains active. Delete confirmation-message content within 30 days,
recheck annually and after material changes/incidents, and remove the badge if
status or control can no longer be substantiated. Hold an impersonation or
abnormal claim rather than accumulating identity documents. Trader-traceability
machinery is deferred until Promenadis enables consumer/seller online contracts,
payments, reservations, or commerce.

Every published public or unlisted event must provide a privacy-preserving
organizer contact relay. Do not publish the managing account's email address by
default. Limit relay content to short plain text without attachments, keep
platform safety/legal reporting separate, and apply rate limits, escalating
CAPTCHA, blocking, and abuse reporting. Neither party's email address is revealed
unless that person deliberately includes it in their own message.

The product must not claim that seller responsibility in the terms removes all
platform responsibility.

### Launch legal-review gate

Commission one bounded, fixed-scope review from Swedish counsel before any real
public or unlisted pilot. Synthetic development and closed alpha without public
real residential locations may continue while it is arranged. Give counsel the
canonical product, architecture, and privacy documents plus the data/retention
inventory, controller/processor and provider-region map, location-publication
lifecycle, UGC/reporting/moderation/appeal flows, operator/contact proposal,
accessibility target, analytics/cookie position, support-income model, and OSM/
ODbL graph design.

Request a short written launch-blocker memo and marked-up requirements or drafts
for Swedish and English terms, privacy notice, acceptable-use rules, reporting/
appeal notices, operator disclosures, and accessibility statement. The review
must explicitly address GDPR roles, legal bases, rights and whether a DPIA is
required; DSA classification and the exact effect of micro/small-enterprise
exceptions; the amended Swedish Electronic Bulletin Boards Act; E-commerce Act
disclosures; accessibility-law classification; and ODbL attribution/share-alike
delivery for the browser routing database.

Keep the engagement narrow and request fixed-fee pricing. Separate launch
blockers from prudent improvements. Defer commercial contracts, VAT, payments,
refunds, consumer-distance-selling, and payment-flow advice until charging is
actually planned. Repeat legal review after a material scope change such as
payments, photos, private events, minors, buyer/seller communication, expansion
to another country, or a substantially different operator.

## 12. Payments and donations

The first release is free and does not process payments. A plain external support
link may point to a service such as Ko-fi or Buy Me a Coffee. It remains important
to account for support income correctly; describing it as a donation does not by
itself make it tax-free.

Before paid plans:

- Establish the appropriate legal/business entity and accounting process.
- Obtain Swedish accounting/tax advice on income and VAT treatment.
- Initially contract with verified organizations rather than consumers.
- Define refund/credit policy and clear absence of a formal SLA.
- Revisit consumer distance-contract withdrawal/cancellation requirements before
  any B2C sale.
- Keep entitlements independent from payment-provider records.

## 13. Incident priorities

Highest-priority incidents include:

- Unauthorized residential address publication.
- Location remaining public beyond its permitted time.
- Compromised event-team or administrator account.
- Bulk extraction of precise location or account data.
- Fraudulent cancellation or event takeover.
- Secret/API-key exposure.
- Backup restore that resurrects erased personal data.

The runbook should support immediate location unpublication, event freeze,
session revocation, key rotation, evidence preservation, user communication, and
regulatory assessment.

Use three operational severities:

- `SEV-0`: possible precise-location exposure, account/event takeover, bulk
  disclosure, failed safety takedown or event expiry, or secret compromise.
  Contain first, alert immediately, preserve minimal necessary evidence, and
  assess legal/user notification duties.
- `SEV-1`: material active-event outage, stale safety state, or failed critical
  job. Alert immediately during a covered event window and enter read-only or
  otherwise safe degraded mode where possible.
- `SEV-2`: nonurgent degradation, isolated job failure, or capacity/cost risk.
  Send email and handle it in the next planned work period.

Promenadis has no 24/7 SLA. The solo operator covers accepted pilot events from
two hours before their first public interval until one hour afterward and targets
15-minute acknowledgement of SEV-0/1 alerts during that window. Automated hard
expiry, unpublication, and event-team safety commands protect sensitive data
outside covered hours.

Outside-in monitoring receives no personal data, authenticated content, event or
account identifiers, logs, traces, or exception payloads. Public status updates
describe affected components and impact without naming an event/customer or
revealing exploitable security detail. Post the initial confirmed user-visible
incident update within 30 minutes, update at least hourly, and close it on
resolution; directly notify affected event teams when material.

## 14. Official legal references

- [EU Digital Services Act](https://eur-lex.europa.eu/eli/reg/2022/2065/oj)
- [EU General Data Protection Regulation](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [Swedish Electronic Bulletin Boards Act, SFS 1998:112](https://data.riksdagen.se/dokument/sfs-1998-112.html)
- [Skatteverket legal guidance relevant to voluntary payments](https://www4.skatteverket.se/rattsligvagledning/edition/2026.6/364826.html)
- [Swedish E-commerce Act, SFS 2002:562](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2002562-om-elektronisk-handel-och-andra_sfs-2002-562/)
- [Bolagsverket organization-number lookup](https://bolagsverket.se/foretag/organisationsnummer.1207.html)
- [W3C WCAG 2.2 Recommendation](https://www.w3.org/TR/WCAG22/)
- [W3C accessibility-statement guidance](https://www.w3.org/WAI/planning/statements/)
- [Swedish Act 2023:254 on accessibility of certain products and services](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2023254-om-vissa-produkters-och-tjansters_sfs-2023-254/)
- [PTS rules for accessibility of covered services](https://pts.se/contentassets/bda1046669b64e9ea9a10ddc7f8f5891/pts-foreskrifter-ptsfs-20246-om-vissa-tjansters-tillganglighet.pdf)
- [Apple iPhone web-app installation](https://support.apple.com/en-euro/guide/iphone/iphea86e5236/ios)
- [Google Chrome Android web apps](https://support.google.com/chrome/answer/9658361/use-progressive-web-apps-android?co=GENIE.Platform%3DAndroid&hl=en-GB)
