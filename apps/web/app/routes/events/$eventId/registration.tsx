import { createFileRoute } from "@tanstack/react-router";
import { EventWorkspace } from "../../../components/event-workspace";

export const Route = createFileRoute("/events/$eventId/registration")({
  component: () => <EventWorkspace view="registration" />,
  head: () => ({
    meta: [
      { title: "Event registration · Promenadis" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
