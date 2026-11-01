import type { MetaFunction } from "react-router";
import { EventWorkspace } from "../components/event-workspace";

export const meta: MetaFunction = () => [
  { title: "Event · Promenadis" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function EventOverviewRoute() {
  return <EventWorkspace view="overview" />;
}
