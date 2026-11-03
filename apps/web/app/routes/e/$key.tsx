import { createFileRoute } from "@tanstack/react-router";
import { EventLanding, PublicShell } from "../../components/public-pages";
import { getPublicEvent, noIndexHeaders } from "../../lib/public-api";

// Indexable landing page of a published public event: event-level fields only.
export const Route = createFileRoute("/e/$key")({
  loader: async ({ params }) => {
    const { event, origin } = await getPublicEvent({ data: { route: "public", key: params.key } });
    return { canonicalUrl: `${origin}/e/${event.publicKey}`, event };
  },
  headers: ({ loaderData }) => (loaderData?.event.indexable ? {} : { ...noIndexHeaders }),
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Promenadis" }] };
    const { event, canonicalUrl } = loaderData;
    const description = event.description.slice(0, 200) || event.title;
    return {
      meta: [
        { title: `${event.title} · Promenadis` },
        { name: "description", content: description },
        ...(event.indexable
          ? []
          : [{ name: "robots", content: "noindex, nofollow, nosnippet, noimageindex" }]),
        { property: "og:type", content: "website" },
        { property: "og:title", content: event.title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonicalUrl },
      ],
      links: event.indexable ? [{ rel: "canonical", href: canonicalUrl }] : [],
    };
  },
  component: PublicEventRoute,
});

function PublicEventRoute() {
  const { canonicalUrl, event } = Route.useLoaderData();
  return (
    <PublicShell>
      {(locale) => <EventLanding canonicalUrl={canonicalUrl} event={event} locale={locale} />}
    </PublicShell>
  );
}
