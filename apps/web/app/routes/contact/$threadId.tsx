import { createFileRoute } from "@tanstack/react-router";
import { ContactThread } from "../../components/organizer-contact";
import { PublicShell } from "../../components/public-pages";
import { noIndexHeaders } from "../../lib/public-api";

export const Route = createFileRoute("/contact/$threadId")({
  headers: () => ({ ...noIndexHeaders, "referrer-policy": "no-referrer" }),
  head: () => ({
    meta: [
      { title: "Meddelande · Promenadis" },
      { name: "robots", content: "noindex, nofollow, nosnippet, noimageindex" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: ContactThreadRoute,
});

function ContactThreadRoute() {
  const { threadId } = Route.useParams();
  return (
    <PublicShell>{(locale) => <ContactThread locale={locale} threadId={threadId} />}</PublicShell>
  );
}
