import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Real local Auth (GoTrue) against the recovery dispatch fence. Disposable
// synthetic identities only; never print tokens, emails or status contents.
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
const owner = createClient(status.API_URL, publicKey, options);

const psql = [
  "exec",
  "-i",
  "supabase_db_promenadis",
  "psql",
  "-X",
  "-Atq",
  "-v",
  "ON_ERROR_STOP=1",
  "-U",
  "postgres",
  "-d",
  "postgres",
];
const sql = (input) =>
  execFileSync("docker", psql, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 10_000,
  }).trim();

// A second connection holds the dispatch row lock, as a resolver would, while
// a real Auth request is in flight behind the fence trigger.
function holdDispatchLock(dispatchId, seconds, onHeld) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("docker", psql, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let held = false;
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (!held && output.includes("DISPATCH_LOCK_HELD")) {
        held = true;
        onHeld();
      }
    });
    child.stderr.resume();
    child.on("error", () => reject(new Error("Local database connection failed")));
    child.on("close", (code) =>
      code === 0 ? resolvePromise() : reject(new Error("Lock holder failed")),
    );
    child.stdin.end(`begin;
      select 1 from app_private.account_recovery_dispatches where id='${dispatchId}' for update;
      select 'DISPATCH_LOCK_HELD';
      select pg_sleep(${seconds});
      commit;`);
  });
}

const token = "x".repeat(43);
const oldEmail = `dispatch-${randomUUID()}@example.invalid`;
const newEmail = `dispatch-new-${randomUUID()}@example.invalid`;
const password = `Synthetic-${randomUUID()}`;
let accountId;
let claimId;

const authEmail = async () => {
  const { data, error } = await admin.auth.admin.getUserById(accountId);
  assert.equal(error, null);
  return data.user.email;
};
const updateAuthEmail = () =>
  admin.auth.admin.updateUserById(accountId, { email: newEmail, email_confirm: true });
async function begin() {
  const { data, error } = await admin.rpc("begin_account_recovery_dispatch_command", {
    p_claim_id: claimId,
    p_verification_token: token,
    p_correlation_id: randomUUID(),
  });
  assert.equal(error, null, "Dispatch did not start");
  return data;
}
async function finish(dispatchId) {
  const { data, error } = await admin.rpc("finish_account_recovery_dispatch_command", {
    p_dispatch_id: dispatchId,
    p_correlation_id: randomUUID(),
  });
  assert.equal(error, null, "Dispatch resolution failed");
  return data;
}

try {
  const created = await admin.auth.admin.createUser({
    email: oldEmail,
    password,
    email_confirm: true,
  });
  assert.equal(created.error, null, "Synthetic account creation failed");
  accountId = created.data.user.id;
  const signedIn = await owner.auth.signInWithPassword({ email: oldEmail, password });
  assert.equal(signedIn.error, null, "Synthetic sign-in failed");
  const oldSession = signedIn.data.session;

  claimId = randomUUID();
  sql(`begin;
    insert into app_private.account_recovery_codes(account_id,code_hash,issued_at,used_at)
    values('${accountId}',repeat('x',60),now()-interval '3 days',now()-interval '2 days');
    insert into app_private.account_recovery_claims(id,account_id,new_email,verification_token_hash,initiated_at,email_verified_at,ready_at,expires_at,code_version)
    values('${claimId}','${accountId}','${newEmail}',extensions.crypt('${token}',extensions.gen_salt('bf',4)),
      now()-interval '2 days',now()-interval '2 days'+interval '1 minute',now()-interval '23 hours',now()+interval '4 days',1);
    insert into app_private.notification_jobs(correlation_id,source_id,recipient_account_id,template_key,completed_at)
    values('${claimId}','${claimId}','${accountId}','account_recovery_started',now());
    select public.prepare_account_recovery_command('${claimId}','${token}','${claimId}');
    commit;`);

  // 1. Auth request in flight while the lease expires: the fence trigger waits
  // on the held dispatch row, then rejects inside Auth's own transaction.
  const late = await begin();
  sql(`update app_private.account_recovery_dispatches
    set started_at=now()-interval '2 minutes'+interval '1 second', lease_until=now()+interval '1 second'
    where id='${late.dispatchId}';`);
  let inFlight;
  await holdDispatchLock(late.dispatchId, 2, () => {
    inFlight = updateAuthEmail();
  });
  const lateResult = await inFlight;
  assert.notEqual(lateResult.error, null, "Late Auth update must be rejected");
  assert.equal(await authEmail(), oldEmail);
  assert.equal(await finish(late.dispatchId), "not_applied");
  const tombstoned = await updateAuthEmail();
  assert.notEqual(tombstoned.error, null, "Resolved dispatch keeps fencing Auth");
  assert.equal(await authEmail(), oldEmail);

  // 2. A fresh dispatch rechecks every gate, then the real Auth update lands.
  const live = await begin();
  assert.notEqual(live.dispatchId, late.dispatchId);
  const applied = await updateAuthEmail();
  assert.equal(applied.error, null, "Leased Auth update failed");
  assert.equal(await finish(live.dispatchId), "applied");
  assert.equal(await finish(live.dispatchId), "applied");
  assert.equal(await authEmail(), newEmail);

  // 3. Old access is gone; only the verified replacement identity signs in.
  const refreshed = await owner.auth.refreshSession({ refresh_token: oldSession.refresh_token });
  assert.notEqual(refreshed.error, null, "Old refresh token must be revoked");
  assert.equal(sql(`select count(*) from auth.sessions where user_id='${accountId}';`), "0");
  const oldSignIn = await owner.auth.signInWithPassword({ email: oldEmail, password });
  assert.notEqual(oldSignIn.error, null, "Old email must not sign in");
  const newSignIn = await owner.auth.signInWithPassword({ email: newEmail, password });
  assert.equal(newSignIn.error, null, "Replacement email sign-in failed");
  assert.equal(newSignIn.data.user.id, accountId);

  // 4. A duplicate request after completion is a harmless no-op.
  assert.equal((await updateAuthEmail()).error, null);
  assert.equal(
    sql(`select count(*) from app_private.account_recovery_claims where id='${claimId}';`),
    "0",
  );
  console.log(
    "Recovery dispatch passed: late in-flight Auth update fenced, leased update applied, old sessions revoked.",
  );
} finally {
  if (accountId) {
    sql(`delete from app_private.audit_events where target_id='${claimId}';
      delete from app_private.notification_jobs where source_id='${claimId}';
      delete from auth.users where id='${accountId}';`);
  }
}
