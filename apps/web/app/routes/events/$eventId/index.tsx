import { createFileRoute } from "@tanstack/react-router";
import { EventWorkspace } from "../../../components/event-workspace";

export const Route = createFileRoute("/events/$eventId/")({
  component: () => <EventWorkspace view="overview" />,
  head: () => ({
    meta: [{ title: "Event · Promenadis" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});
