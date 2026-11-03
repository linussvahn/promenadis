import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test/render";
import { PublicationReadiness } from "./publication-readiness";

const event = {
  boundary: {
    areaSquareKilometers: 0.2,
    displayLabel: "Synthetic area",
    ring: [
      [18, 59],
      [18.01, 59],
      [18.01, 59.01],
      [18, 59],
    ] as [number, number][],
    spanKilometers: 1,
    version: 2,
    warnings: [] as ("area_near_limit" | "span_near_limit")[],
  },
  description: "",
  id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
  intervals: [],
  organizerDisplayName: "Testperson",
  organizerProfileId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f607",
  registration: {
    allowDuringEvent: false,
    closesAt: "2030-09-09T09:00:00.000Z",
    opensAt: "2030-09-01T09:00:00.000Z",
    version: 3,
  },
  role: "owner" as const,
  state: "draft" as const,
  timezone: "Europe/Stockholm",
  title: "Synthetic event",
  version: 4,
  visibility: "unlisted" as const,
};

const mocks = vi.hoisted(() => ({
  attestEventPublication: vi.fn(),
  getEventPublicationReadiness: vi.fn(),
  getSession: vi.fn().mockResolvedValue({
    data: { session: { user: { id: "synthetic-session", email: "fixture@example.invalid" } } },
  }),
}));

vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => ({
    attestEventPublication: mocks.attestEventPublication,
    getEventPublicationReadiness: mocks.getEventPublicationReadiness,
  }),
  getBrowserAuthClient: () => ({ auth: { getSession: mocks.getSession } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PublicationReadiness", () => {
  it("keeps publication blocked and lets the owner attest the current versions", async () => {
    const initial = {
      blockers: [
        "publication_attestation_missing" as const,
        "first_event_review_pending" as const,
        "routing_not_ready" as const,
        "public_delivery_not_ready" as const,
      ],
      eventId: event.id,
      eventVersion: event.version,
      readyToPublish: false,
      recommendations: ["totp_recommended" as const],
    };
    mocks.getEventPublicationReadiness.mockResolvedValue(initial);
    mocks.attestEventPublication.mockResolvedValue({
      ...initial,
      blockers: initial.blockers.filter((blocker) => blocker !== "publication_attestation_missing"),
    });

    await renderWithRouter(<PublicationReadiness event={event} locale="en" />, {
      path: "/events/$eventId",
      url: `/events/${event.id}`,
    });
    await screen.findByText("The safe public-delivery pipeline is not built yet.");
    fireEvent.click(screen.getByLabelText(/responsible for ensuring the event/u));
    fireEvent.click(screen.getByLabelText(/unlisted event is not private/u));
    fireEvent.click(screen.getByRole("button", { name: "Save confirmation" }));

    await waitFor(() =>
      expect(mocks.attestEventPublication).toHaveBeenCalledWith("synthetic-session", event.id, {
        expectedBoundaryVersion: 2,
        expectedEventVersion: 4,
        expectedRegistrationVersion: 3,
        locationAuthorityConfirmed: true,
        visibilityUnderstood: true,
      }),
    );
    expect(await screen.findByText(/matches the current configuration/u)).toBeInTheDocument();
  });
});
