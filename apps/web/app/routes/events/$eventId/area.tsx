import { createFileRoute } from "@tanstack/react-router";
import { optionalStrings } from "../../../lib/search";
import { EventWorkspace } from "../../../components/event-workspace";

export const Route = createFileRoute("/events/$eventId/area")({
  validateSearch: optionalStrings("new"),
  component: () => <EventWorkspace view="area" />,
  head: () => ({
    meta: [{ title: "Event area · Promenadis" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});
