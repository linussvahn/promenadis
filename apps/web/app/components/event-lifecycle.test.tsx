import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountKey } from "../lib/use-account-data";
import { renderWithRouter } from "../test/render";
import { EventLifecycle } from "./event-lifecycle";

const mocks = vi.hoisted(() => ({
  cancelEvent: vi.fn(),
  endEventEarly: vi.fn(),
  postponeEvent: vi.fn(),
  rescheduleEvent: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  getBrowserAuthClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: "owner" } } } }) },
  }),
  getPromenadisApiClient: () => mocks,
}));
vi.mock("../lib/account-session", () => ({ useExpectedAccountId: () => "owner" }));

const eventId = "01992026-1102-7000-8000-000000000001";
const base = {
  id: eventId,
  role: "owner",
  state: "published",
  title: "Spring walk",
  version: 4,
} as never;
const render = (ui: ReactNode) =>
  renderWithRouter(ui, { path: "/events/$eventId", url: `/events/${eventId}` });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventLifecycle", () => {
  it("cancels a published event only with the exact title and a public reason", async () => {
    mocks.cancelEvent.mockResolvedValue({ state: "cancelled", version: 5 });
    const { queryClient } = await render(<EventLifecycle event={base} locale="en" />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByText("Cancel the event", { selector: "summary" }));
    const submit = screen.getByRole("button", { name: "Cancel the event" });
    fireEvent.change(screen.getByLabelText("Public explanation", { selector: "#cancel-reason" }), {
      target: { value: "Storm warning" },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Spring walk"), {
      target: { value: "Spring walk" },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mocks.cancelEvent).toHaveBeenCalledWith("owner", eventId, {
        confirmTitle: "Spring walk",
        expectedEventVersion: 4,
        publicReason: "Storm warning",
      }),
    );
    expect(await screen.findByText("The event is cancelled.")).toBeVisible();
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: accountKey("owner", "dashboard") }),
    );
  });

  it("lets a co-host end a live event but never cancel it", async () => {
    mocks.endEventEarly.mockResolvedValue({ state: "ended", version: 5 });
    await render(
      <EventLifecycle
        event={{ ...(base as object), role: "co_host", state: "active" } as never}
        locale="en"
      />,
    );
    expect(screen.queryByText("Cancel the event")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End the event now" }));
    expect(await screen.findByText("The event has ended.")).toBeVisible();
    expect(mocks.endEventEarly).toHaveBeenCalledWith("owner", eventId, 4);
  });

  it("lets a co-host postpone but not cancel, and shows nothing for drafts", async () => {
    await render(
      <EventLifecycle event={{ ...(base as object), role: "co_host" } as never} locale="en" />,
    );
    expect(screen.queryByText("Cancel the event")).not.toBeInTheDocument();
    expect(screen.getByText("Postpone the event")).toBeVisible();
    cleanup();
    const { container } = await render(
      <EventLifecycle event={{ ...(base as object), state: "draft" } as never} locale="en" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("postpones with a public reason and reschedules in event time", async () => {
    mocks.postponeEvent.mockResolvedValue({ state: "postponed", version: 5 });
    mocks.rescheduleEvent.mockResolvedValue({ state: "published", version: 6 });
    await render(
      <EventLifecycle
        event={{ ...(base as object), role: "co_host", timezone: "Europe/Stockholm" } as never}
        locale="en"
      />,
    );
    fireEvent.click(screen.getByText("Postpone the event"));
    fireEvent.change(screen.getByLabelText("Public explanation"), { target: { value: "Storm" } });
    fireEvent.click(screen.getByRole("button", { name: "Postpone" }));
    await waitFor(() =>
      expect(mocks.postponeEvent).toHaveBeenCalledWith("owner", eventId, {
        expectedEventVersion: 4,
        publicReason: "Storm",
      }),
    );
    cleanup();
    await render(
      <EventLifecycle
        event={
          {
            ...(base as object),
            role: "co_host",
            state: "postponed",
            timezone: "Europe/Stockholm",
            version: 5,
          } as never
        }
        locale="en"
      />,
    );
    fireEvent.click(screen.getByText("Set a new date"));
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2031-09-20T10:00" } });
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2031-09-20T15:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new date" }));
    await waitFor(() =>
      expect(mocks.rescheduleEvent).toHaveBeenCalledWith("owner", eventId, {
        endsAt: "2031-09-20T13:00:00.000Z",
        expectedEventVersion: 5,
        startsAt: "2031-09-20T08:00:00.000Z",
      }),
    );
  });

  it("has no detectable automated accessibility violations", async () => {
    const { container } = await render(<EventLifecycle event={base} locale="en" />);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
