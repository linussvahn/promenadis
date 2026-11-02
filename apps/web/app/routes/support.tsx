import { PublicShell } from "../components/public-pages";
import { SupportForm } from "../components/support-forms";
import type { Route } from "./+types/support";

export const meta: Route.MetaFunction = () => [{ title: "Support · Promenadis" }];

export default function SupportRoute() {
  return <PublicShell>{(locale) => <SupportForm locale={locale} />}</PublicShell>;
}
