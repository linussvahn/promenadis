import type { MetaFunction } from "react-router";
import { EventWorkspace } from "../components/event-workspace";

export const meta: MetaFunction = () => [
  { title: "Event sellers · Promenadis" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function EventSellersRoute() {
  return <EventWorkspace view="sellers" />;
}
