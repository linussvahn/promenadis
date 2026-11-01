import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Local, disposable identities only. Never print token/status contents.
const root = resolve(import.meta.dirname, "../../..");
const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    cwd: root,
    encoding: "utf8",
  }),
);
assert.equal(new URL(status.API_URL).hostname, "127.0.0.1");
const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const first = createClient(status.API_URL, publicKey, options);
const second = createClient(status.API_URL, publicKey, options);
const email = `session-security-${randomUUID()}@example.invalid`;
const password = `Synthetic-${randomUUID()}`;
let accountId;
const claims = (token) =>
  JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));

async function call(path, token, body) {
  return fetch(`${status.API_URL}/functions/v1/api-v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: publicKey,
      authorization: `Bearer ${token}`,
      origin: "http://127.0.0.1:5173",
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function signIn(client) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  assert.equal(error, null, "Synthetic sign-in failed");
  assert.ok(data.session);
  return data.session;
}
try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(created.error, null, "Synthetic account creation failed");
  accountId = created.data.user.id;
  const initial = await signIn(first);
  const sessionId = claims(initial.access_token).session_id;
  assert.match(sessionId, /^[0-9a-f-]{36}$/u);
  assert.match(accountId, /^[0-9a-f-]{36}$/u);
  // Age ONLY this disposable session's AMR evidence, then let real Auth mint a
  // signed refreshed JWT. No forged JWT and no system-wide clock/config change.
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_promenadis",
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    {
      input: `update auth.mfa_amr_claims set created_at=now()-interval '30 minutes',
      updated_at=now()-interval '30 minutes' where session_id='${sessionId}'
      and exists(select 1 from auth.sessions where id='${sessionId}' and user_id='${accountId}');`,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const refreshed = await first.auth.refreshSession({ refresh_token: initial.refresh_token });
  assert.equal(refreshed.error, null, "Synthetic refresh failed");
  const old = refreshed.data.session;
  assert.ok(old);
  const oldEvidence = claims(old.access_token).amr.find((entry) => entry.method === "password");
  assert.ok(oldEvidence.timestamp < Date.now() / 1000 - 15 * 60, "Fixture must have stale AMR");

  const fresh = await signIn(second);
  assert.notEqual(claims(fresh.access_token).session_id, sessionId);
  const oldUser = await admin.auth.getUser(old.access_token);
  assert.equal(oldUser.error, null);
  assert.ok(
    Date.parse(oldUser.data.user.last_sign_in_at) > Date.now() - 60_000,
    "Account-wide timestamp must be fresh to reproduce the original weakness",
  );
  assert.equal(
    (await call("/dashboard", old.access_token)).status,
    200,
    "Stale step-up still permits ordinary reads",
  );
  const denied = await call("/account/recovery-code", old.access_token, { expectedVersion: 0 });
  assert.equal(denied.status, 403, "Another device must not freshen old session");
  assert.equal((await denied.json()).code, "recent_auth_required");
  assert.equal(
    (await call("/account/recovery-code", fresh.access_token, { expectedVersion: 0 })).status,
    201,
    "Actually fresh session can enroll a recovery code",
  );

  const again = await first.auth.refreshSession({ refresh_token: old.refresh_token });
  assert.equal(again.error, null);
  assert.ok(again.data.session);
  const refreshedToken = again.data.session.access_token;
  assert.equal(
    (await call("/account/recovery-code", refreshedToken, { expectedVersion: 1 })).status,
    403,
    "Token refresh must not count as fresh authentication",
  );
  const revoked = await admin.auth.admin.signOut(refreshedToken, "local");
  assert.equal(revoked.error, null);
  assert.equal(
    (await call("/dashboard", refreshedToken)).status,
    401,
    "Revoked but unexpired bearer denied",
  );
  assert.equal(
    (await call("/dashboard", fresh.access_token)).status,
    200,
    "Other session of SAME account stays active",
  );
  const reuse = await first.auth.refreshSession({
    refresh_token: again.data.session.refresh_token,
  });
  assert.ok(reuse.error, "Revoked refresh token must not restore access");
  console.log(
    "Session-security integration passed: per-device freshness, refresh invariance, bearer revocation, and independent same-account sessions.",
  );
} finally {
  if (accountId) {
    const removed = await admin.auth.admin.deleteUser(accountId);
    assert.equal(removed.error, null, "Disposable account cleanup failed");
  }
}
