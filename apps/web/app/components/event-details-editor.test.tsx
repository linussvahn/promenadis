import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountKey } from "../lib/use-account-data";
import { renderWithRouter } from "../test/render";
import { EventDetailsEditor } from "./event-details-editor";

const mocks = vi.hoisted(() => ({ updateDraftEventDetails: vi.fn() }));
vi.mock("../lib/supabase", () => ({ getPromenadisApiClient: () => mocks }));

const eventId = "01992026-1102-7300-8000-000000000001";
const draft = {
  description: "Old text",
  id: eventId,
  intervals: [{ endsAt: "2031-09-09T13:00:00Z", id: eventId, startsAt: "2031-09-09T08:00:00Z" }],
  role: "co_host",
  state: "draft",
  timezone: "Europe/Stockholm",
  title: "Spring walk",
  version: 3,
} as never;
const accessToken = async () => "owner";
const render = (ui: ReactNode) =>
  renderWithRouter(ui, { path: "/events/$eventId", url: `/events/${eventId}` });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventDetailsEditor", () => {
  it("saves wall times in the event's time zone and reports a registration reset", async () => {
    mocks.updateDraftEventDetails.mockResolvedValue({
      id: eventId,
      registrationReset: true,
      state: "draft",
      version: 4,
      visibility: "public",
    });
    const { queryClient } = await render(
      <EventDetailsEditor accessToken={accessToken} event={draft} locale="en" />,
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByText("Edit details"));
    expect(screen.getByLabelText("Starts")).toHaveValue("2031-09-09T10:00");
    fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Autumn walk" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2031-09-01T10:00" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2031-09-01T15:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() =>
      expect(mocks.updateDraftEventDetails).toHaveBeenCalledWith("owner", eventId, {
        description: "Old text",
        endsAt: "2031-09-01T13:00:00.000Z",
        expectedVersion: 3,
        startsAt: "2031-09-01T08:00:00.000Z",
        timezone: "Europe/Stockholm",
        title: "Autumn walk",
      }),
    );
    expect(await screen.findByText(/registration window no longer fitted/u)).toBeVisible();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: accountKey(null, "dashboard") });
  });

  it("is hidden for moderators and published events", async () => {
    const first = await render(
      <EventDetailsEditor
        accessToken={accessToken}
        event={{ ...(draft as object), role: "moderator" } as never}
        locale="en"
      />,
    );
    expect(first.container).toBeEmptyDOMElement();
    cleanup();
    const { container } = await render(
      <EventDetailsEditor
        accessToken={accessToken}
        event={{ ...(draft as object), state: "published" } as never}
        locale="en"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("has no detectable automated accessibility violations", async () => {
    const { container } = await render(
      <EventDetailsEditor accessToken={accessToken} event={draft} locale="en" />,
    );
    fireEvent.click(screen.getByText("Edit details"));
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
