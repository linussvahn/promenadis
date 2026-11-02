import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { archiveDirectory, psql } from "./common.mjs";

// Synthetic drill: an account erased after the backup must not come back,
// and a tampered archive must be refused. Uses throwaway keys.
const keys = mkdtempSync(resolve(tmpdir(), "promenadis-keys-"));
const env = { ...process.env, PROMENADIS_RECOVERY_KEYS: keys };
const run = (script, args = []) =>
  execFileSync("node", [resolve(import.meta.dirname, script), ...args], {
    encoding: "utf8",
    env,
  }).trim();
const account = randomUUID();
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  run("keygen.mjs");
  psql(`insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
    values ('${account}','backup-${account.slice(0, 8)}@example.invalid',now(),now(),now());`);
  const backup = JSON.parse(run("backup-local.mjs").split("\n").at(-1));
  // Erasure after the archive was taken (the real job also writes this tombstone).
  psql(`delete from auth.users where id='${account}';
    insert into app_private.erasure_tombstones(subject_type, subject_id) values ('account','${account}');`);
  const drill = JSON.parse(run("restore-drill.mjs", [backup.manifest]).split("\n").at(-1));
  assert(drill.signatureValid && drill.countsMatch, "The drill did not verify the archive.");
  assert(drill.replay.accountsRemoved === 1, "The erased account was resurrected by the restore.");

  const archivePath = resolve(archiveDirectory, backup.archive);
  const bytes = readFileSync(archivePath);
  bytes[bytes.length - 1] ^= 0xff;
  writeFileSync(archivePath, bytes);
  let refused = false;
  try {
    run("restore-drill.mjs", [backup.manifest]);
  } catch {
    refused = true;
  }
  assert(refused, "A tampered archive was restored.");
  console.log(
    "Backup drill passed: signed, encrypted, restored, counts matched, erasure replayed, tampering refused.",
  );
} finally {
  psql(`delete from app_private.erasure_tombstones where subject_id='${account}';
    delete from auth.users where id='${account}';`);
}
