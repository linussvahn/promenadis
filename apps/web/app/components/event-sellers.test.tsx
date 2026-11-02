import { PromenadisApiError } from "@promenadis/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventSellers } from "./event-sellers";

const mocks = vi.hoisted(() => ({
  decideSeller: vi.fn(),
  listEventSellers: vi.fn(),
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
    insideBoundary: state !== "pending",
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
