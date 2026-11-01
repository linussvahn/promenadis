import type { MetaFunction } from "react-router";
import { EventWorkspace } from "../components/event-workspace";

export const meta: MetaFunction = () => [
  { title: "Review event · Promenadis" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function EventReviewRoute() {
  return <EventWorkspace view="review" />;
}
