import { createFileRoute } from "@tanstack/react-router";
import { NewEvent } from "../../components/new-event";

export const Route = createFileRoute("/events/new")({
  component: () => <NewEvent />,
  head: () => ({
    meta: [
      { title: "Create event · Promenadis" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
