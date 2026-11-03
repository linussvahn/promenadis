import { createFileRoute } from "@tanstack/react-router";
import { DiscoveryPage, PublicShell } from "../components/public-pages";
import { listPublicEvents } from "../lib/public-api";

export const Route = createFileRoute("/discover")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { after?: string; live?: "1"; q?: string } => ({
    ...(typeof search.after === "string" ? { after: search.after } : {}),
    ...(search.live === "1" || search.live === 1 ? { live: "1" as const } : {}),
    ...(typeof search.q === "string" ? { q: search.q.slice(0, 100) } : {}),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const query = deps.q ?? "";
    const liveOnly = deps.live === "1";
    const { list, origin } = await listPublicEvents({
      data: { after: deps.after ?? null, liveOnly, query },
    });
    return { list, liveOnly, origin, query };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: "Upptäck evenemang · Promenadis" },
      { name: "description", content: "Loppisar och kvarterspromenader som är öppna för alla." },
      // Search result pages are not indexed; the plain listing is.
      ...(loaderData && (loaderData.query || loaderData.liveOnly)
        ? [{ name: "robots", content: "noindex, follow" }]
        : []),
    ],
    links:
      loaderData && !loaderData.query && !loaderData.liveOnly
        ? [{ rel: "canonical", href: `${loaderData.origin}/discover` }]
        : [],
  }),
  component: DiscoverRoute,
});

function DiscoverRoute() {
  const { list, liveOnly, query } = Route.useLoaderData();
  return (
    <PublicShell>
      {(locale) => <DiscoveryPage list={list} liveOnly={liveOnly} locale={locale} query={query} />}
    </PublicShell>
  );
}
