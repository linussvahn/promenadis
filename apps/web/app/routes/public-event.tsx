import { data } from "react-router";
import { EventLanding, PublicShell } from "../components/public-pages";
import { loadPublic, noIndexHeaders } from "../lib/public-api.server";
import type { Route } from "./+types/public-event";

// Indexable landing page of a published public event: event-level fields only.
export async function loader({ params, request }: Route.LoaderArgs) {
  const event = await loadPublic((api) => api.getPublicEvent("public", params.key));
  const canonicalUrl = `${new URL(request.url).origin}/e/${event.publicKey}`;
  return data({ canonicalUrl, event }, { headers: event.indexable ? {} : noIndexHeaders });
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export const meta: Route.MetaFunction = ({ loaderData: loaded }) => {
  if (!loaded) return [{ title: "Promenadis" }];
  const { event, canonicalUrl } = loaded;
  return [
    { title: `${event.title} · Promenadis` },
    { name: "description", content: event.description.slice(0, 200) || event.title },
    ...(event.indexable
      ? [{ tagName: "link", rel: "canonical", href: canonicalUrl }]
      : [{ name: "robots", content: "noindex, nofollow, nosnippet, noimageindex" }]),
    { property: "og:type", content: "website" },
    { property: "og:title", content: event.title },
    { property: "og:description", content: event.description.slice(0, 200) || event.title },
    { property: "og:url", content: canonicalUrl },
  ];
};

export default function PublicEventRoute({ loaderData }: Route.ComponentProps) {
  return (
    <PublicShell>
      {(locale) => (
        <EventLanding
          canonicalUrl={loaderData.canonicalUrl}
          event={loaderData.event}
          locale={locale}
        />
      )}
    </PublicShell>
  );
}
