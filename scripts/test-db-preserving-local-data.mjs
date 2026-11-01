import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// pgTAP fixtures assume empty application tables. Isolate each file inside its
// existing rollback-only transaction instead of resetting the developer's DB.
const directory = new URL("../supabase/tests/database/", import.meta.url);
let assertions = 0;
for (const file of readdirSync(directory)
  .filter((name) => name.endsWith(".test.sql"))
  .sort()) {
  const source = readFileSync(new URL(file, directory), "utf8");
  if (
    !/^begin;/u.test(source.trim()) ||
    !/rollback;$/u.test(source.trim()) ||
    /\bcommit\s*;/iu.test(source)
  ) {
    throw new Error(`Not a rollback-only fixture: ${file}`);
  }
  const input = source.replace(
    "begin;",
    `begin;
    truncate auth.users, public.organizer_profiles, app_private.audit_events,
      app_private.local_recovery_budget cascade;`,
  );
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
      "-d",
      "postgres",
    ],
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  if (/^not ok /mu.test(output)) {
    throw new Error(`pgTAP failure in ${file}:\n${output}`);
  }
  const count = [...output.matchAll(/^ok \d+/gmu)].length;
  const plan = output.match(/^1\.\.(\d+)$/mu);
  if (!plan || count !== Number(plan[1])) throw new Error(`Incomplete pgTAP plan: ${file}`);
  assertions += count;
  console.log(`${file}: ${count} passed`);
}
console.log(
  `${assertions} database assertions passed; local data preserved (${fileURLToPath(directory)}).`,
);
