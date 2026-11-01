# Promenadis provider, environment, and secret inventory

Status: discovery sign-off baseline, 2026-09-07

This document inventories intended trust relationships without containing secret
values. Provider pricing, regions, DPAs, subprocessors, quotas, and product terms
must be rechecked from official sources before a real pilot and after material
provider changes.

## 1. Environment inventory

| Environment | Purpose | Data allowed | External delivery | Destructive reset |
| --- | --- | --- | --- | --- |
| Local | Full developer stack and tests | Deterministic synthetic identities/locations only | Local mail capture and fixture adapters | Yes, after explicit local-project check |
| Pull-request preview | UI/review build | Static fixtures only; no remote Supabase or provider secrets | None to real recipients/providers | Rebuilt per preview |
| CI | Build, migration-from-zero, contract, RLS, routing, security tests | Synthetic fixtures and test secrets only | Provider fixtures; GitHub OIDC only in explicitly trusted deployment workflow | Ephemeral runners/local stack |
| Staging | Shared production-like integration environment | Synthetic identities, addresses, reports, and recipients only | Test allowlists; no production domains/recipients | Yes, after staging project-reference check |
| Production | Real accounts, event operations, and public data | Real data only as defined by classification/retention matrix | Authorized providers and public assets | Never reset; forward migrations and explicit erasure only |
| Recovery exercise | Isolated restore validation | Decrypted real backup only for the bounded exercise | No public app and no outbound provider actions | Destroy within 24 hours |

Production data is never copied, sampled, pseudonymized, or restored into local,
preview, CI, or staging. Reproduce incidents with minimal synthetic fixtures.
Production and staging have distinct projects, domains, callback allowlists,
mail identities, widgets, buckets, budgets, and secrets.

## 2. Provider inventory

| Provider/component | Launch purpose | Data received/stored | Credential class | Baseline and constraints |
| --- | --- | --- | --- | --- |
| Netlify | Public web shell, sanitized event landing SSR, deploy/CDN entry | Source/build artifacts and allowlisted public event metadata; no authenticated/private domain data | Deploy token/site/API credentials in CI only | Free initially; immutable bulk assets/snapshots do not traverse functions; Personal only funded/event-month |
| Supabase Stockholm | PostgreSQL/PostGIS, Auth, Queues/Cron, Storage/Smart CDN | Primary application data, identities, precise locations, cases, jobs, public objects | Project URL/public anon key may be browser-visible; service-role, DB, JWT/signing/management credentials server/CI only | Free development/closed alpha; Pro while a real event needs non-pausing availability; Spend Cap enabled |
| Supabase Edge Functions Frankfurt | Versioned BFF, browser-session gateway and I/O-bound workers | Typed request fields and scoped DB/provider responses; encrypted session vault in existing private PostgreSQL | Function secrets, dedicated session encryption key for hosted use, and narrow job credentials | Force `eu-central-1`; browser authentication and private domain calls cross BFF; hosted cookie gateway remains gated |
| AWS SES Stockholm | Auth and transactional email; organizer relay inbound/outbound | Recipient/sender addresses, message body needed for delivery, bounce/complaint/suppression data | SMTP/API credentials, DKIM private material, inbound verification secrets | Structured templates; no newsletter/bulk-composer; process suppression lifecycle |
| AWS ECS Fargate Stockholm | Walking-graph compiler and logical backup job | Metadata-stripped OSM input; event boundary/build metadata; encrypted DB export stream for backup task | Task-role credentials scoped per job | Graph job cannot read seller tables; backup writer cannot read stored archive |
| AWS S3 Stockholm | Private OSM source cache and encrypted independent backups | Public OSM extract/build sources; client-side-encrypted mixed backup archives | Bucket/task roles; offline decryption private key is separate | Block public access; backups versioned with 14-day governance Object Lock/lifecycle |
| AWS EventBridge/Lambda/CloudWatch/SNS | Event-window probe, schedules, metrics, alerts | Generic endpoint status, latency, freshness/expiry and non-personal alarm data | Narrow execution/notification roles | One-minute probe only around accepted events; no application bodies/identifiers |
| Geoapify EU | Server-side address geocoding | User-submitted address/query and provider response needed to propose location | Server-only API key | Normalize/cache successful results; manual pin at quota/failure; Free limits with reserved headroom |
| OpenFreeMap | Browser basemap tiles/style | Browser network request inherently reaches public tile service; Promenadis sends no account/event private payload | None | Development/pilot use, no Promenadis-backed SLA; runtime-configurable alternative |
| Geofabrik | Source of metadata-stripped Sweden OSM PBF/checksum | No Promenadis personal data; scheduled public source fetch | None | Weekly verified immutable source; public Overpass diagnostic-only |
| Cloudflare Turnstile | Abuse challenge for login, anonymous reports/relay, suspicious step-up | Challenge/browser and server-validation data according to provider terms; no report/message body | Browser site key; server-only secret | Managed Free mode; validate hostname/action/single use; direct human fallback |
| Better Stack | Outside-in uptime/heartbeat and public status page | Generic component name, sanitized URL, status/latency, non-secret heartbeat token | Monitor/heartbeat token | Free personal-project tier; no logs, screenshots, event/account IDs, bodies, or personal data |
| GitHub/GitHub Actions | Source, review, CI, staged/production workflow | Source, synthetic fixtures, build/test output; no production records | Repository/deployment permissions and short-lived AWS OIDC | Default read-only workflow permissions; pinned third-party actions; untrusted PRs get no environment secrets |
| DNS/domain registrar | Domain control, DNS records, email authentication | Public registration/DNS data; account/billing data at provider | Registrar/DNS credentials | Provider TBD; MFA and recovery required; SPF/DKIM/DMARC before mail launch |
| Support/legal mailbox | Human support, privacy, safety, accessibility and authority contact | Minimal correspondence and optional contact | Mailbox credentials | Provider/domain TBD; aliases may feed one mailbox; retention follows case/support class |
| Swedish launch counsel | Bounded review before real public/unlisted pilot | Canonical docs and only the minimum examples needed; no production dataset | Secure document/contact channel | Fixed-scope quote; commercial/payment review deferred until charging |

## 3. Secret inventory

No secret value, token fingerprint, private key, or production identifier belongs
in this file, source control, logs, screenshots, issue trackers, or public
deployment output.

| Secret/capability | Environments | Storage | Browser exposure | Rotation/revocation trigger |
| --- | --- | --- | --- | --- |
| Supabase public URL and anon key | Staging/production | Public runtime configuration | Allowed; treated as public identifier | Project replacement or provider direction |
| Supabase service-role/management/database credentials | Staging/production/CI deploy | Provider/GitHub environment secret store | Never | Suspected exposure, role change, environment rebuild, periodic review |
| Auth/JWT signing material and webhook secrets | Staging/production | Supabase/provider secret store | Never | Exposure, signing migration, integration removal |
| Netlify deploy/API credential | Staging/production deploy | GitHub/Netlify secret store | Never | Exposure, workflow/provider change, maintainer removal |
| AWS deployment role | Staging/production deploy | GitHub OIDC trust policy; no stored access key | Never | Trust-policy change, repository/branch change, exposure concern |
| AWS task/Lambda/S3/SES roles | Staging/production | AWS IAM role attachment | Never | Scope/job/provider change or suspected compromise |
| SES SMTP/API and inbound verification material | Staging/production | Supabase/AWS secret stores | Never | Bounce abuse, exposure, domain/environment change |
| DKIM private material | Production mail domain | SES/DNS-managed mechanism | Never; public DNS has verification records only | Domain/provider/key rotation |
| Geoapify API key | Staging/production worker/BFF | Function secret store | Never | Exposure, quota abuse, provider/environment change |
| Turnstile site key | Staging/production | Public runtime config | Allowed | Widget/environment replacement |
| Turnstile secret | Staging/production BFF | Function secret store | Never | Exposure, widget/domain change |
| Better Stack heartbeat/monitor token | Staging/production jobs | Workload/provider secret store | Never; readiness response contains none | Exposure, monitor replacement |
| Unlisted event token | Production per event | Hashed/secure capability representation where possible; route value delivered to link holder | Yes to authorized link holder | Leak, owner rotation, deletion/end |
| Owner recovery code | Production per owner/event | One-way hash | Shown once to owner only | Use, rotation, event transfer/deletion, exposure |
| TOTP secret/recovery codes | Production account | Auth subsystem, encrypted/hashed as appropriate | Enrollment display once; otherwise never | User rotation/removal, compromise |
| Magic-link/OTP delivery | All auth environments | Auth subsystem/transient delivery | Intended user only; callback code transiently reaches browser | Expiry, use, account/security event |
| Supabase access/refresh tokens and PKCE verifier | All auth environments | Auth subsystem and encrypted private BFF vault | Never browser JavaScript; identity DTO only | Vault absolute expiry, replacement/logout, account/security event |
| Opaque browser session handle | Local now; hosted gated | HttpOnly SameSite cookie; hashed lookup in private vault | Cookie transport only; Secure required for hosted HTTPS | 12-hour expiry, logout, replacement, account erasure |
| BFF session encryption key | Local now; hosted gated | Local domain-separated service-key derivation; dedicated rotated workload secret required for hosted use | Never | Exposure, environment change, scheduled key rotation |
| Backup encryption public key | Production backup writer | Workload config | Not needed in browser; disclosure is not decryption authority | Key-generation transition |
| Backup decryption private key | Offline recovery custody | Outside Supabase and AWS production accounts | Never | Suspected access, custodian change, scheduled recovery-key rotation |
| Internal job/webhook signing secret | Staging/production | Workload secret stores | Never | Exposure, integration/version change |
| DNS/registrar/mailbox credentials | Production operations | Provider account plus password manager/MFA | Never | Exposure, recovery/personnel/provider change |

## 4. Least-privilege identities

- The browser receives public configuration and an identity-only session DTO.
  Supabase credentials remain in the private BFF vault (2026-09-15 update).
- Hosted browser-cookie auth remains disabled pending a reviewed HTTPS private
  routing boundary, Secure host-only cookies, dedicated rotated keys, production
  admission limits, vault exclusion from independent exports and restore-time
  session invalidation. No new provider or Netlify private processing is approved.
- Netlify deploy/render identities cannot query production private tables.
- The BFF may execute named domain operations but does not expose service-role
  pass-through endpoints.
- Queue workers claim bounded job types and cannot browse arbitrary data.
- Graph builders read the selected OSM source/boundary/override input and write
  only their job/artifact result; seller records are not part of the graph.
- Backup writers can create encrypted objects but cannot read, overwrite,
  restore, delete, or bypass retention.
- Monitoring probes access only purpose-built sanitized endpoints.
- CI production deployment is manual and environment-scoped; local production
  credentials are break-glass, not routine.
- Administrators authenticate as people, enter short-lived elevated mode, and do
  not share provider/root accounts.

## 5. Pre-pilot verification register

Resolve and record these before a real public/unlisted pilot:

- Exact provider account/project names, owners, regions, plan, billing/spend cap,
  support route, and deletion procedure.
- Signed/accepted DPA and current subprocessor/transfer review for every processor
  receiving personal data.
- Production/staging callback origins, CORS, domains, buckets, mail recipients,
  widgets, and secrets are mutually isolated.
- Supabase Storage/Smart CDN emits the required object content type, cache,
  referrer, and `X-Robots-Tag` behavior; otherwise the header-setting asset
  domain is ready.
- SES production access, SPF, DKIM, DMARC, inbound relay validation, bounce/
  complaint processing, and suppression erasure are tested.
- Geoapify EU processing/configuration, storage terms, daily quota, caching, and
  manual fallback are current.
- OpenFreeMap and Geofabrik/OSM attribution/terms remain compatible; launch
  counsel has reviewed the compact graph's ODbL treatment.
- Better Stack receives only the allowed generic fields and its DPA/subprocessors
  are acceptable.
- AWS budgets/alerts are configured despite the absence of a universal spend
  cap; Supabase Spend Cap and all platform quotas remain enabled.
- DNS/registrar and human mailbox providers are selected, MFA-protected, and
  recoverable.
- A full secret inventory review finds no production credential in local files,
  preview builds, logs, issue trackers, or repository history.

## 6. Change rule

Adding or replacing a provider requires a short decision record covering
purpose, data fields, role (controller/processor/independent), region/transfers,
DPA/subprocessors, retention/deletion, credentials, least privilege, cost/quotas,
failure fallback, portability, and exit procedure. Update this inventory, the
privacy notice, threat model, data classification, and launch checklist together.
