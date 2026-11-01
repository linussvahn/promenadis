import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const result = spawnSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
  encoding: "utf8",
});

if (result.status !== 0) {
  process.stdout.write(
    "Local Supabase is not available; the public shell will run with identity features disabled.\n",
  );
  process.exit(0);
}

const status = JSON.parse(result.stdout);
const apiUrl = status.API_URL;
const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;

if (typeof apiUrl !== "string" || typeof publishableKey !== "string") {
  throw new Error("Supabase status did not provide its public local configuration");
}

const contents = [
  "# Generated from the local Supabase CLI. Never add provider secrets here.",
  `VITE_SUPABASE_URL=${apiUrl}`,
  `VITE_SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
  "",
].join("\n");

writeFileSync(resolve("apps/web/.env.local"), contents, { encoding: "utf8", mode: 0o600 });
process.stdout.write("Synced the local public Supabase configuration.\n");
