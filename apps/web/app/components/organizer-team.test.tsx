import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test/render";
import { OrganizerTeam } from "./organizer-team";

const organizerProfileId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f611";
const ownerMembershipId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f612";
const managerMembershipId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f613";
const initialTeam = {
  currentMembershipId: ownerMembershipId,
  members: [{ displayName: "Organizer Owner", id: ownerMembershipId, role: "owner" as const }],
  organizerProfileId,
  pendingInvites: [],
  teamVersion: 1,
};

const mocks = vi.hoisted(() => ({
  cancelOrganizerManagerInvite: vi.fn(),
  getOrganizerTeam: vi.fn(),
  getSession: vi.fn().mockResolvedValue({
    data: { session: { user: { id: "synthetic-session", email: "fixture@example.invalid" } } },
  }),
  inviteOrganizerManager: vi.fn(),
  removeOrganizerManager: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => ({
    cancelOrganizerManagerInvite: mocks.cancelOrganizerManagerInvite,
    getOrganizerTeam: mocks.getOrganizerTeam,
    inviteOrganizerManager: mocks.inviteOrganizerManager,
    removeOrganizerManager: mocks.removeOrganizerManager,
  }),
  getBrowserAuthClient: () => ({ auth: { getSession: mocks.getSession } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrganizerTeam", () => {
  it("lets only the owner create a short-lived manager invitation", async () => {
    mocks.getOrganizerTeam.mockResolvedValue(initialTeam);
    mocks.inviteOrganizerManager.mockResolvedValue({
      ...initialTeam,
      pendingInvites: [
        {
          email: "manager@example.invalid",
          expiresAt: "2030-09-15T10:00:00.000Z",
          id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f614",
        },
      ],
      teamVersion: 2,
    });

    await renderWithRouter(
      <OrganizerTeam locale="en" organizerProfileId={organizerProfileId} owner />,
    );
    await screen.findByText("Organizer Owner");
    fireEvent.change(screen.getByLabelText("Invite a manager by email"), {
      target: { value: "manager@example.invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create manager invitation" }));

    await waitFor(() =>
      expect(mocks.inviteOrganizerManager).toHaveBeenCalledWith(
        "synthetic-session",
        organizerProfileId,
        { email: "manager@example.invalid", expectedTeamVersion: 1 },
      ),
    );
    expect(await screen.findByText("manager@example.invalid")).toBeInTheDocument();
  });

  it("requires confirmation before removing a manager", async () => {
    const teamWithManager = {
      ...initialTeam,
      members: [
        initialTeam.members[0],
        { displayName: "Organizer Manager", id: managerMembershipId, role: "manager" as const },
      ],
      teamVersion: 4,
    };
    mocks.getOrganizerTeam.mockResolvedValue(teamWithManager);
    mocks.removeOrganizerManager.mockResolvedValue(initialTeam);

    await renderWithRouter(
      <OrganizerTeam locale="en" organizerProfileId={organizerProfileId} owner />,
    );
    await screen.findByText("Organizer Manager");
    fireEvent.click(screen.getByRole("button", { name: "Remove manager" }));
    expect(mocks.removeOrganizerManager).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));

    await waitFor(() =>
      expect(mocks.removeOrganizerManager).toHaveBeenCalledWith(
        "synthetic-session",
        organizerProfileId,
        managerMembershipId,
        { expectedTeamVersion: 4 },
      ),
    );
  });

  it("has no detectable automated accessibility violations", async () => {
    mocks.getOrganizerTeam.mockResolvedValue(initialTeam);
    const { container } = await renderWithRouter(
      <OrganizerTeam locale="en" organizerProfileId={organizerProfileId} owner />,
    );
    await screen.findByText("Organizer Owner");
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
