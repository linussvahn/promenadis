# Promenadis implementation and launch checklist

Status: creation mode active, 2026-09-07

This is the traceable gate register. An item is complete only when its evidence
link or recorded result exists. `Required for` distinguishes permission to start
building from permission to expose real residential locations or accept money.

## 1. Gate definitions

| Gate | Meaning |
| --- | --- |
| `CREATE` | Enter implementation/creation mode; no real public data implied |
| `ALPHA` | Closed testing with synthetic data and no publicly exposed real residential locations |
| `PILOT` | First real public or link-accessible unlisted event, at most 30 sellers |
| `PAID` | Any fee, commercial plan, contractual service commitment, or SLA |

The unpaid pilot has no calendar-based release freeze or formal approval board.
Deployment remains a manual operator decision after automated checks and a
lightweight production/active-event-impact confirmation.

## 2. Creation-mode sign-off

| ID | Requirement | State | Evidence |
| --- | --- | --- | --- |
| CREATE-01 | Product scope, roles, lifecycle, geography, routing, accessibility, support, cost, and deferrals are canonical | Complete | `docs/PRODUCT_SPEC.md` |
| CREATE-02 | Technical topology, API boundary, state model, jobs, routing, snapshots, recovery, deployment, and monitoring are canonical | Complete | `docs/ARCHITECTURE.md` |
| CREATE-03 | Security, privacy, moderation, legal-review, and retention baseline is canonical | Complete | `docs/SECURITY_PRIVACY_LEGAL.md` |
| CREATE-04 | Role/command authorization and denial expectations are explicit | Complete | `docs/AUTHORIZATION_MATRIX.md` |
| CREATE-05 | Threats, trust boundaries, invariants, controls, and residual risks are explicit | Complete | `docs/THREAT_MODEL.md` |
| CREATE-06 | Data classes, recipients, retention, and erasure choreography are explicit | Complete | `docs/DATA_CLASSIFICATION_RETENTION.md` |
| CREATE-07 | Environments, providers, secrets, owners, and pre-pilot unknowns are inventoried | Complete | `docs/PROVIDER_ENVIRONMENT_INVENTORY.md` |
| CREATE-08 | Implementation milestones and per-slice definition of done are accepted | Complete | `docs/ARCHITECTURE.md` and `NEXT_SESSION.md` |
| CREATE-09 | User explicitly authorizes entering creation mode | Complete | User approval in the Promenadis task, 2026-09-07 |

Creation authorization freezes only launch product scope. Architecture may
evolve through a short decision record and canonical-document update.

## 3. Milestone delivery gates

Session-freshness slice (2026-11-01): implemented session-specific AMR-based
step-up and live session/account validation on the BFF's bearer and cookie
paths. Evidence: `packages/domain/src/auth-session.test.ts`,
`supabase/tests/database/140_auth_session_validation.test.sql`, and
`pnpm test:local-session-security` (also in database CI). Recovery completion
and hosted-browser-auth gates remain closed.

Browser-session slice (2026-09-15): local opaque-cookie auth, two-context
isolation, stale-write fences, refresh/replay checks and vault expiry/grants are
verified; see `NEXT_SESSION.md`. Hosted browser authentication remains disabled.
Before any hosted alpha/pilot, verify HTTPS/Secure host-only cookies, dedicated
rotated encryption keys, private credentialed routing that does not silently
expand Netlify's public-only role, production admission limits, vault exclusion
from independent backups and session invalidation on restore. The reported Zen
account switch still requires a browser-specific recheck.

Every vertical slice is complete only when applicable items below pass:

- Schema/migrations rebuild from zero and generated types have no drift.
- Database constraints, RLS, privileged functions, BFF authorization, and state
  transitions have positive, denial, concurrency, and stale-session tests.
- API, queue, webhook, manifest, snapshot, feed, and provider boundaries use
  strict versioned runtime schemas and field allowlists.
- Swedish and English UI, semantic structure, keyboard operation, focus/error/
  async feedback, and non-map/non-drag fallback work for the slice.
- Classification, retention deadline, erasure/tombstone behavior, logging fields,
  and provider disclosure are implemented and testable.
- Retries, idempotency, degraded behavior, alerts, and operator recovery are
  demonstrated for relevant async/external operations.
- Documentation and this checklist link to the evidence.

### Milestone 0 — foundation

- Monorepo/workspace layout and pinned runtime/tooling.
- React/TypeScript server-capable PWA shell and accessible component foundation.
- Swedish/English i18n, locale/time-zone/date/currency primitives.
- Local Supabase/Docker, synthetic seeds, mail capture, and provider fixtures.
- Declarative SQL plus immutable migrations, generated DB types, Zod contracts,
  OpenAPI/JSON Schema generation, and drift checks.
- CI format/lint/type/build/test/security pipeline and preview isolation.
- Environment configuration, feature-flag/kill-switch registry, correlation ID,
  safe logging schemas, and decision-record template.

Milestone 0 state: **complete locally, 2026-09-07**. The configured hosted CI
jobs remain to be exercised when the workspace is placed in a GitHub repository;
that hosting step is not required to begin Milestone 1.

| Evidence | State | Result |
| --- | --- | --- |
| Workspace/runtime/package layout | Complete | `package.json`, `pnpm-workspace.yaml`, `.node-version`, and `docs/decisions/0001-initial-workspace.md` |
| Server-rendered accessible bilingual PWA shell | Complete for foundation | `apps/web`; unit axe check and mobile Chromium smoke passed 2026-09-07 |
| Domain and feature-flag registry | Complete for foundation | `packages/domain`; denial/default tests passed 2026-09-07 |
| Zod boundary source plus JSON Schema/OpenAPI drift check | Complete for foundation | `packages/contracts`; generation and drift check passed 2026-09-07 |
| Format, lint, secret scan, strict types, unit tests, and production build | Complete locally | `pnpm verify` passed 2026-09-07; production dependency audit found no known vulnerability |
| Pinned-SHA application/browser/database CI jobs | Complete for foundation | `.github/workflows/ci.yml`; all equivalent local commands passed, hosted run awaits repository hosting |
| Local Supabase configuration, migration, private feature flags, and pgTAP denial tests | Complete for foundation | Zero-state rebuild and schema lint passed; 7/7 pgTAP tests passed 2026-09-07 |
| Generated database-type drift evidence | Complete for foundation | `supabase/types/database.generated.ts`; local generation/drift check passed 2026-09-07 |

### Milestone 1 — identity and events

- Passwordless email, session controls, Auth abuse limits, and optional TOTP.
- Minimal profiles, organizer profiles/memberships/verification state.
- Event/team roles, ownership, invite, transfer, recovery code, successor, and
  account deletion dependencies.
- Event lifecycle, intervals, visibility, boundary configuration, registration,
  revisions, postponement/cancellation/archival, and duplication shell.

Milestone 1 state: **complete locally, 2026-11-02**, except items that depend on
later milestones: postponement and published boundary/schedule revisions (need
seller reconfirmation and impact, Milestone 2), the routing and public-delivery
publication gates (Milestones 3–4), team copy on duplication, and hosted Auth
abuse controls (Turnstile and production limits, ALPHA-03/PILOT-DATA-08).
Per-slice notes and evidence are in `NEXT_SESSION.md`.

| Evidence | State | Result |
| --- | --- | --- |
| Local passwordless Auth and minimal profile provisioning | Complete for initial slice | Auth trigger plus Swedish/English email-code/link UI; visible OTP and single-exchange PKCE link both pass `pnpm test:e2e:local-auth` |
| Organizer membership and exactly-one-owner draft creation | Complete for initial slice | Transactional service-only commands create organizer/event owner memberships and restricted audit records |
| Browser/BFF/database trust boundary | Complete for initial slice | Direct `anon`/`authenticated` table and command privileges denied; Edge BFF validates Auth JWT, origin, size, request, and response contracts |
| Runtime contracts and generated artifacts | Complete for initial slice | Zod request/response contracts, typed browser client, OpenAPI/JSON Schema, and database types pass drift checks |
| Database verification | Complete | Zero-state rebuild, strict lint and type drift check passed; 621/621 pgTAP assertions across `supabase/tests/database/000`–`270` passed 2026-11-02 |
| End-to-end synthetic command path | Complete for initial slice | `pnpm test:local-slice` passed Auth → BFF → profile/organizer/draft → dashboard plus direct-table denial |
| Accessible bilingual web surface | Complete for initial slice | Responsive sign-in/dashboard UI; unit accessibility checks and 3/3 mobile Chromium/PWA/sign-in smoke tests passed |
| Event team, invitations, ownership transfer, emergency successor | Complete | pgTAP 060–110; event-team and organizer-team component tests |
| Account recovery (code or TOTP), Auth dispatch fence, completion and notices | Complete locally; hosted recovery disabled | pgTAP 120, 160–200, 260; `pnpm test:local-recovery-dispatch`; local-auth e2e |
| Session freshness, opaque browser sessions, stale-write fences | Complete locally; hosted browser auth disabled | pgTAP 130–140; `pnpm test:local-session-security`; local-auth e2e |
| Account deletion with seven-day window, erasure and tombstones | Complete | pgTAP 210; account-deletion component and e2e tests |
| Optional TOTP, admin elevation, first-event review, organizer verification | Complete | pgTAP 220–250; admin-console, two-step and organizer-verification tests; e2e |
| Event lifecycle: publish (gated), cancel, end early, activate/end/archive jobs | Complete; publication gates closed until Milestones 3–4 | pgTAP 240; event-lifecycle tests; e2e |
| Draft detail editing, organizer editing, event duplication, admin intervention | Complete | pgTAP 270; component tests; e2e "owners edit drafts and organizers…" |
| Postponement and published boundary/schedule revisions | Deferred to Milestone 2 | Need seller reconfirmation and seller-impact preview |

### Milestone 2 — sellers and safety lifecycle

Milestone 2 state: **complete locally, 2026-11-03**, except public display and
urgent snapshot/feed invalidation (Milestone 3), seller/owner/reporter mail
(Milestone 5), Turnstile and hosted providers (hosted alpha) and watchlist
entries. Slice 1 (seller applications, admission
modes, seller places, waiting list and promotion, host decisions, withdrawal)
is complete locally as of 2026-11-03: pgTAP 280, domain `seller-admission`
tests, seller-join and event-sellers component tests, and the e2e "sellers
apply through the join page…". Slice 2 (geocoding adapter and budget, shared
stops with host merge/split, address-change reapproval, 25 m pin corrections)
is complete locally: pgTAP 290 and the e2e "geocoded pins, shared stops…".
Slice 3 (flea-market-v1 taxonomy, event category subset, seller listings,
items, accessibility facts, availability, live status) is complete locally:
pgTAP 300 and the e2e "hosts pick categories…". Slice 4a (anonymous reports,
cases, location quarantine, team review and moderation) is complete locally:
pgTAP 310 and the e2e "anonymous reports quarantine…". Slice 4b (appeals with
reviewer separation, platform restrictions with a second-admin lift,
reason-gated private reads, seller invitations) is complete locally: pgTAP 320
and the e2e "invited sellers, appeals…". Slice 5 (14-day seller-data erasure
with tombstones and heartbeat, six-month moderation retention, postponement
with seller reconfirmation and automatic cancellation) is complete locally:
pgTAP 330 and the e2e "postponement asks sellers to reconfirm…". Database
verification: 800/800 pgTAP assertions.

- Seller application, entitlement/waitlist/promotion, address/geocode/manual pin,
  shared-location merge/split, and address-change reapproval.
- Versioned bilingual taxonomy, seller listings/items/tags, accessibility facts,
  availability, away/early-close, and shared-stop semantics.
- Reports, unauthorized-address quarantine, moderation, appeals, platform admin
  elevation, audit, and configured second-person approvals.
- Event-relative publication, expiry, erasure, tombstones, and deletion
  heartbeats before any real location is used.

### Milestone 3 — public discovery

Milestone 3 progress: slice 1 (128-bit route keys, sanitized public `/e/` and
unlisted `/u/` landing pages, discovery search, organizer pages, sitemap,
robots, canonical/Open Graph/JSON-LD, `X-Robots-Tag` and `no-referrer` on
unlisted pages, `404`/`410`, owner rotation of leaked unlisted links) is
complete locally as of 2026-11-04: pgTAP 340, public-pages and
event-public-link component tests, and the e2e "public and unlisted landing
pages…". Slice 2 (per-event manifest, content-addressed snapshot and
coordinate-free safety feed; dirty marking and safety sequence in the
committing transaction; 30-second rebuild worker; 60-second predecessor
handover; tombstones at postponement, end, cancellation and archive; host
early-visibility choice; the `public_delivery_not_ready` gate removed) is
complete locally: pgTAP 350 and contract tests; database verification 859/859. Snapshots are stored in
Postgres and served by the BFF; object storage and CDN purge are hosted-alpha
work. Slice 3 (public map and an equivalent structured stop list, bilingual
search over labels, synonyms, tags and items, category/open-now/step-free/
stroller filters, server cluster cells, counts, away badges, 15-second safety
polling with refusal of expired or unverifiable data, reports by opaque public
ID, and `pnpm demo:seed`) is complete locally: pgTAP 360, public-stops and
public-event-map tests, and the e2e "visitors search the public map…"; database verification 868/868.
Milestone 3 is complete locally except CDN/object storage, a configured site
origin, and walking-route badges (Milestone 4). Not yet verified at a CDN edge; the canonical origin comes from the
request until a configured site origin exists (hosted alpha).

- Sanitized public/unlisted landing behavior, discovery, organizer pages,
  sitemap/canonical/robots/referrer/header rules, `404`/`410`, and safe previews.
- Transactional content-addressed snapshot, manifest, and coordinate-free safety
  feed publication with monotonic state, hard expiry, urgent invalidation, and
  safe failure behavior.
- Bilingual search/filter, public map plus equivalent structured list, seller/
  location status, clustering hints, and aggregate counts.

### Milestone 4 — walking and offline

Milestone 4 progress: slice 1 (walking-network compiler in
`packages/routing`, checksum-verified synthetic OSM fixture as the local
source, build jobs with idempotency and one-at-a-time guard, private
diagnostics with snap/component/detour per location, host preview page,
block/manual-access/entrance/connector overrides with reasons and audit,
approval rules, route-ready publication gate, public immutable package
selected by the manifest, unsafe-edge blocks in the safety feed, 24-hour
package retention) is complete locally as of 2026-11-05: pgTAP 370, routing
build tests, walking-network component tests and the e2e "hosts build,
inspect, correct and approve the walking network"; database verification 900/900. The hosted source
(weekly Geofabrik extract) and pinned compiler container are pilot gates.
Slice 2 (browser routing in a Web Worker with main-thread fallback: grid
spatial index, binary-heap Dijkstra, start snap within 100 m, stop snap
within 60 m; availability-aware ordering with the 20% guardrail and offered
alternative, must-see up to 10, locked positions, shortest mode, return to
start, pace presets, manual gaps without invented time, excluded stops that
can be included; route list, drawn path, next/previous, skip/undo, visited
per stop or seller, manual reorder with recalculation; route state on the
device only, expiring with the event; live network changes offered, never
applied silently) is complete locally: routing graph/order tests,
route-state tests and the extended e2e "hosts build, inspect, correct and
approve the walking network". Slice 3 (location only after an explicit
action with purpose text, 10-second standard fix, retry/manual choice above
100 m accuracy, denied/blocked/timeout/unavailable handling with the
Permissions API used only for wording, live position only while the walk
view is visible, `Permissions-Policy: geolocation=(self)`; offline copy in
IndexedDB admitted only by starting a walk, 50 MiB LRU with the active walk
pinned, refusal after hard expiry, offline banner with last refresh,
reconnect revalidation, "clear saved data" repair; service worker v2 with
versioned shell/page/asset caches, no data caching, and user-accepted
updates) is complete locally: offline-store and geolocation tests and the
e2e walking test going offline and back. Milestone 4 is complete locally
except real-device and installed-PWA testing (Milestone 6), the hosted graph
source and compiler, and signed-in route sync. Offline reload of the page
itself is verified only by reasoning in dev mode; the production build is
needed for the asset cache.

- Checksum-verified OSM acquisition, isolated graph build, immutable package,
  metadata/attribution, host preview, override and rollback lifecycle.
- Browser worker routing, spatial index/priority queue, availability-aware and
  shortest alternatives, dense clustering, shared stops, disconnected/manual
  gaps, estimates, locked order, must-see, and progress.
- Explicit geolocation action, accuracy/out-of-network handling, foreground-only
  watch, manual-start alternatives, and no GPS upload.
- Optional PWA install, managed route cache, first-load/offline limitations,
  reconnect validation, hard expiry, update safety, and cache repair.

### Milestone 5 — operations

Milestone 5 progress: slice 1 (application notices from fixed bilingual
templates for seller decisions, address changes, cancellation, postponement
and rescheduling, quarantine/restore, appeals, seller and team invitations,
unlisted link rotation, reviewed reports and optional reminders; outbox with
required-before-optional claiming, a 60-per-minute send cap, backoff and dead
letters, send-time address resolution, HMAC suppression from bounces and
complaints, 30-day in-app copies and preferences; local Mailpit worker
`pnpm notifications:app`) is complete locally as of 2026-11-06: pgTAP 380,
worker node tests, notification component tests and
`pnpm test:local-notifications`; database verification 924/924. SES sending, SPF/DKIM/DMARC, SES feedback
ingestion and inbound relay are hosted-alpha work. Slice 2 (organizer
contact relay: anonymous form on the event page with honeypot and network/
event rate limits, owners and co-hosts answer in the app, the visitor follows
a private thread link carried by reply mail, neither address shown, bodies
30 days after delivery, threads 14 days after the end; limited CSV export:
recent sign-in, one active per event, three per day, entitlement cap,
formula cells neutralized, single download, deleted within 24 hours) is
complete locally: pgTAP 390, worker relay test and the e2e "visitors
contact organizers through the relay and hosts export sellers"; database verification 945/945. Turnstile on
the relay form is a hosted-alpha gate. Slice 3a (one support form with five
routes into the support mailbox, elevated-admin inbox and resolution;
anonymous post-event feedback with a separate optional follow-up contact and
aggregate team summary; job heartbeats with a sanitized `/status` endpoint
and an admin operations panel; five audited incident switches enforced in
the database; `docs/RUNBOOK.md`) is complete locally: pgTAP 400 and the e2e
"support requests reach the mailbox and visitors leave anonymous feedback"; database verification 962/962.

- SES Auth/application mail, relay, notifications, queues/retries, bounce/
  complaint/suppression handling, and required-versus-optional prioritization.
- Limited CSV export and 24-hour object lifecycle.
- First-party support/accessibility/privacy/safety/legal forms and mailbox routes;
  first-party pilot feedback lifecycle.
- Better Stack monitoring/status, event-window AWS probe, quotas/budget alerts,
  incident commands/runbook, and privacy-safe operational records.
- Supabase recovery path plus encrypted independent backups, tombstone replay,
  restore exercise, and environment/secret runbooks.

### Milestone 6 — pilot hardening

- Full authorization/RLS/state/concurrency review and threat-model test mapping.
- Load tests for the accepted event envelope and failure tests at provider quotas.
- End/cancel/postpone/quarantine/expiry tests with CDN, offline, retry, rollback,
  backup restore, and clock/DST edge cases.
- Real-device/browser/PWA matrix plus manual WCAG 2.2 AA assessment of every
  critical role flow; publish truthful accessibility statement.
- Swedish launch-counsel findings applied and closed or explicitly accepted.
- Pilot operator, support/status routes, event team, cost/headroom, graph preview,
  coverage window, and post-event review scheduled.

## 4. Closed-alpha gate

| ID | Requirement | Required for | State |
| --- | --- | --- | --- |
| ALPHA-01 | Environment is visibly non-production/noindex and contains synthetic data only | ALPHA | Pending |
| ALPHA-02 | Test identities, mail recipients, provider calls, and callback origins are allowlisted | ALPHA | Pending |
| ALPHA-03 | Core auth/authorization denial tests and secret scanning pass | ALPHA | Pending |
| ALPHA-04 | Reset command verifies exact staging project; production credentials are absent | ALPHA | Pending |
| ALPHA-05 | Known limitations and feedback/support route are shown to 5–10 trusted testers | ALPHA | Pending |

Launch counsel is not required for this synthetic/no-public-real-location alpha.

## 5. Real public or unlisted pilot gate

### Legal and operator

| ID | Requirement | State |
| --- | --- | --- |
| PILOT-LEGAL-01 | Natural/legal operator and controller designated | Pending |
| PILOT-LEGAL-02 | Footer-linked operator page has legal identity, compliant establishment address, monitored contacts, and applicable registration details | Pending |
| PILOT-LEGAL-03 | Bounded Swedish legal review completed; launch blockers resolved or consciously deferred only where counsel permits | Pending |
| PILOT-LEGAL-04 | Swedish/English terms, privacy notice, acceptable-use rules, reporting/appeals, accessibility statement, and publication warnings are live | Pending |
| PILOT-LEGAL-05 | Processor DPAs, subprocessors, regions/transfers, purposes, retention, and deletion procedures are recorded | Pending |
| PILOT-LEGAL-06 | OSM/ODbL compact-graph attribution/share-alike position is reviewed and implemented | Pending |

### Security, privacy, and data lifecycle

| ID | Requirement | State |
| --- | --- | --- |
| PILOT-DATA-01 | Authorization matrix maps to BFF/RLS/privileged-function tests with no unexplained exception | Pending |
| PILOT-DATA-02 | Public DTO/snapshot/SSR/export/log allowlists and sensitive-key denial tests pass | Pending |
| PILOT-DATA-03 | Precise location never appears before allowed window and disappears authoritatively on every safety/terminal transition | Pending |
| PILOT-DATA-04 | Snapshot/feed/CDN invalidation and hard expiry meet the settled semantics under partial failure | Pending |
| PILOT-DATA-05 | Event-relative 24-hour/14-day/30-day cleanup, tombstones, provider deletion, and failure alerting are proven | Pending |
| PILOT-DATA-06 | Account deletion/recovery, owner transfer/successor, admin elevation, and second-person transition tests pass | Pending |
| PILOT-DATA-07 | Anonymous unauthorized-address report safely quarantines one location and restoration is human-authorized | Pending |
| PILOT-DATA-08 | Security headers, CSP, origin/CSRF, redirect, rate-limit/Turnstile, webhook replay, and CSV-injection tests pass | Pending |

### Product, routing, and accessibility

| ID | Requirement | State |
| --- | --- | --- |
| PILOT-PROD-01 | Owner, co-host, moderator, seller, signed-in visitor, anonymous visitor, reporter, and admin critical paths pass in Swedish and English | Pending |
| PILOT-PROD-02 | Public/unlisted visibility, seller reconfirmation, indexing controls, safe previews, rotation, `404`/`410`, and archival work | Pending |
| PILOT-PROD-03 | Shared locations, distinct nearby clustering, 30-seller entitlement, 50-stop limit, availability, early close, and disconnected gaps work | Pending |
| PILOT-PROD-04 | Graph source/build/hash/size limits, host preview, overrides, attribution, unsafe-edge update, and rollback pass | Pending |
| PILOT-PROD-05 | Geolocation denial/inaccuracy/revocation, manual starts, no GPS upload, route ordering, progress, and no silent active reorder pass | Pending |
| PILOT-PROD-06 | Offline prepare/start, missing basemap, quota/eviction, stale warning, reconnect, hard expiry, cache repair, and active-route update pass on real devices | Pending |
| PILOT-PROD-07 | WCAG 2.2 AA automated checks and required manual keyboard/zoom/contrast/motion/screen-reader matrix complete; no critical barrier without alternative | Pending |

### Infrastructure, cost, and operations

| ID | Requirement | State |
| --- | --- | --- |
| PILOT-OPS-01 | Production, staging, preview, callback, mail, bucket, widget, and secret isolation is verified | Pending |
| PILOT-OPS-02 | Current official provider limits/pricing/regions/terms rechecked; projection remains within 350 SEK including VAT/buffer | Pending |
| PILOT-OPS-03 | Supabase plan/Spend Cap, Geoapify quota, Netlify headroom, SES/AWS budgets, and reserved safety capacity are configured | Pending |
| PILOT-OPS-04 | Monitoring covers public/BFF, manifest/feed freshness/expiry, queues, retention, backups, graph builds, mail, database, and cost | Pending |
| PILOT-OPS-05 | Read-only degraded mode and protective commands work during simulated backend/provider failure | Pending |
| PILOT-OPS-06 | Independent encrypted backup is verified and isolated restore replays erasure tombstones | Pending |
| PILOT-OPS-07 | SPF/DKIM/DMARC, relay, suppression, bounce/complaint, cancellation burst, and required-mail reservation pass | Pending |
| PILOT-OPS-08 | One verified owner and co-host/emergency successor, reviewed graph, operator coverage, status page, and support routes are ready | Pending |
| PILOT-OPS-09 | Pilot/beta and no-SLA wording is visible; incident contacts/cadence and post-event feedback/review are scheduled | Pending |

### Lightweight deployment confirmation

Before each production deployment, record or display:

- exact target environment and immutable revision;
- green CI/staging result;
- migration type/status and backup preflight if destructive/high-risk;
- current event/publication impact;
- provider cost/quota headroom;
- kill switch and rollback or corrective-forward path.

This is a short safety prompt, not a release board or fixed freeze window.

## 6. Day-of and incident controls

- Operator coverage begins two hours before the first public interval and ends
  one hour after the event.
- One-minute AWS probe is enabled for that window; independent three-minute
  monitoring remains active.
- Manifest/safety feed freshness, hard expiry, queues, mail, database, graph,
  and provider headroom are healthy before locations publish.
- Urgent quarantine, seller close/withdrawal, unsafe-edge block, postponement,
  end, cancellation, session revocation, and kill switches are reachable.
- SEV-0/1 target acknowledgement is 15 minutes during coverage; no SLA is
  promised. Confirmed user-visible incidents receive a safe public update within
  30 minutes and at least hourly thereafter, plus direct affected-team notice.

## 7. Post-event and expansion gate

- Confirm terminal tombstone and immediate non-public state.
- Confirm route/attendance deletion within 24 hours and location/listing erasure
  by the 14-day deadline; investigate any missed heartbeat as SEV-0/1 as defined.
- Complete support/case/email/export/snapshot/package/backup lifecycle checks.
- Synthesize and delete feedback on its deadline; retain only non-personal
  findings.
- Review incidents, accessibility barriers, route safety, support load, provider
  usage/cost, seller/organizer/visitor outcomes, and operator workload within
  seven business days.
- Do not expand with unresolved SEV-0/1, failed expiry, unsafe routing, critical
  accessibility barrier, uncontrolled cost, or unsustainable support load.

## 8. Paid-service trigger

Before accepting payment or promising an SLA:

- complete commercial entity, accounting, tax/VAT, contract, refund/credit,
  consumer-distance-selling, and payment-flow legal review;
- define support/SLA commitments and whether formal change/freeze/reviewer
  controls are proportionate;
- require organization verification for events above the free entitlement;
- add a payment provider only after a separate security/privacy/provider review;
  and
- update threat model, data inventory, authorization, costs, terms, privacy
  notice, incident obligations, and this checklist.
