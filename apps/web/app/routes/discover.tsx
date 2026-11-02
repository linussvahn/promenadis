import { DiscoveryPage, PublicShell } from "../components/public-pages";
import { loadPublic } from "../lib/public-api.server";
import type { Route } from "./+types/discover";

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").slice(0, 100);
  const liveOnly = params.get("live") === "1";
  const list = await loadPublic((api) =>
    api.listPublicEvents({ after: params.get("after"), liveOnly, query }),
  );
  return { list, liveOnly, origin: new URL(request.url).origin, query };
}

export const meta: Route.MetaFunction = ({ loaderData: data }) => [
  { title: "Upptäck evenemang · Promenadis" },
  {
    name: "description",
    content: "Loppisar och kvarterspromenader som är öppna för alla.",
  },
  // Search result pages are not indexed; the plain listing is.
  ...(data && (data.query || data.liveOnly)
    ? [{ name: "robots", content: "noindex, follow" }]
    : data
      ? [{ tagName: "link", rel: "canonical", href: `${data.origin}/discover` }]
      : []),
];

export default function DiscoverRoute({ loaderData }: Route.ComponentProps) {
  return (
    <PublicShell>
      {(locale) => (
        <DiscoveryPage
          list={loaderData.list}
          liveOnly={loaderData.liveOnly}
          locale={locale}
          query={loaderData.query}
        />
      )}
    </PublicShell>
  );
}
