# Promenadis

### Local security-notification preview

With local Supabase/Docker and Mailpit running, `pnpm notifications:local` drains
at most ten eligible recovery/successor security notices into the local inbox.
Run it again after the retry delay to retry failures. Docker must be on PATH.
`pnpm test:local-notifications` tests delivery with a disposable synthetic account
without claiming existing jobs. It leaves one synthetic message in Mailpit.
There is no external mail transport or scheduled worker, and account-recovery
completion remains disabled. The worker reports counts only; a stable message
header aids correlation but does not provide provider-side deduplication.

Promenadis is a mobile-first web app for organizing and visiting geographically
distributed community events, initially Swedish neighbourhood walking flea
markets (`promenadloppis`). It is intended to remain general enough to support
other formats, such as art walks, in the future.

The discovery architecture was approved and creation mode was authorized on
2026-09-07. Milestone 0 (the local-first foundation) is complete locally and
Milestone 1 (identity and events) is underway; its local vertical slices now
cover passwordless sign-in, minimal profiles, direct personal event creation,
organizer identities, one-interval draft scheduling, and versioned draft-event
boundary drawing, seller-registration windows, visibility controls, and
owner-confirmed deletion. Event-team invitations, verified-email acceptance,
role changes, removal, and seven-day invitation retention are also implemented
locally. Shared organizers now have explicit, expiring manager invitations;
personal organizer identities cannot be shared. Planned ownership transfer is
implemented between compatible verified co-hosts, including an owner-approved
recipient organizer identity, explicit acceptance, recent-owner authentication,
optimistic concurrency, seven-day pending-state retention, and an exactly-one-
owner database invariant. The authenticated host UI
separates the event index, guided creation, per-event workspace, map-first area
editor, registration editor, and account settings. This does not authorize a
real public or unlisted pilot, production data, external spend, or any deferred
feature. Owner recovery-code enrollment, verified co-host emergency-successor
designation, and version-bound publication attestations are now available
locally. A designated successor can now initiate a delayed claim, the owner or
successor can cancel it, and the successor can complete it after 24 hours; the
claim expires within seven days and completion transfers only the event and its
pre-approved organizer identity. Structured notification intents are retained
in a private local outbox, but external delivery is not connected. The readiness
view deliberately remains fail-closed. The local recovery preview now supports
code redemption, replacement-email verification through Mailpit, a minimum
24-hour wait from verification, and owner cancellation in Settings. It does not
change the Auth email or restore account access. Safe Auth rebinding/session
revocation, old-email/team delivery, first-event review, routing, public delivery, and publication
lifecycle transitions are still unimplemented.

Browser-session hardening (2026-09-15): local sign-in now uses an opaque
HttpOnly, SameSite cookie through the existing private backend. Supabase tokens
and PKCE state stay encrypted server-side, not in browser storage. Existing
accounts/events are preserved; sign in again with a fresh code/link after
updating. Two independent browser contexts and stale-account writes are tested.
The reported Zen window/account switch is not yet explained. Hosted cookie auth
remains disabled pending HTTPS routing and dedicated encryption-key management.

Session freshness (2026-11-01): sensitive actions now use the requesting
session's verified sign-in evidence, not the account-wide last sign-in time.
Signing in on another device or refreshing a token cannot freshen an older
session. The BFF also rejects revoked direct bearer sessions. Recovery
completion remains disabled pending delivered security notices and a safe
email-change/revocation workflow.

## Canonical product and implementation documents

- [Product specification](docs/PRODUCT_SPEC.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Security, privacy, moderation, and legal baseline](docs/SECURITY_PRIVACY_LEGAL.md)
- [Authorization matrix](docs/AUTHORIZATION_MATRIX.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Data classification, retention, and erasure matrix](docs/DATA_CLASSIFICATION_RETENTION.md)
- [Provider, environment, and secret inventory](docs/PROVIDER_ENVIRONMENT_INVENTORY.md)
- [Implementation and launch checklist](docs/LAUNCH_CHECKLIST.md)
- [Next-session handoff and open questions](NEXT_SESSION.md)

These documents record the decisions made during the initial discovery
conversation. If a later discussion changes a decision, update the relevant
document and the decision snapshot in `NEXT_SESSION.md` in the same change.

## Local development

The repository is a pnpm workspace. Once dependencies are installed:

```sh
pnpm dev
pnpm verify
```

The local Supabase stack additionally requires Docker. It is deliberately
separate from the secretless web/package checks:

```sh
pnpm db:start
pnpm db:test:preserve
pnpm db:lint
pnpm db:types:check
pnpm db:stop
```

`pnpm db:verify` resets the database and is for disposable/CI environments,
not a local database containing accounts or events you want to keep.

For the current local identity/event slice, start Supabase and then the app:

```sh
pnpm db:start
pnpm dev
```

`pnpm dev` copies only Supabase's local public URL/key into an ignored web env
file. Open `http://127.0.0.1:5173/sign-in`; passwordless test mail appears in
Mailpit at `http://127.0.0.1:54324`, and the database can be inspected in Studio
at `http://127.0.0.1:54323`. Use synthetic data only. The reusable backend slice
check is `pnpm test:local-slice`; `pnpm test:e2e:local-auth` verifies both the
visible email OTP and same-browser magic-link flow against the local stack.
The focused regression `pnpm test:local-session-security` checks stale-session
step-up and revocation using a disposable synthetic account.

## Existing prototype

The existing Loppiskartan prototype is outside this workspace at:

`/Users/linussvahn/Documents/Loppiskartan`

It is a React 19, TypeScript, and Vite app using MapLibre/react-map-gl. It reads
seller data from a Google Sheet and performs browser-side walking-route
calculation over a locally generated OpenStreetMap walking graph. Promenadis
should reuse the proven interaction ideas, but remove its hard-coded geography,
spreadsheet dependency, and prototype-only data model.
