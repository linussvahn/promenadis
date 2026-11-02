import { execFileSync } from "node:child_process";
import {
  constants,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  verify,
} from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { archiveDirectory, keyDirectory, psql } from "./common.mjs";

// Restore exercise into an isolated, short-lived database in the local
// stack: verify the signature and checksum, decrypt, restore, compare counts,
// replay current erasure tombstones, then destroy the database.
const DRILL = "promenadis_restore_drill";
const manifestPath =
  process.argv[2] ??
  resolve(
    archiveDirectory,
    readdirSync(archiveDirectory)
      .filter((name) => name.endsWith(".manifest.json"))
      .sort()
      .at(-1) ?? "",
  );
const manifestText = readFileSync(manifestPath, "utf8");
const signature = Buffer.from(readFileSync(`${manifestPath}.sig`, "utf8"), "base64");
const signingPublic = createPublicKey(readFileSync(resolve(keyDirectory, "signing-public.pem")));
if (!verify(null, Buffer.from(manifestText), signingPublic, signature))
  throw new Error("Manifest signature invalid");
const manifest = JSON.parse(manifestText);
const archive = readFileSync(resolve(archiveDirectory, manifest.archive));
if (createHash("sha256").update(archive).digest("hex") !== manifest.sha256)
  throw new Error("Archive checksum invalid");

const recoveryPrivate = createPrivateKey(
  readFileSync(resolve(keyDirectory, "recovery-private.pem")),
);
const key = privateDecrypt(
  { key: recoveryPrivate, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING },
  Buffer.from(manifest.wrappedKey, "base64"),
);
const decipher = createDecipheriv("aes-256-gcm", key, archive.subarray(0, 12));
decipher.setAuthTag(archive.subarray(12, 28));
const dump = gunzipSync(Buffer.concat([decipher.update(archive.subarray(28)), decipher.final()]));

psql(`drop database if exists ${DRILL};`);
psql(`create database ${DRILL};`);
try {
  // Extensions the schemas depend on; scheduling (pg_cron) stays off so
  // nothing in the drill acts on its own.
  psql(
    `drop schema public cascade;
     create schema extensions;
     create extension if not exists pgcrypto with schema extensions;
     create extension if not exists "uuid-ossp" with schema extensions;
     create extension if not exists postgis with schema extensions;`,
    DRILL,
  );
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_promenadis",
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      DRILL,
    ],
    { input: dump, maxBuffer: 512 * 1024 * 1024, stdio: ["pipe", "ignore", "pipe"] },
  );
  const restored = JSON.parse(psql("select app_private.backup_manifest_counts();", DRILL));
  for (const field of ["accounts", "events", "participations", "tombstones", "migration"]) {
    if (String(restored[field]) !== String(manifest.counts[field])) {
      throw new Error(`Restored ${field} differ from the manifest`);
    }
  }
  // Replay the live tombstones so later erasures are not resurrected.
  const tombstones = psql(
    "select coalesce(json_agg(json_build_object('subject_type',subject_type,'subject_id',subject_id,'erased_at',erased_at)),'[]') from app_private.erasure_tombstones;",
  );
  psql(
    `insert into app_private.erasure_tombstones (subject_type, subject_id, erased_at)
     select t.subject_type, t.subject_id, t.erased_at
     from json_to_recordset('${tombstones.replaceAll("'", "''")}'::json) as t(subject_type text, subject_id uuid, erased_at timestamptz)
     on conflict do nothing;`,
    DRILL,
  );
  const replay = JSON.parse(psql("select app_private.replay_erasure_tombstones();", DRILL));
  console.log(
    JSON.stringify({
      archive: manifest.archive,
      countsMatch: true,
      replay,
      restoredMigration: restored.migration,
      signatureValid: true,
    }),
  );
} finally {
  psql(`drop database if exists ${DRILL};`);
}
