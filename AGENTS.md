# Promenadis workspace instructions

Before responding to any Promenadis product, architecture, security, privacy,
legal, or implementation request, read these files completely:

1. `README.md`
2. `docs/PRODUCT_SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/SECURITY_PRIVACY_LEGAL.md`
5. `NEXT_SESSION.md`

Creation mode was explicitly approved on 2026-09-07. Continue the implementation
milestones in `NEXT_SESSION.md`; production deployment, spending, and real
public/unlisted pilots still require their separate gates. Preserve existing
local accounts/events: use forward migrations and rollback-only database tests,
not database resets.

During discovery:

- Continue with the ordered open questions in `NEXT_SESSION.md`.
- Ask one focused question per turn and give a recommended default.
- Keep the conversation in English.
- Explain backend and system implications clearly for a senior frontend
  developer.
- Update the canonical documents whenever a decision is settled.
- If current provider, pricing, security, or legal details matter, verify them
  from current primary/official sources before advising.
- Treat the documents as canonical over incomplete chat recollection. If the
  documents conflict, flag the conflict rather than silently choosing.

Preserve the existing Loppiskartan project at
`/Users/linussvahn/Documents/Loppiskartan`; inspect it read-only unless the user
explicitly authorizes changes there.
