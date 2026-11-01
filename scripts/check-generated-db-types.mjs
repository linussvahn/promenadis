import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const generatedPath = resolve("supabase/types/database.generated.ts");
const result = spawnSync(
  "pnpm",
  ["exec", "supabase", "gen", "types", "typescript", "--local", "--schema", "public,app_private"],
  { encoding: "utf8" },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || "Could not generate local database types.\n");
  process.exit(result.status ?? 1);
}

const committed = readFileSync(generatedPath, "utf8");
if (committed !== result.stdout) {
  process.stderr.write("Generated database types have drifted. Run `pnpm db:types`.\n");
  process.exit(1);
}

process.stdout.write("Generated database types match the local schema.\n");
