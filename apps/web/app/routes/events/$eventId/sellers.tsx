import { createFileRoute } from "@tanstack/react-router";
import { EventWorkspace } from "../../../components/event-workspace";

export const Route = createFileRoute("/events/$eventId/sellers")({
  component: () => <EventWorkspace view="sellers" />,
  head: () => ({
    meta: [
      { title: "Event sellers · Promenadis" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
