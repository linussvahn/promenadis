import { execFileSync } from "node:child_process";
import { deliverApplicationBatch } from "./application-notification-delivery.mjs";

// Local preview only: Mailpit transport, local Docker database, no schedule.
// Addresses are resolved per job and kept in memory; logs show counts only.
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
    ],
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 10_000 },
  ).trim();
}

function uuid(value) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(value))
    throw new Error("Invalid identifier");
  return `'${value}'::uuid`;
}

export function localApplicationDependencies() {
  return {
    origin: "http://127.0.0.1:5173",
    claim: async () =>
      JSON.parse(
        query(
          "select coalesce(json_agg(j),'[]'::json) from public.claim_application_notifications(25) j;",
        ),
      ),
    finish: async (job, delivered) =>
      query(
        `select public.finish_application_notification(${uuid(job.job_id)},${uuid(job.lease_id)},${delivered});`,
      ) === "t",
    resolveRecipient: async (job) => {
      const value = query(
        `select public.resolve_application_recipient(${uuid(job.job_id)},${uuid(job.lease_id)});`,
      );
      return value ? JSON.parse(value) : null;
    },
    send: async (email, message, jobId) => {
      const response = await fetch("http://127.0.0.1:54324/api/v1/send", {
        body: JSON.stringify({
          From: { Email: "no-reply@promenadis.local", Name: "Promenadis" },
          Headers: { "X-Promenadis-Notification-ID": jobId },
          To: [{ Email: email }],
          ...message,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    },
  };
}

if (import.meta.main) {
  try {
    let total = { accepted: 0, failed: 0, skipped: 0, unacknowledged: 0 };
    // Drain in batches; the database caps sends per minute.
    for (let round = 0; round < 10; round++) {
      const result = await deliverApplicationBatch(localApplicationDependencies());
      total = Object.fromEntries(
        Object.entries(total).map(([key, value]) => [key, value + result[key]]),
      );
      if (result.accepted + result.failed + result.skipped + result.unacknowledged === 0) break;
    }
    console.log(JSON.stringify(total));
    if (total.failed || total.unacknowledged) process.exitCode = 1;
  } catch {
    console.error(
      "Local notification delivery failed. Check Docker and Mailpit; no remote mail was sent.",
    );
    process.exitCode = 1;
  }
}
