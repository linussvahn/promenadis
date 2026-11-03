import type { PublicEventSummary } from "@promenadis/contracts";
import { cleanup, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithRouter } from "../test/render";
import { DiscoveryPage, EventLanding, OrganizerPublicPage } from "./public-pages";

const event: PublicEventSummary = {
  areaLabel: "Södermalm",
  description: "Books & <plants>",
  indexable: true,
  intervals: [{ endsAt: "2031-09-09T13:00:00+00:00", startsAt: "2031-09-09T08:00:00+00:00" }],
  organizer: {
    displayName: "Garden Club",
    locality: "Stockholm",
    publicKey: "a".repeat(24),
    verified: true,
  },
  originalStartsAt: null,
  publicKey: "b".repeat(32),
  publicNotice: null,
  state: "published",
  timezone: "Europe/Stockholm",
  title: "Spring market",
  updatedAt: "2031-09-01T08:00:00+00:00",
  visibility: "public",
};

const renderAt = (element: React.ReactNode) => renderWithRouter(element);

afterEach(cleanup);

describe("EventLanding", () => {
  it("shows event-level fields and escaped structured data for indexable events", async () => {
    const { container } = await renderAt(
      <EventLanding canonicalUrl="https://example.test/e/x" event={event} locale="en" />,
    );
    expect(screen.getByRole("heading", { name: "Spring market" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Garden Club" })).toHaveAttribute(
      "href",
      `/o/${"a".repeat(24)}`,
    );
    expect(screen.getByText("Verified organizer")).toBeVisible();
    const ld = container.querySelector('script[type="application/ld+json"]');
    expect(ld?.innerHTML).not.toContain("<plants>");
    expect(JSON.parse(ld?.textContent ?? "{}")).toMatchObject({
      "@type": "Event",
      eventStatus: "https://schema.org/EventScheduled",
      name: "Spring market",
    });
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });

  it("emits no structured data and warns about link sharing when unlisted", async () => {
    const { container } = await renderAt(
      <EventLanding
        canonicalUrl="https://example.test/u/x"
        event={{
          ...event,
          indexable: false,
          organizer: { ...event.organizer, publicKey: null },
          visibility: "unlisted",
        }}
        locale="en"
      />,
    );
    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "Garden Club" })).toBeNull();
    expect(screen.getByText(/Anyone with the link can view it/u)).toBeVisible();
  });

  it("shows the public cancellation notice", async () => {
    await renderAt(
      <EventLanding
        canonicalUrl="https://example.test/e/x"
        event={{ ...event, publicNotice: "Storm warning", state: "cancelled" }}
        locale="en"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("This event is cancelledStorm warning");
  });
});

describe("DiscoveryPage", () => {
  it("lists events, keeps the search and links to the next page", async () => {
    const { container, router } = await renderAt(
      <DiscoveryPage
        list={{
          events: [event],
          nextCursor: {
            afterId: "01992026-1104-7100-8000-000000000001",
            afterStartsAt: "2031-09-09T08:00:00+00:00",
          },
        }}
        liveOnly
        locale="en"
        query="books"
      />,
    );
    expect(
      screen.getByRole("searchbox", { name: "Search by name, area or organizer" }),
    ).toHaveValue("books");
    expect(screen.getByRole("checkbox", { name: "Happening now only" })).toBeChecked();
    expect(screen.getByRole("link", { name: "View event" })).toHaveAttribute(
      "href",
      `/e/${"b".repeat(32)}`,
    );
    // The router encodes search values its own way; compare what it reads back.
    const more = new URL(
      screen.getByRole("link", { name: "Show more" }).getAttribute("href") ?? "",
      "https://example.test",
    );
    expect(more.pathname).toBe("/discover");
    expect(router.options.parseSearch(more.search)).toEqual({
      after: "2031-09-09T08:00:00+00:00_01992026-1104-7100-8000-000000000001",
      live: "1",
      q: "books",
    });
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });

  it("says when nothing matched", async () => {
    await renderAt(
      <DiscoveryPage
        list={{ events: [], nextCursor: null }}
        liveOnly={false}
        locale="sv"
        query=""
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Inga evenemang hittades.");
  });
});

describe("OrganizerPublicPage", () => {
  it("lists the organizer's public events with a safe website link", async () => {
    await renderAt(
      <OrganizerPublicPage
        locale="en"
        organizer={{
          displayName: "Garden Club",
          events: [event],
          locality: "Stockholm",
          publicKey: "a".repeat(24),
          verified: false,
          website: "https://garden.example",
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Website" })).toHaveAttribute(
      "rel",
      "noopener noreferrer nofollow ugc",
    );
    expect(screen.getByRole("heading", { name: "Spring market" })).toBeVisible();
  });
});
