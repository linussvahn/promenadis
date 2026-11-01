import type { MetaFunction } from "react-router";
import { Settings } from "../components/settings";

export const meta: MetaFunction = () => [
  { title: "Settings · Promenadis" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function SettingsRoute() {
  return <Settings />;
}
