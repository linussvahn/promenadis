import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { boundarySchemas } from "./schemas.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(packageRoot, "generated");

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function withoutDialectMarker(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _schema, ...component } = schema;
  return component;
}

const jsonSchemas = Object.fromEntries(
  Object.entries(boundarySchemas).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema, { target: "draft-2020-12" }),
  ]),
);

const artifacts = new Map<string, string>([
  ["boundary-schemas.json", serialize(jsonSchemas)],
  [
    "openapi.json",
    serialize({
      components: {
        schemas: Object.fromEntries(
          Object.entries(jsonSchemas).map(([name, schema]) => [name, withoutDialectMarker(schema)]),
        ),
      },
      info: {
        title: "Promenadis API",
        version: "1.0.0-foundation",
      },
      openapi: "3.1.0",
      paths: {},
    }),
  ],
]);

const checkOnly = process.argv.includes("--check");

if (!checkOnly) {
  mkdirSync(outputDirectory, { recursive: true });
}

for (const [filename, expected] of artifacts) {
  const path = resolve(outputDirectory, filename);

  if (checkOnly) {
    let actual: string;
    try {
      actual = readFileSync(path, "utf8");
    } catch {
      throw new Error(`Missing generated contract artifact: ${filename}`);
    }

    if (actual !== expected) {
      throw new Error(`Generated contract artifact is stale: ${filename}`);
    }
  } else {
    writeFileSync(path, expected, "utf8");
  }
}

if (checkOnly) {
  console.log("Contract artifacts are current.");
} else {
  console.log(`Generated ${artifacts.size} contract artifacts.`);
}
