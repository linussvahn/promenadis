import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "../components/dashboard";

export const Route = createFileRoute("/dashboard")({
  component: () => <Dashboard />,
  head: () => ({
    meta: [{ title: "My events · Promenadis" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});
