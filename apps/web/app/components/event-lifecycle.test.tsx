import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventLifecycle } from "./event-lifecycle";

const mocks = vi.hoisted(() => ({ cancelEvent: vi.fn(), endEventEarly: vi.fn() }));
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
const onChanged = vi.fn(async () => {});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventLifecycle", () => {
  it("cancels a published event only with the exact title and a public reason", async () => {
    mocks.cancelEvent.mockResolvedValue({ state: "cancelled", version: 5 });
    render(<EventLifecycle event={base} locale="en" onChanged={onChanged} />);
    fireEvent.click(screen.getByText("Cancel the event", { selector: "summary" }));
    const submit = screen.getByRole("button", { name: "Cancel the event" });
    fireEvent.change(screen.getByLabelText("Public explanation"), {
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
    expect(onChanged).toHaveBeenCalled();
  });

  it("lets a co-host end a live event but never cancel it", async () => {
    mocks.endEventEarly.mockResolvedValue({ state: "ended", version: 5 });
    render(
      <EventLifecycle
        event={{ ...(base as object), role: "co_host", state: "active" } as never}
        locale="en"
        onChanged={onChanged}
      />,
    );
    expect(screen.queryByText("Cancel the event")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End the event now" }));
    expect(await screen.findByText("The event has ended.")).toBeVisible();
    expect(mocks.endEventEarly).toHaveBeenCalledWith("owner", eventId, 4);
  });

  it("shows nothing to a co-host of a published event or for drafts", () => {
    const { container, rerender } = render(
      <EventLifecycle
        event={{ ...(base as object), role: "co_host" } as never}
        locale="en"
        onChanged={onChanged}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <EventLifecycle
        event={{ ...(base as object), state: "draft" } as never}
        locale="en"
        onChanged={onChanged}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("has no detectable automated accessibility violations", async () => {
    const { container } = render(<EventLifecycle event={base} locale="en" onChanged={onChanged} />);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
