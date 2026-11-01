# Promenadis product specification

Status: approved creation baseline, 2026-09-07

## 1. Product intent

Promenadis helps a local organizer create a geographically bounded walking
event, lets neighbours register their seller locations, and lets visitors
discover those locations and build a walkable route between them.

The first market is Swedish neighbourhood associations and informal organizers.
Data models, localization, time zones, addresses, and currency handling must not
assume Sweden is the only future market.

The core experience is discovery and walking, not e-commerce. Visitors should
be encouraged to wander and find things in person. Promenadis will not support
online purchase, reservation, checkout, or buyer-to-seller messaging at launch.

## 2. Product principles

- Appearance follows the device theme by default, with light and dark overrides
  available in the header. The choice is local to the browser, requires no account,
  and does not change event data or map geography.
- One account can participate differently in different events. A person may be
  an owner, co-host, moderator, seller, attendee, and visitor without changing
  accounts.
- Roles and permissions are event-scoped, not global user types.
- Browsing, searching, map use, and local route planning work without an
  account.
- Residential locations are useful but sensitive. Collect and retain no more
  precise location data than the event requires.
- Build for credible real usage and acquisition due diligence without paying
  for hypothetical millions of users.
- Keep operations manageable for one developer.
- The free launch is not allowed to paint the architecture into a corner for
  later paid organizational plans.

## 3. Actors and permissions

### Visitor

- Browse public events anonymously.
- Open an unlisted event using its URL.
- Search seller descriptions, categories, tags, and highlighted items.
- Save stops, choose a start point, optimize and reorder a route, and mark or
  skip stops while walking.
- Sign in to sync route progress or mark an event as interested/going.
- Report a location or seller listing without an account, subject to abuse
  protection.

Ordinary public map/search use never requires CAPTCHA. It reads a bounded,
immutable per-event snapshot rather than exposing global exact-location search
or arbitrary coordinate-range APIs. A snapshot that is legitimately public can
be copied; Promenadis limits its fields, scope, discoverability, and lifetime
rather than claiming rate limits can make public data secret.

### Seller

- Join an event using an event-specific participation record.
- Submit an address and confirm the right to use it for the event.
- Add an optional seller title, description, categories, tags, accessibility
  details, availability, and highlighted items.
- Withdraw before or during the event and close early.
- Appeal a moderation decision.
- Never expose their legal name, account email, or other private account data to
  visitors.

A sufficiently complete unauthorized-address report immediately and temporarily
unpublishes only the reported physical location pending authorized human review.
Incomplete or obviously automated submissions do not trigger automatic
quarantine. The seller and event owner are notified without receiving the
reporter's identity or contact details.

### Event team

Event roles form a three-level split:

- **Owner:** ultimate event control, team management, duplication, and limited
  export.
- **Co-host:** broad operational event management and limited export, without
  owner-only powers.
- **Moderator:** admission and content moderation duties, without export or
  ownership controls.

Hosts can approve or reject applications, approve geographic exceptions,
suspend or revoke participation, hide content, and handle reports. Important
actions are enforced server-side and audited.

The owner-facing event audit history identifies acting co-hosts and moderators
by their stable event display name and role. It does not expose email addresses,
authentication identifiers, or seller/reporter identities that are otherwise
restricted.

Only the owner may invite, remove, or change the role of an event-team member,
and those privilege changes require authentication no older than 15 minutes.
An invitation targets a normalized verified email, carries either the co-host
or moderator role, and expires after at most seven days. The recipient chooses
the stable display name used inside that event when accepting. The invitation
email row is deleted immediately on acceptance or cancellation, and an hourly
retention job deletes expired rows. Audit summaries record the role but never
copy the invited email. Ordinary role editing cannot create, replace, or remove
the event's single owner; ownership transfer remains a separate accepted flow.

The planned-transfer UI offers only verified co-host and organizer-profile
combinations the recipient already controls. The current owner explicitly
reviews both the recipient and the public organizer identity that the event will
use after acceptance. This may preserve a genuinely shared organizer or reassign
the event to the recipient's personal organizer identity. Initiation creates one
pending transfer per event for at most seven days. The current owner may cancel
it with recent authentication; acceptance or cancellation deletes the pending
row immediately, while safe audit events retain the two decisions.
Organizer-profile management is never granted implicitly.

### Platform administrator

Platform administrators handle escalated safety, abuse, and legal reports.
Administration uses the administrator's normal identity with a separately
elevated, short-lived admin mode. There is no user impersonation.

Only a freshly elevated platform administrator can reinstate a suspension made
at platform-admin level. Event teams cannot override it. While only one platform
administrator exists, that administrator may reinstate with fresh TOTP, a
structured reason, and an audit record explicitly marked non-independent. Once
two eligible administrators exist, reinstatement and other defined high-risk
actions require approval by a different administrator before taking effect.

## 4. Accounts and authentication

- Anonymous public browsing is the default.
- Authentication is required to host, sell, record attendance, or sync progress.
- Launch with verified-email passwordless login using magic links or email OTP.
- Browser sessions use server-managed opaque HttpOnly cookies, not
  browser-readable Auth tokens (approved 2026-09-15). Local sessions have a
  12-hour absolute lifetime; expired sessions require signing in again.
  Independent browser profiles remain independent; windows sharing one cookie
  jar share a login. If an account changes beneath an open page, unsaved
  account-scoped state is discarded and a stale action must not affect the new
  account. Existing accounts/events survive this session-storage migration.
- Recent authentication is specific to the requesting session. Signing in on
  another device or silently refreshing a token must not renew that session's
  15-minute sensitive-action window. An older valid session may continue
  ordinary work but must sign in again before a sensitive action.
- Passwords are not planned at launch.
- Passkeys and Google/Apple login are post-launch possibilities.
- A verified email is sufficient for sellers; phone verification is not
  required.
- Accounts are for people aged 18 or older. A guardian represents children;
  Promenadis does not collect birth dates.
- Before publishing an event, its owner must create and save a hashed, single-use
  recovery code. TOTP is strongly encouraged as an additional recovery method.
- An owner may predesignate one verified co-host as the event's emergency
  successor. Recovery or successor transfer uses a new verified email, a 24-hour
  delay, notifications to the old email and event team, and a complete audit
  trail. A successor receives event ownership, not access to the old account.
- For recovery-code account recovery, the full 24-hour minimum wait starts
  after replacement-email verification, not when an unverified request is
  created. The signed-in owner may cancel a pending request; replacing the
  recovery code also cancels it. Neither cancellation nor expiry makes a
  consumed code reusable. After the wait, the emailed link offers an explicit
  "finish recovery" step that changes the sign-in email to the verified address
  and ends every existing sign-in on all devices. The owner, the event team and
  the previous sign-in address are then notified. This works only in the local
  preview; hosted recovery remains disabled.
- Without a valid recovery factor or a predesignated successor, Promenadis does
  not perform ad-hoc account recovery or ownership transfer based on submitted
  identity documents or operator judgment. Existing co-host permissions continue
  to support event operations.
- Account deletion has a seven-day recovery window. During recovery the account
  is disabled and its public content is hidden; afterward personal data is
  erased or irreversibly pseudonymized where retention is not legally required.

## 5. Event lifecycle and configuration

Proposed lifecycle states:

`draft -> published -> active -> ended -> archived`

Cancellation is a separate terminal path for a published event. Drafts may be
deleted. Published events are cancelled rather than silently deleted.
`postponed` is a nonterminal safety path from published or active. It immediately
hides seller locations, invalidates routes, pauses registration, and retains a
public notice page.

Draft deletion is owner-only, permanent, and requires recent authentication,
the current optimistic event version, and entry of the exact event title.
Co-hosts may edit draft configuration but may not delete the draft. The deletion
audit retains only the event identifier and safe lifecycle metadata, not the
event title, description, boundary, or other user-authored content.

An event includes:

- Localized title, description, links, organizer information, and branding.
- IANA time zone.
- One or more date/time intervals in the data model.
- Registration open and close times.
- A geographic admission boundary.
- Admission policy.
- Visibility (`public` or `unlisted` at launch).
- Event-level opening hours and seller-specific shorter availability.
- Categories and optional suggested event tags.
- Accessibility and operational settings.

One verified human account may own or manage multiple public organizer profiles
for different individual, informal-group, association, or company contexts. Each
event selects exactly one organizer profile. Public organizer fields are display
name, organizer type, optional locality and website, and an accurate verification
badge when applicable. The managing account's email, authentication identity,
and private profile remain hidden. Enforcement applies across the account and
all organizer profiles so a new profile cannot evade restrictions.

This internal separation must not make an individual create or select a
separate organization before creating an event. The first-event flow defaults
to `Organized by you`, asks the person to confirm the public organizer name,
and creates the `individual` organizer profile behind the scenes. The organizer
selector is hidden while the account has only that one usable profile and is
shown as `Organizing as` only when the account manages multiple profiles. The
public-name confirmation remains explicit because the private account display
name is not automatically public.

Shared informal-group, association, and company profiles may have managers.
Only the organizer-profile owner can create or revoke a seven-day verified-email
manager invitation or remove a manager, and those privilege changes require
authentication no older than 15 minutes. The recipient chooses a stable
organizer-team display name on acceptance. Personal `individual` organizer
identities cannot have managers. Pending invitation emails are deleted on
acceptance or cancellation and purged after expiry.

Ordinary individual and informal-group organizers use verified email, an owner
recovery code, publication attestation, and a manual review of their first event.
Promenadis does not collect their legal name, phone number, government ID,
proof-of-residence document, or BankID merely to host. Their profile shows its
declared organizer type but receives no identity-verification badge.

Associations and companies may request a narrowly labelled `Registered
organization verified` badge. Promenadis checks the organization number and
registered name/status in an official register, then confirms the claimant's
control through an organization-domain email, an established official website,
or independently sourced official contact details. The badge verifies only that
organization/control check, not the event's quality, safety, or endorsement.
Events above the 30-seller free entitlement require this organization
verification before contracting. Disputed or abnormal organizer claims remain
unpublished until resolved; uploaded identity documents are not the default
proof method.

The launch UI optimizes for a one-day event with one shared opening interval,
while the database supports multi-day and multiple intervals for later formats.

The authenticated host experience is task-oriented rather than a single
administrative dashboard. `My events` is a concise event index with one primary
create action. New-event setup is a guided `Basics -> Area -> Review` flow; the
private draft is created after Basics so its boundary can be saved against a
stable event ID. Each event then has its own workspace and setup status. Profile
and additional organizer-profile administration live under Settings, and raw
boundary coordinates are available only through a collapsed advanced editor.

### Public and unlisted visibility

`Unlisted` controls Promenadis and search-engine discoverability; it is not
private access control. Anyone with the link can open, copy, and reshare the
event during its publication window. Invite-only seller admission does not
change visitor access. A genuinely private or invite-visible event is deferred
and would require authenticated authorization.

- A published `public` event appears in Promenadis discovery, search/filter
  feeds, its organizer profile's public event list, and the production sitemap.
  Its stable landing page is indexable with sanitized event-level metadata only:
  title, description, organizer, locality, schedule, and lifecycle status.
- Map and route views, seller/location detail routes, exact pins, street or unit
  addresses, seller text, map screenshots, and public-data object URLs are never
  included in indexable HTML or metadata. Application-internal seller search
  remains available from the bounded event snapshot.
- An `unlisted` event is absent from discovery, public organizer listings,
  feeds, recommendations, and sitemaps. Its URL is nonsequential and contains at
  least 128 bits of unguessable entropy. The creation and seller flows warn that
  every link holder has anonymous viewing access while the event is published.
- Unlisted links may show a sanitized social preview containing the event title,
  organizer, date, locality, and generic branding, but no map, seller, pin, or
  address. The UI warns that pasting the URL may disclose the URL and this
  event-level metadata to a preview provider. Promenadis adds no tracking query
  parameters.
- Before activation, an owner may rotate a leaked unlisted URL. The old URL
  returns `410 Gone` without redirect and participants are notified. Rotation
  during an active event is reserved for safety incidents because it disrupts
  visitors.
- Visibility is freely selectable while the event is a draft and no seller has
  joined. A public event may
  become unlisted before activation, with immediate discovery/sitemap removal
  and a warning that prior search results or shares may persist. Once sellers
  have joined, changing an unlisted event to public requires notice and explicit
  seller reconfirmation before each listing and pin becomes publicly
  discoverable. Visibility locks at activation.
- A public landing page may retain sanitized postponement, rescheduling, or
  cancellation status after exact seller data is removed. At the 14-day archive
  transition it leaves the sitemap and becomes non-indexable; a minimal direct-
  URL history shell may remain. Unlisted pages remain non-indexable throughout.
  Deleted events and rotated URLs return `410`; unknown URLs return `404`.

Search-engine directives are best-effort third-party instructions, not a
promise of immediate removal from search caches or already downloaded data.

After publication but before activation, boundary or schedule changes are
versioned pending revisions with a host impact preview. A boundary revision
re-evaluates pending applications and walking data. Approved sellers newly
outside the polygon are hidden until explicitly retained as geographic exceptions
or rejected/withdrawn. Date changes use the postponement/reconfirmation flow.
Shortening same-day hours clips seller availability and notifies sellers;
extending hours never extends seller availability or residential-pin publication
without individual opt-in.

Boundary and core event intervals lock at activation. An active event may end
early or enter postponement, but cannot be redrawn, shifted, or extended.
Additional time or another day uses a duplicated event. Effective revisions
increment boundary/schedule versions, regenerate snapshots, rebuild walking data
when geography changes, notify affected users, and are audited.

Registration opens when the scheduled draft is created and closes one hour
before the event by default. The host can configure the window and can explicitly
keep registration open while the event is active. A registration window cannot
end after the event itself.

Cancelling an event disables registration and new routes and displays a public
cancellation notice. After 14 days it is archived and removed from discovery.
Its direct URL may show a minimal archived/cancelled page without seller data or
residential locations.

Completed events archive automatically after 14 days. Hosts can retain an
event-history shell and duplicate an old event.

### Severe-weather postponement

An owner or co-host may postpone with recent authentication and a public reason;
moderators cannot. A replacement must be finalized within 14 days and start no
more than 30 days after the original date. A later replacement uses cancellation
plus event duplication.

Approved sellers move to `pending_reschedule_confirmation`, retain their seller
place temporarily, and remain unpublished until they accept the new publication
window. Unchanged addresses need no new geographic approval; declined or expired
confirmations withdraw and free the place. If no valid replacement is finalized,
the event cancels automatically and precise seller data is deleted no later than
14 days after postponement, without another grace period. An interruption after
activation closes the current interval and follows the same hiding,
notification, and reconfirmation flow. Sellers, event team, and interested/going
users are notified at postponement, rescheduling, and automatic cancellation.

### Event duplication

Duplication copies event configuration, descriptive content, boundary,
categories, and branding. It does not copy dates, sellers, addresses, listings,
reports, visitor routes, or audit records.

The duplicate is owner-only by default. A checkbox may copy/invite the previous
event team.

### Ownership transfer and owner deletion

Every event has exactly one active owner. A planned transfer requires a recently
authenticated current owner and acceptance by a verified existing co-host; both
steps are audited. The previous owner becomes a co-host by default. Managing the
post-transfer organizer profile is a separate permission: the incoming owner
must already own or manage the organizer identity explicitly selected by the
current owner. Acceptance changes the event owner and, when selected, its public
organizer identity atomically.
The ordinary planned-transfer offer expires after at most seven days and is not
the delayed emergency-successor recovery flow.

A sole owner requesting account deletion must transfer each draft, published, or
active event, delete drafts, or cancel published/active events. If they continue
without a transfer, cancellation immediately unpublishes seller locations before
the seven-day account-recovery window starts. Ended/archived history shells may
remain without a personal-account link; organizer profiles must be transferred
or hidden and detached from the erased/pseudonymized owner. An unreachable owner
uses only the predesignated-successor recovery flow.

## 6. Geography and seller admission

The canonical event boundary is a polygon drawn on a map. Postal codes and named
areas may help create or explain the boundary but are not the authoritative
geometry.

Launch limits are approximately:

- Maximum boundary area: 25 square kilometres.
- Maximum span: 10 kilometres.
- Warn the host before enforcing the hard limit.

Supported admission modes:

1. Automatically approve locations inside the boundary.
2. Require host approval for every application.
3. Invite-only.

A seller outside the boundary receives a clear warning but can still submit.
That application becomes a pending geographic exception and requires host
approval.

Participation should support at least these states:

- `pending`
- `waitlisted`
- `approved`
- `withdrawn`
- `rejected`
- `suspended`
- `revoked`
- `pending_address_change`
- `pending_reschedule_confirmation`

Approval is specific to one event and is never inherited by another event.

Only `approved`, `suspended`, and `pending_address_change` participations consume
the event's seller entitlement. When capacity is full, otherwise eligible
applications become `waitlisted` rather than being rejected. Automatic
inside-boundary events promote the earliest eligible waitlisted seller when a
slot opens before the event starts, unless registration or promotion is paused.
Manual and invite-only events require host selection; invitations do not reserve
capacity before acceptance. Active events never auto-promote replacements.

Withdrawal and revocation free a slot. Temporary suspension, address-change
review, and early closure retain it. Approval and promotion enforce capacity in
one transaction so concurrent actions cannot exceed the entitlement. Reducing a
future entitlement below current usage does not revoke sellers; it blocks new
approvals until usage falls below the limit.

After approval, changing an address always unpublishes the seller location and
moves it to `pending_address_change`. A host must approve the new address even
when the event normally auto-approves inside-boundary applicants.

During an active event, any seller-initiated address or pin change immediately
unpublishes only that seller participation and uses `pending_address_change`,
regardless of distance. At a shared location, the other sellers and canonical pin
remain unchanged; moving away proposes a new location. An authorized owner,
co-host, or moderator may correct an obvious same-address mapping error by at
most 25 metres without closing the stop, but only with recent authentication, a
required reason, before/after coordinates, seller notice, and an audit event.
Larger or physical-stop changes require full reapproval. Every active correction
triggers urgent public-snapshot and route-cache invalidation.

Geocoding should propose a pin. During initial application, the seller may
manually correct it without a review beyond the event's normal admission flow.
After approval/publication, pin changes follow the address-change and active-event
correction rules. Manually placed pins carry a visible internal/publicly
appropriate indicator.

Promenadis does not request proof of residence. Sellers attest that they have
the right to publish and use the location. Abuse is mitigated through verified
email, rate limits, duplicate-address visibility, reporting, and quarantine.

## 7. Locations and multiple sellers

A physical `event_location` is one map pin and one route stop. One or more
seller participation records may attach to it, which supports apartment
buildings and shared yards without creating duplicate route stops.

Locations share one canonical stop only when they use the same actual public
entrance, yard, or stall. A normalized address or nearby coordinate is only a
candidate signal: ask the applicant whether the entrance/stop is shared and
require host confirmation for ambiguous merges or splits. Apartment/unit
identifiers are never public and are retained privately only when briefly needed
to distinguish entrances.

Nearby but distinct addresses, such as six townhouses in one row, remain six
`event_location` records, pins at close zoom, progress items, visit-time inputs,
and contributions to the 50-location route limit. A derived route/display
cluster may group them at overview zoom and as a macro-node for optimization,
then expand into an efficient individual-stop order. The cluster's time estimate
sums its locations rather than treating the group as one visit.

Each approved seller participation consumes one event seller place even when
several sellers share a location. Capacity UI explicitly distinguishes the two,
for example `23 of 30 seller places used · 18 map locations`. An applicant joining
an existing location is told that they share a stop but still consume one seller
place.

The stop defaults to an address-derived label. Each seller may add an optional
event-specific public title. Visitors can mark the entire location visited or
expand it and track individual sellers.

The public experience does not expose legal names or account email addresses.

## 8. Location publication and retention

- Before approval, the precise address and pin are visible only to the seller
  and authorized event team.
- The host can choose whether approved locations appear before event day.
- A seller can opt out of early visibility; the host cannot override that.
- While participating in an active event, an exact public pin is required so
  visitors can find the seller. The formatted street address may be omitted from
  the UI, but the product treats the pin as address-equivalent information.
- A withdrawn, revoked, suspended, or closed seller disappears from new route
  plans.
- Exact locations and listing content become non-public immediately when the
  event ends.
- A private 14-day operational grace period follows, after which precise
  addresses, coordinates, descriptions, listings, and any future images are
  deleted.
- Minimal event history, aggregate counts, and separately justified security,
  moderation, and audit records may remain.

## 9. Seller discovery content

Launch is text-only. Sellers can publish:

- Optional seller/location title.
- Short free-text description.
- Standardized localized categories.
- Free-form tags.
- Seller-specific availability within the event hours.
- Basic accessibility/location facts: step-free access, stairs, elevator,
  indoor/outdoor, and stroller suitability.
- Highlighted items with name, category, availability/sold status, optional
  indicative price, and a notice to confirm price at the stall.

Prices are stored as integer minor units with an ISO currency code. The event
defaults to SEK in Sweden.

Search favors recall over precision. PostgreSQL full-text search and trigram
matching should cover descriptions, standardized category translations,
Swedish synonyms, seller tags, and highlighted item text. An external search
service is not required initially.

### Category and tag taxonomy

Taxonomies are versioned by event format. Launch begins with
`flea-market-v1`; later formats such as an art walk receive their own taxonomy
rather than inheriting flea-market concepts. Canonical categories use immutable
opaque IDs and stable machine keys. Platform-owned Swedish and English labels,
short descriptions, reviewed search synonyms, sort order, and active/deprecated
state are presentation metadata; persisted selections always reference the
category ID rather than a translated label.

`flea-market-v1` contains fourteen broad multi-select categories:

- Kläder & accessoarer / Clothing & accessories
- Barn & baby / Children & baby
- Hem & kök / Home & kitchen
- Möbler & inredning / Furniture & decor
- Böcker & media / Books & media
- Leksaker & spel / Toys & games
- Elektronik / Electronics
- Sport & fritid / Sports & outdoors
- Verktyg & bygg / Tools & DIY
- Trädgård & växter / Garden & plants
- Samlarobjekt & vintage / Collectibles & vintage
- Hantverk & handgjort / Crafts & handmade
- Mat & fika / Food & refreshments
- Övrigt / Other

Each seller listing selects one to five canonical categories. A highlighted
item selects one primary category. Selecting `Other` prompts for descriptive
text but never relaxes content rules. Accessibility, availability, sold status,
event format, and safety facts remain separately typed fields and cannot be
represented as categories or tags.

An event owner may enable a relevant subset, reorder it for the event, and
publish up to twelve optional suggested tags. Owners cannot rename canonical
categories, change translations, or create event-local categories at launch. A
missing concept uses a seller tag plus feedback to Promenadis until platform
review decides whether a later taxonomy version needs a category.

A seller may add up to ten free-form tags of at most 30 Unicode grapheme
clusters after trimming. Preserve the authored spelling for display and keep a
separate normalized value for whitespace, case, duplicate, search, and abuse
controls. Tags are untranslated user-authored text, cannot imitate platform
badges or typed accessibility/safety claims, and follow the listing's
moderation and deletion lifecycle.

Filters operate on canonical category IDs and render labels in the visitor's
UI language. Search expands selected categories with Swedish and English labels
and a small reviewed synonym list while also searching the original seller
description, tags, and highlighted-item text. Promenadis does not machine-
translate or silently rewrite user-authored text.

Published and active events pin one taxonomy version and enabled subset so
their filters cannot change mid-event. Drafts may explicitly upgrade; a
duplicated event begins with the prior compatible selection and offers the
current version. Category IDs are never reused or hard-deleted. Deprecation maps
to a replacement category or `Other`, and taxonomy changes are reviewed code/
data migrations during the solo-developer pilot rather than unrestricted admin
edits.

### Images

Images are explicitly out of launch scope. The data model and service boundaries
may allow them later, but no public upload UI or image moderation pipeline should
ship initially.

A later moderated pilot would require upload quarantine, file validation,
re-encoding, EXIF/GPS stripping, processed-asset-only publication, rapid report
handling, and deletion of originals. Terms alone are not a substitute for these
controls or the platform's legal duties.

## 10. Visitor map and routing

Visitors may favorite any number of sellers, but an active optimized walk is
limited to 50 physical locations. Before starting, Promenadis estimates walking
time plus configurable visit time and warns when the route is unlikely to fit
within the event or sellers' availability.

The standard visit estimate is five minutes for a physical location with one
selected seller plus two minutes per additional selected seller there. Route-wide
presets are `quick` (two plus one per additional seller), `standard` (five plus
two), and `leisurely` (ten plus five), with a custom global base and optional
per-location overrides. Cluster duration sums its individual locations. Anonymous
preferences stay local; signed-in saved routes sync them. Estimates inform
warnings and optimization but never block a visitor from starting a route.

The 50-location limit is a technical and interaction ceiling, not a recommended
route length. A visitor may reasonably complete all 50 when stops are dense, such
as adjacent townhouses. Feasibility warnings use the actual walking network and
visit-time assumptions rather than rejecting a route merely because its stop
count is high. Several sellers at one shared location count as one route stop.
Derived nearby-location clusters do not reduce the number of individual
locations counted toward the limit.

Route functionality:

- Custom start point.
- Best-effort optimized walking order.
- One-way route by default, with a return-to-start option.
- Manual reordering and recalculation.
- Next/previous, skip, undo skip, visited progress, and whole-location or
  individual-seller completion.
- A drawn walking path and live location puck.
- Continue using the most recently cached route package during a backend outage
  when possible.

Location permission is optional. Promenadis never requests it on page load;
`Use my location` explains the immediate purpose and triggers the browser prompt
only after the visitor acts. Without permission, route setup supports picking a
start on the map, choosing a selected event stop, or optimizing with no fixed
start. The last option states that travel to the first stop is not included.

An initial position uses a roughly 10-second timeout and shows its accuracy
circle. Accuracy worse than 100 metres requires retry or manual selection rather
than silent use. A usable point within 100 metres of the prepared graph routes
from the nearest graph point and distinguishes the unverified start connector.
For a more distant/out-of-area point, omit the first access leg and its duration
with a clear explanation. `Show my position` explicitly starts higher-accuracy
tracking only while the active route view is visible. Manual route progress
always works, and Promenadis does not promise background tracking.

Walking-network packages target at most 2 MiB compressed transfer and 25 MiB
decoded browser memory, with a hard 5 MiB compressed ceiling. Oversized builds
must be simplified or have their boundary reviewed before route readiness. The
managed offline cache has a 50 MiB budget with least-recently-used eviction
across events, but never evicts the package used by an active walk. Packages stop
being valid within 24 hours after event end or cancellation even if their bytes
remain in the browser's HTTP cache.

Route optimization defaults to availability-aware ordering. It minimizes
selected sellers reached after closing while normally limiting added walking to
20% over the shortest plan, then minimizes walking time. If another time window
would exceed that guardrail, show both alternatives and explain the tradeoff.
Visitors may mark up to ten selected sellers as `must-see`, which may exceed the
ordinary guardrail. A `shortest walk` mode remains available with time-window
warnings.

Impossible or conflicting stops remain visible with predicted-miss warnings and
are never silently dropped. Show estimated arrival/departure times and brief
ordering explanations. Respect manually locked positions. Live changes may
trigger a revised suggestion, but an active route is never silently reordered;
the visitor accepts the revision. At shared locations, calculate availability
for each selected seller even though walking uses one stop.

Seller check-in is optional. Scheduled availability publishes the seller
automatically unless another participation/moderation state blocks it. Sellers
may set `confirmed_open`, `temporarily_away`, or `closed_early`; they may resume
or deliberately reopen the same approved location before scheduled end. Event-
team members may act on their behalf with an audited reason. At shared locations,
status applies per seller and the stop remains available while at least one
seller is open. Scheduled end closes/unpublishes automatically.

Away and early-close commands affect authoritative APIs and new routes
immediately, trigger urgent CDN invalidation, and target a refreshed public
snapshot within 60 seconds under normal operation. Active clients check a small
safety/status feed about every 15 seconds, so safety-visible UI changes target
15 seconds without claiming that every cached full-snapshot byte disappears that
quickly. Offline clients show when their data was last updated because downloaded
data cannot be remotely retracted.

Each event publishes a small manifest, a content-addressed full public snapshot,
and a coordinate-free safety feed. The manifest names the active snapshot and
routing versions and their hard expiry. The full snapshot contains only
explicitly allowed public event, organizer, location, seller, availability,
accessibility, search, and cluster fields. The safety feed carries only event
state, removed/closed opaque public IDs, blocked graph edges, required graph
version, sequence, generation time, and expiry.

Fresh clients validate the manifest and safety feed before rendering precise
locations. On event end or cancellation, a tombstone manifest/feed replaces the
active state immediately, public snapshot objects are deleted, and provider
cache invalidation targets completion within 60 seconds. Clients refuse expired
snapshots even when bytes remain in HTTP or offline cache.

An approved location that cannot connect to the walking graph remains visible in
discovery with a `walking route unavailable` badge. It is excluded from the
connected optimized path by default, but a visitor may explicitly include it as
a manual gap between connected route segments. Display that gap as a dotted,
labelled `manual connection — no verified walking path`, never as a normal route
line. Do not invent travel time from straight-line distance; show known walking
time with an incomplete-total warning. Pin and network changes trigger
re-evaluation.

Before route readiness is confirmed, owners and co-hosts receive a walking-
network preview showing graph edges, seller-location snap points, connected
components, disconnected locations, and suspicious detour outliers. Moderators
may inspect and report problems but cannot publish network changes. An owner or
co-host may correct a same-address entrance, block an unsafe edge, mark a stop
as intentionally manual-access, or propose an event-scoped connector of at most
100 metres between existing graph/location nodes within the buffered event area.
Every override requires a reason and is audited. A connector additionally
requires an explicit attestation that visitors may legally and safely walk it,
and visitor-facing details identify it as an `organizer-confirmed connection`.

Overrides never edit OpenStreetMap and expire with the event. Each publication
creates a new immutable graph version with an impact summary and source/build
metadata. Route readiness may include known manual-access stops, but not
unexplained disconnects or unresolved unsafe-edge warnings. During an active
event, blocking an unsafe edge uses urgent invalidation. An added connector
still requires preview and confirmation, and an active visitor must explicitly
accept the new graph version.

Full street-level turn-by-turn instructions, voice guidance, off-route automatic
recalculation, native apps, and external Apple/Google Maps handoff are deferred.
They remain straightforward future additions to an API-first architecture.

### Supported devices, installation, and offline use

Promenadis is URL-first. PWA installation is optional and never unlocks product
functionality, privacy, or entitlements. The launch provides a web manifest and
scoped service worker but no Apple App Store, Google Play, or Microsoft Store
package. Browser-provided installation UI is preferred; a quiet, dismissible,
frequency-capped suggestion may appear only after a meaningful action such as
preparing a route, never during active navigation. iOS installation guidance is
user-invoked rather than an imitation of Chromium's install prompt.

Visitor-critical Tier 1 covers Safari on the current and previous supported
iOS/iPadOS major releases and Chrome on Android 10 or later at its current and
two preceding stable releases, in both browser and installed modes. Other
standards-capable mobile and embedded browsers receive a best-effort landing,
seller-list, and manual-progress experience; constrained in-app browsers explain
how to open the same URL in the system browser when necessary.

Organizer, seller, moderation, and administration Tier 1 covers the current and
two preceding stable desktop releases of Chrome, Edge, Firefox, and Safari on
vendor-supported operating systems. Tablet layouts are responsive and iPad
Safari is explicitly tested. Internet Explorer, obsolete Android WebViews,
smartwatches, feature phones, and vehicle browsers are unsupported. Feature
detection controls capability fallbacks; Promenadis does not deny access through
a browser-name allowlist.

If the map/WebGL fails, the structured list remains usable. If Web Workers or
local storage are unavailable or quota-limited, browsing plus manual route
ordering and progress remain available while optimization/offline limitations
are stated precisely. Geolocation and background behavior are never prerequisites
for manual use.

The first event open requires connectivity. Once a visitor explicitly prepares
or starts a route, the valid app shell, sanitized event snapshot, walking package,
selected route, and progress may remain usable through connection loss within
the 50 MiB managed cache and existing hard expiry. A complete offline basemap is
not promised; already cached tiles are best-effort, while the stop list, route
order, textual legs/manual gaps, and progress remain authoritative.

Offline state shows its last successful refresh and whether safety changes could
not be checked. Reconnection refreshes manifest/safety state before synchronization
or newly requested exact data. Event end, cancellation, hard expiry, and privacy
deletion boundaries win over availability, and the UI explains that downloaded
public information cannot be remotely retracted before reconnection.

Only visitor route progress may be recorded locally offline and reconciled on
reconnect before expiry. Authentication, applications, seller/host changes,
moderation, administration, reports, and organizer-relay messages require an
online authoritative response and are never invisibly queued.

Service-worker updates use versioned caches, do not force a reload or alter an
active walk, and apply at a safe boundary after notice. Safety feeds, expiries,
and kill switches remain authoritative. Help and accessibility documentation
publish a rolling support/test matrix, rechecked before every public pilot.

Live GPS remains transient in the browser. Promenadis never stores visitor GPS
trails. A signed-in synced route stores chosen stops and progress only.
Current coordinates, reported accuracy, and a manually chosen visitor start are
never uploaded, logged, synced, or placed in analytics.
Synced routes and progress are deleted within 24 hours after the event ends or
is cancelled; visitors may delete them earlier. Anonymous local route state
expires at the same event boundary.

## 11. Attendance and analytics

Signed-in users may mark an event as interested or going. This supports personal
reminders and cancellation notices. Event teams see aggregate counts only, not
attendee identities or email addresses. Attendance is not publicly attached to
profiles.

Identifiable attendance is deleted within 24 hours after event end or
cancellation once the final notification has been queued or abandoned.
Irreversibly anonymized aggregate counts may remain.

Analytics are first-party and aggregate. Promenadis does not collect movement
history, cross-site identifiers, or user-level visitor analytics. Hosts receive
event-level operational statistics only.

## 12. Notifications

Launch uses email and in-app notifications. Active pages can refresh data about
every 60 seconds; web push and SMS are deferred.

Transactional messages include:

- Login messages.
- Team invitations.
- Seller application and address-change decisions.
- Event cancellation.
- Security notices.
- Optional event reminders according to user preferences.

Notifications are structured templates only. Hosts cannot upload recipient
lists, send newsletters, or compose arbitrary bulk email through Promenadis.

Every published public or unlisted event provides a structured `Contact
organizer` form backed by an event-scoped two-way relay. It routes to verified
owner/co-host recipients without automatically disclosing either party's email
address. Messages are short plain text with no attachments. Safety, privacy,
legal, and abuse reports remain separate platform workflows; the organizer relay
is not buyer-to-seller messaging.

Completed notification jobs are deleted promptly; delivery metadata and in-app
notification content expire after 30 days unless linked to an unresolved
security/moderation case. Relay message bodies expire 30 days after delivery and
relay routing metadata 14 days after event end or cancellation. Suppression state
persists only while necessary to protect an active address or honor its current
preference.

## 13. Export and import

Owner and co-host may request a limited, audited CSV export containing approved
public operational fields such as address, title, hours, categories, and status.
It excludes account email, private identity information, reports, and internal
moderation data. Moderators cannot export.

Exports require recent authentication, allow one active export per event and
three requests per event/account per day, cap rows to the event entitlement,
neutralize spreadsheet-formula cells, and use a single-purpose signed download
that expires and is deleted within 24 hours.

General spreadsheet import and a Loppiskartan migration assistant are deferred.
Any future import of people must use invitations and explicit account claiming;
an organizer cannot silently create accounts or publish residential locations
for other people.

## 14. Accessibility and localization

Promenadis targets WCAG 2.2 Level AA for every first-party public,
authenticated, organizer, moderation, and administration flow in Swedish and
English. Accessibility is a launch quality gate even if launch counsel concludes
that the initial service is outside a particular statutory accessibility regime.

Core functionality never depends on seeing or directly manipulating the map.
Visitors can discover and filter stops, select them, understand availability,
build and reorder a route, read every leg/manual-gap/status warning, move through
next/previous controls, and record progress using an equivalent structured list.
Hosts can define and edit boundaries and correct pins using labelled search,
selected-point fields, and button/keyboard controls; pointer dragging is an
enhancement rather than the only method. Launch does not need to narrate exact
visual path geometry as turn-by-turn directions.

Product requirements include semantic structure, logical headings and
landmarks, full labels and instructions, visible non-obscured keyboard focus,
skip navigation, color-independent state, adequate contrast, zoom/reflow through
400%, reduced-motion support, and persistent plus programmatically announced
validation and asynchronous status. Controls target at least 44 CSS pixels where
practical and never fall below the WCAG 2.2 AA minimum. Route/boundary reordering
and editing always have non-drag controls.

Authentication, CAPTCHA, session expiry, recovery, and destructive confirmation
flows are in scope. Promenadis does not add cognitive-function tests or block
paste/password-manager behavior. Recoverable expiry preserves entered data where
security permits, and the direct human contact route remains available if an
anti-abuse provider is inaccessible.

Seller accessibility facts are structured, seller-supplied, and explicitly
unverified. Promenadis does not label a walking route `step-free` or `accessible`
merely because individual seller locations are; verified accessibility-aware
routing remains deferred.

Before a real public pilot, publish a plain-language, footer-linked accessibility
statement naming WCAG 2.2 AA as the target, accurately describing the assessed
conformance status, known limitations and alternatives, tested environments,
review date, and accessible email/form feedback channels. Do not claim full
conformance, certification, or legal compliance without supporting evaluation
and legal review. Review the statement after material releases and at least
annually.

Accessibility reports are ordinary product/support issues unless they also
identify a safety, privacy, or legal incident. Reporting cannot require CAPTCHA
as the only route or require a person to disclose a disability.

Localization requirements:

- Swedish and English UI at launch.
- User-authored event and seller content remains in its authored language.
- No automatic translation at launch.
- Translation keys, locale-aware dates/times, currencies, and address formatting
  are required from the beginning.

## 15. Commercial model

The pilot launches entirely free. Billing code and a payment provider are not
part of the first release, though dormant entitlement concepts may be reflected
in the data model.

Before any real public or unlisted pilot, Promenadis designates its natural or
legal operator/controller and publishes a persistent operator page with legal
name, a compliant Swedish establishment address, human-monitored email, and
organization/VAT or competent-authority details where applicable. If operated
personally, use a lawful business/service address confirmed by launch counsel so
a home address is not published unnecessarily. Closed alpha may continue until
that public identity and contact route are ready.

Before the same real-pilot boundary, commission one bounded Swedish legal review
of the free launch: operator/controller disclosures, GDPR roles and legal bases,
location/publication/retention rules, terms and privacy text, UGC moderation and
appeals, DSA and Swedish Electronic Bulletin Boards Act classification,
accessibility-law positioning, and OpenStreetMap/ODbL delivery. Synthetic
development and closed alpha without publicly exposed real residential
locations may proceed before that review. Commercial contracts, VAT, payments,
refunds, and consumer-distance-selling advice are deferred until Promenadis
actually plans to charge.

Current working model for later:

- Free events support up to 30 approved seller participations, counted by
  seller rather than physical location.
- Larger or premium events may use a one-time B2B event upgrade.
- Initially sell only to verified organizations such as associations and
  companies, after a business entity/accounting/legal review is in place.
- Do not rely on programmatic ads as the primary model; they are seasonal,
  privacy-sensitive, and unpredictable at this scale.
- An external `Support Promenadis` link may appear in the footer and as
  dismissible, frequency-capped prompts after meaningful host milestones.
- Support/donations never unlock features or change moderation outcomes.
- Do not interrupt active navigation with support prompts.

The seller cap is configurable so it can be revisited using actual costs and
support revenue. Development and closed alpha must remain free or near-free. A
live pilot uses a hard 350 SEK/month personal out-of-pocket ceiling, including
VAT and projected variable usage. If the current exchange rate and provider
estimate cannot fit within that ceiling, public production waits until support,
sponsorship, or a pilot organizer covers the difference. The cost-capped live
topology is Supabase Pro only while real events require non-pausing production,
Netlify Free, and small metered SES/Fargate/S3 usage. Netlify Personal is an
optional funded event-month upgrade, not a permanent dependency. No meaningful
SLA is promised; paid incidents may be handled with best-effort credits or
refunds.

Provider selection follows the same low-commitment rule: prefer free or
freemium tiers during development and closed alpha, then metered pay-as-you-go
services with explicit quotas, budget alerts, and reversible upgrades. Do not
silently enable overages, automatic recharge, or a fixed subscription merely
for convenience. A fixed tier is acceptable only when a measured reliability or
capacity requirement for a real event justifies it, or when external funding
covers it. Supabase Pro is the planned exception for a real public event because
the Free project can pause; it is not intended to remain enabled between event
periods when the production project can safely fit the Free limits and all
post-event obligations are complete.

The accepted self-funded envelope is one large event of up to 500 sellers and
10,000 visitors in a paid month. Up to three overlapping equivalents are
conditional on staging load tests, measured provider headroom, operator
coverage, and a fresh projection below 350 SEK. Five equivalents are a funded
stress case. Working all-in estimates are approximately 335 SEK for one event,
344 SEK for three, and 356 SEK for five, including 25% VAT, a 15 SEK monthly
domain allocation, and a 3% currency/payment buffer. Recalculate from current
provider usage and exchange rates seven days before publication. A required
database compute upgrade, Netlify Personal, or paid Geoapify tier fails the
personal-budget gate and requires funding or postponement.

The pilot has no 24/7 support promise. Accept an event date only when the solo
operator can cover the period from two hours before its first public interval
until one hour afterward. During that covered window, the internal target is to
acknowledge a critical privacy/security or active-event outage alert within 15
minutes; this is an operational target, not a customer SLA. Automated expiry,
unpublication, degraded mode, and event-team safety controls remain the primary
protection when the operator is unavailable.

### Pilot rollout and feedback

Roll out in three stages: synthetic internal dogfooding; a closed alpha with one
organizer and five to ten trusted testers without public real residential
locations; then one real public or unlisted event with one known organizer and
at most 30 sellers. A real unlisted event receives the same readiness treatment
as a public one because anyone with its link can view it.

The first real pilot requires a verified owner and co-host/emergency successor,
the settled public operator/legal/support/accessibility routes, working
monitoring and retention/expiry controls, a reviewed route graph, and operator
coverage. It is visibly labelled as a pilot/beta and carries no uptime or
support SLA.

There is no fixed release-freeze calendar or formal change board while the
service is free and solo-operated. The operator may deploy frequently and use
judgment, including close to an event. Payment status does not weaken the
privacy and safety baseline: automated CI, production-target confirmation,
location expiry/takedown tests, safe migration rules, monitoring, kill switches,
and a viable rollback or forward-fix path remain mandatory. Formal freezes and
change-management commitments are reconsidered before paid service or an SLA.

Avoid paid help-desk and survey products. Human-monitored support, safety/legal,
privacy, and accessibility aliases/forms may feed one mailbox. Organizers answer
event-logistics questions; Promenadis handles platform, account, privacy,
safety, and accessibility issues. Ordinary support has a best-effort two-
business-day acknowledgement target, not an SLA.

Optional post-event feedback uses a small first-party role-specific form plus
optional short text. It is non-identifiable by default; follow-up contact is
collected separately only by explicit choice. Delete raw feedback no later than
90 days and within 30 days after synthesis, whichever is sooner, and delete
follow-up contact after resolution or 30 days. Retain only non-personal decision
summaries. Review the pilot within seven business days before expanding.

## 16. Explicitly deferred

- Seller photos and image moderation.
- Passkeys and social login.
- Native React Native apps.
- Private/invite-visible event discovery beyond the initial invite-only
  admission mechanics.
- Full turn-by-turn navigation, voice guidance, and automatic off-route logic.
- External map-app handoff.
- Dedicated verified step-free routing.
- Web push and SMS.
- General imports and migration tooling.
- Payments, reservations, buyer/seller chat, and public payment details.
- Individual visitor analytics.
