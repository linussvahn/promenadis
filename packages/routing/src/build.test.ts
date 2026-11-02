import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BuildInput,
  buildRoutingPackage,
  distanceMeters,
  type LngLat,
  MinHeap,
  validateRoutingPackage,
} from "./build";

const source = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      "../../../supabase/functions/api-v1/fixtures/osm-synthetic-sodermalm.json",
    ),
    "utf8",
  ),
);
const boundary: LngLat[] = [
  [18.06, 59.31],
  [18.072, 59.31],
  [18.072, 59.316],
  [18.06, 59.316],
  [18.06, 59.31],
];
const metadata = {
  attribution: "© OpenStreetMap contributors",
  license: "ODbL-1.0",
  name: "fixture",
  retrievedAt: "2026-11-04T00:00:00Z",
  sha256: "a".repeat(64),
  url: "local-fixture:test",
};
const street = { id: "street", point: [18.0632, 59.3121] as LngLat };
const island = { id: "island", point: [18.06775, 59.3118] as LngLat };
const input = (overrides: BuildInput["overrides"] = []): BuildInput => ({
  boundary,
  locations: [street, island],
  overrides,
  source,
  sourceMetadata: metadata,
});

describe("buildRoutingPackage", () => {
  const result = buildRoutingPackage(input());
  it("keeps only walkable ways inside the buffered event area", () => {
    expect(validateRoutingPackage(JSON.parse(result.body))).toBe(true);
    const lngs = result.pkg.nodes.filter((_, i) => i % 2 === 0);
    expect(Math.min(...lngs)).toBeGreaterThan(18.055);
    expect(Math.max(...lngs)).toBeLessThan(18.0775);
    // Motorway at 59.3205 and the private service road never appear.
    expect(result.pkg.nodes.filter((_, i) => i % 2 === 1).some((lat) => lat > 59.32)).toBe(false);
    expect(
      result.pkg.nodes.some(
        (value, i) => i % 2 === 0 && value === 18.07025 && result.pkg.nodes[i + 1] === 59.3138,
      ),
    ).toBe(false);
    expect(result.pkg.edges.filter((_, i) => i % 4 === 3).includes(1)).toBe(true);
  });

  it("contains street data and attribution only, never locations", () => {
    expect(result.body).not.toContain("street");
    expect(result.body).not.toContain("island");
    expect(result.pkg.license).toBe("ODbL-1.0");
    expect(result.pkg.attribution).toContain("OpenStreetMap");
  });

  it("reports connected and disconnected locations", () => {
    const status = Object.fromEntries(result.diagnostics.locations.map((l) => [l.id, l.status]));
    expect(status).toEqual({ island: "disconnected", street: "connected" });
    expect(result.diagnostics.componentCount).toBeGreaterThan(1);
  });

  it("applies manual access, entrance, block and connector overrides", () => {
    const islandNode: LngLat = [18.06755, 59.3117];
    const streetNode: LngLat = [18.067, 59.3114];
    expect(distanceMeters(islandNode, streetNode)).toBeLessThan(100);
    const edited = buildRoutingPackage(
      input([
        { edgeKey: result.pkg.edgeKeys[0] as string, id: "b1", kind: "block_edge" },
        { from: islandNode, id: "c1", kind: "connector", to: streetNode },
        { from: [18.061, 59.311], id: "c2", kind: "connector", to: [18.0625, 59.3125] },
        { id: "m1", kind: "manual_access", locationId: "street" },
      ]),
    );
    expect(edited.pkg.edgeKeys).not.toContain(result.pkg.edgeKeys[0]);
    expect(edited.pkg.edgeKeys).toContain("c:c1");
    expect(edited.diagnostics.rejectedConnectors).toEqual(["c2"]);
    expect(edited.diagnostics.warnings).toContain("connector_rejected");
    const status = Object.fromEntries(edited.diagnostics.locations.map((l) => [l.id, l.status]));
    expect(status).toEqual({ island: "connected", street: "manual_access" });
    const moved = buildRoutingPackage(
      input([{ id: "e1", kind: "entrance", locationId: "island", point: [18.0677, 59.3112] }]),
    );
    expect(moved.diagnostics.locations.find((l) => l.id === "island")?.status).toBe("connected");
  });

  it("is deterministic for the same inputs", () => {
    expect(buildRoutingPackage(input()).body).toBe(result.body);
  });
});

describe("MinHeap", () => {
  it("pops in priority order", () => {
    const heap = new MinHeap();
    for (const [priority, value] of [
      [5, 1],
      [1, 2],
      [3, 3],
      [0, 4],
      [4, 5],
    ] as const)
      heap.push(priority, value);
    const order: number[] = [];
    while (heap.size) order.push(heap.pop()[1]);
    expect(order).toEqual([4, 2, 3, 5, 1]);
  });
});
