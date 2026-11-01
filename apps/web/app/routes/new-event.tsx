import type { MetaFunction } from "react-router";
import { NewEvent } from "../components/new-event";

export const meta: MetaFunction = () => [
  { title: "Create event · Promenadis" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function NewEventRoute() {
  return <NewEvent />;
}
