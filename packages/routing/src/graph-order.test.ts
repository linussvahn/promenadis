import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRoutingPackage } from "./build";
import { WalkingGraph } from "./graph";
import { type OrderInput, orderRoute, schedule, visitMinutes } from "./order";

const source = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      "../../../supabase/functions/api-v1/fixtures/osm-synthetic-sodermalm.json",
    ),
    "utf8",
  ),
);
const { pkg } = buildRoutingPackage({
  boundary: [
    [18.06, 59.31],
    [18.072, 59.31],
    [18.072, 59.316],
    [18.06, 59.316],
    [18.06, 59.31],
  ],
  locations: [],
  overrides: [],
  source,
  sourceMetadata: {
    attribution: "© OpenStreetMap contributors",
    license: "ODbL-1.0",
    name: "fixture",
    retrievedAt: "2026-11-04T00:00:00Z",
    sha256: "a".repeat(64),
    url: "local-fixture:test",
  },
});

describe("WalkingGraph", () => {
  const graph = new WalkingGraph(pkg);
  it("snaps near points and refuses distant ones", () => {
    expect(graph.snap([18.0632, 59.3121], 60)?.meters).toBeLessThan(60);
    expect(graph.snap([18.2, 59.5], 100)).toBeNull();
  });

  it("finds street distances no shorter than the straight line", () => {
    const a = graph.snap([18.0611, 59.3105], 60);
    const b = graph.snap([18.0705, 59.3151], 60);
    const [[, meters]] = graph.matrix([a, b]) as [[number, number]];
    expect(meters).toBeGreaterThan(700);
    expect(meters).toBeLessThan(1400);
    const path = graph.path(a as never, b as never);
    expect(path?.coordinates.length).toBeGreaterThan(3);
    expect(Math.abs((path?.meters ?? 0) - meters)).toBeLessThan(1);
  });

  it("marks the courtyard island unreachable and respects blocked edges", () => {
    const street = graph.snap([18.0632, 59.3121], 60);
    const island = graph.snap([18.06775, 59.3118], 60);
    expect(graph.matrix([street, island])[0]?.[1]).toBe(Number.POSITIVE_INFINITY);
    const blockedAll = new WalkingGraph(pkg, new Set(pkg.edgeKeys));
    expect(blockedAll.snap([18.0632, 59.3121], 60)).toBeNull();
  });
});

const lineMatrix = (positions: number[]) =>
  positions.map((a) => positions.map((b) => Math.abs(a - b)));
const hour = 3_600_000;
const t0 = Date.UTC(2031, 8, 9, 8);
const stop = (
  id: string,
  windows = [{ endsAt: t0 + 8 * hour, startsAt: t0 }],
  mustSee = false,
) => ({
  id,
  sellers: [{ id: `seller-${id}`, mustSee, windows }],
  visitSeconds: 300,
});

describe("orderRoute", () => {
  it("orders by walking distance in shortest mode and counts visit time", () => {
    const input: OrderInput = {
      hasStart: true,
      matrix: lineMatrix([0, 300, 100, 200]),
      mode: "shortest",
      returnToStart: false,
      startTime: t0,
      stops: [stop("a"), stop("b"), stop("c")],
    };
    const { plan } = orderRoute(input);
    expect(plan.order).toEqual([1, 2, 0]);
    expect(plan.walkSeconds).toBe(Math.round(100 / 1.25) * 3);
    expect(plan.departures.at(-1)).toBe(t0 + (240 + 900) * 1000);
  });

  it("reaches a seller who closes early within the detour guardrail", () => {
    const closingSoon = stop("far", [{ endsAt: t0 + 10 * 60_000, startsAt: t0 }]);
    const input: OrderInput = {
      hasStart: true,
      matrix: lineMatrix([0, 100, 200, 300, 500]),
      mode: "availability",
      returnToStart: false,
      startTime: t0,
      stops: [stop("1"), stop("2"), stop("3"), closingSoon],
    };
    const result = orderRoute(input);
    expect(result.shortest.missedSellerIds).toEqual(["seller-far"]);
    // Going there first doubles the walk, beyond 20%: offered, not applied.
    expect(result.plan.missedSellerIds).toEqual(["seller-far"]);
    expect(result.alternative?.missedSellerIds).toEqual([]);
    const mustSee = orderRoute({
      ...input,
      stops: [
        stop("1"),
        stop("2"),
        stop("3"),
        { ...closingSoon, sellers: [{ ...closingSoon.sellers[0], mustSee: true }] as never },
      ],
    });
    expect(mustSee.plan.missedSellerIds).toEqual([]);
    expect(mustSee.plan.order[0]).toBe(3);
  });

  it("keeps locked positions and shows manual gaps without invented time", () => {
    const matrix = lineMatrix([0, 100, 200, 300]).map((row, i) =>
      row.map((value, j) => ((i === 3 || j === 3) && i !== j ? Number.POSITIVE_INFINITY : value)),
    );
    const input: OrderInput = {
      hasStart: true,
      matrix,
      mode: "shortest",
      returnToStart: true,
      startTime: t0,
      stops: [stop("a"), { ...stop("b"), lockedPosition: 0 }, stop("gap")],
    };
    const { plan } = orderRoute(input);
    expect(plan.order[0]).toBe(1);
    expect(plan.incomplete).toBe(true);
    expect(plan.legs.filter((leg) => leg.manualGap).every((leg) => leg.seconds === null)).toBe(
      true,
    );
    expect(plan.legs.at(-1)?.to).toBeNull();
  });

  it("waits for a seller who has not opened yet", () => {
    const later = stop("late", [{ endsAt: t0 + 4 * hour, startsAt: t0 + hour }]);
    const plan = schedule(
      {
        hasStart: false,
        matrix: [[0]],
        mode: "shortest",
        returnToStart: false,
        startTime: t0,
        stops: [later],
      },
      [0],
    );
    expect(plan.arrivals[0]).toBe(t0 + hour);
    expect(plan.missedSellerIds).toEqual([]);
  });

  it("uses the pace presets", () => {
    expect(visitMinutes("standard", 1)).toBe(5);
    expect(visitMinutes("standard", 3)).toBe(9);
    expect(visitMinutes("quick", 2)).toBe(3);
    expect(visitMinutes("leisurely", 2, 12)).toBe(17);
  });
});
