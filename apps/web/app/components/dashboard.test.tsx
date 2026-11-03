import { cleanup, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test/render";
import { Dashboard } from "./dashboard";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn().mockResolvedValue({
    events: [],
    organizers: [],
    profile: {
      accountId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
      displayName: null,
      preferredLocale: "sv",
    },
    schemaVersion: "1.0",
  }),
  getSession: vi.fn().mockResolvedValue({
    data: { session: { user: { id: "synthetic-session", email: "fixture@example.invalid" } } },
  }),
  getIncomingEventTeamInvites: vi.fn().mockResolvedValue([]),
  getIncomingOrganizerInvites: vi.fn().mockResolvedValue([]),
  signOut: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => ({
    getDashboard: mocks.getDashboard,
    getIncomingEventTeamInvites: mocks.getIncomingEventTeamInvites,
    getIncomingOrganizerInvites: mocks.getIncomingOrganizerInvites,
  }),
  getBrowserAuthClient: () => ({
    auth: { getSession: mocks.getSession, signOut: mocks.signOut },
  }),
  hasLocalBackendConfiguration: () => true,
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("Dashboard", () => {
  it("keeps the empty dashboard focused on creating an event", async () => {
    await renderWithRouter(<Dashboard />, { path: "/dashboard" });

    expect(
      await screen.findByRole("heading", { name: "Mina evenemang", level: 1 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Ditt första evenemang börjar här" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skapa mitt första evenemang" })).toHaveAttribute(
      "href",
      "/events/new",
    );
    expect(screen.queryByRole("heading", { name: "Din profil" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Evenemangsområde" })).not.toBeInTheDocument();
    expect(mocks.getDashboard).toHaveBeenCalledWith("synthetic-session");
  });

  it("renders an existing event as a concise setup card", async () => {
    mocks.getDashboard.mockResolvedValueOnce({
      events: [
        {
          boundary: null,
          description: "",
          id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f607",
          intervals: [
            {
              endsAt: "2026-09-10T13:00:00.000Z",
              id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f608",
              startsAt: "2026-09-10T08:00:00.000Z",
            },
          ],
          organizerDisplayName: "Testperson",
          organizerProfileId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f609",
          registration: null,
          role: "owner",
          state: "draft",
          timezone: "Europe/Stockholm",
          title: "Syntetisk promenad",
          version: 1,
          visibility: "public",
        },
      ],
      organizers: [],
      profile: {
        accountId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
        displayName: "Testperson",
        preferredLocale: "sv",
      },
      schemaVersion: "1.0",
    });

    await renderWithRouter(<Dashboard />, { path: "/dashboard" });

    expect(await screen.findByRole("heading", { name: "Syntetisk promenad" })).toBeInTheDocument();
    expect(screen.getByText("Område saknas")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fortsätt konfigurera" })).toHaveAttribute(
      "href",
      "/events/01991dd3-a7c7-7ea2-aee5-43ec2cb5f607",
    );
  });

  it("has no detectable automated accessibility violations after loading", async () => {
    const { container } = await renderWithRouter(<Dashboard />, { path: "/dashboard" });
    await screen.findByRole("heading", { name: "Mina evenemang", level: 1 });
    await waitFor(() => expect(screen.getByRole("button", { name: /English/u })).toBeEnabled());

    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
