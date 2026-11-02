import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

// Keys live outside the repository and outside the database. The writer
// needs only the recovery public key and the signing private key; restoring
// needs the recovery private key and the signing public key.
export const keyDirectory =
  process.env.PROMENADIS_RECOVERY_KEYS ?? resolve(homedir(), ".promenadis-recovery");
export const archiveDirectory = resolve(import.meta.dirname, "../../.local-backups");

export function psql(sql, database = "postgres") {
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
      database,
    ],
    { input: sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  ).trim();
}

// Live session material is never archived: restored databases start with
// every session invalid.
export const excludedData = [
  "app_private.browser_sessions",
  "app_private.admin_elevation_sessions",
  "auth.sessions",
  "auth.refresh_tokens",
  // Session-bound or one-time token material.
  "auth.mfa_amr_claims",
  "auth.mfa_challenges",
  "auth.one_time_tokens",
  "auth.flow_state",
];
export const schemas = ["public", "app_private", "auth", "supabase_migrations"];
