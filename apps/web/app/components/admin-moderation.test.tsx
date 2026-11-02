import { PromenadisApiError } from "@promenadis/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminModeration } from "./admin-moderation";

const api = {
  decideAdminApproval: vi.fn(),
  decideAppeal: vi.fn(),
  findAccount: vi.fn(),
  liftRestriction: vi.fn(),
  listAdminApprovals: vi.fn(),
  listAdminCases: vi.fn(),
  listAppeals: vi.fn(),
  readReportContact: vi.fn(),
  restrictAccount: vi.fn(),
};
const call = async () => ({ api, token: "admin" }) as never;
const id = "01992026-1103-7400-8000-000000000001";
const reportId = "01992026-1103-7400-8000-000000000002";

beforeEach(() => {
  api.listAppeals.mockResolvedValue([
    {
      action: "hide_listing",
      actionAt: "2031-09-01T10:00:00Z",
      actionReason: "Offensive",
      createdAt: "2031-09-02T10:00:00Z",
      eventTitle: "Spring market",
      id,
      ownDecision: false,
      statement: "It was a book title.",
    },
  ]);
  api.listAdminCases.mockResolvedValue([
    {
      eventTitle: "Spring market",
      id,
      openedAt: "2031-09-01T10:00:00Z",
      quarantined: false,
      reports: [
        {
          createdAt: "2031-09-01T10:00:00Z",
          details: "Blocking",
          hasContact: true,
          id: reportId,
          reason: "safety",
        },
      ],
      subjectType: "participation",
    },
  ]);
  api.listAdminApprovals.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminModeration", () => {
  it("reverses an appeal with a reason", async () => {
    api.decideAppeal.mockResolvedValue([]);
    render(<AdminModeration call={call} locale="en" />);
    const reasons = await screen.findAllByLabelText("Reason (required)");
    fireEvent.change(reasons[0] as HTMLElement, { target: { value: "Book title" } });
    fireEvent.click(screen.getByRole("button", { name: "Change the decision" }));
    await waitFor(() =>
      expect(api.decideAppeal).toHaveBeenCalledWith("admin", id, {
        decision: "reverse",
        reason: "Book title",
      }),
    );
  });

  it("shows reporter contact only after a reason", async () => {
    api.readReportContact.mockResolvedValue({ contact: "witness@example.invalid" });
    render(<AdminModeration call={call} locale="en" />);
    fireEvent.change(await screen.findByLabelText(/reporter's contact/u), {
      target: { value: "Need to verify" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show contact" }));
    expect(await screen.findByText("witness@example.invalid")).toBeVisible();
    expect(api.readReportContact).toHaveBeenCalledWith("admin", reportId, "Need to verify");
  });

  it("explains when another administrator must review", async () => {
    api.decideAppeal.mockRejectedValue(
      new PromenadisApiError("x", 409, "different_reviewer_required", null),
    );
    render(<AdminModeration call={call} locale="en" />);
    const reasons = await screen.findAllByLabelText("Reason (required)");
    fireEvent.change(reasons[0] as HTMLElement, { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep the decision" }));
    expect(await screen.findByText(/Another administrator must review/u)).toBeVisible();
  });

  it("has no detectable automated accessibility violations", async () => {
    const { container } = render(<AdminModeration call={call} locale="en" />);
    await screen.findByText("It was a book title.");
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
