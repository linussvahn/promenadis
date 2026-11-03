import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountKey } from "../lib/use-account-data";
import { renderWithRouter } from "../test/render";
import { EventPublicLink } from "./event-public-link";

const mocks = vi.hoisted(() => ({ getEventPublicLink: vi.fn(), rotateUnlistedLink: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  getBrowserAuthClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: "owner" } } } }) },
  }),
  getPromenadisApiClient: () => mocks,
}));
vi.mock("../lib/account-session", () => ({ useExpectedAccountId: () => "owner" }));

const eventId = "01992026-1104-7100-8000-000000000001";
const link = (overrides: object = {}) => ({
  eventId,
  live: true,
  publicKey: "c".repeat(32),
  state: "published",
  version: 3,
  visibility: "unlisted",
  ...overrides,
});
const event = (role: string) => ({ id: eventId, role, version: 3 }) as never;
const render = (ui: ReactNode) =>
  renderWithRouter(ui, { path: "/events/$eventId", url: `/events/${eventId}` });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventPublicLink", () => {
  it("shows the unlisted link with its sharing warning and lets the owner replace it", async () => {
    mocks.getEventPublicLink.mockResolvedValue(link());
    mocks.rotateUnlistedLink.mockResolvedValue(link({ publicKey: "d".repeat(32), version: 4 }));
    const { queryClient } = await render(<EventPublicLink event={event("owner")} locale="en" />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    expect(await screen.findByText(`${window.location.origin}/u/${"c".repeat(32)}`)).toBeVisible();
    expect(screen.getByText(/may let that service fetch the title/u)).toBeVisible();
    expect(screen.queryByLabelText(/Safety reason/u)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Replace link" }));
    await waitFor(() =>
      expect(mocks.rotateUnlistedLink).toHaveBeenCalledWith("owner", eventId, {
        expectedEventVersion: 3,
      }),
    );
    expect(await screen.findByText(`${window.location.origin}/u/${"d".repeat(32)}`)).toBeVisible();
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: accountKey("owner", "dashboard") }),
    );
  });

  it("asks for a safety reason during a live event", async () => {
    mocks.getEventPublicLink.mockResolvedValue(link({ state: "active" }));
    await render(<EventPublicLink event={event("owner")} locale="en" />);
    expect(await screen.findByLabelText(/Safety reason/u)).toBeRequired();
  });

  it("offers no replacement to co-hosts or for public links", async () => {
    mocks.getEventPublicLink.mockResolvedValue(link({ visibility: "public" }));
    await render(<EventPublicLink event={event("owner")} locale="en" />);
    expect(await screen.findByText(`${window.location.origin}/e/${"c".repeat(32)}`)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Replace link" })).toBeNull();
    cleanup();
    mocks.getEventPublicLink.mockResolvedValue(link());
    await render(<EventPublicLink event={event("co_host")} locale="en" />);
    await screen.findByText(/\/u\//u);
    expect(screen.queryByRole("button", { name: "Replace link" })).toBeNull();
  });
});
