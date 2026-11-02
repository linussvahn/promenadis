import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyModeration } from "./my-moderation";

const mocks = vi.hoisted(() => ({ listMyModeration: vi.fn(), submitAppeal: vi.fn() }));
vi.mock("../lib/supabase", () => ({ getPromenadisApiClient: () => mocks }));
const actionId = "01992026-1103-7400-8000-000000000001";
const action = {
  action: "hide_listing",
  appeal: null,
  createdAt: "2031-09-01T10:00:00Z",
  eventId: actionId,
  eventTitle: "Spring market",
  id: actionId,
  reason: "Offensive wording",
};
const accessToken = async () => "seller";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MyModeration", () => {
  it("appeals a decision and shows its state", async () => {
    mocks.listMyModeration.mockResolvedValue([action]);
    mocks.submitAppeal.mockResolvedValue([
      { ...action, appeal: { decisionReason: null, independent: null, state: "pending" } },
    ]);
    render(<MyModeration accessToken={accessToken} locale="en" />);
    fireEvent.change(await screen.findByLabelText("Why should the decision change?"), {
      target: { value: "It was a book title." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Appeal" }));
    await waitFor(() =>
      expect(mocks.submitAppeal).toHaveBeenCalledWith("seller", actionId, "It was a book title."),
    );
    expect(await screen.findByText("The appeal is being reviewed.")).toBeVisible();
  });

  it("discloses a non-independent review", async () => {
    mocks.listMyModeration.mockResolvedValue([
      { ...action, appeal: { decisionReason: "Checked", independent: false, state: "upheld" } },
    ]);
    render(<MyModeration accessToken={accessToken} locale="en" />);
    expect(await screen.findByText(/same administrator/u)).toBeVisible();
  });

  it("has no detectable automated accessibility violations", async () => {
    mocks.listMyModeration.mockResolvedValue([action]);
    const { container } = render(<MyModeration accessToken={accessToken} locale="en" />);
    await screen.findByText(/Spring market/u);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
