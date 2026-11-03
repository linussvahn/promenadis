import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test/render";
import { EventCases } from "./event-cases";

const api = { listEventCases: vi.fn(), reviewCase: vi.fn() };
const call = async () => ({ api, token: "moderator" }) as never;
const eventId = "01992026-1103-7300-8000-000000000001";
const caseId = "01992026-1103-7300-8000-000000000003";
const quarantined = {
  addressLine: "Testgatan 1",
  closedAt: null,
  id: caseId,
  locationId: eventId,
  openedAt: "2031-09-01T10:00:00Z",
  outcome: null,
  participationId: null,
  quarantined: true,
  reports: [
    {
      complete: true,
      createdAt: "2031-09-01T10:00:00Z",
      details: "I live here and never agreed.",
      id: eventId,
      reason: "unauthorized_address",
      relationship: "resident",
    },
  ],
  sellerDisplayName: null,
  state: "open",
  subjectId: eventId,
  subjectType: "location",
};
const onChanged = vi.fn(async () => {});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventCases", () => {
  it("shows a quarantined location and restores it with a reason", async () => {
    api.listEventCases.mockResolvedValue([quarantined]);
    api.reviewCase.mockResolvedValue([{ ...quarantined, state: "closed" }]);
    await renderWithRouter(
      <EventCases
        call={call}
        eventId={eventId}
        locale="en"
        onChanged={onChanged}
        timezone="Europe/Stockholm"
      />,
    );
    expect(await screen.findByText(/Quarantined/u)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Close without action" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason (required)"), {
      target: { value: "Seller showed permission" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Restore the location" }));
    await waitFor(() =>
      expect(api.reviewCase).toHaveBeenCalledWith("moderator", caseId, {
        decision: "restore",
        reason: "Seller showed permission",
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("has no detectable automated accessibility violations", async () => {
    api.listEventCases.mockResolvedValue([quarantined]);
    const { container } = await renderWithRouter(
      <EventCases
        call={call}
        eventId={eventId}
        locale="en"
        onChanged={onChanged}
        timezone="Europe/Stockholm"
      />,
    );
    await screen.findByText(/Quarantined/u);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
