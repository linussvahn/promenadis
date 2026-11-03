import { formatDateTime } from "@promenadis/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { EventLanding, PublicShell } from "../../components/public-pages";
import { getPublicEvent, noIndexHeaders } from "../../lib/public-api";

// Unlisted landing page: never indexed, never leaks its URL as a referrer.
export const Route = createFileRoute("/u/$key")({
  loader: async ({ params }) => {
    const { event, origin } = await getPublicEvent({
      data: { route: "unlisted", key: params.key },
    });
    return { event, url: `${origin}/u/${event.publicKey}` };
  },
  headers: () => ({ ...noIndexHeaders, "referrer-policy": "no-referrer" }),
  // A sanitized link preview: title, organizer, date and area only.
  head: ({ loaderData }) => {
    const robots = { name: "robots", content: "noindex, nofollow, nosnippet, noimageindex" };
    const referrer = { name: "referrer", content: "no-referrer" };
    if (!loaderData) return { meta: [{ title: "Promenadis" }, robots, referrer] };
    const { event } = loaderData;
    const first = event.intervals[0];
    const summary = [
      event.organizer.displayName,
      first ? formatDateTime("sv", first.startsAt, event.timezone) : null,
      event.areaLabel,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      meta: [
        { title: `${event.title} · Promenadis` },
        robots,
        referrer,
        { property: "og:type", content: "website" },
        { property: "og:title", content: event.title },
        { property: "og:description", content: summary },
      ],
    };
  },
  component: UnlistedEventRoute,
});

function UnlistedEventRoute() {
  const { event, url } = Route.useLoaderData();
  return (
    <PublicShell>
      {(locale) => <EventLanding canonicalUrl={url} event={event} locale={locale} />}
    </PublicShell>
  );
}
