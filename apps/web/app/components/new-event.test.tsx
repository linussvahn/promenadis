import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewEvent } from "./new-event";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn().mockResolvedValue({
    events: [],
    organizers: [],
    profile: {
      accountId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
      displayName: "Testperson",
      preferredLocale: "sv",
    },
    schemaVersion: "1.0",
  }),
  getSession: vi.fn().mockResolvedValue({
    data: { session: { user: { id: "synthetic-session", email: "fixture@example.invalid" } } },
  }),
  signOut: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => ({
    createDraftEvent: vi.fn(),
    getDashboard: mocks.getDashboard,
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

describe("NewEvent", () => {
  it("lets a person start an event without creating an organizer first", async () => {
    render(
      <MemoryRouter>
        <NewEvent />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Arrangeras av dig")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Namn som visas offentligt" })).toBeRequired();
    expect(screen.queryByRole("combobox", { name: "Arrangeras som" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fortsätt till området" })).toBeEnabled();
  });

  it("shows the organizer selector only when several profiles are usable", async () => {
    mocks.getDashboard.mockResolvedValueOnce({
      events: [],
      organizers: [
        {
          displayName: "Linus Test",
          id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f607",
          locality: null,
          organizerType: "individual",
          role: "owner",
          website: null,
        },
        {
          displayName: "Testföreningen",
          id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f608",
          locality: "Stockholm",
          organizerType: "association",
          role: "owner",
          website: null,
        },
      ],
      profile: {
        accountId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
        displayName: "Linus Test",
        preferredLocale: "sv",
      },
      schemaVersion: "1.0",
    });

    render(
      <MemoryRouter>
        <NewEvent />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("combobox", { name: "Arrangeras som" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Namn som visas offentligt" })).toBeNull();
  });
});
