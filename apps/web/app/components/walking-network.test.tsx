import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalkingNetwork } from "./walking-network";

vi.mock("react-map-gl/maplibre", () => ({
  default: () => null,
  Layer: () => null,
  Source: () => null,
}));
const mocks = vi.hoisted(() => ({
  addRoutingOverride: vi.fn(),
  buildEventRouting: vi.fn(),
  confirmRoutingBuild: vi.fn(),
  getEventRouting: vi.fn(),
  getRoutingPreviewPackage: vi.fn(),
  removeRoutingOverride: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ getPromenadisApiClient: () => mocks }));

const eventId = "01992026-1105-7200-8000-000000000001";
const buildId = "01992026-1105-7200-8000-000000000002";
const locationId = "01992026-1105-7200-8000-000000000003";
const accessToken = async () => "owner";
const routing = (status: "connected" | "disconnected", state = "awaiting_host_preview") => ({
  active: null,
  boundaryVersion: 1,
  eventId,
  latest: {
    boundaryVersion: 1,
    byteSize: 1000,
    compilerVersion: "promenadis-routing/1",
    componentCount: 2,
    confirmedAt: null,
    createdAt: "2031-09-01T08:00:00Z",
    edgeCount: 10,
    error: null,
    id: buildId,
    locations: [
      {
        component: 1,
        detourRatio: null,
        id: locationId,
        sellerNames: ["Courtyard"],
        snapMeters: 8,
        status,
      },
    ],
    nodeCount: 12,
    packageId: null,
    rejectedConnectorIds: [],
    source: { attribution: "© OpenStreetMap contributors", license: "ODbL-1.0", name: "fixture" },
    state,
    warnings: [],
  },
  overrides: [],
  ready: state === "ready",
});
const event = (role: string, state = "published") => ({ id: eventId, role, state }) as never;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WalkingNetwork", () => {
  it("lets a host mark a disconnected stop as manual access and approve", async () => {
    mocks.getEventRouting.mockResolvedValue(routing("disconnected"));
    mocks.addRoutingOverride.mockResolvedValue(routing("connected"));
    mocks.confirmRoutingBuild.mockResolvedValue(routing("connected", "ready"));
    render(<WalkingNetwork accessToken={accessToken} event={event("owner")} locale="en" />);
    expect(await screen.findByText("No walking path")).toBeVisible();
    expect(screen.getByText(/ODbL-1.0/u)).toBeVisible();
    fireEvent.change(screen.getAllByLabelText("Reason")[0] as HTMLElement, {
      target: { value: "Reached through the gate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark as manual access" }));
    await waitFor(() =>
      expect(mocks.addRoutingOverride).toHaveBeenCalledWith("owner", eventId, {
        kind: "manual_access",
        locationId,
        reason: "Reached through the gate",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Approve the walking network" }));
    expect(await screen.findByText("Walking routes ready")).toBeVisible();
    expect(mocks.confirmRoutingBuild).toHaveBeenCalledWith("owner", eventId, buildId);
  });

  it("gives moderators inspection only and hides connectors during the event", async () => {
    mocks.getEventRouting.mockResolvedValue(routing("connected"));
    render(<WalkingNetwork accessToken={accessToken} event={event("moderator")} locale="en" />);
    expect(await screen.findByText(/inspect and report problems/u)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Build walking network" })).toBeNull();
    cleanup();
    render(
      <WalkingNetwork accessToken={accessToken} event={event("owner", "active")} locale="en" />,
    );
    expect(await screen.findByRole("button", { name: "Block the segment" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add connection" })).toBeNull();
  });
});
