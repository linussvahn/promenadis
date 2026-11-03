import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test/render";
import { IncomingTeamInvites } from "./incoming-team-invites";

const mocks = vi.hoisted(() => ({
  acceptEventTeamInvite: vi.fn().mockResolvedValue({}),
  getIncomingEventTeamInvites: vi.fn().mockResolvedValue([
    {
      eventId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
      eventTitle: "Neighbourhood walk",
      expiresAt: "2030-09-15T10:00:00.000Z",
      id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f607",
      organizerDisplayName: "Test Organizer",
      role: "co_host",
    },
  ]),
  getSession: vi.fn().mockResolvedValue({
    data: { session: { user: { id: "synthetic-session", email: "fixture@example.invalid" } } },
  }),
  onAccepted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => ({
    acceptEventTeamInvite: mocks.acceptEventTeamInvite,
    getIncomingEventTeamInvites: mocks.getIncomingEventTeamInvites,
  }),
  getBrowserAuthClient: () => ({ auth: { getSession: mocks.getSession } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IncomingTeamInvites", () => {
  it("accepts an invitation using an event-facing display name", async () => {
    await renderWithRouter(
      <IncomingTeamInvites displayName="Test Person" locale="en" onAccepted={mocks.onAccepted} />,
    );
    await screen.findByText("Neighbourhood walk");

    fireEvent.change(screen.getByLabelText("Your name in the event team"), {
      target: { value: "Neighbour Helper" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));

    await waitFor(() =>
      expect(mocks.acceptEventTeamInvite).toHaveBeenCalledWith(
        "synthetic-session",
        "01991dd3-a7c7-7ea2-aee5-43ec2cb5f607",
        { displayName: "Neighbour Helper" },
      ),
    );
    expect(mocks.onAccepted).toHaveBeenCalledOnce();
  });
});
