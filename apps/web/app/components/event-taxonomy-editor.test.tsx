import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventTaxonomyEditor } from "./event-taxonomy-editor";

const api = { getEventTaxonomy: vi.fn(), saveEventTaxonomy: vi.fn() };
const call = async () => ({ api, token: "owner" }) as never;
const eventId = "01992026-1103-7200-8000-000000000001";
const ids = [
  "0199a000-0000-7000-8000-000000000001",
  "0199a000-0000-7000-8000-000000000005",
  "0199a000-0000-7000-8000-000000000014",
];
const taxonomy = {
  categories: [
    {
      enabled: true,
      id: ids[0],
      isOther: false,
      key: "clothing_accessories",
      label: { en: "Clothing & accessories", sv: "Kläder" },
    },
    {
      enabled: true,
      id: ids[1],
      isOther: false,
      key: "books_media",
      label: { en: "Books & media", sv: "Böcker" },
    },
    {
      enabled: true,
      id: ids[2],
      isOther: true,
      key: "other",
      label: { en: "Other", sv: "Övrigt" },
    },
  ],
  suggestedTags: [],
  taxonomyKey: "flea-market-v1",
  version: 1,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventTaxonomyEditor", () => {
  it("reorders, disables a category and saves suggestions", async () => {
    api.getEventTaxonomy.mockResolvedValue(taxonomy);
    api.saveEventTaxonomy.mockResolvedValue({ ...taxonomy, version: 2 });
    render(<EventTaxonomyEditor call={call} editable eventId={eventId} locale="en" />);
    fireEvent.click(await screen.findByText("Categories and suggested tags"));
    fireEvent.click(screen.getByRole("button", { name: "Move up: Books & media" }));
    fireEvent.click(screen.getByLabelText("Other"));
    fireEvent.change(screen.getByLabelText(/Suggested tags/u), {
      target: { value: "Vinyl\nRetro\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save categories" }));
    await waitFor(() =>
      expect(api.saveEventTaxonomy).toHaveBeenCalledWith("owner", eventId, {
        enabledCategoryIds: [ids[1], ids[0]],
        expectedVersion: 1,
        suggestedTags: ["Vinyl", "Retro"],
      }),
    );
  });

  it("is read-only after publication", async () => {
    api.getEventTaxonomy.mockResolvedValue(taxonomy);
    render(<EventTaxonomyEditor call={call} editable={false} eventId={eventId} locale="en" />);
    fireEvent.click(await screen.findByText("Categories and suggested tags"));
    expect(screen.getByText(/locked since the event was published/u)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save categories" })).not.toBeInTheDocument();
  });

  it("has no detectable automated accessibility violations", async () => {
    api.getEventTaxonomy.mockResolvedValue(taxonomy);
    const { container } = render(
      <EventTaxonomyEditor call={call} editable eventId={eventId} locale="en" />,
    );
    fireEvent.click(await screen.findByText("Categories and suggested tags"));
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
