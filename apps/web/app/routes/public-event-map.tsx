import { translate } from "@promenadis/i18n";
import { data, Link } from "react-router";
import { backLink, PageHeading } from "../components/page";
import { PublicEventMap } from "../components/public-event-map";
import { PublicShell } from "../components/public-pages";
import { loadPublic, noIndexHeaders } from "../lib/public-api.server";
import type { Route } from "./+types/public-event-map";

// Map and stop list: never indexed for public or unlisted events. Precise
// data loads in the browser from the manifest, safety feed and snapshot.
export async function loader({ params }: Route.LoaderArgs) {
  const route = params.route === "u" ? "unlisted" : "public";
  if (params.route !== "e" && params.route !== "u") throw data(null, { status: 404 });
  const event = await loadPublic((api) => api.getPublicEvent(route, params.key));
  return data({ event, route } as const, {
    headers: {
      ...noIndexHeaders,
      ...(route === "unlisted" ? { "referrer-policy": "no-referrer" } : {}),
    },
  });
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: loaderData ? `${loaderData.event.title} · Karta · Promenadis` : "Promenadis" },
  { name: "robots", content: "noindex, nofollow, nosnippet, noimageindex" },
  ...(loaderData?.route === "unlisted" ? [{ name: "referrer", content: "no-referrer" }] : []),
];

export default function PublicEventMapRoute({ loaderData }: Route.ComponentProps) {
  const { event, route } = loaderData;
  const landing = `/${route === "public" ? "e" : "u"}/${event.publicKey}`;
  return (
    <PublicShell>
      {(locale) => (
        <section aria-labelledby="map-title" className="grid gap-4">
          <Link className={backLink} to={landing}>
            ← {translate(locale, "map.back")}
          </Link>
          <PageHeading
            description={translate(locale, "map.title")}
            title={event.title}
            titleId="map-title"
          />
          <PublicEventMap eventKey={event.publicKey} locale={locale} route={route} />
        </section>
      )}
    </PublicShell>
  );
}
