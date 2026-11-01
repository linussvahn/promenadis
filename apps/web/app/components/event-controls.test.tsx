import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventControls } from "./event-controls";

const mocks = vi.hoisted(() => ({
  deleteDraftEvent: vi.fn().mockResolvedValue({
    id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
    schemaVersion: "1.0",
  }),
  getSession: vi.fn().mockResolvedValue({
    data: { session: { user: { id: "synthetic-session", email: "fixture@example.invalid" } } },
  }),
  onDeleted: vi.fn().mockResolvedValue(undefined),
  onSaved: vi.fn().mockResolvedValue(undefined),
  updateDraftEventVisibility: vi.fn().mockResolvedValue({
    id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
    state: "draft",
    version: 2,
    visibility: "unlisted",
  }),
}));

vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => ({
    deleteDraftEvent: mocks.deleteDraftEvent,
    updateDraftEventVisibility: mocks.updateDraftEventVisibility,
  }),
  getBrowserAuthClient: () => ({ auth: { getSession: mocks.getSession } }),
}));

const event = {
  boundary: null,
  description: "",
  id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
  intervals: [],
  organizerDisplayName: "Testperson",
  organizerProfileId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f607",
  registration: null,
  role: "owner" as const,
  state: "draft" as const,
  timezone: "Europe/Stockholm",
  title: "Test event",
  version: 1,
  visibility: "public" as const,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventControls", () => {
  it("updates draft visibility with optimistic concurrency", async () => {
    render(
      <EventControls
        event={event}
        locale="sv"
        onDeleted={mocks.onDeleted}
        onSaved={mocks.onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Synlighet"), { target: { value: "unlisted" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara synlighet" }));

    await waitFor(() =>
      expect(mocks.updateDraftEventVisibility).toHaveBeenCalledWith("synthetic-session", event.id, {
        expectedVersion: 1,
        visibility: "unlisted",
      }),
    );
    expect(mocks.onSaved).toHaveBeenCalledOnce();
  });

  it("requires the exact title before owner deletion", async () => {
    render(
      <EventControls
        event={event}
        locale="sv"
        onDeleted={mocks.onDeleted}
        onSaved={mocks.onSaved}
      />,
    );

    fireEvent.click(screen.getByText("Radera utkast"));
    const deleteButton = screen.getByRole("button", { name: "Radera utkast permanent" });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Skriv evenemangets exakta titel för att bekräfta"), {
      target: { value: event.title },
    });
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(mocks.deleteDraftEvent).toHaveBeenCalledWith("synthetic-session", event.id, {
        confirmTitle: event.title,
        expectedVersion: 1,
      }),
    );
    expect(mocks.onDeleted).toHaveBeenCalledOnce();
  });

  it("has no detectable automated accessibility violations", async () => {
    const { container } = render(
      <EventControls
        event={event}
        locale="sv"
        onDeleted={mocks.onDeleted}
        onSaved={mocks.onSaved}
      />,
    );
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
