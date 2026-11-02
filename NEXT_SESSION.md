# Promenadis implementation handoff

Last updated: 2026-11-03

## How to resume

For a fresh Codex task, use this prompt:

> Continue implementing Promenadis. Read `README.md`,
> `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`,
> `docs/SECURITY_PRIVACY_LEGAL.md`, and `NEXT_SESSION.md` completely before
> responding. Creation mode is authorized, but no real public/unlisted pilot,
> production data, external spend, or deferred feature is authorized. Continue
> the current milestone, verify changes, and update canonical documentation when
> implementation learning changes a settled decision.

In the current task, simply say: **Continue Promenadis.**

## Current phase and instruction

User checkpoint rule: monitor usage during longer work. Near the limit, stop at
a safe checkpoint, update this handoff, commit and push, then pause. Report any
push failure explicitly. GitHub origin is linussvahn/promenadis over SSH.

Creation mode is active. The user approved the architecture and authorized
Milestone 0 on 2026-09-07. Implement autonomously within the accepted scope and
vertical milestone order. Ask only when a missing decision would materially
change scope, risk, cost, or external state. Real residential data, a public or
unlisted pilot, provider purchases, production deployment, and deferred features
remain outside this authorization.

## Latest decisions

- Added device/light/dark appearance selection in public and account headers.
  The non-sensitive preference is stored locally, applied before first paint,
  and falls back to the device theme when storage is unavailable. Forms, cards,
  navigation and notices follow the theme; geographic map styling is unchanged.
  Recovery security notices remain the next implementation-plan step.

- Browser-session hardening approved and implemented locally: opaque HttpOnly,
  SameSite cookies; Supabase tokens and PKCE state encrypted behind the existing
  BFF; account-ID fences on protected requests; account-scoped UI invalidation.
  No new paid service. Local sessions expire after 12 hours, pending login after
  15 minutes/five attempts; minutely expiry erasure. Hosted gateway fails closed
  until HTTPS/Secure cookies, dedicated rotated keys, admission limits and
  credentialed routing preserving the public-only Netlify boundary are reviewed.
- Existing local accounts/events were preserved using a forward migration.
  Users need a fresh code/link after legacy localStorage credentials are
  discarded. Do not reset their database. Auth/session changes do not establish
  the cause of the reported Zen window account switch: that remains unresolved.
- Local tests cover two separate Chromium browser contexts, distinct profile
  edits/reloads, no browser-readable tokens, stale account writes, CSRF rejection,
  concurrent refresh, local logout and rejected cookie replay. Database suite:
  366 rollback-only assertions passed, including vault grants, lease ownership,
  Auth-session revocation, expiry and attempt limits. Continue the existing
  recovery/lifecycle plan; the Zen-specific recheck remains a separate open item.
- Verification for this slice: 79 unit/component/contract/client tests,
  all four local-auth browser tests, three mobile smoke tests, the synthetic
  BFF integration, database lint/type drift, secret scan, contracts and build
  passed. The existing map bundle-size warning remains. No deployment or
  production provider configuration was performed.

- Retention is privacy-first and limited to the shortest legally and
  operationally necessary period. Promenadis will not retain personal data
  merely in case it becomes useful; extensions require an active incident or
  documented legal hold.
- Provisional retention maximums are 30 days for security/authentication logs,
  6 months for ordinary moderation/report/appeal evidence, and 12 months for
  serious cases and privileged administrator audit records. Swedish legal
  review may shorten them before launch.
- Event owners can see a co-host or moderator's stable event display name and
  role for that person's audited team actions. Owner-facing audit history does
  not expose email/authentication identifiers or restricted seller/reporter
  identities.
- A sufficiently complete unauthorized-address report immediately quarantines
  only the reported physical location pending authorized human review. Safety
  removal bypasses normal snapshot refresh, triggers urgent cache invalidation,
  and does not reveal the reporter to the seller or event owner.
- Only a freshly elevated platform administrator can reverse a platform-admin
  suspension. A solo administrator may do so with fresh TOTP, reason, and a
  non-independent audit marker. Once two eligible administrators exist, a
  different administrator must approve reinstatement, platform-admin role
  changes, bulk sensitive-data exports, and production restores. Emergency
  suspension remains immediate.
- Before publishing, an event owner must save a hashed, single-use recovery code
  and is strongly encouraged to enable TOTP. The owner may predesignate one
  verified co-host as emergency successor. Recovery/transfer has a 24-hour delay
  and notifications; a successor receives only the event, never the old account.
  No ad-hoc identity-document recovery is offered.
- One verified account may manage multiple public organizer profiles. Each event
  selects one stable organizer profile; private account identity stays hidden,
  while abuse enforcement applies across all profiles linked to the account.
- Every published public or unlisted event has a structured two-way organizer
  relay with no automatic email-address disclosure. Messages are short plain
  text without attachments; platform safety/legal reports remain separate.
- Synced routes and identifiable attendance expire within 24 hours after event
  end/cancellation. Notification metadata and in-app content expire after 30
  days; relay bodies after 30 days and routing metadata 14 days after the event.
  Email suppressions use HMACed application state and remain only while the
  address is referenced or its current opt-out/bounce state is necessary.
- Every event has exactly one owner. Planned transfer requires recent
  authentication and acceptance by a verified co-host who already manages the
  selected organizer. One transfer may be pending for at most seven days;
  acceptance/cancellation deletes it immediately. A sole owner deleting their
  account must transfer, delete drafts, or cancel published/active events;
  cancellation first unpublishes all seller locations. Unreachable-owner cases
  use only the predesignated-successor workflow.
- At the 30-seller entitlement, otherwise eligible applications become
  waitlisted. Automatic-admission events promote the earliest eligible seller
  only before activation; manual/invite-only and active events require host
  selection. Approved, suspended, and address-change-review states retain a
  slot, and capacity is enforced transactionally.
- Each approved seller uses one seller place even at a shared address; shared
  addresses remain one pin and route stop. The 50-stop route ceiling remains: it
  permits dense 50-stop walks and is not itself a feasibility judgment.
- Only sellers using the same actual entrance/yard/stall share a canonical stop.
  Nearby distinct addresses remain separate locations and count individually
  toward the 50-location limit, but may form a derived overview/optimization
  cluster whose visit time sums the individual stops.
- Seller-initiated active-event pin/address changes immediately unpublish only
  that seller and require reapproval. Authorized event-team members may make an
  audited same-address correction of at most 25 metres without closing the stop;
  all active changes urgently invalidate snapshots and routes.
- Severe-weather postponement immediately hides locations, pauses registration,
  and preserves a public notice page. A replacement is due within 14 days and
  within 30 days of the original date; sellers must reconfirm before republication
  and precise data is deleted at the 14-day mark if rescheduling fails.
- Published boundary/schedule edits are versioned pending revisions with impact
  previews and required artifact rebuilds. Active boundaries/core intervals are
  locked; extensions require seller opt-in before activation, while an active
  event can only end early, postpone, or be followed by a duplicated event.
- Seller check-in is optional; scheduled availability is authoritative. Away and
  early-close updates affect server routes immediately and target safety-visible
  clients within 15 seconds, while full snapshot replacement targets 60 seconds.
  Shared pins remain while another seller is open; offline clients show their
  last-update time.
- Visit-time presets are quick (2 minutes plus 1 per additional selected seller),
  standard (5 plus 2), and leisurely (10 plus 5), with custom global and sparse
  per-location overrides. Estimates warn and guide optimization but never block
  route start.
- Availability-aware routing normally accepts up to 20% extra walking to reduce
  predicted misses, supports up to ten must-see sellers, and shows alternatives
  beyond the guardrail. It never silently drops stops or reorders an active walk.
- Disconnected sellers remain discoverable but are excluded from connected
  optimization by default. Visitors may explicitly add a labelled manual gap;
  Promenadis never draws it as a verified path or invents its travel time.
- Owners and co-hosts preview graph connectivity and detour anomalies before
  route readiness. They may make audited, event-scoped entrance/manual-access/
  unsafe-edge corrections or attest a connector of at most 100 metres; each
  publication creates an immutable version, and moderators cannot publish it.
- Production graph builds use weekly checksum-verified, metadata-stripped
  Geofabrik Sweden extracts cached privately in AWS Stockholm and a version-
  pinned ECS Fargate compiler in `eu-north-1`. Public Overpass is diagnostic-
  only; jobs and packages are immutable, idempotently versioned, and visibly
  attributed under ODbL, with conservative derived-database treatment pending
  launch legal review.
- Route packages target 2 MiB compressed and 25 MiB decoded with a hard 5 MiB
  compressed ceiling. Supabase Storage retains the current plus two preceding
  successful versions while published/active; older artifacts and post-event
  packages expire promptly. The managed offline cache is capped at 50 MiB, and
  the safety feed can block unsafe edges before a replacement graph is accepted.
- Geolocation is optional and requested only after an explicit visitor action.
  Map-picked, selected-stop, and unfixed-start routing work without it; inaccurate
  or out-of-network positions never create fabricated legs. Live coordinates
  remain transient, foreground-only browser state and are never uploaded.
- The user rejected a permanently self-funded production baseline around 500
  SEK/month. Development must remain free or near-free, and public production
  must use a materially cheaper, explicitly capped topology or wait for external
  funding.
- The accepted cost-capped topology keeps Netlify Free for static/sanitized
  public delivery and moves `/api/v1` plus I/O-bound durable queue workers to
  Supabase Edge Functions in Frankfurt. PostgreSQL/Queues/Cron remain the job
  source of truth and Fargate remains graph-only. Development is free-tier;
  public production has a hard 350 SEK/month personal out-of-pocket launch gate.
- Public reads use a typed manifest, content-addressed allowlisted full snapshot,
  and coordinate-free safety feed with opaque event-scoped IDs. Authoritative
  safety changes are immediate and target clients within 15 seconds; ordinary/
  full-snapshot publication and CDN removal target 60 seconds. Blind rollback
  cannot resurrect removed residential data.
- Database state uses readable declarative SQL plus immutable, reviewed,
  forward-only Supabase migrations; no ORM owns the schema. Supabase-generated
  row types remain internal, while strict Zod 4 schemas own API/snapshot/queue/
  webhook contracts and generate JSON Schema/OpenAPI artifacts. CI rebuilds and
  pgTAP-tests the database and fails on generated drift.
- Environments are local Supabase/Docker, fixture-backed secretless Netlify PR
  previews, one resettable synthetic Supabase Free staging project, and a fully
  isolated production project. Production data is never copied to nonproduction;
  automatic metered Supabase preview branches are deferred.
- Releases are CI-gated and automatically serialized to synthetic staging but
  manually promoted to production as the exact staged revision. Database change
  is forward-only expand/contract; application rollback is allowed only while
  schema-compatible, and database defects are corrected forward. A small typed,
  Postgres-backed, audited feature-flag/kill-switch mechanism replaces paid flag
  SaaS; flags normally expire within 90 days and never grant authorization.
- Monitoring uses privacy-minimized Better Stack Free outside-in checks and a
  public status page, plus a one-minute AWS probe only around accepted live
  events. The solo operator covers two hours before through one hour after each
  pilot, targets 15-minute SEV-0/1 acknowledgement without offering an SLA, and
  keeps raw operational/alert records no longer than 30 days.
- Moderation decisions can be appealed. Use a different administrator for review
  when multiple administrators exist.
- Launch is text-only; seller photo uploads are deferred to a separately
  moderated post-launch pilot.
- A ToS clause cannot eliminate Promenadis's own platform obligations.
- Provider selection is low-commitment by default: use free/freemium tiers for
  development and closed alpha, prefer metered pay-as-you-go services with hard
  limits, and activate fixed subscriptions only for a measured event need or
  external funding. Supabase Pro is the deliberate public-event exception; it
  need not remain enabled when post-event work is complete and Free is safe.
- The accepted self-funded capacity envelope is one 500-seller/10,000-visitor
  event per paid month. Up to three overlapping equivalents are conditional on
  load tests, provider headroom, operator coverage, and a fresh projection below
  350 SEK; five equivalents are funded-only. Working all-in estimates are about
  335/344/356 SEK for one/three/five, and any required Small database, Netlify
  Personal, or paid Geoapify tier fails the personal-budget gate.
- Backup recovery uses Supabase Pro's included seven-day daily backups first,
  plus independent Supabase CLI logical archives created by short-lived Fargate
  tasks daily and hourly around covered events. Archives are encrypted to an
  offline key, kept under 14-day S3 Object Lock in Stockholm, checksum-verified,
  and quarterly restored in isolation with erasure-tombstone replay. PITR and
  object-for-object copies of reproducible launch assets are excluded.
- Abuse protection keeps anonymous public reads on bounded CDN snapshots and
  uses short-lived HMAC-keyed Postgres token buckets for writes/provider calls.
  Cloudflare Turnstile Free protects passwordless email and anonymous reports/
  relay, Supabase Auth limits remain enabled, and conservative geocoding,
  application, report, and export limits preserve safety-command capacity. Raw
  IPs/fingerprints, paid Redis, and AWS WAF are excluded at launch.
- Ordinary organizers use verified email, recovery/publication attestations,
  and first-event review without legal names, phone, ID documents, residence
  proof, or BankID; they receive no identity badge. Registered organizations may
  earn a narrowly scoped badge through official registry plus control checks,
  and are required above the free entitlement. Before a real pilot, Promenadis
  itself publishes its legal operator/controller, compliant Swedish
  establishment address, monitored contact routes, and applicable registration
  details; otherwise the service remains closed alpha.
- Public events enter Promenadis discovery, organizer listings, and the sitemap
  only while published; only their sanitized event landing page is indexable.
  Map/route/seller resources and exact location data are always non-indexable.
  Unlisted events use a high-entropy reshareable URL, remain absent from all
  discovery and sitemaps, and are explicitly described as link-accessible rather
  than private. Seller reconfirmation is required before an unlisted event with
  joined sellers becomes public; visibility locks at activation. Rotated/deleted
  known URLs return `410`, and crawler directives are never treated as access
  control.
- WCAG 2.2 Level AA is the launch target for every first-party role and both
  languages. Core map, route, boundary, and pin tasks have equivalent structured
  list/button/keyboard workflows; dragging is optional. Automated checks are
  supplemented by manual zoom, keyboard, contrast/motion, and representative
  mobile/desktop screen-reader testing before a real pilot. A truthful footer-
  linked accessibility statement lists assessed status, limitations,
  alternatives, tested environments, and accessible feedback routes; no full-
  conformance or legal-compliance claim is made without evidence and review.
- Promenadis is a URL-first, optionally installable PWA with no launch app-store
  packages. Tier 1 covers current/previous iOS/iPadOS Safari, Android 10+ with
  current plus two Chrome releases, and the current plus two desktop Chrome,
  Edge, Firefox, and Safari releases. Feature detection preserves structured
  list/manual fallbacks. Explicitly prepared routes and progress work through
  connection loss without promising a complete offline basemap; first load,
  safety refresh, authentication, and every private/sensitive write require an
  online response. Hard expiry and privacy boundaries apply to cached data, and
  service-worker updates never disrupt an active walk.
- Category identities are stable, versioned, and independent of language,
  beginning with the accepted fourteen-category `flea-market-v1` Swedish/
  English seed. Sellers choose one to five categories and may author up to ten
  short untranslated tags; organizers may enable/reorder a subset and suggest
  up to twelve tags but cannot create or rename canonical categories. Published
  events pin the taxonomy version, and tags follow listing moderation and
  deletion rather than creating a retained analytics dataset.
- Pilot rollout is synthetic dogfood, a 5–10-person closed alpha without public
  real residential locations, then one real event with at most 30 sellers.
  Support and feedback stay first-party and low-cost. There is no calendar-based
  release freeze or formal change board while the service is unpaid: the solo
  operator may deploy at their discretion. Automated CI, safe migrations,
  production confirmation, location expiry/takedown, monitoring, kill switches,
  and rollback/forward-fix readiness remain mandatory because free usage does
  not reduce privacy or safety risk. Formal freezes are reconsidered before paid
  service or an SLA.
- A bounded, fixed-scope Swedish legal review is required before the first real
  public or unlisted pilot, but it does not block implementation, synthetic
  dogfooding, or closed alpha without public real residential locations. Counsel
  reviews the free-launch GDPR/controller, UGC/reporting, DSA/BBS, operator,
  accessibility, retention, and ODbL position. Commercial contracts, VAT,
  payments, refunds, and consumer-distance-selling advice remain deferred until
  Promenadis plans to charge.
- The architecture sign-off criteria and seven vertical implementation
  milestones are accepted. The readiness packet now contains an explicit
  authorization matrix, threat model/trust boundaries, data classification and
  erasure matrix, provider/environment/secret inventory, and traceable creation/
  alpha/pilot/paid checklist. All discovery sign-off artifacts are complete and
  the user explicitly authorized creation mode on 2026-09-07.

The complete settled scope and readiness packet are in the canonical documents
linked from `README.md`.
Treat those documents as canonical rather than relying on chat memory.

## Implementation progress

- Creation authorization is recorded in the launch checklist and canonical
  status headers.
- ADR-0001 selected a Node 24/pnpm 11 workspace with `apps/web`,
  `packages/domain`, `packages/contracts`, `packages/i18n`, and `supabase`.
- The React Router framework-mode shell renders in Swedish and English, includes
  semantic/keyboard/reduced-motion foundations, an install manifest, and a
  shell-only offline fallback. It does not cache event or personal data.
- Pure event-state and fail-closed capability rules have unit tests. Strict Zod
  API/manifest/queue/safe-log schemas generate committed JSON Schema 2020-12 and
  OpenAPI 3.1 artifacts with a drift check.
- `pnpm verify` and the mobile Chromium/PWA smoke suite passed locally on
  2026-09-07. The production dependency audit reported no known vulnerability.
- Docker Desktop and the local Supabase stack are running. The database rebuilt
  from zero, Promenadis-owned schemas passed strict lint, all seven pgTAP
  privilege-denial tests passed, and committed database types match the live
  local schema on 2026-09-07.
- Milestone 0 is complete locally. Hosted GitHub Actions evidence awaits placing
  this workspace in a GitHub repository and does not block Milestone 1.
- The first Milestone 1 vertical slice is complete locally. Supabase Auth now
  creates a minimal profile; a service-only Edge BFF exposes allowlisted profile,
  organizer, draft-event, and dashboard contracts; authenticated browser roles
  have no direct table or command privileges; and Swedish/English sign-in and
  dashboard flows are implemented.
- The identity/event migration rebuilt from zero, strict schema lint passed, all
  25 pgTAP tests passed, generated database and contract artifacts have no drift,
  and the synthetic `pnpm test:local-slice` exercise passed across Auth, BFF,
  Postgres, audit writes, dashboard reads, and direct-table denial on 2026-09-07.
- `pnpm verify` and all three mobile Chromium/PWA/sign-in smoke tests passed after
  this slice. The local Edge health contract returns `200`, missing authentication
  returns the versioned `401`, and an untrusted origin returns `403`.
- The local Auth email template visibly includes both a six-digit OTP and magic
  link. Automatic callback processing is disabled in favor of the explicit PKCE
  exchange, avoiding a double-exchange race. Both real local browser paths pass
  `pnpm test:e2e:local-auth` as of 2026-09-07.
- First-event UX is settled: a private individual creates an event directly via
  `Organized by you`; the UI confirms the public name and creates the internal
  individual organizer profile automatically. Do not show an organizer selector
  unless the account can act through multiple profiles.
- The settled first-event UX is implemented locally. One BFF command now creates
  the first `individual` organizer profile when needed, the draft event, exactly
  one owner membership, and one opening interval in a single transaction. A sole
  usable organizer is selected automatically; multiple usable profiles require
  an explicit `Organizing as` selection.
- The authenticated host UI was reset after browser review exposed backend
  resource boundaries directly on one long dashboard. `My events` is now a
  focused event-card index; creation follows `Basics -> Area -> Review`; every
  draft has a dedicated workspace and setup checklist; and profile plus optional
  group/association/company identities live under Settings.
- The boundary editor is now map-first with undo, clear, and point-count feedback.
  Raw ordered longitude/latitude controls remain fully keyboard-accessible but
  are collapsed under an explicitly advanced editor instead of dominating the
  normal flow.
- The scheduled-event migration rebuilt from zero, strict schema lint passed,
  all 48 pgTAP checks passed, generated database and API contract artifacts have
  no drift, and the synthetic Auth/BFF/Postgres integration passed on 2026-09-07.
  Both real local passwordless browser paths still pass, with the email-OTP path
  additionally creating and rendering the first scheduled event.
- Draft boundary configuration is implemented locally as a versioned PostGIS
  polygon. The owner/co-host command is draft-only, uses optimistic concurrency,
  computes authoritative geodesic area and maximum vertex span, enforces the 25
  km² and 10 km hard limits, warns at 80 percent, and audits metrics without
  copying coordinates into the audit summary.
- The bilingual host editor uses the current OpenFreeMap Liberty style with
  MapLibre and supports click-to-add map drawing. The same ordered points remain
  fully editable through labelled longitude/latitude fields plus add, move, and
  remove buttons, so saving does not require WebGL, pointer dragging, or sight.
- The boundary migration rebuilt from zero and passed strict lint. All 73 pgTAP
  assertions pass, including direct-access denial, authorization, geometry,
  limits, lifecycle lock, redacted audit, rollback, and stale-version tests. The
  synthetic Auth/BFF/PostGIS slice and real email-OTP browser flow both create
  and round-trip a boundary as of 2026-09-07.
- The host UI reset passed `pnpm verify`, the three mobile shell/sign-in smoke
  tests, and both real local passwordless browser paths on 2026-09-08. The OTP
  path creates a private draft, advances through Basics and Area, saves a
  boundary through the structured accessible fallback, and reaches Review.
- Draft seller-registration windows are implemented end to end. Creating a
  scheduled draft creates version 1 automatically, opening at draft creation and
  closing one hour before the event. Owners and co-hosts can edit the window
  through a service-only, draft-only, optimistic-concurrency command; accepting
  registrations after the event begins requires explicit consent, and the
  window may never extend past the event.
- The per-event workspace and Review screen now surface the bilingual
  registration window, with a dedicated accessible editor that interprets
  wall-clock inputs in the event time zone. Direct browser table access remains
  denied and successful changes are audited without seller or address data.
- Draft event controls are implemented end to end. Events now carry their own
  optimistic version; owners and co-hosts can switch public/unlisted intent
  through a service-only command, and owner-only deletion requires a current
  version, exact-title confirmation, and authentication within 15 minutes.
  Cascading draft data is removed while the surviving audit retains only the
  event ID and safe state/version/visibility metadata.
- The bilingual event workspace exposes the visibility control and a clearly
  separated deletion danger zone only for eligible draft roles. State labels
  now cover the full lifecycle, and draft-only setup links are hidden for later
  states. Publishing remains unavailable: recovery enrollment and current-
  configuration attestation are implemented, while first-event review, routing,
  public delivery, and the delayed recovery/claim workflow remain fail-closed.
- Event-team management is implemented end to end. Owners can create seven-day
  co-host/moderator invitations, see and revoke pending invites, change non-owner
  roles, and remove members. The intended verified account sees the invitation
  on its dashboard and chooses an event-facing display name on acceptance.
  Privilege changes require authentication within 15 minutes; acceptance and
  cancellation delete the email immediately, and an hourly database job purges
  expired invitations. Ownership cannot be changed through ordinary role
  controls, and external invitation-email delivery remains deferred.
- Planned event-ownership transfer is implemented end to end. A recently
  authenticated owner gets only compatible verified co-host/organizer choices
  and must review both before initiating. The intended co-host accepts
  explicitly; the previous owner becomes co-host, and management of the exact
  owner-approved target organizer is rechecked without granting it. Acceptance
  atomically changes event ownership and, when selected, the public organizer
  identity. The locked team version serializes changes, a partial unique index
  plus deferred constraint trigger enforce exactly one owner, and pending
  transfer rows are deleted on resolution or purged after at most seven days.
- Organizer-manager access is implemented end to end for shared informal-group,
  association, and company identities. Only the organizer owner can create,
  cancel, or remove managers with recent authentication and optimistic
  concurrency. The intended verified account sees and explicitly accepts the
  seven-day invitation; acceptance/cancellation deletes the email-bearing row,
  an hourly job purges expiry, and audit summaries exclude email and account
  identifiers. Individual organizer identities reject manager invitations.
- The new migrations rebuild from zero, strict schema lint passes, and all 259
  pgTAP assertions pass. All 58 unit/component tests and the synthetic
  two-account Auth/BFF/Postgres lifecycle pass as of 2026-09-08. That lifecycle
  now covers event invitations, organizer-manager invitations, a private-person
  handoff to the recipient's own organizer identity, the reverse handoff, and
  direct-table denial. Generated database and contract artifacts are current.
  Both real local passwordless mobile Chromium paths also pass, with the OTP
  path creating a shared organizer and exercising its manager invitation UI.
- Owner recovery-code enrollment is implemented end to end. The BFF generates a
  non-ambiguous single-use code, returns its plaintext once, and stores only a
  bcrypt hash plus minimal rotation metadata. Enrollment/rotation requires a
  verified email, recent authentication, and the current optimistic version;
  direct browser table access remains denied.
- Owners can designate, replace, or clear one verified co-host as emergency
  successor, including the exact organizer identity that person already
  manages. The command requires recent authentication and the current team
  version, audits only safe role metadata, and clears stale designations when
  the co-host role, organizer access, or ownership changes.
- Emergency-successor claims are implemented end to end. The designated
  verified co-host explicitly initiates the claim, the owner or successor may
  cancel it, and only the successor may complete it after 24 hours. Completion
  atomically rechecks the current designation, roles, approved organizer access,
  event state, and team version, then transfers only the event and approved
  organizer identity. Claims expire within seven days. Structured per-account
  notification intents are written to a private local outbox; actual external
  email delivery remains a pilot gate and the UI does not claim delivery.
- Draft publication readiness and owner attestations are implemented as
  version-bound, service-only commands with bilingual UI. An attestation covers
  the exact event, boundary, registration, and visibility versions and becomes
  stale after any relevant change. Readiness always remains blocked on the
  unbuilt first-event review, routing, and public-delivery gates; no publish
  command or public activation path has been introduced.
- The current migrations rebuild from zero, strict schema lint has no errors,
  and all 319 pgTAP assertions pass. All 70 unit/component tests, the
  synthetic two-account Auth/BFF/Postgres lifecycle, and both real local
  passwordless mobile Chromium paths pass as of 2026-09-09. Generated database
  and contract artifacts are current.

## Recommended next work

### Milestone 2 plan and slice 1 (2026-11-03)

Planned slices, each its own commit:

1. Seller applications and admission (done, below).
2. (done) Geocoding adapter (local fixture, Geoapify later), shared locations
   (exact-address prompt, host merge/split), address-change reapproval, pin
   correction up to 25 m.
3. (done) Taxonomy `flea-market-v1`, event taxonomy subset, seller listing content
   (title, description, categories, tags, items, accessibility facts),
   availability and live status.
4. Reports, unauthorized-address quarantine, hide/suspend/revoke, appeals,
   invite-only seller invitations.
5. Event-relative retention: non-public at end/cancel, 14-day erasure,
   tombstones, heartbeats; postponement and reschedule confirmation.

Slice 4a, `20261103000400_reports_moderation.sql`:

- Anonymous `POST /reports` (handled before the auth gate; the browser
  gateway forwards it without the session). Structured: subject
  (location/participation/item), eight reasons, details, optional
  relationship and contact, honeypot field. Limits: 3/hour per HMAC of the
  network prefix (IPv4 /24, IPv6 /48; raw IP never stored) and 10/hour per
  subject (`app_private.report_rate_buckets`, purged hourly). Clear the table
  between repeated local e2e runs. Turnstile/CAPTCHA is a hosted-alpha gate.
- Reports collapse into one open `moderation_cases` row per subject. The
  first complete unauthorized-address report (relationship resident/owner/
  manager, no-consent confirmation, 20+ character details) quarantines only
  that physical location (`event_locations.quarantined_at`). The answer is
  always `{received: true}`.
- Team (owner/co-host/moderator): `list_event_cases_command` (no reporter
  identity or contact), `review_moderation_case_command` (restore / uphold /
  dismiss with a reason; a quarantined location must be restored or upheld;
  uphold revokes every seller at the stop and erases the address, or hides a
  reported item), `moderate_participation_command` (hide/restore listing text
  or item, suspend/reinstate). `app_private.moderation_actions` records each
  action with the affected account so it can be appealed;
  `list_my_moderation_command` shows a seller what affected them.
- `app_private.platform_account_restrictions` exists so local reviewers
  cannot restore or reinstate a platform-restricted seller; admin commands
  arrive in 4b.
- Web: public `/report` page, `EventCases` and moderation buttons on the
  sellers page, quarantine/hidden notices for sellers.
- Deferred: seller/owner notification of quarantine (Milestone 5 mail),
  urgent feed/snapshot invalidation (Milestone 3), watchlist entries,
  report/case retention purge (slice 5).
- Verified: pgTAP 310 (30; 744 total), 99 web tests, full verify, DB
  rebuild, 16/16 local-auth e2e (one submits through the browser gateway),
  5 smoke, integration scripts.

Slice 3, `20261103000300_taxonomy_listings.sql`:

- Taxonomy `flea-market-v1`: `taxonomy_versions`, `taxonomy_categories`
  (14 fixed UUIDs `0199a000-0000-7000-8000-0000000000NN`, keys, `is_other`,
  deprecation/replacement columns), `taxonomy_category_localizations`
  (sv/en labels, descriptions, reviewed synonyms). Taxonomy changes are
  reviewed migrations only.
- `event_taxonomies` (pinned version, enabled subset in event order, up to 12
  suggested tags) created by trigger; `save_event_taxonomy_command`
  (owner/co-host, drafts only — published events are pinned). Duplication
  copies the subset, suggestions and admission mode.
- Listing: `seller_listings` (title, description <= 1000, accessibility facts
  as nullable booleans plus indoor/outdoor, early-visibility opt-out),
  `seller_category_assignments` (1-5 enabled categories; "Other" needs a
  10+ character description), `seller_tags` (<= 10, <= 30 graphemes in the
  contract, normalized identity, reserved words for badges/accessibility/
  safety refused), `highlighted_items` (<= 20, one category, sold status,
  optional integer minor-unit price in SEK), `seller_availability` (<= 10,
  inside the event, no overlap; empty = whole event). One whole-listing save.
- `seller_live_status` + `set_seller_live_status_command`: active events and
  approved sellers only; open/away/closed_early; the team may act on behalf
  only with a reason (audited); closing early is final for the seller and
  keeps the place.
- BFF: `GET/PUT /events/{id}/taxonomy`, `GET/PUT /participations/{id}/listing`,
  `POST /participations/{id}/live-status`.
- Web: `SellerListingEditor` on the join page (and live-status buttons
  during the event), `EventTaxonomyEditor` and a per-seller listing view with
  on-behalf live status on the sellers page.
- Deferred to Milestone 3: public display and full-text/trigram search,
  explicit taxonomy upgrade for drafts (only v1 exists).
- Verified: pgTAP 300 (31; 714 total), 93 web tests, full verify, DB
  rebuild, 15/15 local-auth e2e, 5 smoke, integration scripts.

Slice 2, `20261103000200_shared_locations_address_change.sql`:

- Geocoding: `supabase/functions/api-v1/geocoder.ts` adapter. Local default is
  a deterministic fixture ("Testgatan N"/"Provgatan N"; anything else is not
  found). Hosted gets no geocoder unless `GEOCODER_PROVIDER=geoapify` and
  `GEOAPIFY_API_KEY` are set (code written, never called: no keys, no spend).
  `POST /events/{id}/geocode` checks a 7-day cache keyed by a SHA-256 of the
  normalized query (coordinates only), then the budget
  (`reserve_geocode_request_command`: 10/min, 30/day per account, 750/day per
  event, 2,500/day platform), then the provider. Failure degrades to the
  manual pin. Hourly purge of cache and request rows.
- Apply now takes `placement` (`geocoded` only when the seller kept the
  proposed point) and `sharesEntrance`. An exact normalized-address match
  with another active stop returns 409 `shared_entrance_question`; "yes"
  joins that stop, "no" creates a new stop flagged `needs_review`.
- `change_participation_address_command`: pending/waitlisted follow normal
  admission; approved or pending_address_change become
  `pending_address_change` (keeps the place; approve needs no free place).
  Other sellers at a shared stop keep it.
- `review_event_location_command` (owner/co-host): merge, split,
  confirm_separate. `correct_location_pin_command` (team incl. moderator):
  recent auth, reason, at most 25 m; before/after points live in
  `app_private.location_pin_corrections` (cascade-deleted with the
  location), the audit keeps only distance. Placement becomes `corrected`.
- Web: shared `SellerAddressForm` (find on map, pin, shared-entrance
  question, attestation) for applying and changing address; team
  `LocationTools` (shared/own stop, review buttons, split, pin correction).
- Deferred to Milestone 5 (mail): seller notice of pin corrections and
  decisions. Urgent snapshot/route invalidation arrives with publication
  (Milestone 3).
- Verified: pgTAP 290 (28; 683 total), component tests (167 total), full
  verify, DB rebuild, 14/14 local-auth e2e, 5 smoke, integration scripts.

Slice 1, `20261103000100_seller_admission.sql`:

- `events.admission_mode` (`auto_inside` | `host_approval` | `invite_only`,
  default `host_approval`) and `waitlist_promotion_paused`;
  `event_entitlements` (seller limit 30, platform-controlled, created by
  trigger).
- `event_locations` (private address, manual pin, `inside_boundary`,
  normalized address for later shared-location matching) and
  `seller_participations` (one per account/event, nine states, transition
  trigger mirroring `packages/domain/src/seller-admission.ts`). Closing a
  participation clears its location and the location row is deleted, so
  closed applications keep no address.
- Commands: `get_event_for_seller_command`, `apply_to_event_command`
  (registration window, not invite-only, attestation, boundary required,
  10 applications/account/day, inside+auto = approved or waitlisted, else
  pending; outside = geographic exception), `list_my_participations_command`,
  `withdraw_participation_command`, `list_event_sellers_command` (team;
  places used vs map locations), `decide_seller_participation_command`
  (owner/co-host/moderator; approve/waitlist/reject/revoke; capacity checked
  under the event lock; reasons for reject/revoke; no self-decision),
  `update_event_admission_command` (owner/co-host, draft/published).
  `promote_waitlisted_sellers` runs after withdraw/revoke/admission change:
  automatic mode only, not paused, before the start, inside-boundary only.
- BFF: `GET /events/{id}/seller-view`, `POST /events/{id}/participation`,
  `GET /events/{id}/sellers`, `PUT /events/{id}/admission`,
  `GET /participations`, `POST /participations/{id}/withdraw|decision`.
- Web: `/events/:id/join` (application with map pin plus typed-coordinate
  fallback, status, withdraw), `/events/:id/sellers` (places, join link,
  admission settings, decisions), "Your seller applications" on the dashboard.
- Not yet: geocoding (pins are manual), shared stops, address change,
  suspension/reinstatement (moderation slice), invitations for invite-only
  events, notifications to sellers, account-deletion blockers for sellers.
- Verified: pgTAP 280 (34; 655 total), domain/component tests (164 total),
  full verify, DB rebuild, 13/13 local-auth e2e, 5 smoke, all integration
  scripts.


### Milestone 1 completion gaps (2026-11-02)

A review against `docs/LAUNCH_CHECKLIST.md` found four Milestone 1 items with
no command. All four are now built:

- `20261102000400_event_editing_duplication.sql`:
  - `update_draft_event_details_command`: owner/co-host, drafts only; edits
    title, description, time zone and the first interval. Registration settings
    that no longer fit the new schedule reset to the defaults (reported as
    `registrationReset`). The version bump invalidates attestation and review.
  - `update_organizer_profile_command`: managers; name, locality, website.
    Type is fixed after creation. New `organizer_profiles.version`. A rename
    of a verified organization goes back to review (existing trigger).
  - `duplicate_event_command`: owner/co-host of any state; reuses
    `create_scheduled_draft_event_command` so the actor must manage the target
    organizer. Copies description, time zone, visibility and boundary; never
    dates, team, registration, sellers or history. The copy is owner-only.
  - `admin_get_event_command` and `admin_intervene_event_command`: elevated
    admin looks up an event by ID, then cancels a published/postponed event
    (public notice) or ends a live one. The internal reason goes into the
    restricted audit record.
- BFF: `PUT /organizers/{id}`, `PUT /events/{id}/details`,
  `POST /events/{id}/duplicate`, `GET /admin/events/{id}`,
  `POST /admin/events/{id}/intervention`.
- Web: `EventDetailsEditor` and `EventDuplicate` on the event overview,
  `OrganizerProfileEditor` in Settings (including the personal organizer),
  `AdminEventIntervention` on `/admin`. Event-time-zone wall-time helpers moved
  to `apps/web/app/lib/wall-time.ts`.
- Flaky e2e fixes: Settings no longer resets a typed display name when the
  dashboard reloads in the background (it now keys on the stored value). The
  recovery-completion e2e waits for the page to read the link token before
  clicking.
- Verified: pgTAP 270 (35; 621 total), component tests (151 total), full
  verify, DB rebuild, 12/12 local-auth e2e (twice), 5 smoke, all local
  integration scripts. Repeated recovery runs hit the local recovery rate
  limit (429); clear `app_private.local_recovery_budget` between repeats.
- Still deferred, all waiting on later milestones: postponement (seller
  reconfirmation), published boundary/schedule revisions (seller impact),
  admin postponement, copying/inviting the previous team on duplication,
  routing/public-delivery publication gates, Turnstile and production Auth
  limits.

Milestone 1 is complete locally for everything that does not depend on a
later milestone. Next: Milestone 2 (sellers and safety lifecycle).

### Batch (2026-11-01): deletion, TOTP, admin review

User asked for fewer stops: implement the next Milestone 1 items as a batch,
commit and push each, ask only on real blockers. Order: account deletion
(done), optional owner TOTP, then platform-admin elevation plus first-event
review.

### TOTP as a recovery factor (2026-11-02)

- `20261102000300_totp_recovery_factor.sql`: claims gain `method`
  (`recovery_code`|`totp`, `code_version` only for codes); in-database RFC 6238
  check (`base32_decode`, `totp_code` verified against both RFC vectors,
  `consume_recovery_totp` with +-1 step, replay fence and 5-failures/24h
  lockout in `recovery_totp_attempts`). Initiation takes exactly one factor and
  RETURNS `{"error":"invalid_recovery"}` for a wrong TOTP so the failure count
  commits (a raise would roll it back). Confirm/eligibility require the factor
  to stay verified; a trigger on `auth.mfa_factors` withdraws TOTP claims when
  it is removed. Encrypted factor secrets fail closed.
- Contract is now a union (recovery code XOR totp code); the recovery page has
  a factor choice. Test 120 call sites updated for the new parameter.
- Verified: pgTAP 260 (20), component, e2e (wrong code, both factors, success
  through completion), full verify, DB rebuild, all recovery integration
  scripts, smoke e2e; local-auth e2e 10/11 with the known flaky
  "opaque sessions" test, which passed 3/3 alone.

Milestone 1 status: every item on the list is now implemented locally except
what explicitly depends on later milestones (publication's routing/delivery
gates, sellers, public pages, notifications). Next: Milestone 2 (sellers and
safety lifecycle), or a Milestone 1 completion review against
`docs/LAUNCH_CHECKLIST.md` first.

### Organizer verification (2026-11-02)

- `20261102000200_organizer_verification.sql` + domain
  `normalizeOrganizationNumber` (Luhn, third digit >= 2 so personnummer are
  refused; SQL mirror `valid_organization_number`). Request (association/
  company members), elevated-admin queue and decision (verify needs registry
  name + active + control confirmed; reject/revoke need a reason; no self-
  review), badge = verified and before the one-year recheck, rename/type
  change returns it to pending, closed outcomes purged after 30 days.
- BFF `GET/POST /organizers/{id}/verification`,
  `GET /admin/organizer-verifications`,
  `POST /admin/organizer-verifications/{id}/decision`. Web: verification block
  per association/company in Settings; second queue on `/admin`.
- Gotcha: the Supabase CLI bind-mounts each imported shared file separately
  when the stack starts, so a NEW import from `packages/*` 503s until
  `pnpm db:stop && pnpm db:start`.
- Verified: pgTAP 250 (22), domain tests, component tests, e2e, full verify,
  DB rebuild, slice, all 10 local-auth and 5 smoke e2e.
- Not done: showing the badge publicly (Milestone 3), enforcing verification
  for events above the free entitlement (no entitlements yet), an organizer
  edit command (the material-change trigger is ready for it).

Next: TOTP as an account-recovery factor, then Milestone 2 (sellers).

### Event lifecycle (2026-11-02)

- `20261102000100_event_lifecycle.sql`: transition trigger (same table as the
  domain rules; active cannot cancel), `state_changed_at`, `public_notice`,
  `publication_system_blockers()` (routing/delivery, still closed),
  `publish_event_command` (owner, recent auth, readiness clear, before start),
  `cancel_event_command` (owner, recent auth, exact title, public reason; drops
  pending transfers/invites), `end_event_early_command` (owner/co-host, no
  step-up), per-minute `advance_event_lifecycle_command` (activate, end,
  archive 14 days after end/cancel).
- BFF `POST /events/{id}/publish|cancel|end-early`; web: Publish button when
  ready, `EventLifecycle` panel (cancel danger zone, end-now button).
- Spec conflict resolved: deletion text said "cancel published/active"; now
  "end active events early" to match lifecycle + matrix.
- Tests: pgTAP 240 (22, opens the system gates only inside the rolled-back
  test), component tests, e2e (publish gated, cancel, live end-early). Fixtures
  that need finished events must walk draft->published->active->ended.
- Not done: postponement/rescheduling, cancellation/end notifications, public
  cancellation page, registration enforcement by state (Milestone 2 sellers).

Next: organizer verification state, TOTP as a recovery factor, then
Milestone 2 (sellers and safety lifecycle).

### Admin elevation and first-event review (2026-11-01)

- `20261101001100`: `platform_admins` (operator-granted only, via
  `pnpm admin:grant:local <email>`), `admin_elevation_sessions` (aal2 + a fresh
  TOTP code verified against Auth, bound to the Auth session ID, max 15 min,
  explicit exit), `event_first_reviews` (owner submits once only system gates
  remain; bound to event/boundary/registration versions and visibility).
  Readiness blockers: `first_event_review_required|pending|rejected`; none
  once approved for the current versions or when the owner already has an
  approved first event elsewhere. `totp_recommended` disappears once the
  owner has a verified factor.
- BFF: `GET/POST /events/{id}/first-review`, `GET /admin/status`,
  `POST /admin/elevation`, `POST /admin/elevation/end`, `GET /admin/reviews`,
  `POST /admin/reviews/{id}/decision`. Web: "Submit for review" plus rejection
  reason on the event review step; `/admin` page with code form, persistent
  warning, queue, approve/reject with reason, exit.
- Verified: pgTAP 230 (22), admin component tests, e2e (eligibility, wrong and
  right elevation code, queue, approve, readiness cleared, exit), full verify,
  DB rebuild, slice, all 8 local-auth and 5 smoke e2e.
- Not done: second-person approval once two admins exist, reason-gated
  sensitive reads, admin nav link, review notifications to the owner, pruning
  ended elevation rows, organizer-verification badge (which would exempt
  verified organizations from review).

### Batch outcome and next work

Batch complete: deletion, TOTP, admin review (each committed and pushed).
Remaining Milestone 1 per the list below: routing/public-delivery gates,
publication lifecycle transitions (publish, cancel — which also unblocks
deleting accounts that own published events), organizer verification state,
and TOTP as a recovery factor.

### Optional TOTP (2026-11-01)

- `supabase/config.toml` enables Auth TOTP (restart Supabase after pulling).
  BFF: `GET /account/mfa`, `POST /account/mfa/totp` (enroll, recent auth,
  replaces abandoned setups, raw SVG QR wrapped as base64 data URI ~280 KB),
  `POST /account/mfa/totp/remove` (recent auth + aal2). Factor calls run as the
  user against Auth's own API. Gateway `POST /api/auth/mfa/verify` verifies a
  code and swaps the vault tokens for the aal2 ones (same Auth session).
- Gate: verified factor + aal1 -> 403 `mfa_required` on everything except
  `GET /account/mfa`; the web app routes that to `/sign-in?step=mfa`.
  Domain: `assuranceLevel` from the verified JWT; `totp` AMR counts as fresh
  authentication. Audit via `record_account_mfa_event_command`.
- Verified: e2e (enroll, aal1 gate, wrong then right code in the app, removal),
  component tests, pgTAP 220, full verify, all local-auth/smoke e2e.
- Not done: TOTP as an account-recovery factor (spec says "additional recovery
  method"), a smaller client-rendered QR, TOTP reuse/rate limits beyond Auth's.

### Account deletion (2026-11-01)

- `20261101000900_account_deletion.sql`: blockers (owned non-finished events,
  owned shared organizers with other members), request (recent auth, typed
  email, cancels a pending recovery claim, revokes Auth + browser sessions),
  cancel, `account_deletion_pending` gate, hourly erasure with tombstones.
  `events`/`organizer_profiles.created_by_account_id` are now nullable
  `ON DELETE SET NULL`; the one-owner trigger allows zero owners only for
  ended/cancelled/archived shells; `organizer_profiles.detached_at` hides
  identities kept for history.
- BFF: `GET/POST /account/deletion`, `POST /account/deletion/cancel`; any other
  authenticated route answers 403 `account_deletion_pending`. Web: Settings
  "Delete account" (blockers link to events, email confirmation, signs out),
  and a disabled account is routed to Settings showing only "Undo deletion".
- Caught in e2e: two `clock_timestamp()` calls differed by a microsecond and
  broke the exact seven-day check; now one timestamp.
- Verified: 495 DB assertions, verify (114 tests), local slice, 6 local-auth
  and 5 smoke e2e. Not done: hiding detached organizers in future public
  delivery, a published-event cancellation path, deletion notices.

### Local recovery completion (2026-11-01)

- User decision: after recovery completes, notify the previous sign-in address.
  Implemented as `account_recovery_completed_previous_email`: fixed bilingual
  text, no new address, no link. The address lives only in
  `app_private.recovery_previous_email_notices` (job-bound, erased on
  acceptance/cancellation, hourly purge, max 72 hours), queued by a BEFORE
  DELETE trigger on the claim once its dispatch is `applied`.
- `POST /account-recovery/{id}/complete` (local only, token-proved, inside the
  existing anonymous budget): prepare -> begin dispatch -> admin
  `updateUserById(email, email_confirm)` -> finish. 200 `completed`, 202
  `finishing` (lease still undecided), 409 otherwise. The provider response
  is ignored by design. Contract `AccountRecoveryCompletion`, client
  `completeAccountRecovery`, bilingual UI: reopening the emailed link after
  the wait shows "Finish recovery", then a sign-in link.
- Bug found by the new e2e and fixed forward in `20261101000700`: the
  completion-recipient UNION in `20261101000500` (already pushed) did not
  dedupe because each row carried a different `clock_timestamp()`, so any
  event owner crashed completion on the per-recipient unique key. pgTAP 190
  now includes an event-owning account.
- Verified: 465 database assertions (DB rebuilt from zero, lint, types), full
  `pnpm verify` (108 tests + build), local slice, session-security,
  notifications, preparation race, dispatch race, mobile smoke e2e, and all
  local-auth e2e including the new full completion flow (Auth email changed,
  stale bearer 401, old refresh/old email rejected, previous-address notice
  in Mailpit without the new address, binding erased).
- Known: "opaque sessions isolate accounts" e2e failed once in a full run and
  passed 3/3 alone (profile field empty); looks flaky, not investigated.
  Playwright's web server runs the app's own `dev` script, which skips the
  env sync: on a fresh clone run `pnpm dev` (or the sync script) once first.
- Fixed the reopened-link UX: `POST /account-recovery/{id}/status` (local,
  token-proved, read-only `read_account_recovery_claim_command`: no code
  consumption, no timestamps, no audit) lets the page skip straight to the
  wait or finish step for an already verified request. Unverified links still
  require the explicit verify click. pgTAP 200, component and e2e coverage.
  Next: the remaining Milestone 1 list below.

### Recovery Auth dispatch fence (2026-11-01)

- Verified from the installed auth-js 2.115 and the Supabase Auth source: the
  admin `PUT /admin/users/{id}` email update runs in one Auth database
  transaction, clears pending tokens, sends no mail and revokes NO sessions;
  there is no admin revoke-by-user-id endpoint (only JWT-scoped logout). A
  duplicate destination fails on Auth's unique index with a generic error.
- Because Auth writes to the same Postgres, the fence lives in the database:
  `promenadis_fence_recovery_email_change` (BEFORE UPDATE OF email on
  `auth.users`) permits the change only to the claim's verified destination
  while a live two-minute dispatch lease exists. Late/in-flight Auth requests
  after lease expiry or resolution fail inside Auth's own transaction. The
  outcome is therefore never ambiguous: resolution reads `auth.users` after
  locking the dispatch row (lock order code -> claim -> dispatch; the trigger
  only takes the dispatch row, so no deadlock with Auth).
- `begin_account_recovery_dispatch_command` rechecks every gate (shared
  `lock_eligible_recovery_claim`, also now used by preparation) and requires a
  prior preparation. `finish_...` / per-minute cron `reconcile_...` resolve:
  applied -> delete Auth sessions (refresh tokens cascade) and browser-session
  vault rows, queue `account_recovery_completed` notices, audit, erase claim;
  unchanged after lease expiry -> `not_applied`, claim kept for retry/cancel.
- Claim deletion is blocked while dispatching (cancel, rotation, expiry purge
  and account deletion fail closed for at most the two-minute lease; purge
  skips such claims). Resolved dispatch rows hold no email/token and remain as
  24-hour tombstones that keep rejecting late Auth requests, then are purged.
- Verified: 452 database assertions (29 new), DB rebuilt from zero, SQL lint,
  type drift, full `pnpm verify` (100 tests + build), `test:local-slice`,
  session-security, notifications, preparation race, and the new
  `pnpm test:local-recovery-dispatch` against real local Auth (in-flight Auth
  update held behind the dispatch lock past lease expiry is rejected; leased
  update applies; old refresh token and old email sign-in fail; new email
  signs in as the same account). Added to database CI.
- Local environment note: this session ran Supabase on Podman (a `docker`
  shim plus `DOCKER_HOST` to the Podman socket, 6 GiB VM). `supabase start`
  needs an existing `supabase/snippets` directory. The database was fresh, so
  earlier local accounts/events from the previous machine are not present.
- Superseded by "Local recovery completion" above: the route and UI now exist.
  At the time: no BFF/HTTP completion route called Auth and there was no UI. Next: wire the Edge BFF
  completion route as begin -> `admin.updateUserById(email, email_confirm)`
  -> finish, reporting "finishing" while undecided; add the browser flow and
  an e2e test; decide whether a completion notice to the old address is
  required (the original email is erased with the claim today). Then continue
  the Milestone 1 list below.

### Usage checkpoint (2026-11-01)

- Paused before starting external Auth dispatch at 75% of the five-hour usage
  window, following the user's request to preserve a safe checkpoint near limits.
  Latest implementation checkpoint is `06b9fe2`; no Auth side effects enabled.
- Resume with the durable dispatch/reconciliation design, not another preparation
  layer. Inspect the installed Supabase Auth client/server capabilities and verify
  current official API support for email updates and account-wide session
  revocation before implementing the adapter.
- Explicitly cover: cancellation winning before dispatch; cancellation/rotation
  after a provider call may have started; worker crash before/after acceptance;
  late responses after lease expiry; duplicate dispatch; destination collision;
  expired claims during ambiguous operations; and stale bearer/refresh/cookie
  sessions after a successful recovery. A lease cannot fence an external service
  unless that service honors the fencing/idempotency mechanism.
- Do not cascade-delete the sole reconciliation evidence after dispatch starts,
  blindly resend an ambiguous email update, or assume a successful email update
  revokes sessions. Resolve any conflict with the seven-day claim retention
  requirement explicitly before enabling the workflow. Until then, completion
  remains unavailable and the existing preparation operation ID grants no Auth
  mutation authority.

### Durable recovery preparation (2026-11-01)

- Added an internal service-only preparation command. It locks recovery code then
  claim consistently with cancellation/rotation, validates the token proof,
  verified destination, 24-hour delay, expiry, consumed/current code, original
  identity, destination collision and accepted notices. Retries recheck these
  conditions and return the same operation ID without duplicate audit writes.
- Preparation stores only claim ID, operation ID and timestamp; claim deletion
  cascades the intent. No extra address/token storage or longer retention.
  The operation ID is NOT authority to call Auth: no dispatcher, completion HTTP
  route, email mutation or session revocation was enabled in this slice.
- Verified 423 rollback-only database assertions, SQL lint, full `pnpm verify`
  (106 tests and build), and a separate two-connection preparation/cancellation
  regression. That test holds preparation locks while cancellation starts,
  then verifies no claim/intent survives and Auth remains unchanged. Fixtures
  are disposable; no existing accounts/events reset. Added regression to CI.
- Next: design and implement the dispatch/reconciliation fence before any Auth
  side effect. A prepared row alone must never authorize a delayed worker:
  cancellation/rotation/expiry can erase it after preparation returns. Recheck
  and durably transition under consistent locks, reconcile ambiguous Auth
  outcomes, revoke old access/refresh sessions and test interrupted races before
  enabling completion. Do not treat cascade deletion as sufficient once external
  effects may have started; dispatch state needs explicit lifecycle handling.

### Claim-bound recovery security notices (2026-11-01)

- New recovery claims capture the original verified account email privately at
  creation. The local worker uses a service-only lease-fenced recipient resolver;
  later Auth email changes cannot redirect the owner's original-address notice.
  The extra address is erased with the claim (at most seven days), never placed
  in outbox rows, logs or browser DTOs.
- A service-only mail-acceptance predicate requires the initial notice count and
  owner notice to be satisfied. Missing/deleted jobs cannot silently reduce the
  required set. This records transport acceptance, NOT proof of inbox receipt,
  and is not a recovery-completion authorization command.
- Existing pending claims are deliberately not backfilled with a guessed old
  email: they fail closed. Cancel/rotate and initiate a new local request to test
  the new binding. Existing accounts/events were preserved by forward migration.
- Verified 406 rollback-only database assertions, SQL lint, workspace typechecks
  and the local Mailpit delivery regression. The transport regression changes its
  disposable Auth email after claim creation and checks delivery to the original
  destination plus acceptance evidence. No existing local accounts are changed.
  Full `pnpm verify` also passes (106 tests and production build), with generated
  database types matching. Existing map bundle warning remains.
- Next: integrate this prerequisite into a durable recovery completion protocol
  with consistent cancellation/rotation locks, Auth reconciliation and old-session
  revocation. Verification, the full delay and all other gates still apply.
  No Auth mutation, hosted mail or completion endpoint has been enabled.

### Local security-notification adapter (2026-11-01)

- Added `pnpm notifications:local`: manual batches of at most ten existing
  recovery/successor jobs, fixed Swedish/English plain-text templates and a
  hardcoded local Mailpit transport. No provider account, remote mail or spend.
- Recipient email and locale are resolved in memory from the current verified
  account after a live lease/cancellation/expiry check. Logs contain only counts.
  No user-authored content, names, replacement emails or tokens in team notices.
- Six deterministic delivery tests cover templates, failure/retry acknowledgement,
  unavailable recipients, ambiguous acknowledgement and batch isolation. The
  isolated SQL → Mailpit → acknowledgement regression passes and removes its
  disposable database fixture, leaving one synthetic message in the test inbox.
- Full `pnpm verify` passed: 100 existing tests plus six new delivery tests,
  formatting/lint, secret scan, contracts, typechecks and production build.
  Existing map bundle-size warning remains. The local transport regression is
  wired into database CI; hosted results have not been verified this session.
- This manual local adapter does not complete the production notification gate:
  resolve/freeze the old-email recipient safely before any Auth rebinding, add
  delivery evidence tied to the claim, durable reconciliation and revocation.
  Current email lookup is safe only while Auth completion stays disabled. A
  cancellation cannot recall in-flight mail; ambiguous sends may duplicate.
  Exhausted jobs remain visible in the private outbox until existing expiry.
- Next: enforce claim-specific delivered-notice prerequisites and old-recipient
  binding, then implement the retry-safe recovery completion protocol. Hosted
  mail, automatic scheduling and Auth email mutation remain disabled.

### Notification delivery foundation (2026-11-01)

- Added service-only bounded outbox claim/acknowledgement functions, two-minute
  leases, five-attempt budget and exponential retry delay. Expired, cancelled,
  completed and verification-link jobs are excluded. Lease tokens fence stale
  acknowledgements; no addresses, bodies or raw provider errors are added.
- Applied a forward migration without resetting local accounts/events. Generated
  internal types updated. SQL lint, workspace typechecks and all 390 rollback-only
  database assertions pass. `pnpm check` reports 14 existing import-organization
  issues in untouched TypeScript files; no unrelated automatic fixes applied.
- This is delivery bookkeeping only: no worker or new emails are enabled yet.
  Next connect localized fixed security templates and the local Mailpit adapter,
  resolve recipients securely, and test actual delivery/failure handling.
  Job IDs are stable idempotency keys, but delivery after an ambiguous provider
  response cannot promise exactly-once mail without provider deduplication.
  Cancellation fences acknowledgements, not an already in-flight external send.
  Existing expiry cleanup remains; exhausted jobs are not silently called sent.
  Recovery completion and hosted recovery remain disabled.

### Latest session-security slice (2026-11-01)

- Resumed from the September cookie-auth hardening. The Zen-specific switch
  remains unresolved; no browser-specific cause or fix is claimed.
- Completed the next recovery prerequisite: the BFF now derives recent-auth
  timestamps from the requesting token's Auth-validated AMR, not account-wide
  `last_sign_in_at`. Another device's login or token refresh does not extend
  sensitive-action access. Missing/invalid evidence denies step-up.
- Added a service-only live Auth-session/account check for direct bearer and
  cookie-bridged domain calls, including explicit session expiry. No new
  retained personal data, provider, subscription, or hosted deployment.
- Forward migration applied without resetting the local database. Reloaded
  only the function runtime so it could mount the new shared domain helper.
- Added `pnpm test:local-session-security` and wired it into database CI. The
  regression ages only a disposable session's authentication evidence, obtains
  a real refreshed JWT, signs in on another device, and checks stale/fresh
  sensitive actions, logout, revoked refresh and same-account session isolation.
- Updated the stale discovery wording in `AGENTS.md` to match the existing
  creation approval. No broader scope approval was inferred.
- Verified: `pnpm verify` (100 unit/component/contract tests, formatting, lint,
  secret scan, types, contracts and build); 373 rollback-only database checks;
  database lint/type drift; the new session-security integration; and the
  existing BFF lifecycle integration. All four auth browser cases passed,
  with recovery rerun successfully after an initial Vite dependency-reload
  timeout; all three mobile smoke tests passed. No database reset was run.
- A language-switcher disabled-attribute hydration warning was observed in
  development-server logs, including the rerun. It remains unresolved and
  should be reproduced separately; browser workflow success does not establish
  warning-free hydration. The existing large-map-bundle warning also remains.

### Latest local recovery slice (2026-09-09)

- Added `/recover-account`: submit the saved owner recovery code and a replacement
  email, then explicitly confirm the link captured in Mailpit. The token is
  emailed only, lives in a URL fragment/component memory, and is never returned
  by initiation or persisted in browser storage.
- Confirmation consumes the enrolled code and begins a full 24-hour minimum
  wait. Requests expire within seven days. Settings shows a masked destination
  and lets the recently signed-in owner cancel. Code rotation invalidates both
  verified and unverified pending requests. Cancellation does not revive codes.
- This is a local verification preview, NOT completed account recovery. The
  unfinished Auth mutation path was removed: no completion RPC/client action
  exists and the completion HTTP path returns 503. Hosted recovery routes also
  fail closed. Old-email/team notifications are still undelivered intents.
- Local Mailpit send failures are reported, not disguised as queued success;
  restarting an unverified request replaces its token. A persistent global
  60-attempt/10-minute local budget precedes anonymous work; production
  per-subject limits and delivery adapters remain required.
- Kept existing local accounts/events. The usual pgTAP suite assumes an empty DB;
  `pnpm db:test:preserve` now runs each fixture with temporary table clearing
  inside its rollback-only transaction. Use this instead of resetting a local
  DB containing work you want to keep. It briefly locks application tables.
- Verification: 349 database assertions passed with local data preserved;
  database lint and generated-type drift checks pass. All 77 unit/component
  tests, the synthetic BFF integration, three mobile smoke tests, and all three local-auth browser tests
  pass. The browser suite covers Mailpit delivery, no token in initiation
  responses, same-tab link handling, explicit verification, cancellation,
  rejected replay, and disabled Auth completion. Formatting, lint, secret scan,
  contract generation checks, typechecks, and build pass.

### Milestone 1 — complete identity and event lifecycle

Recommendation:

- Next: implement delivered old-email/team security notices in the local mail
  adapter, with retry/idempotency and expiry tests. Session-specific recent
  authentication is now implemented. Finish recovery's revocation of old
  refresh sessions/access, and a durable retry-safe Auth email-update protocol
  that fences cancellation and reconciles interrupted/ambiguous updates. Test
  expiry, rotation, concurrent cancellation, retries, and stale sessions before
  exposing completion. Then continue with
  the first-event review, routing/public-delivery gates, publication lifecycle
  transitions, account-deletion dependencies, organizer verification state,
  optional TOTP controls, and their retention/erasure and stale-session/
  concurrency tests before calling Milestone 1 complete.
- Continue using only deterministic synthetic identities and locations. Do not
  connect production providers, spend money, or expose real residential data.

No product question is currently required. Proceed with implementation and
surface a focused decision only if implementation evidence exposes one.

## Remaining discovery gate

None. The user explicitly authorized creation mode on 2026-09-07. Pilot and paid
gates remain pending in `docs/LAUNCH_CHECKLIST.md`.

## Architecture sign-off checklist

Do not call discovery complete until at least:

- Complete: all high-risk questions are settled or explicitly deferred with a
  trigger for revisiting.
- Complete: threat model and authorization matrix are written.
- Complete: data classification, retention, and erasure matrix is written.
- Complete: the core entity/state model is reviewed for lifecycle edge cases.
- Complete for discovery: provider limits and production costs were checked from
  official information on 2026-09-07; the pilot checklist requires recheck.
- Complete for discovery: routing acquisition/build is operationally credible;
  ODbL classification remains an explicit launch-counsel gate.
- Complete for design: degraded mode and restore paths are testable requirements;
  implementation evidence is a pilot gate.
- Complete: launch legal review boundary is accepted.
- Complete: launch, post-launch, and future scope are separated.
- Complete: the user explicitly authorized entering creation mode on 2026-09-07.
