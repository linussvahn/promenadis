import { execFileSync } from "node:child_process";

// Local operator tool only: grants platform-admin eligibility to an existing,
// verified local account. Eligibility alone grants nothing; admin mode still
// needs TOTP and a fresh code. There is no UI or API for this by design.
const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[^@\s'"\\]+@[^@\s'"\\]+\.[^@\s'"\\]+$/u.test(email)) {
  console.error("Usage: pnpm admin:grant:local <verified-account-email>");
  process.exit(1);
}
const output = execFileSync(
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
  {
    input: `insert into app_private.platform_admins(account_id)
      select id from auth.users where lower(email)='${email}' and email_confirmed_at is not null
      on conflict do nothing returning 'granted';`,
    encoding: "utf8",
  },
).trim();
console.log(
  output === "granted"
    ? "Granted local platform-admin eligibility."
    : "No change: unknown, unverified or already eligible.",
);
