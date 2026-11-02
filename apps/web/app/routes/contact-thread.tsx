import { data } from "react-router";
import { ContactThread } from "../components/organizer-contact";
import { PublicShell } from "../components/public-pages";
import { noIndexHeaders } from "../lib/public-api.server";
import type { Route } from "./+types/contact-thread";

export function loader() {
  return data(null, { headers: { ...noIndexHeaders, "referrer-policy": "no-referrer" } });
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export const meta: Route.MetaFunction = () => [
  { title: "Meddelande · Promenadis" },
  { name: "robots", content: "noindex, nofollow, nosnippet, noimageindex" },
  { name: "referrer", content: "no-referrer" },
];

export default function ContactThreadRoute({ params }: Route.ComponentProps) {
  return (
    <PublicShell>
      {(locale) => <ContactThread locale={locale} threadId={params.threadId} />}
    </PublicShell>
  );
}
