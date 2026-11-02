import { PromenadisApiError } from "@promenadis/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizerProfileEditor } from "./organizer-profile-editor";

const mocks = vi.hoisted(() => ({ updateOrganizer: vi.fn() }));
vi.mock("../lib/supabase", () => ({ getPromenadisApiClient: () => mocks }));

const organizerId = "01992026-1102-7300-8000-000000000011";
const organizer = {
  displayName: "Walkers",
  id: organizerId,
  locality: "Uppsala",
  organizerType: "association",
  role: "manager",
  version: 2,
  website: "https://example.invalid",
} as const;
const accessToken = async () => "manager";
const onSaved = vi.fn(async () => {});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrganizerProfileEditor", () => {
  it("saves the edited fields with the current version", async () => {
    mocks.updateOrganizer.mockResolvedValue({ ...organizer, version: 3 });
    render(
      <OrganizerProfileEditor
        accessToken={accessToken}
        locale="en"
        onSaved={onSaved}
        organizer={organizer}
      />,
    );
    fireEvent.click(screen.getByText("Edit organizer"));
    fireEvent.change(screen.getByLabelText("Organizer display name"), {
      target: { value: "Walkers Club" },
    });
    fireEvent.change(screen.getByLabelText("Locality (optional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save organizer" }));
    await waitFor(() =>
      expect(mocks.updateOrganizer).toHaveBeenCalledWith("manager", organizerId, {
        displayName: "Walkers Club",
        expectedVersion: 2,
        locality: "",
        website: "https://example.invalid",
      }),
    );
    expect(await screen.findByText("Organizer saved.")).toBeVisible();
    expect(onSaved).toHaveBeenCalled();
  });

  it("asks for a reload after a concurrent change", async () => {
    mocks.updateOrganizer.mockRejectedValue(
      new PromenadisApiError("changed", 409, "version_conflict", "correlation"),
    );
    render(
      <OrganizerProfileEditor
        accessToken={accessToken}
        locale="en"
        onSaved={onSaved}
        organizer={organizer}
      />,
    );
    fireEvent.click(screen.getByText("Edit organizer"));
    fireEvent.click(screen.getByRole("button", { name: "Save organizer" }));
    expect(await screen.findByText(/Someone else changed this organizer/u)).toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("has no detectable automated accessibility violations", async () => {
    const { container } = render(
      <OrganizerProfileEditor
        accessToken={accessToken}
        locale="en"
        onSaved={onSaved}
        organizer={organizer}
      />,
    );
    fireEvent.click(screen.getByText("Edit organizer"));
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
