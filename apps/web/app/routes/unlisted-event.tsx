import { formatDateTime } from "@promenadis/i18n";
import { data } from "react-router";
import { EventLanding, PublicShell } from "../components/public-pages";
import { loadPublic, noIndexHeaders } from "../lib/public-api.server";
import type { Route } from "./+types/unlisted-event";

// Unlisted landing page: never indexed, never leaks its URL as a referrer.
export async function loader({ params, request }: Route.LoaderArgs) {
  const event = await loadPublic((api) => api.getPublicEvent("unlisted", params.key));
  return data(
    { event, url: `${new URL(request.url).origin}/u/${event.publicKey}` },
    { headers: { ...noIndexHeaders, "referrer-policy": "no-referrer" } },
  );
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

// A sanitized link preview: title, organizer, date and area only.
export const meta: Route.MetaFunction = ({ loaderData: loaded }) => {
  const robots = { name: "robots", content: "noindex, nofollow, nosnippet, noimageindex" };
  const referrer = { name: "referrer", content: "no-referrer" };
  if (!loaded) return [{ title: "Promenadis" }, robots, referrer];
  const { event } = loaded;
  const first = event.intervals[0];
  const summary = [
    event.organizer.displayName,
    first ? formatDateTime("sv", first.startsAt, event.timezone) : null,
    event.areaLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  return [
    { title: `${event.title} · Promenadis` },
    robots,
    referrer,
    { property: "og:type", content: "website" },
    { property: "og:title", content: event.title },
    { property: "og:description", content: summary },
  ];
};

export default function UnlistedEventRoute({ loaderData }: Route.ComponentProps) {
  return (
    <PublicShell>
      {(locale) => (
        <EventLanding canonicalUrl={loaderData.url} event={loaderData.event} locale={locale} />
      )}
    </PublicShell>
  );
}
