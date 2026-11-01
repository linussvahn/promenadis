import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const args = [
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
function sql(input) {
  return execFileSync("docker", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 10_000,
  }).trim();
}

// Separate database connections exercise real lock contention, not a mocked
// cancellation. Output is consumed privately and only a pass summary is logged.
function concurrentSql(input, onPrepared = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill(), 10_000);
    let output = "";
    let reported = false;
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (!reported && output.includes("PREPARED_LOCK_HELD")) {
        reported = true;
        onPrepared();
      }
    });
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Local database connection failed"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error("Local concurrent SQL failed"));
    });
    child.stdin.end(input);
  });
}

const account = randomUUID();
const claim = randomUUID();
try {
  sql(`begin;
    insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
    values('${account}','prepare-${account}@example.invalid',now(),now(),now());
    insert into app_private.account_recovery_codes(account_id,code_hash,issued_at,used_at)
    values('${account}',repeat('x',60),now()-interval '3 days',now()-interval '2 days');
    insert into app_private.account_recovery_claims(id,account_id,new_email,verification_token_hash,initiated_at,email_verified_at,ready_at,expires_at,code_version)
    values('${claim}','${account}','replacement-${account}@example.invalid',extensions.crypt(repeat('x',43),extensions.gen_salt('bf',4)),now()-interval '2 days',now()-interval '2 days'+interval '1 minute',now()-interval '23 hours',now()+interval '4 days',1);
    insert into app_private.notification_jobs(correlation_id,source_id,recipient_account_id,template_key,completed_at)
    values('${claim}','${claim}','${account}','account_recovery_started',now());
    commit;`);
  let cancel;
  await concurrentSql(
    `begin;
    select public.prepare_account_recovery_command('${claim}',repeat('x',43),'${claim}');
    select 'PREPARED_LOCK_HELD';
    select pg_sleep(1);
    commit;`,
    () => {
      cancel = concurrentSql(
        `select public.cancel_account_recovery_claim_command('${account}','${claim}',now(),'${claim}');`,
      );
      // Observe rejection immediately while the preparation connection finishes.
      cancel.catch(() => {});
    },
  );
  assert.ok(cancel, "cancellation launched while preparation held locks");
  await cancel;
  assert.equal(
    sql(
      `select count(*) from app_private.account_recovery_preparations where claim_id='${claim}';`,
    ),
    "0",
  );
  assert.equal(
    sql(`select count(*) from app_private.account_recovery_claims where id='${claim}';`),
    "0",
  );
  assert.equal(
    sql(`select email from auth.users where id='${account}';`),
    `prepare-${account}@example.invalid`,
  );
  console.log(
    "Concurrent preparation/cancellation passed; no prepared intent survives, Auth unchanged.",
  );
} finally {
  sql(`delete from app_private.audit_events where target_id='${claim}';
    delete from app_private.notification_jobs where source_id='${claim}';
    delete from auth.users where id='${account}';`);
}
