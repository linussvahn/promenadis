import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  browserCallbackSchema,
  browserOtpStartSchema,
  browserOtpVerifySchema,
  browserSessionResponseSchema,
  totpVerifyRequestSchema,
} from "../../../packages/contracts/src/schemas.ts";

const sessionCookie = "promenadis-session";
const pendingCookie = "promenadis-login";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const secretPattern = /^[A-Za-z0-9_-]{43}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

class SessionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}
function randomSecret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
async function hash(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
function readCookie(request: Request, name: string) {
  const entries = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim());
  const values = entries.filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return secretPattern.test(value) ? value : null;
}
function cookie(name: string, value: string, seconds: number) {
  // HTTP cookies are permitted only in the explicitly local gateway below.
  // Hosted support must use HTTPS + Secure and a reviewed same-origin route.
  return `${name}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
}
function jwtSessionId(token: string): string {
  const payload = JSON.parse(atob(token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")));
  if (typeof payload.session_id !== "string" || !uuidPattern.test(payload.session_id)) {
    throw new SessionError("unauthorized", 401);
  }
  return payload.session_id;
}
type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };
type Stored = { payload: string; accountId: string | null; authSessionId: string | null };

export function createBrowserSessionGateway(config: {
  admin: SupabaseClient;
  url: string;
  publicKey: string;
  localEncryptionSeed: string;
  origins: ReadonlySet<string>;
  readBody: (request: Request) => Promise<unknown>;
}) {
  const { admin } = config;
  // Local-only key derivation, domain-separated from authentication. Production
  // needs a dedicated, rotated secret before this gate may be removed.
  const key = crypto.subtle
    .digest(
      "SHA-256",
      encoder.encode(`promenadis/browser-sessions/local/v1/${config.localEncryptionSeed}`),
    )
    .then((bytes) =>
      crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]),
    );
  async function encrypt(value: unknown, context: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: encoder.encode(context),
        },
        await key,
        encoder.encode(JSON.stringify(value)),
      ),
    );
    return btoa(String.fromCharCode(...iv, ...ciphertext));
  }
  async function decrypt(payload: string, context: string): Promise<unknown> {
    const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
    return JSON.parse(
      decoder.decode(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: bytes.slice(0, 12),
            additionalData: encoder.encode(context),
          },
          await key,
          bytes.slice(12),
        ),
      ),
    );
  }
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new SessionError("session_unavailable", 503);
    return data;
  }
  async function drop(secret: string | null) {
    if (secret) await rpc("delete_browser_session_command", { p_hash: await hash(secret) });
  }
  async function store(
    kind: string,
    payload: unknown,
    accountId: string | null,
    authSessionId: string | null,
  ) {
    const secret = randomSecret();
    const digest = await hash(secret);
    await rpc("store_browser_session_command", {
      p_hash: digest,
      p_kind: kind,
      p_payload: await encrypt(payload, `${kind}:${digest}`),
      p_account_id: accountId,
      p_auth_session_id: authSessionId,
    });
    return secret;
  }
  async function take(secret: string, kind: string, lease: string): Promise<Stored> {
    const digest = await hash(secret);
    for (let attempt = 0; attempt < 25; attempt++) {
      const result = await rpc("take_browser_session_command", {
        p_hash: digest,
        p_kind: kind,
        p_lease: lease,
      });
      if (result?.state === "missing") throw new SessionError("unauthorized", 401);
      if (result?.state === "ok" && typeof result.payload === "string") return result as Stored;
      if (result?.state !== "busy") throw new SessionError("session_unavailable", 503);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new SessionError("session_busy", 503);
  }
  async function release(secret: string, kind: string, lease: string, payload?: unknown) {
    const digest = await hash(secret);
    return rpc("release_browser_session_command", {
      p_hash: digest,
      p_lease: lease,
      p_payload: payload ? await encrypt(payload, `${kind}:${digest}`) : null,
    });
  }
  function authClient(verifier?: string) {
    const memory: Record<string, string> = {};
    if (verifier) memory["promenadis-pkce-code-verifier"] = verifier;
    const client = createClient(config.url, config.publicKey, {
      auth: {
        flowType: "pkce",
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
        storageKey: "promenadis-pkce",
        storage: {
          getItem: (name) => memory[name] ?? null,
          setItem: (name, value) => {
            memory[name] = value;
          },
          removeItem: (name) => {
            delete memory[name];
          },
        },
      },
    });
    return { client, memory };
  }
  async function authenticated(secret: string) {
    const lease = crypto.randomUUID();
    const stored = await take(secret, "authenticated", lease);
    try {
      let tokens = (await decrypt(stored.payload, `authenticated:${await hash(secret)}`)) as Tokens;
      if (
        !tokens ||
        typeof tokens.accessToken !== "string" ||
        typeof tokens.refreshToken !== "string" ||
        typeof tokens.expiresAt !== "number"
      )
        throw new SessionError("unauthorized", 401);
      if (tokens.expiresAt * 1000 <= Date.now() + 60_000) {
        const { client } = authClient();
        const { data, error } = await client.auth.refreshSession({
          refresh_token: tokens.refreshToken,
        });
        if (
          error ||
          !data.session ||
          data.user?.id !== stored.accountId ||
          jwtSessionId(data.session.access_token) !== stored.authSessionId
        ) {
          await drop(secret);
          throw new SessionError("unauthorized", 401);
        }
        tokens = {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at ?? 0,
        };
      }
      const { data, error } = await admin.auth.getUser(tokens.accessToken);
      if (
        error ||
        !data.user?.email ||
        data.user.id !== stored.accountId ||
        jwtSessionId(tokens.accessToken) !== stored.authSessionId
      ) {
        await drop(secret);
        throw new SessionError("unauthorized", 401);
      }
      if (!(await release(secret, "authenticated", lease, tokens))) {
        throw new SessionError("unauthorized", 401);
      }
      return { tokens, user: { id: data.user.id, email: data.user.email } };
    } catch (error) {
      await release(secret, "authenticated", lease);
      throw error;
    }
  }

  return async function handle(
    request: Request,
    path: string,
    correlationId: string,
  ): Promise<Request | Response> {
    const headers = new Headers({
      "cache-control": "no-store, private",
      pragma: "no-cache",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-correlation-id": correlationId,
    });
    function respond(body: Record<string, unknown>, status = 200) {
      return new Response(JSON.stringify({ schemaVersion: "1.0", ...body }), { status, headers });
    }
    function clear(name: string) {
      headers.append("set-cookie", cookie(name, "", 0));
    }
    try {
      if (new URL(config.url).hostname !== "kong") throw new SessionError("local_only", 503);
      const origin = request.headers.get("origin");
      const write = request.method !== "GET";
      if (
        request.headers.get("x-promenadis-browser") !== "1" ||
        (origin
          ? !config.origins.has(origin)
          : write || request.headers.get("sec-fetch-site") !== "same-origin") ||
        (write && !request.headers.get("content-type")?.startsWith("application/json"))
      ) {
        throw new SessionError("origin_denied", 403);
      }
      if (request.method === "POST" && path === "/auth/send") {
        const input = browserOtpStartSchema.safeParse(await config.readBody(request));
        if (!input.success) throw new SessionError("invalid_request", 400);
        const email = input.data.email.trim().toLowerCase();
        const { client, memory } = authClient();
        const { error } = await client.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: `${origin}/auth/callback`,
          },
        });
        if (error)
          throw new SessionError(
            error.status === 429 ? "rate_limited" : "login_failed",
            error.status === 429 ? 429 : 400,
          );
        const verifier = memory["promenadis-pkce-code-verifier"];
        if (!verifier) throw new SessionError("login_failed", 503);
        const pending = await store("pending", { email, verifier }, null, null);
        await drop(readCookie(request, pendingCookie));
        headers.append("set-cookie", cookie(pendingCookie, pending, 900));
        return respond({ ok: true });
      }
      if (request.method === "POST" && (path === "/auth/verify" || path === "/auth/exchange")) {
        const pending = readCookie(request, pendingCookie);
        if (!pending) throw new SessionError("login_expired", 401);
        const input = await config.readBody(request);
        const otp = path === "/auth/verify" ? browserOtpVerifySchema.safeParse(input) : null;
        const callback = path === "/auth/exchange" ? browserCallbackSchema.safeParse(input) : null;
        if (!otp?.success && !callback?.success) throw new SessionError("invalid_request", 400);
        const lease = crypto.randomUUID();
        const stored = await take(pending, "pending", lease);
        try {
          const payload = (await decrypt(stored.payload, `pending:${await hash(pending)}`)) as {
            email: string;
            verifier: string;
          };
          if (typeof payload.email !== "string" || typeof payload.verifier !== "string")
            throw new SessionError("login_failed", 400);
          const { client } = authClient(payload.verifier);
          if (otp?.success && otp.data.email.trim().toLowerCase() !== payload.email) {
            throw new SessionError("login_changed", 409);
          }
          const { data, error } = otp?.success
            ? await client.auth.verifyOtp({
                email: payload.email,
                token: otp.data.token,
                type: "email",
              })
            : await client.auth.exchangeCodeForSession(callback?.success ? callback.data.code : "");
          if (error || !data.session || data.user?.email?.toLowerCase() !== payload.email) {
            throw new SessionError("login_failed", 400);
          }
          const session = data.session;
          const secret = await store(
            "authenticated",
            {
              accessToken: session.access_token,
              refreshToken: session.refresh_token,
              expiresAt: session.expires_at ?? 0,
            },
            data.user.id,
            jwtSessionId(session.access_token),
          );
          await drop(pending);
          await drop(readCookie(request, sessionCookie));
          clear(pendingCookie);
          headers.append("set-cookie", cookie(sessionCookie, secret, 12 * 3600));
          return respond(
            browserSessionResponseSchema.parse({
              schemaVersion: "1.0",
              session: { user: { id: data.user.id, email: data.user.email } },
            }),
          );
        } finally {
          await release(pending, "pending", lease);
        }
      }
      // Recovery, reports and public pages remain public but keep the same-origin/CSRF
      // boundary. They are anonymous by design: never attach the signed-in session.
      if (
        path === "/account-recovery" ||
        path.startsWith("/account-recovery/") ||
        ((path === "/reports" || path === "/reports/public") && request.method === "POST") ||
        (path.startsWith("/public/") && request.method === "GET") ||
        (/^\/public\/(events|unlisted)\/[0-9a-f]{32}\/contact$/u.test(path) &&
          request.method === "POST") ||
        (path.startsWith("/contact/") && request.method === "POST") ||
        (path === "/support" && request.method === "POST") ||
        (/^\/public\/(events|unlisted)\/[0-9a-f]{32}\/feedback$/u.test(path) &&
          request.method === "POST")
      ) {
        const cleaned = new Headers(request.headers);
        cleaned.delete("authorization");
        return new Request(request, { headers: cleaned });
      }
      const secret = readCookie(request, sessionCookie);
      if (path === "/auth/session" && request.method === "GET" && !secret)
        return respond({ session: null });
      if (path === "/auth/sign-out" && request.method === "POST") {
        if (secret) {
          let session: Awaited<ReturnType<typeof authenticated>> | null = null;
          try {
            session = await authenticated(secret);
          } catch (error) {
            if (!(error instanceof SessionError) || error.status !== 401) throw error;
          }
          if (session && request.headers.get("x-account-id") !== session.user.id) {
            throw new SessionError("account_changed", 409);
          }
          await drop(secret);
          clear(sessionCookie);
          if (session) {
            const { error } = await admin.auth.admin.signOut(session.tokens.accessToken, "local");
            if (error) throw new SessionError("logout_incomplete", 503);
          }
        }
        await drop(readCookie(request, pendingCookie));
        clear(pendingCookie);
        clear(sessionCookie);
        return respond({ ok: true });
      }
      if (!secret) throw new SessionError("unauthorized", 401);
      let session: Awaited<ReturnType<typeof authenticated>>;
      try {
        session = await authenticated(secret);
      } catch (error) {
        if (error instanceof SessionError && error.status === 401) {
          clear(sessionCookie);
          if (path === "/auth/session" && request.method === "GET")
            return respond({ session: null });
        }
        throw error;
      }
      if (path === "/auth/session" && request.method === "GET") {
        return respond(
          browserSessionResponseSchema.parse({
            schemaVersion: "1.0",
            session: { user: session.user },
          }),
        );
      }
      if (request.headers.get("x-account-id") !== session.user.id)
        throw new SessionError("account_changed", 409);
      if (request.method === "POST" && path === "/auth/mfa/verify") {
        // TOTP step-up (sign-in or first setup). The upgraded aal2 tokens keep the
        // same Auth session and replace the vault copy; the browser never sees them.
        const input = totpVerifyRequestSchema.safeParse(await config.readBody(request));
        if (!input.success) throw new SessionError("invalid_request", 400);
        const asUser = async (factorPath: string, body: unknown) => {
          const response = await fetch(`${config.url}/auth/v1/factors/${factorPath}`, {
            method: "POST",
            headers: {
              apikey: config.publicKey,
              authorization: `Bearer ${session.tokens.accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          });
          return response.ok ? ((await response.json()) as Record<string, unknown>) : null;
        };
        let factorId = input.data.factorId;
        if (!factorId) {
          const { data } = await admin.auth.getUser(session.tokens.accessToken);
          factorId = data.user?.factors?.find(
            (factor) => factor.factor_type === "totp" && factor.status === "verified",
          )?.id;
        }
        if (!factorId) throw new SessionError("mfa_unavailable", 409);
        const challenge = await asUser(`${factorId}/challenge`, {});
        const verified =
          typeof challenge?.id === "string"
            ? await asUser(`${factorId}/verify`, {
                challenge_id: challenge.id,
                code: input.data.code,
              })
            : null;
        if (
          typeof verified?.access_token !== "string" ||
          typeof verified.refresh_token !== "string" ||
          jwtSessionId(verified.access_token) !== jwtSessionId(session.tokens.accessToken)
        ) {
          throw new SessionError("mfa_failed", 400);
        }
        const lease = crypto.randomUUID();
        await take(secret, "authenticated", lease);
        const expiresIn = typeof verified.expires_in === "number" ? verified.expires_in : 3600;
        const released = await release(secret, "authenticated", lease, {
          accessToken: verified.access_token,
          refreshToken: verified.refresh_token,
          expiresAt:
            typeof verified.expires_at === "number"
              ? verified.expires_at
              : Math.floor(Date.now() / 1000) + expiresIn,
        });
        if (!released) throw new SessionError("unauthorized", 401);
        await rpc("record_account_mfa_event_command", {
          p_action: "account.mfa_totp_verified",
          p_actor_id: session.user.id,
          p_correlation_id: correlationId,
        });
        return respond(
          browserSessionResponseSchema.parse({
            schemaVersion: "1.0",
            session: { user: session.user },
          }),
        );
      }
      // Never trust a browser-supplied bearer token alongside the cookie.
      const authenticatedHeaders = new Headers(request.headers);
      authenticatedHeaders.set("authorization", `Bearer ${session.tokens.accessToken}`);
      return new Request(request, { headers: authenticatedHeaders });
    } catch (error) {
      const known =
        error instanceof SessionError ? error : new SessionError("session_unavailable", 503);
      return respond(
        {
          code: known.code,
          message: "The session operation could not be completed.",
          schemaVersion: "1.0",
          correlationId,
        },
        known.status,
      );
    }
  };
}
