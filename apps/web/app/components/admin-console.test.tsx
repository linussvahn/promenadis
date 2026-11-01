import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminContent } from "./admin-console";

const mocks = vi.hoisted(() => ({
  decideFirstEventReview: vi.fn(),
  endAdminElevation: vi.fn(),
  getAdminStatus: vi.fn(),
  listFirstEventReviews: vi.fn(),
  startAdminElevation: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ getPromenadisApiClient: () => mocks }));
const accountData = vi.hoisted(() => ({ accessToken: async () => "admin" }));
vi.mock("../lib/use-account-data", () => ({ useAccountData: () => accountData }));

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
    render(<AdminContent locale="en" />);
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
    render(<AdminContent locale="en" />);
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
    render(<AdminContent locale="en" />);
    await screen.findByText("You cannot review an event whose team you belong to.");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("has no detectable automated accessibility violations", async () => {
    mocks.getAdminStatus.mockResolvedValue(elevated);
    mocks.listFirstEventReviews.mockResolvedValue([item]);
    const { container } = render(<AdminContent locale="en" />);
    await screen.findByText("Spring walk");
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
