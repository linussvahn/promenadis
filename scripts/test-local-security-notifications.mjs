import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { localDeliveryDependencies } from "./deliver-local-security-notifications.mjs";
import { deliverSecurityBatch } from "./security-notification-delivery.mjs";

function sql(input) {
  return execFileSync(
    "docker",
    [
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
    ],
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}

const account = randomUUID();
const id = randomUUID();
const lease = randomUUID();
const email = `notice-${account}@example.invalid`;
try {
  // Claim SQL is covered by rollback-only pgTAP. Set up only our own leased job
  // here so the transport regression never claims existing developer jobs.
  sql(`begin;
    insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
    values ('${account}','${email}',now(),now(),now());
    insert into app_private.account_recovery_claims(id,account_id,new_email,verification_token_hash,ready_at,expires_at,code_version)
    values ('${id}','${account}','replacement-${account}@example.invalid',repeat('x',60),now()+interval '25 hours',now()+interval '7 days',1);
    insert into app_private.notification_jobs(id,correlation_id,source_id,recipient_account_id,template_key,delivery_lease_id,delivery_lease_until,attempt_count)
    values ('${id}','${id}','${id}','${account}','account_recovery_started','${lease}',now()+interval '2 minutes',1);
    commit;`);
  // Simulate a separate Auth change; the notice must still use the claim's
  // original destination, never this newer account email.
  sql(`update auth.users set email='changed-${account}@example.invalid' where id='${account}';`);
  const deps = localDeliveryDependencies();
  const job = { job_id: id, lease_id: lease, template_key: "account_recovery_started" };
  const result = await deliverSecurityBatch({ ...deps, claim: async () => [job] });
  assert.equal(result.accepted, 1);
  assert.equal(
    sql(`select completed_at is not null from app_private.notification_jobs where id='${id}';`),
    "t",
  );
  assert.equal(await deps.resolveRecipient(job), null);
  assert.equal(sql(`select public.account_recovery_notices_accepted('${id}');`), "t");
  const inbox = await (await fetch("http://127.0.0.1:54324/api/v1/messages")).json();
  const message = inbox.messages.find((item) => item.To.some((to) => to.Address === email));
  assert.ok(message, "Mailpit captured synthetic recipient notice");
  const detail = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${message.ID}`)).json();
  assert.match(detail.Text, /Kontoåterställning/u);
  assert.match(detail.Text, /Lokalt test/u);
  console.log("Local SQL → Mailpit → acknowledgement passed; completed-job replay blocked.");
} finally {
  // Exact disposable fixture only; existing accounts, outbox and mail untouched.
  sql(`delete from auth.users where id='${account}';`);
}
