import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "../components/settings";

export const Route = createFileRoute("/settings")({
  component: () => <Settings />,
  head: () => ({
    meta: [{ title: "Settings · Promenadis" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});
