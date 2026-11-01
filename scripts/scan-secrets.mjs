import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(".");
const ignoredDirectories = new Set([
  ".git",
  ".netlify",
  ".react-router",
  "build",
  "coverage",
  "node_modules",
]);
const textExtensions = new Set([
  "",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const patterns = [
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { label: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u },
  { label: "GitHub token", pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/u },
  { label: "Stripe live key", pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/u },
];

const findings = [];

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(path);
      continue;
    }

    if (
      !entry.isFile() ||
      relative(root, path) === "scripts/scan-secrets.mjs" ||
      !textExtensions.has(extname(entry.name)) ||
      statSync(path).size > 2_000_000
    ) {
      continue;
    }

    const content = readFileSync(path, "utf8");
    for (const candidate of patterns) {
      if (candidate.pattern.test(content)) {
        findings.push(`${relative(root, path)}: possible ${candidate.label}`);
      }
    }
  }
}

visit(root);

if (findings.length > 0) {
  process.stderr.write(`${findings.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("No high-confidence committed-secret pattern detected.\n");
