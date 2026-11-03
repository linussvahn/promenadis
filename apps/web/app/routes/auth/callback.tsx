import { createFileRoute } from "@tanstack/react-router";
import { AuthCallback } from "../../components/auth-callback";

export const Route = createFileRoute("/auth/callback")({
  component: () => <AuthCallback />,
  head: () => ({
    meta: [
      { title: "Slutför inloggning — Promenadis" },
      { name: "robots", content: "noindex, nofollow, nosnippet" },
    ],
  }),
});
