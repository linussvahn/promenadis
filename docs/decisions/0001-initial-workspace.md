# ADR-0001: Initial workspace and package boundaries

- Status: accepted
- Date: 2026-09-07
- Owners: Promenadis

## Context

Milestone 0 needs a concrete repository layout. The system must remain portable,
low-cost, contract-first, and reusable by a later non-web client without
prematurely creating packages for unimplemented features.

## Decision

Use a pnpm workspace pinned to Node 24 and pnpm 11. The first packages are a
React Router framework-mode web app, pure domain rules, strict Zod boundary
contracts, and framework-independent Swedish/English messages. Supabase SQL and
local-service configuration remain in `supabase/`. Add API-client, routing, and
provider-adapter packages with the vertical slices that first need them.

Use Biome for the initial formatter/linter and Vitest for package/component
tests. Keep the toolchain small; a tool earns its place by enforcing an accepted
gate.

## Consequences

The web shell can use server rendering while shared business rules stay free of
React and Supabase. Contract artifacts can be checked for drift from their Zod
source. Some conceptual architecture packages do not yet exist; this is
intentional, not missing scaffolding.

## Canonical-document changes

- `docs/ARCHITECTURE.md` now records the initial locked layout.
- `NEXT_SESSION.md` now records active creation mode and Milestone 0 work.
