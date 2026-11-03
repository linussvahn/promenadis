import { createFileRoute } from "@tanstack/react-router";
import { EventWorkspace } from "../../../components/event-workspace";

export const Route = createFileRoute("/events/$eventId/review")({
  component: () => <EventWorkspace view="review" />,
  head: () => ({
    meta: [
      { title: "Review event · Promenadis" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
