import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminEventIntervention } from "./admin-event-intervention";

const api = { getAdminEvent: vi.fn(), interveneInEvent: vi.fn() };
const call = async () => ({ api, token: "admin" }) as never;
const eventId = "01992026-1102-7300-8000-000000000001";
const summary = {
  endsAt: "2031-09-09T13:00:00Z",
  id: eventId,
  organizerDisplayName: "Walkers",
  startsAt: "2031-09-09T08:00:00Z",
  state: "published",
  timezone: "Europe/Stockholm",
  title: "Spring walk",
  version: 5,
  visibility: "public",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const lookUp = async () => {
  fireEvent.change(screen.getByLabelText("Event ID"), { target: { value: eventId } });
  fireEvent.click(screen.getByRole("button", { name: "Look up" }));
  expect(await screen.findByText("Spring walk")).toBeVisible();
};

describe("AdminEventIntervention", () => {
  it("cancels a published event with public and internal reasons", async () => {
    api.getAdminEvent.mockResolvedValue(summary);
    api.interveneInEvent.mockResolvedValue({ state: "cancelled", version: 6 });
    render(<AdminEventIntervention call={call} locale="en" />);
    await lookUp();
    fireEvent.change(screen.getByLabelText("Public explanation"), {
      target: { value: "Unsafe area" },
    });
    fireEvent.change(screen.getByLabelText(/Internal reason/u), {
      target: { value: "Report 42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel the event" }));
    await waitFor(() =>
      expect(api.interveneInEvent).toHaveBeenCalledWith("admin", eventId, {
        action: "cancel",
        expectedEventVersion: 5,
        internalReason: "Report 42",
        publicReason: "Unsafe area",
      }),
    );
    expect(await screen.findByText("The event was changed.")).toBeVisible();
    expect(screen.getByText(/The event cannot be changed/u)).toBeVisible();
  });

  it("ends a live event with only an internal reason", async () => {
    api.getAdminEvent.mockResolvedValue({ ...summary, state: "active" });
    api.interveneInEvent.mockResolvedValue({ state: "ended", version: 6 });
    render(<AdminEventIntervention call={call} locale="en" />);
    await lookUp();
    expect(screen.queryByLabelText("Public explanation")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Internal reason/u), {
      target: { value: "Report 43" },
    });
    fireEvent.click(screen.getByRole("button", { name: "End the event now" }));
    await waitFor(() =>
      expect(api.interveneInEvent).toHaveBeenCalledWith("admin", eventId, {
        action: "end_early",
        expectedEventVersion: 5,
        internalReason: "Report 43",
      }),
    );
  });

  it("has no detectable automated accessibility violations", async () => {
    api.getAdminEvent.mockResolvedValue(summary);
    const { container } = render(<AdminEventIntervention call={call} locale="en" />);
    await lookUp();
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
