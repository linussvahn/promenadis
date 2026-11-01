import type { MetaFunction } from "react-router";
import { EventWorkspace } from "../components/event-workspace";

export const meta: MetaFunction = () => [
  { title: "Event area · Promenadis" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function EventAreaRoute() {
  return <EventWorkspace view="area" />;
}
