import { createPromenadisApiClient } from "@promenadis/api-client";
import { browserSessionResponseSchema } from "@promenadis/contracts";
import { notifySessionChanged } from "./account-session";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export function hasLocalBackendConfiguration() {
  return Boolean(supabaseUrl);
}

async function authRequest(path: string, body?: unknown, accountId?: string | null) {
  try {
    if (supabaseUrl) {
      const key = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}-code-verifier`);
    }
  } catch {
    // Storage may be disabled. Cookie authentication does not require it;
    // legacy credentials are never read or trusted even when removal fails.
  }
  try {
    const response = await fetch(`/api/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "x-promenadis-browser": "1",
        "content-type": "application/json",
        ...(accountId ? { "x-account-id": accountId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 409) notifySessionChanged();
      return {
        result: null,
        error: {
          status: response.status,
          code: response.status === 429 ? "over_email_send_rate_limit" : "auth_failed",
        },
      };
    }
    return { result: (await response.json()) as unknown, error: null };
  } catch {
    return { result: null, error: { status: 503, code: "auth_unavailable" } };
  }
}

export function getBrowserAuthClient(expectedAccountId?: string | null) {
  if (!hasLocalBackendConfiguration()) return null;
  async function sessionResult(path: string, body?: unknown) {
    const response = await authRequest(path, body);
    const parsed = browserSessionResponseSchema.safeParse(response.result);
    const session = parsed.success ? parsed.data.session : null;
    if (
      !response.error &&
      parsed.success &&
      expectedAccountId &&
      session?.user.id !== expectedAccountId
    ) {
      notifySessionChanged();
      return { data: { session: null }, error: { status: 409 } };
    }
    return {
      data: { session },
      error: response.error ?? (parsed.success ? null : { status: 503 }),
    };
  }
  return {
    auth: {
      getSession: () => sessionResult("session"),
      signInWithOtp: async (input: { email: string; options?: unknown }) =>
        authRequest("send", { email: input.email }),
      verifyOtp: async (input: { token: string; email: string; type?: string }) => {
        const result = await sessionResult("verify", { token: input.token, email: input.email });
        if (!result.error) notifySessionChanged();
        return result;
      },
      exchangeCodeForSession: async (code: string) => {
        const result = await sessionResult("exchange", { code });
        if (!result.error) notifySessionChanged();
        return result;
      },
      // Second step for an account with TOTP, at sign-in or when first set up.
      verifyTotp: async (input: { code: string; factorId?: string }) => {
        const current = await sessionResult("session");
        const accountId = current.data.session?.user.id ?? expectedAccountId;
        const result = await authRequest("mfa/verify", input, accountId);
        if (!result.error) notifySessionChanged();
        return result;
      },
      signOut: async () => {
        const result = await authRequest("sign-out", {}, expectedAccountId);
        notifySessionChanged();
        return result;
      },
    },
  };
}

export function getPromenadisApiClient() {
  return hasLocalBackendConfiguration()
    ? createPromenadisApiClient({
        baseUrl: "/api",
        browserSession: true,
        onAccountChanged: notifySessionChanged,
      })
    : null;
}
