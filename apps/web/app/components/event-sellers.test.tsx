import { PromenadisApiError } from "@promenadis/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventSellers } from "./event-sellers";

const mocks = vi.hoisted(() => ({
  correctLocationPin: vi.fn(),
  decideSeller: vi.fn(),
  reviewEventLocation: vi.fn(),
  listEventSellers: vi.fn(),
  setEarlyLocationVisibility: vi.fn(),
  updateEventAdmission: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ getPromenadisApiClient: () => mocks }));

const eventId = "01992026-1103-7000-8000-000000000001";
const seller = (id: string, state: string, name: string) => ({
  appliedAt: "2031-08-01T10:00:00Z",
  decisionReason: null,
  displayName: name,
  eventId,
  geographicException: state === "pending",
  id,
  location: {
    addressLine: `${name}gatan 1`,
    id: `${id.slice(0, -2)}9${id.slice(-1)}`,
    insideBoundary: state !== "pending",
    needsReview: false,
    sellerCount: 1,
    latitude: 59.331,
    locality: null,
    longitude: 18.062,
    placement: "manual",
    postalCode: null,
  },
  state,
  version: 2,
});
const data = {
  admissionMode: "auto_inside",
  eventId,
  eventVersion: 5,
  locationCount: 1,
  placesUsed: 1,
  sellerLimit: 30,
  sellers: [
    seller("01992026-1103-7000-8000-000000000011", "approved", "Anna"),
    seller("01992026-1103-7000-8000-000000000012", "pending", "Bo"),
  ],
  earlyLocationVisibility: false,
  waitlistPromotionPaused: false,
};
const event = {
  id: eventId,
  role: "owner",
  state: "draft",
  timezone: "Europe/Stockholm",
  title: "Spring market",
  version: 5,
} as never;
const accessToken = async () => "owner";
const onChanged = vi.fn(async () => {});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventSellers", () => {
  it("shows seller places and map locations separately", async () => {
    mocks.listEventSellers.mockResolvedValue(data);
    render(
      <EventSellers accessToken={accessToken} event={event} locale="en" onChanged={onChanged} />,
    );
    expect(await screen.findByText("1 of 30 seller places used · 1 map locations")).toBeVisible();
    expect(screen.getByText("Outside the area")).toBeVisible();
  });

  it("approves a pending seller and reports full places", async () => {
    mocks.listEventSellers.mockResolvedValue(data);
    mocks.decideSeller.mockRejectedValueOnce(
      new PromenadisApiError("full", 409, "places_full", null),
    );
    render(
      <EventSellers accessToken={accessToken} event={event} locale="en" onChanged={onChanged} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText("All seller places are taken.")).toBeVisible();
    expect(mocks.decideSeller).toHaveBeenCalledWith(
      "owner",
      "01992026-1103-7000-8000-000000000012",
      { decision: "approve", expectedVersion: 2 },
    );
  });

  it("revokes with a reason and saves admission settings", async () => {
    mocks.listEventSellers.mockResolvedValue(data);
    mocks.decideSeller.mockResolvedValue({});
    mocks.updateEventAdmission.mockResolvedValue(data);
    render(
      <EventSellers accessToken={accessToken} event={event} locale="en" onChanged={onChanged} />,
    );
    const reasons = await screen.findAllByLabelText(/Reason/u);
    fireEvent.change(reasons.at(-1) as HTMLElement, { target: { value: "No-show" } });
    fireEvent.click(screen.getByRole("button", { name: "Revoke place" }));
    await waitFor(() =>
      expect(mocks.decideSeller).toHaveBeenCalledWith(
        "owner",
        "01992026-1103-7000-8000-000000000011",
        { decision: "revoke", expectedVersion: 2, reason: "No-show" },
      ),
    );
    fireEvent.click(screen.getByLabelText("Review every application"));
    fireEvent.click(screen.getByRole("button", { name: "Save admission" }));
    await waitFor(() =>
      expect(mocks.updateEventAdmission).toHaveBeenCalledWith("owner", eventId, {
        admissionMode: "host_approval",
        expectedVersion: 5,
        waitlistPromotionPaused: false,
      }),
    );
    fireEvent.click(screen.getByLabelText(/Show approved stops to visitors/u));
    fireEvent.click(screen.getByRole("button", { name: "Save visibility" }));
    await waitFor(() =>
      expect(mocks.setEarlyLocationVisibility).toHaveBeenCalledWith("owner", eventId, {
        expectedEventVersion: 5,
        visible: true,
      }),
    );
  });

  it("confirms a flagged separate stop and corrects a pin", async () => {
    const flagged = seller("01992026-1103-7000-8000-000000000013", "approved", "Cia");
    mocks.listEventSellers.mockResolvedValue({
      ...data,
      sellers: [{ ...flagged, location: { ...flagged.location, needsReview: true } }],
    });
    mocks.reviewEventLocation.mockResolvedValue(data);
    mocks.correctLocationPin.mockResolvedValue(data);
    render(
      <EventSellers accessToken={accessToken} event={event} locale="en" onChanged={onChanged} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Confirm separate stop" }));
    await waitFor(() =>
      expect(mocks.reviewEventLocation).toHaveBeenCalledWith("owner", eventId, {
        action: "confirm_separate",
        locationId: "01992026-1103-7000-8000-000000000093",
      }),
    );
    fireEvent.click(screen.getByText("Correct the pin (25 m at most)"));
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "18.0621" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Wrong side" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() =>
      expect(mocks.correctLocationPin).toHaveBeenCalledWith(
        "owner",
        "01992026-1103-7000-8000-000000000093",
        { latitude: 59.331, longitude: 18.0621, reason: "Wrong side" },
      ),
    );
  });

  it("hides admission settings from moderators", async () => {
    mocks.listEventSellers.mockResolvedValue(data);
    render(
      <EventSellers
        accessToken={accessToken}
        event={{ ...(event as object), role: "moderator" } as never}
        locale="en"
        onChanged={onChanged}
      />,
    );
    await screen.findByText("Anna");
    expect(screen.queryByRole("button", { name: "Save admission" })).not.toBeInTheDocument();
  });

  it("has no detectable automated accessibility violations", async () => {
    mocks.listEventSellers.mockResolvedValue(data);
    const { container } = render(
      <EventSellers accessToken={accessToken} event={event} locale="en" onChanged={onChanged} />,
    );
    await screen.findByText("Anna");
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
