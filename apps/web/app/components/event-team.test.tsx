import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test/render";
import { EventTeam } from "./event-team";

const eventId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606";
const render = (ui: ReactNode) =>
  renderWithRouter(ui, { path: "/events/$eventId", url: `/events/${eventId}` });
const ownerMembershipId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f607";
const initialTeam = {
  eventId,
  members: [
    {
      displayName: "Test Owner",
      id: ownerMembershipId,
      role: "owner" as const,
    },
  ],
  pendingInvites: [],
  teamVersion: 1,
};

const mocks = vi.hoisted(() => ({
  acceptEventOwnershipTransfer: vi.fn(),
  cancelEventTeamInvite: vi.fn(),
  cancelEventOwnershipTransfer: vi.fn(),
  cancelEmergencySuccessorClaim: vi.fn(),
  clearEventEmergencySuccessor: vi.fn(),
  completeEmergencySuccessorClaim: vi.fn(),
  getEventTeam: vi.fn(),
  getSession: vi.fn().mockResolvedValue({
    data: { session: { user: { id: "synthetic-session", email: "fixture@example.invalid" } } },
  }),
  inviteEventTeamMember: vi.fn(),
  initiateEmergencySuccessorClaim: vi.fn(),
  initiateEventOwnershipTransfer: vi.fn(),
  removeEventTeamMember: vi.fn(),
  setEventEmergencySuccessor: vi.fn(),
  updateEventTeamMemberRole: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => ({
    acceptEventOwnershipTransfer: mocks.acceptEventOwnershipTransfer,
    cancelEventTeamInvite: mocks.cancelEventTeamInvite,
    cancelEventOwnershipTransfer: mocks.cancelEventOwnershipTransfer,
    cancelEmergencySuccessorClaim: mocks.cancelEmergencySuccessorClaim,
    clearEventEmergencySuccessor: mocks.clearEventEmergencySuccessor,
    completeEmergencySuccessorClaim: mocks.completeEmergencySuccessorClaim,
    getEventTeam: mocks.getEventTeam,
    inviteEventTeamMember: mocks.inviteEventTeamMember,
    initiateEmergencySuccessorClaim: mocks.initiateEmergencySuccessorClaim,
    initiateEventOwnershipTransfer: mocks.initiateEventOwnershipTransfer,
    removeEventTeamMember: mocks.removeEventTeamMember,
    setEventEmergencySuccessor: mocks.setEventEmergencySuccessor,
    updateEventTeamMemberRole: mocks.updateEventTeamMemberRole,
  }),
  getBrowserAuthClient: () => ({ auth: { getSession: mocks.getSession } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventTeam", () => {
  it("lets the owner create a time-limited role invitation", async () => {
    mocks.getEventTeam.mockResolvedValue(initialTeam);
    mocks.inviteEventTeamMember.mockResolvedValue({
      ...initialTeam,
      pendingInvites: [
        {
          email: "helper@example.invalid",
          expiresAt: "2030-09-15T10:00:00.000Z",
          id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f608",
          role: "moderator",
        },
      ],
      teamVersion: 2,
    });

    await render(<EventTeam actorRole="owner" eventId={eventId} locale="en" />);
    await screen.findByText("Test Owner");

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "helper@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "moderator" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));

    await waitFor(() =>
      expect(mocks.inviteEventTeamMember).toHaveBeenCalledWith("synthetic-session", eventId, {
        email: "helper@example.invalid",
        expectedTeamVersion: 1,
        role: "moderator",
      }),
    );
    expect(await screen.findByText("helper@example.invalid")).toBeInTheDocument();
  });

  it("shows members without owner controls to a co-host", async () => {
    mocks.getEventTeam.mockResolvedValue({
      ...initialTeam,
      members: [
        ...initialTeam.members,
        {
          displayName: "Helpful Co-host",
          id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f609",
          role: "co_host",
        },
      ],
    });

    await render(<EventTeam actorRole="co_host" eventId={eventId} locale="en" />);
    expect(await screen.findByText("Helpful Co-host")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Invite someone" })).not.toBeInTheDocument();
    expect(screen.queryByText("Manage member")).not.toBeInTheDocument();
  });

  it("requires an explicit second step before removing a member", async () => {
    const teamWithMember = {
      ...initialTeam,
      members: [
        ...initialTeam.members,
        {
          displayName: "Helpful Co-host",
          id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f609",
          role: "co_host" as const,
        },
      ],
      teamVersion: 3,
    };
    mocks.getEventTeam.mockResolvedValue(teamWithMember);
    mocks.removeEventTeamMember.mockResolvedValue(initialTeam);

    await render(<EventTeam actorRole="owner" eventId={eventId} locale="en" />);
    await screen.findByText("Helpful Co-host");
    fireEvent.click(screen.getByText("Manage member"));
    fireEvent.click(screen.getByRole("button", { name: "Remove from team" }));
    expect(mocks.removeEventTeamMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));

    await waitFor(() =>
      expect(mocks.removeEventTeamMember).toHaveBeenCalledWith(
        "synthetic-session",
        eventId,
        "01991dd3-a7c7-7ea2-aee5-43ec2cb5f609",
        { expectedTeamVersion: 3 },
      ),
    );
  });

  it("requires review before the owner initiates a compatible transfer", async () => {
    const recipientId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f609";
    const targetOrganizerId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f611";
    const transferableTeam = {
      ...initialTeam,
      currentMembershipId: ownerMembershipId,
      members: [
        initialTeam.members[0],
        {
          canReceiveOwnership: true,
          displayName: "Helpful Co-host",
          id: recipientId,
          role: "co_host" as const,
        },
      ],
      ownershipTransferOptions: [
        {
          organizerDisplayName: "Helpful Co-host",
          organizerProfileId: targetOrganizerId,
          organizerWillChange: true,
          recipientDisplayName: "Helpful Co-host",
          toMembershipId: recipientId,
        },
      ],
      pendingTransfer: null,
    };
    mocks.getEventTeam.mockResolvedValue(transferableTeam);
    mocks.initiateEventOwnershipTransfer.mockResolvedValue({
      ...transferableTeam,
      pendingTransfer: {
        expiresAt: "2030-09-15T10:00:00.000Z",
        id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f610",
        organizerWillChange: true,
        targetOrganizerDisplayName: "Helpful Co-host",
        toDisplayName: "Helpful Co-host",
        toMembershipId: recipientId,
      },
      teamVersion: 2,
    });

    await render(<EventTeam actorRole="owner" eventId={eventId} locale="en" />);
    await screen.findByRole("heading", { name: "Transfer ownership" });
    fireEvent.click(screen.getByRole("button", { name: "Review transfer" }));
    expect(mocks.initiateEventOwnershipTransfer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start transfer" }));

    await waitFor(() =>
      expect(mocks.initiateEventOwnershipTransfer).toHaveBeenCalledWith(
        "synthetic-session",
        eventId,
        {
          expectedTeamVersion: 1,
          targetOrganizerProfileId: targetOrganizerId,
          toMembershipId: recipientId,
        },
      ),
    );
    expect(await screen.findByText("Waiting for Helpful Co-host to accept.")).toBeInTheDocument();
    expect(screen.getByText("The event will be organized as Helpful Co-host.")).toBeInTheDocument();
  });

  it("lets the owner designate an eligible co-host as emergency successor", async () => {
    const successorMembershipId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f609";
    const organizerProfileId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f611";
    const teamWithSuccessorOption = {
      ...initialTeam,
      currentMembershipId: ownerMembershipId,
      members: [
        initialTeam.members[0],
        { displayName: "Helpful Co-host", id: successorMembershipId, role: "co_host" as const },
      ],
      successorOptions: [
        {
          organizerDisplayName: "Helpful Co-host",
          organizerProfileId,
          recipientDisplayName: "Helpful Co-host",
          successorMembershipId,
        },
      ],
    };
    mocks.getEventTeam.mockResolvedValue(teamWithSuccessorOption);
    mocks.setEventEmergencySuccessor.mockResolvedValue({
      ...teamWithSuccessorOption,
      emergencySuccessor: {
        designatedAt: "2030-09-09T10:00:00.000Z",
        organizerDisplayName: "Helpful Co-host",
        recipientDisplayName: "Helpful Co-host",
        successorMembershipId,
        targetOrganizerProfileId: organizerProfileId,
      },
      teamVersion: 2,
    });

    await render(<EventTeam actorRole="owner" eventId={eventId} locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "Designate successor" }));

    await waitFor(() =>
      expect(mocks.setEventEmergencySuccessor).toHaveBeenCalledWith("synthetic-session", eventId, {
        expectedTeamVersion: 1,
        successorMembershipId,
        targetOrganizerProfileId: organizerProfileId,
      }),
    );
    expect(await screen.findByText(/Helpful Co-host is designated/u)).toBeInTheDocument();
  });

  it("lets only the intended current membership accept a pending transfer", async () => {
    const ownerId = ownerMembershipId;
    const recipientId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f609";
    const transferId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f610";
    const recipientTeam = {
      ...initialTeam,
      currentMembershipId: recipientId,
      members: [
        initialTeam.members[0],
        { displayName: "Helpful Co-host", id: recipientId, role: "co_host" as const },
      ],
      pendingTransfer: {
        expiresAt: "2030-09-15T10:00:00.000Z",
        id: transferId,
        organizerWillChange: true,
        targetOrganizerDisplayName: "Helpful Co-host",
        toDisplayName: "Helpful Co-host",
        toMembershipId: recipientId,
      },
      teamVersion: 2,
    };
    mocks.getEventTeam.mockResolvedValue(recipientTeam);
    mocks.acceptEventOwnershipTransfer.mockResolvedValue({
      ...recipientTeam,
      members: [
        { ...initialTeam.members[0], role: "co_host" as const },
        { displayName: "Helpful Co-host", id: recipientId, role: "owner" as const },
      ],
      pendingTransfer: null,
      teamVersion: 3,
    });

    await render(<EventTeam actorRole="co_host" eventId={eventId} locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept and become owner" }));

    await waitFor(() =>
      expect(mocks.acceptEventOwnershipTransfer).toHaveBeenCalledWith(
        "synthetic-session",
        eventId,
        transferId,
        { expectedTeamVersion: 2 },
      ),
    );
    expect(await screen.findByText("You are now the event owner.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Invite someone" })).toBeInTheDocument();
    expect(ownerId).not.toBe(recipientId);
  });

  it("requires explicit review before the designated successor starts the 24-hour claim", async () => {
    const successorMembershipId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f609";
    const claimId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f610";
    const successorTeam = {
      ...initialTeam,
      currentMembershipId: successorMembershipId,
      emergencySuccessor: {
        designatedAt: "2030-09-09T10:00:00.000Z",
        organizerDisplayName: "Successor organizer",
        recipientDisplayName: "Helpful Co-host",
        successorMembershipId,
        targetOrganizerProfileId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f611",
      },
      members: [
        initialTeam.members[0],
        { displayName: "Helpful Co-host", id: successorMembershipId, role: "co_host" as const },
      ],
      pendingEmergencyClaim: null,
      teamVersion: 2,
    };
    mocks.getEventTeam.mockResolvedValue(successorTeam);
    mocks.initiateEmergencySuccessorClaim.mockResolvedValue({
      ...successorTeam,
      pendingEmergencyClaim: {
        expiresAt: "2030-09-16T10:00:00.000Z",
        id: claimId,
        initiatedAt: "2030-09-09T10:00:00.000Z",
        readyAt: "2030-09-10T10:00:00.000Z",
        successorDisplayName: "Helpful Co-host",
        successorMembershipId,
        targetOrganizerDisplayName: "Successor organizer",
      },
      teamVersion: 3,
    });

    await render(<EventTeam actorRole="co_host" eventId={eventId} locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "Review emergency transfer" }));
    expect(mocks.initiateEmergencySuccessorClaim).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start 24-hour waiting period" }));

    await waitFor(() =>
      expect(mocks.initiateEmergencySuccessorClaim).toHaveBeenCalledWith(
        "synthetic-session",
        eventId,
        { expectedTeamVersion: 2 },
      ),
    );
    expect(await screen.findByText(/requested ownership/u)).toBeInTheDocument();
  });

  it("lets the successor complete a mature claim and lets the owner cancel one", async () => {
    const successorMembershipId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f609";
    const claimId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f610";
    const pendingClaim = {
      expiresAt: "2030-09-16T10:00:00.000Z",
      id: claimId,
      initiatedAt: "2020-09-09T10:00:00.000Z",
      readyAt: "2020-09-10T10:00:00.000Z",
      successorDisplayName: "Helpful Co-host",
      successorMembershipId,
      targetOrganizerDisplayName: "Successor organizer",
    };
    const claimantTeam = {
      ...initialTeam,
      currentMembershipId: successorMembershipId,
      members: [
        initialTeam.members[0],
        { displayName: "Helpful Co-host", id: successorMembershipId, role: "co_host" as const },
      ],
      pendingEmergencyClaim: pendingClaim,
      teamVersion: 3,
    };
    mocks.getEventTeam.mockResolvedValueOnce(claimantTeam);
    mocks.completeEmergencySuccessorClaim.mockResolvedValue({
      ...claimantTeam,
      members: [
        { ...initialTeam.members[0], role: "co_host" as const },
        { displayName: "Helpful Co-host", id: successorMembershipId, role: "owner" as const },
      ],
      pendingEmergencyClaim: null,
      teamVersion: 4,
    });

    const { unmount } = await render(
      <EventTeam actorRole="co_host" eventId={eventId} locale="en" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Complete and take ownership" }));
    await waitFor(() =>
      expect(mocks.completeEmergencySuccessorClaim).toHaveBeenCalledWith(
        "synthetic-session",
        eventId,
        claimId,
        { expectedTeamVersion: 3 },
      ),
    );
    unmount();

    const ownerTeam = {
      ...claimantTeam,
      currentMembershipId: ownerMembershipId,
    };
    mocks.getEventTeam.mockResolvedValueOnce(ownerTeam);
    mocks.cancelEmergencySuccessorClaim.mockResolvedValue({
      ...ownerTeam,
      pendingEmergencyClaim: null,
      teamVersion: 4,
    });
    await render(<EventTeam actorRole="owner" eventId={eventId} locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel emergency transfer" }));
    await waitFor(() =>
      expect(mocks.cancelEmergencySuccessorClaim).toHaveBeenCalledWith(
        "synthetic-session",
        eventId,
        claimId,
        { expectedTeamVersion: 3 },
      ),
    );
  });

  it("has no detectable automated accessibility violations", async () => {
    mocks.getEventTeam.mockResolvedValue(initialTeam);
    const { container } = await render(
      <EventTeam actorRole="owner" eventId={eventId} locale="en" />,
    );
    await screen.findByText("Test Owner");
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
