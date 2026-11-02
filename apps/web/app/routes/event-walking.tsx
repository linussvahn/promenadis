import type { MetaFunction } from "react-router";
import { EventWorkspace } from "../components/event-workspace";

export const meta: MetaFunction = () => [
  { title: "Walking routes · Promenadis" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function EventWalkingRoute() {
  return <EventWorkspace view="walking" />;
}
