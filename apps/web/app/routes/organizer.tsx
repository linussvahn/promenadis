import { OrganizerPublicPage, PublicShell } from "../components/public-pages";
import { loadPublic } from "../lib/public-api.server";
import type { Route } from "./+types/organizer";

export async function loader({ params, request }: Route.LoaderArgs) {
  const organizer = await loadPublic((api) => api.getPublicOrganizer(params.key));
  return { canonicalUrl: `${new URL(request.url).origin}/o/${organizer.publicKey}`, organizer };
}

export const meta: Route.MetaFunction = ({ loaderData: data }) =>
  data
    ? [
        { title: `${data.organizer.displayName} · Promenadis` },
        { tagName: "link", rel: "canonical", href: data.canonicalUrl },
      ]
    : [{ title: "Promenadis" }];

export default function OrganizerRoute({ loaderData }: Route.ComponentProps) {
  return (
    <PublicShell>
      {(locale) => <OrganizerPublicPage locale={locale} organizer={loaderData.organizer} />}
    </PublicShell>
  );
}
