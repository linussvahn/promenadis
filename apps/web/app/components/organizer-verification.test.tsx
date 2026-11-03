import { PromenadisApiError } from "@promenadis/api-client";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test/render";
import { OrganizerVerification } from "./organizer-verification";

const mocks = vi.hoisted(() => ({
  getOrganizerVerification: vi.fn(),
  requestOrganizerVerification: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  getBrowserAuthClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: "manager" } } } }) },
  }),
  getPromenadisApiClient: () => mocks,
}));
vi.mock("../lib/account-session", () => ({ useExpectedAccountId: () => "manager" }));

const organizerProfileId = "01992026-1102-7100-8000-000000000011";
const none = {
  badge: false,
  organizationNumber: null,
  reason: null,
  recheckDueAt: null,
  registeredName: null,
  status: "none",
};
const renderVerification = () =>
  renderWithRouter(<OrganizerVerification locale="en" organizerProfileId={organizerProfileId} />);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrganizerVerification", () => {
  it("requests verification and explains a rejected number", async () => {
    mocks.getOrganizerVerification.mockResolvedValue(none);
    mocks.requestOrganizerVerification
      .mockRejectedValueOnce(
        new PromenadisApiError("bad", 400, "invalid_organization_number", null),
      )
      .mockResolvedValueOnce({ ...none, organizationNumber: "556016-0680", status: "pending" });
    await renderVerification();
    fireEvent.click(await screen.findByText("Request verification"));
    fireEvent.change(screen.getByLabelText("Organization number"), {
      target: { value: "811218-9876" },
    });
    fireEvent.change(screen.getByLabelText("Website, domain or contact source"), {
      target: { value: "https://example.invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await screen.findByText(/Personal identity numbers cannot be used/u);
    fireEvent.change(screen.getByLabelText("Organization number"), {
      target: { value: "556016-0680" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Verification is being reviewed.")).toBeVisible();
    expect(mocks.requestOrganizerVerification).toHaveBeenLastCalledWith(
      "manager",
      organizerProfileId,
      {
        controlMethod: "official_website",
        controlReference: "https://example.invalid",
        organizationNumber: "556016-0680",
      },
    );
  });

  it("shows the badge with the registered name and recheck date", async () => {
    mocks.getOrganizerVerification.mockResolvedValue({
      ...none,
      badge: true,
      organizationNumber: "556016-0680",
      recheckDueAt: "2032-09-01T10:00:00Z",
      registeredName: "Example Förening",
      status: "verified",
    });
    await renderVerification();
    expect(
      await screen.findByText("Registered organization verified: Example Förening"),
    ).toBeVisible();
    expect(screen.queryByText("Request verification")).not.toBeInTheDocument();
  });

  it("has no detectable automated accessibility violations", async () => {
    mocks.getOrganizerVerification.mockResolvedValue(none);
    const { container } = await renderVerification();
    await screen.findByText("Request verification");
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
