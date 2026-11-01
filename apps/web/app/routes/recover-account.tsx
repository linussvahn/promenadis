import { RecoverAccount } from "../components/recover-account";
import type { Route } from "./+types/recover-account";

export const meta: Route.MetaFunction = () => [{ title: "Återställ konto — Promenadis" }];

export default function RecoverAccountRoute() {
  return <RecoverAccount />;
}
