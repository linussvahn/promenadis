import { PromenadisApiError } from "@promenadis/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SellerListingEditor } from "./seller-listing-editor";

const api = {
  getEventTaxonomy: vi.fn(),
  getSellerListing: vi.fn(),
  saveSellerListing: vi.fn(),
  setSellerLiveStatus: vi.fn(),
};
const call = async () => ({ api, token: "seller" }) as never;
const eventId = "01992026-1103-7200-8000-000000000001";
const books = "0199a000-0000-7000-8000-000000000005";
const clothes = "0199a000-0000-7000-8000-000000000001";
const taxonomy = {
  categories: [
    {
      enabled: true,
      id: books,
      isOther: false,
      key: "books_media",
      label: { en: "Books & media", sv: "Böcker & media" },
    },
    {
      enabled: true,
      id: clothes,
      isOther: false,
      key: "clothing_accessories",
      label: { en: "Clothing & accessories", sv: "Kläder & accessoarer" },
    },
  ],
  suggestedTags: ["Vinyl"],
  taxonomyKey: "flea-market-v1",
  version: 2,
};
const emptyListing = {
  accessibility: {
    elevator: null,
    setting: null,
    stairs: null,
    stepFree: null,
    strollerFriendly: null,
  },
  availability: [],
  categoryIds: [],
  description: "",
  earlyVisibilityOptOut: false,
  items: [],
  liveStatus: null,
  tags: [],
  title: null,
  version: 0,
};
const participationId = "01992026-1103-7200-8000-000000000009";
const participation = { id: participationId, state: "approved" } as never;
const props = {
  call,
  eventEndsAt: "2031-09-09T13:00:00Z",
  eventId,
  eventStartsAt: "2031-09-09T08:00:00Z",
  locale: "en" as const,
  participation,
  timezone: "Europe/Stockholm",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SellerListingEditor", () => {
  it("saves categories, a suggested tag, an item in kronor and a slot in event time", async () => {
    api.getEventTaxonomy.mockResolvedValue(taxonomy);
    api.getSellerListing.mockResolvedValue(emptyListing);
    api.saveSellerListing.mockResolvedValue({ ...emptyListing, version: 1 });
    render(<SellerListingEditor {...props} eventActive={false} />);
    fireEvent.click(await screen.findByLabelText("Books & media"));
    fireEvent.change(screen.getByLabelText("Short description"), { target: { value: "Records" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Vinyl" }));
    fireEvent.change(screen.getByLabelText("Step-free"), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: "Blue Note LP" } });
    fireEvent.change(screen.getByLabelText("Price in kronor (optional)"), {
      target: { value: "150" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add time" }));
    fireEvent.change(screen.getByLabelText("Ends 1"), { target: { value: "2031-09-09T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save listing" }));
    await waitFor(() =>
      expect(api.saveSellerListing).toHaveBeenCalledWith("seller", participationId, {
        accessibility: {
          elevator: null,
          setting: null,
          stairs: null,
          stepFree: true,
          strollerFriendly: null,
        },
        availability: [
          { endsAt: "2031-09-09T10:00:00.000Z", startsAt: "2031-09-09T08:00:00.000Z" },
        ],
        categoryIds: [books],
        description: "Records",
        earlyVisibilityOptOut: false,
        expectedVersion: 0,
        items: [
          { categoryId: books, name: "Blue Note LP", priceMinor: 15000, status: "available" },
        ],
        tags: ["Vinyl"],
        title: "",
      }),
    );
    expect(await screen.findByText("The listing is saved.")).toBeVisible();
  });

  it("explains that Other needs a description", async () => {
    api.getEventTaxonomy.mockResolvedValue(taxonomy);
    api.getSellerListing.mockResolvedValue({ ...emptyListing, categoryIds: [books], version: 1 });
    api.saveSellerListing.mockRejectedValue(
      new PromenadisApiError("other", 400, "other_needs_description", null),
    );
    render(<SellerListingEditor {...props} eventActive={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save listing" }));
    expect(await screen.findByText(/Describe what you sell/u)).toBeVisible();
  });

  it("sets live status only while the event is active", async () => {
    api.getEventTaxonomy.mockResolvedValue(taxonomy);
    api.getSellerListing.mockResolvedValue(emptyListing);
    api.setSellerLiveStatus.mockResolvedValue({
      ...emptyListing,
      liveStatus: { setAt: "2031-09-09T09:00:00Z", status: "away", until: null },
    });
    const { rerender } = render(<SellerListingEditor {...props} eventActive={false} />);
    await screen.findByLabelText("Books & media");
    expect(screen.queryByRole("button", { name: "Back soon" })).not.toBeInTheDocument();
    rerender(<SellerListingEditor {...props} eventActive />);
    fireEvent.click(screen.getByRole("button", { name: "Back soon" }));
    await waitFor(() =>
      expect(api.setSellerLiveStatus).toHaveBeenCalledWith("seller", participationId, {
        status: "away",
        until: null,
      }),
    );
    expect((await screen.findAllByText("Away for a moment.")).length).toBeGreaterThan(0);
  });

  it("has no detectable automated accessibility violations", async () => {
    api.getEventTaxonomy.mockResolvedValue(taxonomy);
    api.getSellerListing.mockResolvedValue({
      ...emptyListing,
      items: [
        {
          categoryId: books,
          currency: "SEK",
          id: eventId,
          name: "LP",
          priceMinor: null,
          status: "sold",
        },
      ],
      version: 1,
    });
    const { container } = render(<SellerListingEditor {...props} eventActive />);
    await screen.findByLabelText("Books & media");
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
