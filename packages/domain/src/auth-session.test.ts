import { describe, expect, it } from "vitest";
import { sessionFromVerifiedAccessToken } from "./auth-session";

const accountId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606";
const sessionId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f607";
const now = 1_800_000_000;
function token(overrides: Record<string, unknown> = {}) {
  // Parsing fixtures only: these are intentionally not signed or usable tokens.
  const claims = {
    sub: accountId,
    session_id: sessionId,
    role: "authenticated",
    exp: now + 3600,
    iat: now,
    amr: [{ method: "otp", timestamp: now - 120 }],
    ...overrides,
  };
  return `fixture.${btoa(JSON.stringify(claims))}.fixture`;
}
const read = (value: string) => sessionFromVerifiedAccessToken(value, accountId, now * 1000);
describe("session-bound authentication evidence", () => {
  it.each(["otp", "magiclink", "password", "totp"])("uses verified %s evidence", (method) => {
    expect(read(token({ amr: [{ method, timestamp: now - 120 }] }))).toEqual({
      sessionId,
      assuranceLevel: "aal1",
      authenticatedAt: new Date((now - 120) * 1000).toISOString(),
    });
  });
  it.each([
    ["aal2", "aal2"],
    ["aal1", "aal1"],
    ["AAL2", "aal1"],
    [undefined, "aal1"],
  ])("reads assurance %j as %s", (aal, expected) => {
    expect(read(token({ aal }))?.assuranceLevel).toBe(expected);
  });
  it("does not freshen an old sign-in on token refresh or another device's login", () => {
    const old = now - 1800;
    expect(
      read(
        token({
          last_sign_in_at: new Date(now * 1000).toISOString(),
          user_metadata: { authenticatedAt: now },
          amr: [
            { method: "otp", timestamp: old },
            { method: "token_refresh", timestamp: now },
          ],
        }),
      )?.authenticatedAt,
    ).toBe(new Date(old * 1000).toISOString());
  });
  it.each([
    undefined,
    [],
    [{ method: "recovery", timestamp: now }],
    [{ method: "unknown", timestamp: now }],
    [{ method: "token_refresh", timestamp: now }],
  ])("missing or unsupported evidence cannot authorize a sensitive action: %j", (amr) => {
    expect(read(token({ amr }))).toEqual({
      sessionId,
      assuranceLevel: "aal1",
      authenticatedAt: null,
    });
  });
  it.each([now + 61, "1800000000", -1, 1.5, null])(
    "rejects invalid AMR timestamp %j",
    (timestamp) => {
      expect(read(token({ amr: [{ method: "otp", timestamp }] }))?.authenticatedAt).toBeNull();
    },
  );
  it.each([
    { sub: sessionId },
    { session_id: null },
    { session_id: "invalid" },
    { role: "service_role" },
    { exp: now },
    { exp: "1800003600" },
  ])("rejects mismatched or expired session claims %j", (claims) => {
    expect(read(token(claims))).toBeNull();
  });
  it("fails closed on malformed payloads without throwing", () => {
    for (const value of ["", "a.b", "a.%%%.b", "a.bnVsbA==.b", `a.${"x".repeat(32769)}.b`]) {
      expect(read(value)).toBeNull();
    }
  });
});
