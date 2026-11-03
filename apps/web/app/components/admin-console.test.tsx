import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test/render";
import { AdminContent } from "./admin-console";

const mocks = vi.hoisted(() => ({
  decideFirstEventReview: vi.fn(),
  endAdminElevation: vi.fn(),
  getAdminStatus: vi.fn(),
  decideOrganizerVerification: vi.fn(),
  listFirstEventReviews: vi.fn(),
  listOrganizerVerifications: vi.fn(),
  startAdminElevation: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ getPromenadisApiClient: () => mocks }));
const accountData = vi.hoisted(() => ({ accessToken: async () => "admin" }));
vi.mock("../lib/use-account-data", async (original) => ({
  ...(await original<typeof import("../lib/use-account-data")>()),
  useAccountData: () => accountData,
}));

const eventId = "01992026-1101-7600-8000-000000000001";
const item = {
  current: true,
  description: "A walk",
  eventId,
  eventVersion: 3,
  organizerName: "Owner",
  organizerType: "individual",
  ownEvent: false,
  requestedAt: "2031-09-01T10:00:00Z",
  title: "Spring walk",
  visibility: "unlisted",
};
const elevated = { elevated: true, eligible: true, expiresAt: "2031-09-01T10:15:00Z" };

beforeEach(() => {
  mocks.listOrganizerVerifications.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminContent", () => {
  it("needs a fresh code before showing the review queue", async () => {
    mocks.getAdminStatus
      .mockResolvedValueOnce({ elevated: false, eligible: true, expiresAt: null })
      .mockResolvedValueOnce(elevated);
    mocks.listFirstEventReviews.mockResolvedValue([item]);
    mocks.startAdminElevation.mockResolvedValue(elevated);
    await renderWithRouter(<AdminContent locale="en" />, { path: "/admin" });
    expect(screen.queryByText("Spring walk")).not.toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("Six-digit code from the app"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enter admin mode" }));
    expect(await screen.findByText("Admin mode is active.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Exit admin mode" })).toBeVisible();
    expect(await screen.findByText("Spring walk")).toBeVisible();
    expect(mocks.startAdminElevation).toHaveBeenCalledWith("admin", "123456");
  });

  it("rejects with a reason using the reviewed event version", async () => {
    mocks.getAdminStatus.mockResolvedValue(elevated);
    mocks.listFirstEventReviews.mockResolvedValueOnce([item]).mockResolvedValueOnce([]);
    mocks.decideFirstEventReview.mockResolvedValue(elevated);
    await renderWithRouter(<AdminContent locale="en" />, { path: "/admin" });
    fireEvent.change(await screen.findByLabelText("Reason (shown to the owner if rejected)"), {
      target: { value: "Boundary covers a closed park" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(mocks.decideFirstEventReview).toHaveBeenCalledWith("admin", eventId, {
        decision: "rejected",
        expectedEventVersion: 3,
        reason: "Boundary covers a closed park",
      }),
    );
    expect(await screen.findByText("The event was rejected.")).toBeVisible();
  });

  it("never offers a decision on the admin's own event", async () => {
    mocks.getAdminStatus.mockResolvedValue(elevated);
    mocks.listFirstEventReviews.mockResolvedValue([{ ...item, ownEvent: true }]);
    await renderWithRouter(<AdminContent locale="en" />, { path: "/admin" });
    await screen.findByText("You cannot review an event whose team you belong to.");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("verifies an organization only with registry and control confirmations", async () => {
    const organizerProfileId = "01992026-1102-7100-8000-000000000011";
    mocks.getAdminStatus.mockResolvedValue(elevated);
    mocks.listFirstEventReviews.mockResolvedValue([]);
    mocks.listOrganizerVerifications.mockResolvedValueOnce([
      {
        controlMethod: "official_website",
        controlReference: "https://example.invalid",
        displayName: "Example Association",
        organizationNumber: "556016-0680",
        organizerProfileId,
        organizerType: "association",
        ownOrganizer: false,
        requestedAt: "2031-09-01T10:00:00Z",
        website: null,
      },
    ]);
    mocks.decideOrganizerVerification.mockResolvedValue(elevated);
    await renderWithRouter(<AdminContent locale="en" />, { path: "/admin" });
    fireEvent.change(await screen.findByLabelText("Registered name at Bolagsverket"), {
      target: { value: "Example Förening" },
    });
    fireEvent.click(screen.getByLabelText("Registered and active at Bolagsverket"));
    fireEvent.click(screen.getByLabelText("The representative's control is confirmed"));
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() =>
      expect(mocks.decideOrganizerVerification).toHaveBeenCalledWith("admin", organizerProfileId, {
        controlConfirmed: true,
        decision: "verified",
        reason: undefined,
        registeredName: "Example Förening",
        registryActive: true,
      }),
    );
    expect(await screen.findByText("The organization is verified.")).toBeVisible();
  });

  it("has no detectable automated accessibility violations", async () => {
    mocks.getAdminStatus.mockResolvedValue(elevated);
    mocks.listFirstEventReviews.mockResolvedValue([item]);
    const { container } = await renderWithRouter(<AdminContent locale="en" />, {
      path: "/admin",
    });
    await screen.findByText("Spring walk");
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
