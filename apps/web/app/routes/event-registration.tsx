import type { MetaFunction } from "react-router";
import { EventWorkspace } from "../components/event-workspace";

export const meta: MetaFunction = () => [
  { title: "Event registration · Promenadis" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function EventRegistrationRoute() {
  return <EventWorkspace view="registration" />;
}
