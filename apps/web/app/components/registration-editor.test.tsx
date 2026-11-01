import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegistrationEditor } from "./registration-editor";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn().mockResolvedValue({
    data: { session: { user: { id: "synthetic-session", email: "fixture@example.invalid" } } },
  }),
  onSaved: vi.fn().mockResolvedValue(undefined),
  saveEventRegistration: vi.fn().mockResolvedValue({
    allowDuringEvent: true,
    closesAt: "2030-09-08T08:30:00.000Z",
    opensAt: "2030-09-07T06:00:00.000Z",
    version: 2,
  }),
}));

vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => ({
    saveEventRegistration: mocks.saveEventRegistration,
  }),
  getBrowserAuthClient: () => ({ auth: { getSession: mocks.getSession } }),
}));

const event = {
  boundary: null,
  description: "",
  id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
  intervals: [
    {
      endsAt: "2030-09-08T13:00:00.000Z",
      id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f607",
      startsAt: "2030-09-08T08:00:00.000Z",
    },
  ],
  organizerDisplayName: "Testperson",
  organizerProfileId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f608",
  registration: {
    allowDuringEvent: false,
    closesAt: "2030-09-08T07:00:00.000Z",
    opensAt: "2030-09-07T06:00:00.000Z",
    version: 1,
  },
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

describe("RegistrationEditor", () => {
  it("saves event-zone wall times and explicit active-event consent", async () => {
    render(<RegistrationEditor event={event} locale="sv" onSaved={mocks.onSaved} />);

    fireEvent.change(screen.getByLabelText("Anmälan stänger"), {
      target: { value: "2030-09-08T10:30" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Tillåt anmälningar medan evenemanget pågår/u,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Spara anmälningsperiod" }));

    await waitFor(() =>
      expect(mocks.saveEventRegistration).toHaveBeenCalledWith("synthetic-session", event.id, {
        allowDuringEvent: true,
        closesAt: "2030-09-08T08:30:00.000Z",
        expectedVersion: 1,
        opensAt: "2030-09-07T06:00:00.000Z",
      }),
    );
    expect(mocks.onSaved).toHaveBeenCalledOnce();
  });

  it("has no detectable automated accessibility violations", async () => {
    const { container } = render(
      <RegistrationEditor event={event} locale="sv" onSaved={mocks.onSaved} />,
    );
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
