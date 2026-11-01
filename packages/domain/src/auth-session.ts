const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
// A verified TOTP step is fresh authentication of this session as well.
const signInMethods = new Set(["otp", "magiclink", "password", "totp"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract only AFTER Auth has validated this exact token. Decoding is not verification.
 * Freshness comes from this session's authentication methods, never iat,
 * token refresh, account-wide last_sign_in_at, or editable user metadata.
 * Assurance is aal2 only when Auth itself says so; anything else is aal1.
 */
export function sessionFromVerifiedAccessToken(
  token: string,
  verifiedAccountId: string,
  nowMilliseconds = Date.now(),
): {
  readonly sessionId: string;
  readonly authenticatedAt: string | null;
  readonly assuranceLevel: "aal1" | "aal2";
} | null {
  try {
    const parts = token.split(".");
    const payload = parts[1];
    if (parts.length !== 3 || !payload || payload.length > 32_768) return null;
    const bytes = Uint8Array.from(
      atob(payload.replaceAll("-", "+").replaceAll("_", "/")),
      (character) => character.charCodeAt(0),
    );
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const now = Math.floor(nowMilliseconds / 1000);
    if (
      !record(claims) ||
      claims.sub !== verifiedAccountId ||
      claims.role !== "authenticated" ||
      typeof claims.session_id !== "string" ||
      !uuid.test(claims.session_id) ||
      typeof claims.exp !== "number" ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= now
    )
      return null;

    const assuranceLevel = claims.aal === "aal2" ? "aal2" : "aal1";
    let authenticatedAt: number | null = null;
    if (Array.isArray(claims.amr)) {
      for (const entry of claims.amr) {
        if (!record(entry) || typeof entry.method !== "string" || !signInMethods.has(entry.method))
          continue;
        const timestamp = entry.timestamp;
        // Malformed supported evidence denies step-up, rather than falling back
        // to an account timestamp or selecting a questionable later AMR entry.
        if (
          typeof timestamp !== "number" ||
          !Number.isSafeInteger(timestamp) ||
          timestamp < 0 ||
          timestamp > now + 60
        ) {
          return { sessionId: claims.session_id, authenticatedAt: null, assuranceLevel };
        }
        authenticatedAt = Math.max(authenticatedAt ?? 0, timestamp);
      }
    }
    return {
      sessionId: claims.session_id,
      assuranceLevel,
      authenticatedAt:
        authenticatedAt === null ? null : new Date(authenticatedAt * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}
