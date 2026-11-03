import { createFileRoute } from "@tanstack/react-router";
import { SignIn } from "../components/sign-in";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { step?: "mfa" } =>
    search.step === "mfa" ? { step: "mfa" } : {},
  component: () => <SignIn />,
  head: () => ({ meta: [{ title: "Logga in — Promenadis" }] }),
});
