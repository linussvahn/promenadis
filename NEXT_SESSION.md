# Promenadis implementation handoff

Last updated: 2026-11-01

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
- Still NOT enabled: no BFF/HTTP completion route calls Auth (the completion
  path still returns 503) and there is no UI. Next: wire the Edge BFF
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
