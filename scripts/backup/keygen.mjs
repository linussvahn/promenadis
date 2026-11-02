import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { keyDirectory } from "./common.mjs";

// One-time: an RSA recovery key pair (archives are encrypted to the public
// key) and an Ed25519 signing pair for manifests. Keep the private recovery
// key offline; never put it in the repository, Supabase or AWS.
if (existsSync(resolve(keyDirectory, "recovery-private.pem"))) {
  console.error(`Keys already exist in ${keyDirectory}; refusing to overwrite.`);
  process.exit(1);
}
mkdirSync(keyDirectory, { mode: 0o700, recursive: true });
const recovery = generateKeyPairSync("rsa", { modulusLength: 4096 });
const signing = generateKeyPairSync("ed25519");
const write = (name, key, type) =>
  writeFileSync(resolve(keyDirectory, name), key.export({ format: "pem", type }), { mode: 0o600 });
write("recovery-public.pem", recovery.publicKey, "spki");
write("recovery-private.pem", recovery.privateKey, "pkcs8");
write("signing-public.pem", signing.publicKey, "spki");
write("signing-private.pem", signing.privateKey, "pkcs8");
console.log(`Wrote recovery and signing keys to ${keyDirectory}.`);
