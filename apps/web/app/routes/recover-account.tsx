import { createFileRoute } from "@tanstack/react-router";
import { RecoverAccount } from "../components/recover-account";

export const Route = createFileRoute("/recover-account")({
  component: () => <RecoverAccount />,
  head: () => ({ meta: [{ title: "Återställ konto — Promenadis" }] }),
});
