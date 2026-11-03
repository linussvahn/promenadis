import { createFileRoute } from "@tanstack/react-router";
import { OrganizerPublicPage, PublicShell } from "../../components/public-pages";
import { getPublicOrganizer } from "../../lib/public-api";

export const Route = createFileRoute("/o/$key")({
  loader: async ({ params }) => {
    const { organizer, origin } = await getPublicOrganizer({ data: { key: params.key } });
    return { canonicalUrl: `${origin}/o/${organizer.publicKey}`, organizer };
  },
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: [{ title: `${loaderData.organizer.displayName} · Promenadis` }],
          links: [{ rel: "canonical", href: loaderData.canonicalUrl }],
        }
      : { meta: [{ title: "Promenadis" }] },
  component: OrganizerRoute,
});

function OrganizerRoute() {
  const { organizer } = Route.useLoaderData();
  return (
    <PublicShell>
      {(locale) => <OrganizerPublicPage locale={locale} organizer={organizer} />}
    </PublicShell>
  );
}
