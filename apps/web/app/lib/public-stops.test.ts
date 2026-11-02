import type { PublicSafetyFeed, PublicSnapshot } from "@promenadis/contracts";
import { describe, expect, it } from "vitest";
import { applySafetyFeed, clusterStops, filterStops, isOpenNow, noFilters } from "./public-stops";

const books = "0199a000-0000-7000-8000-000000000005";
const toys = "0199a000-0000-7000-8000-000000000006";
const seller = (id: string, overrides: Partial<PublicSnapshot["sellers"][number]> = {}) => ({
  accessibility: {
    elevator: null,
    setting: null,
    stairs: null,
    stepFree: null,
    strollerFriendly: null,
  },
  availability: [],
  categoryIds: [books],
  description: "",
  displayName: `Seller ${id}`,
  id: id.repeat(24),
  items: [],
  status: "open" as const,
  stopId: id.repeat(24),
  tags: [],
  title: null,
  ...overrides,
});
const stop = (id: string, sellerIds: string[], cell = "1_1") => ({
  cluster: { z13: "0_0", z15: cell },
  id: id.repeat(24),
  latitude: 59.3,
  longitude: 18.06,
  sellerIds: sellerIds.map((s) => s.repeat(24)),
});
const snapshot: PublicSnapshot = {
  categories: [
    {
      id: books,
      key: "books",
      labels: { en: "Books", sv: "Böcker" },
      synonyms: { en: ["novels"], sv: ["deckare"] },
    },
    { id: toys, key: "toys", labels: { en: "Toys", sv: "Leksaker" }, synonyms: { en: [], sv: [] } },
  ],
  counts: { byCategory: {}, open: 3, sellers: 3, stops: 2 },
  event: {
    areaLabel: null,
    boundary: null,
    intervals: [{ endsAt: "2031-09-09T15:00:00Z", startsAt: "2031-09-09T08:00:00Z" }],
    state: "active",
    timezone: "Europe/Stockholm",
    title: "Walk",
  },
  eventKey: "c".repeat(32),
  expiresAt: "2031-09-09T15:00:00Z",
  generatedAt: "2031-09-09T08:00:00Z",
  revision: 2,
  schemaVersion: "1.0",
  sellers: [
    seller("a", {
      accessibility: {
        elevator: null,
        setting: null,
        stairs: null,
        stepFree: true,
        strollerFriendly: null,
      },
    }),
    seller("b", {
      categoryIds: [toys],
      items: [
        { categoryId: toys, currency: "SEK", name: "Lego", priceMinor: 100, status: "available" },
      ],
    }),
    seller("d", { status: "away" }),
  ],
  stops: [stop("1", ["a", "b"]), stop("2", ["d"], "9_9")],
};
const feed = (overrides: Partial<PublicSafetyFeed> = {}): PublicSafetyFeed => ({
  awaySellerIds: [],
  blockedEdgeIds: [],
  eventKey: "c".repeat(32),
  expiresAt: "2031-09-09T15:00:00Z",
  generatedAt: "2031-09-09T09:00:00Z",
  removedSellerIds: [],
  removedStopIds: [],
  requiredGraphVersion: null,
  schemaVersion: "1.0",
  sequence: 4,
  state: "active",
  ...overrides,
});

describe("applySafetyFeed", () => {
  it("removes sellers and stops and takes away status from the live feed", () => {
    const stops = applySafetyFeed(
      snapshot,
      feed({ awaySellerIds: ["a".repeat(24)], removedSellerIds: ["d".repeat(24)] }),
    );
    expect(stops.map((s) => s.number)).toEqual([1]);
    expect(stops[0]?.sellers.map((s) => [s.displayName, s.status])).toEqual([
      ["Seller a", "away"],
      ["Seller b", "open"],
    ]);
    expect(
      applySafetyFeed(snapshot, feed({ removedStopIds: ["1".repeat(24)] })).map((s) => s.number),
    ).toEqual([2]);
  });
});

describe("filterStops", () => {
  const now = new Date("2031-09-09T10:00:00Z");
  const stops = applySafetyFeed(snapshot, feed());
  it("matches words in either language, including synonyms and item names", () => {
    const names = (query: string) =>
      filterStops(stops, snapshot, { ...noFilters, query }, now).flatMap((s) =>
        s.sellers.map((x) => x.displayName),
      );
    expect(names("deckare")).toEqual(["Seller a", "Seller d"]);
    expect(names("LEGO")).toEqual(["Seller b"]);
    expect(names("leksaker lego")).toEqual(["Seller b"]);
    expect(names("toys books")).toEqual([]);
  });
  it("filters by category, accessibility and open now", () => {
    expect(filterStops(stops, snapshot, { ...noFilters, categoryId: toys }, now)).toHaveLength(1);
    expect(
      filterStops(stops, snapshot, { ...noFilters, stepFree: true }, now)[0]?.sellers,
    ).toHaveLength(1);
    expect(isOpenNow(stops[0]?.sellers[0] as never, now, snapshot.event.intervals)).toBe(true);
    expect(
      isOpenNow(
        stops[0]?.sellers[0] as never,
        new Date("2031-09-09T16:00:00Z"),
        snapshot.event.intervals,
      ),
    ).toBe(false);
  });
});

describe("clusterStops", () => {
  const stops = applySafetyFeed(snapshot, feed());
  it("groups by server cells when zoomed out and splits when zoomed in", () => {
    expect(clusterStops(stops, 12)).toHaveLength(1);
    expect(clusterStops(stops, 14)).toHaveLength(2);
    expect(clusterStops(stops, 16)).toHaveLength(2);
  });
});
