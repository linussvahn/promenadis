# Promenadis authorization matrix

Status: discovery sign-off baseline; implementation mapping updated 2026-09-09

This matrix turns the role model into server-enforced command rules. It is the
starting point for BFF authorization, PostgreSQL RLS, pgTAP denial tests, audit
events, and UI capability hints. The product and security documents remain
authoritative if implementation naming changes.

## 1. Rules that apply to every command

- Browser UI state never grants permission. The BFF authenticates the actor,
  resolves current event-scoped membership, validates entity state, and executes
  cross-table changes transactionally.
- RLS is defense in depth. Private tables are not broadly selectable by browser
  roles, and service credentials never reach a browser.
- `Own` means the authenticated account owns the referenced account-scoped or
  participation-scoped record. It never implies access to another participant at
  the same physical location.
- `Event team` means a current membership in the exact event. Organizer-profile
  management alone does not grant event authority.
- Recent authentication is required for destructive, export, ownership,
  recovery, privilege, and sensitive active-event location commands.
- Every administrative or safety-sensitive command records an audit event in the
  same transaction. Commands marked `reason` require structured justification.
- Elevated platform administration requires fresh TOTP and expires after about
  15 minutes. Administrators use normal-user permissions outside that mode.
- When two eligible platform administrators exist, the configured high-risk
  actions require a different administrator's approval. Emergency suspension or
  quarantine remains immediate; restoration/reinstatement may require approval.
- System workers use narrow, non-browser identities and may perform only the
  scheduled/job transition they were issued. They do not inherit platform-admin
  browsing privileges.

## 2. Role abbreviations

| Code | Actor |
| --- | --- |
| `ANON` | Anonymous visitor |
| `USER` | Authenticated account with no relevant event role |
| `SELLER` | Seller acting on their own participation/listing/location input |
| `MOD` | Event moderator |
| `COHOST` | Event co-host |
| `OWNER` | Event owner |
| `ADMIN` | Platform administrator in freshly elevated mode |
| `SYSTEM` | Narrow queue, expiry, snapshot, or provider worker identity |

## 3. Public, account, and visitor commands

| Command | ANON | USER | Event team / ADMIN | Conditions |
| --- | --- | --- | --- | --- |
| Read public discovery and public event landing data | Yes | Yes | Yes | Only currently public, allowlisted metadata |
| Read public/unlisted map snapshot | Yes | Yes | Yes | Valid public state/token, safety feed, and hard expiry |
| Search/favourite/plan route locally | Yes | Yes | Yes | Browser-local by default; no private-table reads |
| Sync attendance, saved route, or progress | No | Own | Own | Online authoritative response; event-relative expiry |
| Delete own attendance/route/progress early | No | Own | Own | Idempotent deletion |
| Submit ordinary organizer relay message | Yes | Yes | Yes | Rate limit, Turnstile where applicable, no attachments |
| Submit safety/privacy/legal report | Yes | Yes | Yes | Never silently discarded; contact optional |
| Request passwordless login | Yes | Yes | Yes | Enumeration-resistant, rate-limited, Turnstile |
| View/update own minimal account profile | No | Own | Own | Email changes handled through Auth verification |
| View/enroll/rotate own owner recovery code | No | Own | Own | Verified email and recent authentication for enrollment/rotation; plaintext returned once and never readable again |
| Enable/manage own TOTP and recovery methods | No | Own | Own | Recent authentication for removal/rotation |
| Request account deletion | No | Own | Own | Seven-day recovery; event-owner dependencies resolved |
| Enter platform-admin mode | No | No | ADMIN only | Eligibility plus fresh TOTP; audited |

Anonymous reads never expose a global precise-location endpoint, sequential
identifier, arbitrary coordinate query, private participation record, reporter,
or attendee identity.

## 4. Organizer, event, and team commands

| Command | USER | MOD | COHOST | OWNER | ADMIN | Conditions |
| --- | --- | --- | --- | --- | --- | --- |
| Create organizer profile | Yes | Yes | Yes | Yes | Normal-user mode | Actor becomes its initial manager |
| Edit organizer profile | Manager | Manager | Manager | Manager | Elevated only for enforcement | Organizer membership is separate from event role; current organizer version; type fixed after creation; a rename of a verified organization returns it to review |
| Invite/cancel/remove shared-organizer managers | Organizer owner | Organizer owner | Organizer owner | Organizer owner | Enforcement only | Recent auth; organizer team version; individual identities reject managers; audit excludes email |
| Accept organizer-manager invitation | Intended verified account | Intended verified account | Intended verified account | Intended verified account | No | Matching verified email; invitation unexpired; recipient chooses organizer-team display name |
| Request organization verification | Manager | Manager | Manager | Manager | Review | Official registry/control evidence only |
| Create event | Yes | Yes | Yes | Yes | Normal-user mode | Creator becomes sole owner |
| Read event-team private operations | No | Event scope | Event scope | Event scope | Elevated with reason where sensitive | Field-level DTOs |
| Edit draft event/configuration | No | Moderation fields only | Yes | Yes | Elevated intervention | State and field allowlist enforced |
| Open/close registration before activation | No | No | Yes | Yes | Elevated intervention | Audited |
| Publish event | No | No | No | Yes | Emergency/enforcement only | Recent auth, recovery code, readiness gates |
| Apply published boundary/schedule revision | No | No | Yes | Yes | Elevated intervention | Impact preview and artifact readiness; date changes may require reconfirmation |
| Change visibility before activation | No | No | Yes | Yes | Elevated intervention | Seller reconfirmation for unlisted-to-public after joining |
| Postpone event | No | No | Yes | Yes | Yes | Recent auth, public reason, urgent unpublication |
| End active event early | No | No | Yes | Yes | Yes | Urgent expiry/tombstone path |
| Cancel published event | No | No | No | Yes | Yes | Recent auth; locations unpublished first |
| Duplicate event shell | No | No | Yes | Yes | No special access | Never copies sellers/addresses/private records |
| Invite/remove event team or change roles | No | No | No | Yes | Enforcement only | Recent auth; current team version; exactly one owner; audited without email |
| Accept event-team invitation | Intended verified account | Intended verified account | Intended verified account | N/A | No | Matching verified email; invitation unexpired; recipient chooses event display name |
| Initiate/cancel ownership transfer | No | No | No | Yes | No ad-hoc transfer | Recent auth; current team version; recipient is verified co-host; owner approves an organizer the recipient already manages |
| Accept ownership transfer | Intended co-host | Intended co-host | Intended co-host | N/A | No | Explicit acceptance; current team version; verified account and exact target-organizer permission rechecked; owner and organizer change atomically |
| Designate/change/clear emergency successor | No | No | No | Yes | No | Recent auth and current team version; exactly one verified co-host who manages the pre-approved target organizer; audited |
| Initiate emergency-successor claim | No | No | Designated successor only | No | No | Recent auth and current team version; verified account; exact active designation; no planned transfer; starts a 24-hour delay and queues notification intents |
| Cancel emergency-successor claim | No | No | Claiming successor only | Current owner | No | Recent auth and current team version; claim is deleted atomically and cancellation intents are queued |
| Complete emergency-successor claim | No | No | Claiming successor only | No | No | At least 24 hours after initiation and before seven-day expiry; current team version, roles, exact designation, verified account, and target-organizer management rechecked atomically |
| Read publication readiness | No | Event scope | Event scope | Event scope | Elevated support only | Field-scoped blockers/recommendations; never grants publication authority |
| Attest publication prerequisites | No | No | No | Yes | No | Recent auth; exact current event, boundary, registration, and visibility versions; audited |
| View owner-facing event audit history | No | No | No | Yes | Elevated | Display-safe actor label/role only |
| Request limited CSV export | No | No | Yes | Yes | Elevated for support/legal scope | Recent auth, rate/row limits, 24-hour object |

Platform administrators do not silently become event owners and never
impersonate a user. Administrative intervention has a separate legal/safety or
enforcement reason and audit trail.

## 5. Seller, location, and taxonomy commands

| Command | SELLER | MOD | COHOST | OWNER | ADMIN | Conditions |
| --- | --- | --- | --- | --- | --- | --- |
| Apply to event / accept invite | Own | No | No | No | No | One participation/account/event; capacity policy |
| Read own private application/address | Own | Event review scope | Event review scope | Event review scope | Elevated with reason | Never returned in public DTOs before publication |
| Edit own pending listing/address/pin | Own | No | No | No | Enforcement only | Normal admission rules |
| Change address after approval | Own | Review | Review | Review | Enforcement | Immediately unpublishes seller; requires reapproval |
| Withdraw participation | Own | No | No | No | Enforcement | Frees capacity; urgent unpublication if public |
| Set open/away/closed-early status | Own | On behalf with reason | On behalf with reason | On behalf with reason | Enforcement | Seller-scoped at shared stop; urgent feed update |
| Apply/reject/waitlist/promote seller | No | Yes | Yes | Yes | Enforcement | Transactional entitlement check; no active auto-promotion |
| Approve geographic exception/address change | No | Yes | Yes | Yes | Enforcement | Event scope and state checks |
| Same-address pin correction up to 25 m | No | Yes | Yes | Yes | Yes | Recent auth, reason, before/after, seller notice |
| Merge/split ambiguous physical locations | No | Review | Yes | Yes | Enforcement | Shared actual entrance/yard/stall confirmed |
| Select seller categories/tags/items | Own | Hide/remove prohibited content | Hide/remove prohibited content | Hide/remove prohibited content | Enforcement | Taxonomy/count/UGC validation |
| Configure event taxonomy subset/order/suggestions | No | No | Yes | Yes | Platform taxonomy enforcement | Pinned version; no canonical rename/local category |
| Create/deprecate canonical category/version | No | No | No | No | Platform-controlled migration | IDs immutable; reviewed code/data change |

One approved seller consumes one seller entitlement even at a shared location.
Routing limits count physical locations, not seller records or derived clusters.

## 6. Moderation, safety, routing, and administration

| Command | MOD | COHOST | OWNER | ADMIN | SYSTEM | Conditions |
| --- | --- | --- | --- | --- | --- | --- |
| Review event-scoped report | Yes | Yes | Yes | Yes | Triage only | Reporter identity/contact remains restricted |
| Hide seller text/item | Yes | Yes | Yes | Yes | No | Reason and affected-user notice where applicable |
| Suspend/revoke event participation | Yes | Yes | Yes | Yes | No | State transition plus audit |
| Quarantine complete unauthorized-address report | Review/maintain | Review/maintain | Review/maintain | Review/maintain | Initial deterministic quarantine | Temporary, location-scoped, urgent unpublication |
| Restore quarantined location | Authorized reviewer | Authorized reviewer | Authorized reviewer | Authorized reviewer | No | Human decision; platform-level restriction cannot be overridden locally |
| Apply platform-level suspension | No | No | No | Yes | No | Fresh elevation and reason |
| Reverse platform-level suspension | No | No | No | Yes | No | Fresh elevation; distinct approver once two admins exist |
| Decide appeal | No | No | No | Yes | No | Different reviewer when possible; preserve original decision |
| Preview routing graph/anomalies | Yes | Yes | Yes | Yes | Build data | Moderator cannot publish overrides |
| Publish entrance/manual-access/unsafe-edge override | No | Yes | Yes | Yes | Build only | Recent auth, reason, immutable version |
| Publish connector up to 100 m | No | Yes | Yes | Yes | Build only | Legal/safe-walking attestation and preview |
| Launch/retry graph build | No | Yes | Yes | Yes | Executes | Event scope, quotas, idempotency |
| Trigger urgent snapshot/feed invalidation | Via authorized safety command | Via authorized command | Via authorized command | Yes | Executes | Cannot be disabled by ordinary write freeze |
| Bulk sensitive-data export | No | No | No | Yes | Generates only | Distinct approver once two admins exist |
| Production restore | No | No | No | Yes | Executes narrow steps | Distinct approver once two admins exist; tombstone replay |

## 7. Required denial and concurrency tests

- Cross-event access for every event-scoped read and command.
- Seller access to another seller at the same shared location.
- Moderator attempts to export, manage team roles, publish an event, transfer
  ownership, or publish a routing override.
- Co-host attempts to transfer ownership, remove the owner, or cancel the event.
- Owner attempts to read hidden reporter identity or unrelated account data.
- Normal administrator session attempts elevated reads/actions.
- Event team attempts to override a platform-level suspension.
- Reinstatement, admin-role change, bulk export, and restore without the required
  second approver when two eligible administrators exist.
- Concurrent capacity approvals/promotions and exactly-one-owner transfers.
- Stale membership/session use after removal, elevation expiry, event end,
  account deletion, token rotation, or permission change.
- Worker credentials used against any table/command outside the assigned job.
- Public snapshot validation when a sensitive field is added to an internal row
  or DTO.

Any implementation change that grants a role a new command updates this matrix,
the BFF policy, RLS/privileged functions, tests, audit requirements, and public
documentation together.
