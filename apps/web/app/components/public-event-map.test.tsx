import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicEventMap } from "./public-event-map";

vi.mock("react-map-gl/maplibre", () => ({
  default: () => null,
  Layer: () => null,
  Marker: () => null,
  Source: () => null,
}));
const mocks = vi.hoisted(() => ({
  getPublicManifest: vi.fn(),
  getPublicSafetyFeed: vi.fn(),
  getPublicSnapshot: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ getPromenadisApiClient: () => mocks }));

const key = "c".repeat(32);
const later = new Date(Date.now() + 3_600_000).toISOString();
const earlier = new Date(Date.now() - 3_600_000).toISOString();
const manifest = (overrides: object = {}) => ({
  eventKey: key,
  expiresAt: later,
  generatedAt: earlier,
  publicRevision: 2,
  routing: null,
  routingVersion: null,
  safetySequence: 3,
  schemaVersion: "1.0",
  snapshot: { byteSize: 100, id: "01992026-1104-7400-8000-000000000001", sha256: "a".repeat(64) },
  state: "active",
  ...overrides,
});
const feed = (overrides: object = {}) => ({
  awaySellerIds: [],
  blockedEdgeIds: [],
  eventKey: key,
  expiresAt: later,
  generatedAt: earlier,
  removedSellerIds: [],
  removedStopIds: [],
  requiredGraphVersion: null,
  schemaVersion: "1.0",
  sequence: 3,
  state: "active",
  ...overrides,
});
const seller = (id: string, title: string) => ({
  accessibility: {
    elevator: null,
    setting: "outdoor",
    stairs: null,
    stepFree: true,
    strollerFriendly: null,
  },
  availability: [],
  categoryIds: ["0199a000-0000-7000-8000-000000000005"],
  description: "",
  displayName: `Seller ${id}`,
  id: id.repeat(24),
  items: [
    { categoryId: null, currency: "SEK", name: "Atlas", priceMinor: 5000, status: "available" },
  ],
  status: "open",
  stopId: id.repeat(24),
  tags: ["vinyl"],
  title,
});
const snapshot = {
  categories: [
    {
      id: "0199a000-0000-7000-8000-000000000005",
      key: "books",
      labels: { en: "Books", sv: "Böcker" },
      synonyms: { en: [], sv: [] },
    },
  ],
  counts: {
    byCategory: { "0199a000-0000-7000-8000-000000000005": 2 },
    open: 2,
    sellers: 2,
    stops: 2,
  },
  event: {
    areaLabel: null,
    boundary: null,
    intervals: [{ endsAt: later, startsAt: earlier }],
    state: "active",
    timezone: "Europe/Stockholm",
    title: "Walk",
  },
  eventKey: key,
  expiresAt: later,
  generatedAt: earlier,
  revision: 2,
  schemaVersion: "1.0",
  sellers: [seller("a", "Crime novels"), seller("b", "Cookbooks")],
  stops: ["a", "b"].map((id) => ({
    cluster: { z13: "1_1", z15: `${id}_1` },
    entrance: null,
    manualAccess: false,
    id: id.repeat(24),
    latitude: 59.3,
    longitude: 18.06,
    sellerIds: [id.repeat(24)],
  })),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PublicEventMap", () => {
  it("lists stops after validating the feed, applies removals and away status", async () => {
    mocks.getPublicManifest.mockResolvedValue(manifest());
    mocks.getPublicSnapshot.mockResolvedValue(snapshot);
    mocks.getPublicSafetyFeed.mockResolvedValue(
      feed({ awaySellerIds: ["a".repeat(24)], removedSellerIds: ["b".repeat(24)] }),
    );
    const { container } = render(<PublicEventMap eventKey={key} locale="en" route="public" />);
    const list = await screen.findByRole("region", { name: "List of the stops" });
    expect(within(list).getByRole("heading", { name: /Crime novels/u })).toBeVisible();
    expect(within(list).getByText("Away for a moment")).toBeVisible();
    expect(within(list).queryByText("Cookbooks")).toBeNull();
    expect(within(list).getByText("Atlas · SEK 50.00")).toBeVisible();
    expect(within(list).getByRole("link", { name: "Report" })).toHaveAttribute(
      "href",
      `/report?key=${key}&route=public&type=participation&subject=${"a".repeat(24)}`,
    );
    expect(screen.getByText(/1 stops · 1 sellers · 0 open now/u)).toBeVisible();
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });

  it("filters the list by search words", async () => {
    mocks.getPublicManifest.mockResolvedValue(manifest());
    mocks.getPublicSnapshot.mockResolvedValue(snapshot);
    mocks.getPublicSafetyFeed.mockResolvedValue(feed());
    render(<PublicEventMap eventKey={key} locale="en" route="unlisted" />);
    const list = await screen.findByRole("region", { name: "List of the stops" });
    fireEvent.change(screen.getByLabelText("Search for items, categories or sellers"), {
      target: { value: "cook" },
    });
    expect(within(list).queryByText("Crime novels")).toBeNull();
    expect(within(list).getByRole("heading", { name: /Cookbooks/u })).toBeVisible();
  });

  it("refuses expired data and tombstoned events", async () => {
    mocks.getPublicManifest.mockResolvedValue(manifest({ expiresAt: earlier }));
    render(<PublicEventMap eventKey={key} locale="en" route="public" />);
    expect(
      await screen.findByText("The map data has expired and is no longer shown."),
    ).toBeVisible();
    expect(mocks.getPublicSnapshot).not.toHaveBeenCalled();
    cleanup();
    mocks.getPublicManifest.mockResolvedValue(manifest({ snapshot: null, state: "ended" }));
    render(<PublicEventMap eventKey={key} locale="en" route="public" />);
    expect(await screen.findByText(/The event is not running/u)).toBeVisible();
  });

  it("shows nothing precise when the safety feed cannot be read", async () => {
    mocks.getPublicManifest.mockResolvedValue(manifest());
    mocks.getPublicSnapshot.mockResolvedValue(snapshot);
    mocks.getPublicSafetyFeed.mockRejectedValue(new Error("offline"));
    render(<PublicEventMap eventKey={key} locale="en" route="public" />);
    expect(await screen.findByText(/could not be loaded/u)).toBeVisible();
    expect(screen.queryByText("Crime novels")).toBeNull();
  });
});
