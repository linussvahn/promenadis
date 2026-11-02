import { PromenadisApiError } from "@promenadis/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SellerJoinContent } from "./seller-join";

vi.mock("react-map-gl/maplibre", () => ({
  default: () => null,
  Layer: () => null,
  Source: () => null,
}));
const mocks = vi.hoisted(() => ({
  applyToEvent: vi.fn(),
  changeParticipationAddress: vi.fn(),
  geocodeAddress: vi.fn(),
  getEventForSeller: vi.fn(),
  withdrawParticipation: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ getPromenadisApiClient: () => mocks }));
const accountData = vi.hoisted(() => ({
  accessToken: async () => "seller",
  dashboard: { profile: { displayName: "Anna" } },
}));
vi.mock("../lib/use-account-data", () => ({ useAccountData: () => accountData }));

const eventId = "01992026-1103-7000-8000-000000000001";
const participationId = "01992026-1103-7000-8000-000000000002";
const event = {
  admissionMode: "auto_inside",
  boundary: [
    [18.06, 59.33],
    [18.064, 59.33],
    [18.064, 59.333],
    [18.06, 59.33],
  ],
  description: "",
  endsAt: "2031-09-09T13:00:00Z",
  id: eventId,
  organizerDisplayName: "Walkers",
  participation: null,
  placesFull: false,
  registrationClosesAt: "2031-09-09T07:00:00Z",
  registrationOpen: true,
  startsAt: "2031-09-09T08:00:00Z",
  state: "draft",
  timezone: "Europe/Stockholm",
  title: "Spring market",
};
const participation = {
  appliedAt: "2031-08-01T10:00:00Z",
  decisionReason: null,
  displayName: "Anna",
  eventId,
  geographicException: false,
  id: participationId,
  location: {
    addressLine: "Testgatan 1",
    id: "01992026-1103-7000-8000-000000000003",
    insideBoundary: true,
    needsReview: false,
    sellerCount: 1,
    latitude: 59.331,
    locality: null,
    longitude: 18.062,
    placement: "manual",
    postalCode: "113 45",
  },
  state: "approved",
  version: 1,
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/events/${eventId}/join`]}>
      <Routes>
        <Route element={<SellerJoinContent locale="en" />} path="/events/:eventId/join" />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SellerJoin", () => {
  it("applies with an address, a typed pin and the attestation", async () => {
    mocks.getEventForSeller
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ ...event, participation });
    mocks.applyToEvent.mockResolvedValue(participation);
    renderPage();
    fireEvent.change(await screen.findByLabelText("Address"), {
      target: { value: "Testgatan 1" },
    });
    fireEvent.change(screen.getByLabelText("Postal code (optional)"), {
      target: { value: "113 45" },
    });
    fireEvent.change(await screen.findByLabelText("Latitude"), { target: { value: "59.331" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "18.062" } });
    fireEvent.click(screen.getByLabelText(/I have the right to use/u));
    fireEvent.click(screen.getByRole("button", { name: "Send application" }));
    await waitFor(() =>
      expect(mocks.applyToEvent).toHaveBeenCalledWith("seller", eventId, {
        addressLine: "Testgatan 1",
        displayName: "Anna",
        latitude: 59.331,
        locality: "",
        longitude: 18.062,
        placement: "manual",
        postalCode: "113 45",
        rightToUseAttested: true,
        sharesEntrance: null,
      }),
    );
    expect(await screen.findByText("You have a seller place at the event.")).toBeVisible();
  });

  it("uses the geocoded point and answers the shared-entrance question", async () => {
    mocks.getEventForSeller
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce({ ...event, participation });
    mocks.geocodeAddress.mockResolvedValue({ found: true, latitude: 59.331, longitude: 18.0606 });
    mocks.applyToEvent
      .mockRejectedValueOnce(
        new PromenadisApiError("shared", 409, "shared_entrance_question", null),
      )
      .mockResolvedValueOnce(participation);
    renderPage();
    fireEvent.change(await screen.findByLabelText("Address"), {
      target: { value: "Testgatan 1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find the address on the map" }));
    expect(await screen.findByText(/pin is placed from the address/u)).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText("Latitude")).toHaveValue("59.331"));
    fireEvent.click(screen.getByLabelText(/I have the right to use/u));
    fireEvent.click(screen.getByRole("button", { name: "Send application" }));
    fireEvent.click(await screen.findByLabelText(/Yes, the same entrance/u));
    fireEvent.click(screen.getByRole("button", { name: "Send application" }));
    await waitFor(() => expect(mocks.applyToEvent).toHaveBeenCalledTimes(2));
    expect(mocks.applyToEvent.mock.calls[1]?.[2]).toMatchObject({
      longitude: 18.0606,
      placement: "geocoded",
      sharesEntrance: true,
    });
    expect(mocks.geocodeAddress).toHaveBeenCalledWith("seller", eventId, {
      addressLine: "Testgatan 1",
      locality: "",
      postalCode: "",
    });
  });

  it("changes an approved seller's address", async () => {
    mocks.getEventForSeller.mockResolvedValue({ ...event, participation });
    mocks.changeParticipationAddress.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByText("Change address"));
    expect(screen.getByText(/organizer must approve the new address/u)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "Provgatan 9" } });
    fireEvent.click(screen.getByLabelText(/I have the right to use/u));
    fireEvent.click(screen.getByRole("button", { name: "Save new address" }));
    await waitFor(() =>
      expect(mocks.changeParticipationAddress).toHaveBeenCalledWith(
        "seller",
        participationId,
        expect.objectContaining({ addressLine: "Provgatan 9", expectedVersion: 1 }),
      ),
    );
  });

  it("withdraws an application", async () => {
    mocks.getEventForSeller
      .mockResolvedValueOnce({ ...event, participation })
      .mockResolvedValueOnce({
        ...event,
        participation: { ...participation, location: null, state: "withdrawn", version: 2 },
      });
    mocks.withdrawParticipation.mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw application" }));
    expect(await screen.findByText(/application is withdrawn/u)).toBeVisible();
    expect(mocks.withdrawParticipation).toHaveBeenCalledWith("seller", participationId, 1);
  });

  it("explains closed and invite-only registration", async () => {
    mocks.getEventForSeller.mockResolvedValue({
      ...event,
      admissionMode: "invite_only",
      registrationOpen: false,
    });
    renderPage();
    expect(await screen.findByText("This event only takes invited sellers.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Send application" })).not.toBeInTheDocument();
  });

  it("has no detectable automated accessibility violations", async () => {
    mocks.getEventForSeller.mockResolvedValue(event);
    const { container } = renderPage();
    await screen.findByLabelText("Address");
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
