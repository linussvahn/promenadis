import { execFileSync } from "node:child_process";
import {
  constants,
  createCipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  sign,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { archiveDirectory, excludedData, keyDirectory, psql, schemas } from "./common.mjs";

// Local logical export: compress, encrypt to the recovery public key and
// write a signed manifest with checksums, counts and the tombstone watermark.
const recoveryPublic = createPublicKey(readFileSync(resolve(keyDirectory, "recovery-public.pem")));
const signingPrivate = createPrivateKey(readFileSync(resolve(keyDirectory, "signing-private.pem")));

const dump = execFileSync(
  "docker",
  [
    "exec",
    "supabase_db_promenadis",
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "--no-owner",
    "--no-privileges",
    ...schemas.flatMap((schema) => ["--schema", schema]),
    ...excludedData.flatMap((table) => ["--exclude-table-data", table]),
  ],
  { maxBuffer: 512 * 1024 * 1024 },
);
const counts = JSON.parse(psql("select app_private.backup_manifest_counts();"));
const key = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([cipher.update(gzipSync(dump)), cipher.final()]);
const archive = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
const wrappedKey = publicEncrypt(
  { key: recoveryPublic, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING },
  key,
);
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
mkdirSync(archiveDirectory, { recursive: true });
const archiveName = `promenadis-${stamp}.dump.gz.enc`;
writeFileSync(resolve(archiveDirectory, archiveName), archive, { mode: 0o600 });
const manifest = {
  archive: archiveName,
  byteSize: archive.length,
  counts,
  createdAt: new Date().toISOString(),
  excludedData,
  format: "pg_dump-plain+gzip+aes-256-gcm/rsa-oaep-sha256",
  schemas,
  schemaVersion: 1,
  sha256: createHash("sha256").update(archive).digest("hex"),
  wrappedKey: wrappedKey.toString("base64"),
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestPath = resolve(archiveDirectory, `promenadis-${stamp}.manifest.json`);
writeFileSync(manifestPath, manifestText, { mode: 0o600 });
writeFileSync(
  `${manifestPath}.sig`,
  sign(null, Buffer.from(manifestText), signingPrivate).toString("base64"),
);
console.log(
  JSON.stringify({
    archive: archiveName,
    bytes: archive.length,
    manifest: manifestPath,
    migration: counts.migration,
  }),
);
