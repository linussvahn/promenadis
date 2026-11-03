import { createFileRoute } from "@tanstack/react-router";
import { optionalStrings } from "../lib/search";
import { PublicShell } from "../components/public-pages";
import { SupportForm } from "../components/support-forms";

export const Route = createFileRoute("/support")({
  validateSearch: optionalStrings("topic"),
  component: () => <PublicShell>{(locale) => <SupportForm locale={locale} />}</PublicShell>,
  head: () => ({ meta: [{ title: "Support · Promenadis" }] }),
});
