import { execFileSync } from "node:child_process";
import { deliverSecurityBatch } from "./security-notification-delivery.mjs";

// Deliberately fixed local endpoints. No credentials or remote transport, no
// automatic schedule, no production use. Database addresses stay in memory.
function query(sql) {
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
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 10_000 },
  ).trim();
}

function uuid(value) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(value)) {
    throw new Error("Invalid notification identifier");
  }
  return `'${value}'::uuid`;
}

export function localDeliveryDependencies() {
  return {
    claim: async () =>
      JSON.parse(
        query(
          "select coalesce(json_agg(j),'[]'::json) from public.claim_security_notification_jobs(10) j;",
        ),
      ),
    resolveRecipient: async (job) => {
      // Recheck cancellation/expiry immediately before sending. A concurrent
      // cancellation cannot recall a message already accepted by Mailpit.
      const value = query(`select public.resolve_security_notification_recipient(
        ${uuid(job.job_id)},${uuid(job.lease_id)});`);
      return value ? JSON.parse(value) : null;
    },
    send: async (email, message, jobId) => {
      const response = await fetch("http://127.0.0.1:54324/api/v1/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({
          From: { Email: "no-reply@promenadis.local", Name: "Promenadis" },
          To: [{ Email: email }],
          ...message,
          Headers: { "X-Promenadis-Notification-ID": jobId },
        }),
      });
      return response.ok;
    },
    finish: async (job, delivered) =>
      query(
        `select public.finish_security_notification_job(${uuid(job.job_id)},${uuid(job.lease_id)},${delivered});`,
      ) === "t",
  };
}

if (import.meta.main) {
  try {
    const result = await deliverSecurityBatch(localDeliveryDependencies());
    console.log(JSON.stringify(result));
    if (result.failed || result.unacknowledged || result.skipped) process.exitCode = 1;
  } catch {
    // Never print subprocess diagnostics: they could contain recipient data.
    console.error(
      "Local notification delivery failed. Check Docker and Mailpit; no remote mail was sent.",
    );
    process.exitCode = 1;
  }
}
