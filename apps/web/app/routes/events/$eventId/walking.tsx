import { createFileRoute } from "@tanstack/react-router";
import { EventWorkspace } from "../../../components/event-workspace";

export const Route = createFileRoute("/events/$eventId/walking")({
  component: () => <EventWorkspace view="walking" />,
  head: () => ({
    meta: [
      { title: "Walking routes · Promenadis" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
