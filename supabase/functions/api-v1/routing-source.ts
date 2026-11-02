// Walking-network source acquisition. Locally this is a checksum-verified
// synthetic fixture; the hosted adapter (weekly Geofabrik Sweden extract into
// private storage) is a pilot gate and fails closed until configured.
const fixture = {
  attribution: "© OpenStreetMap contributors (synthetic local fixture)",
  file: "fixtures/osm-synthetic-sodermalm.json",
  license: "ODbL-1.0",
  name: "Promenadis synthetic Södermalm fixture",
  retrievedAt: "2026-11-04T00:00:00Z",
  sha256: "153353401749d81d94ec03b64f97b42c5b6bec1e8365afe22d0d83e1caa04347",
  url: "local-fixture:osm-synthetic-sodermalm.json",
} as const;

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadRoutingSource() {
  if (
    Deno.env.get("ROUTING_SOURCE_PROVIDER") &&
    Deno.env.get("ROUTING_SOURCE_PROVIDER") !== "fixture"
  ) {
    throw new Error("routing_source_unavailable");
  }
  const text = await Deno.readTextFile(new URL(fixture.file, import.meta.url));
  // A changed or truncated source is never compiled.
  if ((await sha256Hex(text)) !== fixture.sha256)
    throw new Error("routing_source_checksum_mismatch");
  const { file: _file, ...metadata } = fixture;
  return { metadata, source: JSON.parse(text) };
}
