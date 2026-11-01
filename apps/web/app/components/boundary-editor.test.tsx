import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoundaryEditor } from "./boundary-editor";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn().mockResolvedValue({
    data: { session: { user: { id: "synthetic-session", email: "fixture@example.invalid" } } },
  }),
  onSaved: vi.fn().mockResolvedValue(undefined),
  saveEventBoundary: vi.fn().mockResolvedValue({
    areaSquareKilometers: 0.5,
    displayLabel: "Test area",
    ring: [
      [18, 59],
      [18.01, 59],
      [18.01, 59.01],
      [18, 59],
    ],
    spanKilometers: 1.2,
    version: 1,
    warnings: [],
  }),
}));

vi.mock("react-map-gl/maplibre", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  Layer: () => null,
  Source: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/supabase", () => ({
  getPromenadisApiClient: () => ({ saveEventBoundary: mocks.saveEventBoundary }),
  getBrowserAuthClient: () => ({ auth: { getSession: mocks.getSession } }),
}));

const events = [
  {
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
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function addPoint(longitude: string, latitude: string) {
  fireEvent.change(screen.getByRole("spinbutton", { name: /^Longitud$/u }), {
    target: { value: longitude },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: /^Latitud$/u }), {
    target: { value: latitude },
  });
  fireEvent.click(screen.getByRole("button", { name: "Lägg till hörn" }));
}

describe("BoundaryEditor", () => {
  it("provides a non-map workflow and saves an open ordered ring", async () => {
    render(<BoundaryEditor events={events} locale="sv" onSaved={mocks.onSaved} />);

    fireEvent.click(screen.getByText("Avancerat: redigera koordinater"));
    addPoint("18", "59");
    addPoint("18.01", "59");
    addPoint("18.01", "59.01");
    fireEvent.change(screen.getByLabelText("Områdets namn (valfritt)"), {
      target: { value: "Test area" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Spara område" }));

    await waitFor(() =>
      expect(mocks.saveEventBoundary).toHaveBeenCalledWith("synthetic-session", events[0]?.id, {
        displayLabel: "Test area",
        expectedVersion: null,
        ring: [
          [18, 59],
          [18.01, 59],
          [18.01, 59.01],
        ],
      }),
    );
    expect(mocks.onSaved).toHaveBeenCalledOnce();
  });

  it("has no detectable automated accessibility violations", async () => {
    const { container } = render(
      <BoundaryEditor events={events} locale="sv" onSaved={mocks.onSaved} />,
    );
    await screen.findByTestId("map");

    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
