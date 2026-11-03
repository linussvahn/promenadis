import { translate } from "@promenadis/i18n";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { backLink, PageHeading } from "../../../components/page";
import { PublicEventMap } from "../../../components/public-event-map";
import { PublicShell } from "../../../components/public-pages";
import { getPublicEvent, noIndexHeaders } from "../../../lib/public-api";

// Map and stop list: never indexed for public or unlisted events. Precise
// data loads in the browser from the manifest, safety feed and snapshot.
export const Route = createFileRoute("/$route/$key/map")({
  loader: async ({ params }) => {
    if (params.route !== "e" && params.route !== "u") throw notFound();
    const route = params.route === "u" ? ("unlisted" as const) : ("public" as const);
    const { event } = await getPublicEvent({ data: { route, key: params.key } });
    return { event, route };
  },
  headers: ({ loaderData }) => ({
    ...noIndexHeaders,
    ...(loaderData?.route === "unlisted" ? { "referrer-policy": "no-referrer" } : {}),
  }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.event.title} · Karta · Promenadis` : "Promenadis" },
      { name: "robots", content: "noindex, nofollow, nosnippet, noimageindex" },
      ...(loaderData?.route === "unlisted" ? [{ name: "referrer", content: "no-referrer" }] : []),
    ],
  }),
  component: PublicEventMapRoute,
});

function PublicEventMapRoute() {
  const { event, route } = Route.useLoaderData();
  return (
    <PublicShell>
      {(locale) => (
        <section aria-labelledby="map-title" className="grid gap-4">
          <Link
            className={backLink}
            params={{ key: event.publicKey }}
            to={route === "public" ? "/e/$key" : "/u/$key"}
          >
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
