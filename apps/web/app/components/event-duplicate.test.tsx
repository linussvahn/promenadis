import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventDuplicate } from "./event-duplicate";

const mocks = vi.hoisted(() => ({ duplicateEvent: vi.fn() }));
vi.mock("../lib/supabase", () => ({ getPromenadisApiClient: () => mocks }));

const eventId = "01992026-1102-7300-8000-000000000001";
const organizerId = "01992026-1102-7300-8000-000000000011";
const copyId = "01992026-1102-7300-8000-000000000099";
const event = {
  id: eventId,
  intervals: [{ endsAt: "2031-09-09T13:00:00Z", id: eventId, startsAt: "2031-09-09T08:00:00Z" }],
  organizerProfileId: organizerId,
  role: "owner",
  state: "archived",
  timezone: "Europe/Stockholm",
  title: "Spring walk",
} as never;
const organizer = {
  displayName: "Walkers",
  id: organizerId,
  locality: null,
  organizerType: "association",
  role: "owner",
  version: 1,
  website: null,
} as const;
const accessToken = async () => "owner";
const onCreated = vi.fn(async () => {});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventDuplicate", () => {
  it("copies an old event a year later and opens the copy", async () => {
    mocks.duplicateEvent.mockResolvedValue({ id: copyId, schemaVersion: "1.0" });
    render(
      <EventDuplicate
        accessToken={accessToken}
        event={event}
        locale="en"
        onCreated={onCreated}
        organizers={[organizer]}
      />,
    );
    fireEvent.click(screen.getByText("Copy as a new event"));
    expect(screen.getByLabelText("Starts")).toHaveValue("2032-09-09T10:00");
    fireEvent.click(screen.getByRole("button", { name: "Create copy" }));
    await waitFor(() =>
      expect(mocks.duplicateEvent).toHaveBeenCalledWith("owner", eventId, {
        endsAt: "2032-09-09T13:00:00.000Z",
        organizerProfileId: organizerId,
        startsAt: "2032-09-09T08:00:00.000Z",
        title: "Spring walk",
      }),
    );
    expect(onCreated).toHaveBeenCalledWith(copyId);
  });

  it("explains that a co-host needs an organizer of their own", () => {
    render(
      <EventDuplicate
        accessToken={accessToken}
        event={{ ...(event as object), role: "co_host" } as never}
        locale="en"
        onCreated={onCreated}
        organizers={[]}
      />,
    );
    fireEvent.click(screen.getByText("Copy as a new event"));
    expect(screen.getByText(/You need to manage an organizer/u)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create copy" })).not.toBeInTheDocument();
  });

  it("has no detectable automated accessibility violations", async () => {
    const { container } = render(
      <EventDuplicate
        accessToken={accessToken}
        event={event}
        locale="en"
        onCreated={onCreated}
        organizers={[organizer, { ...organizer, displayName: "Other", id: copyId }]}
      />,
    );
    fireEvent.click(screen.getByText("Copy as a new event"));
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
