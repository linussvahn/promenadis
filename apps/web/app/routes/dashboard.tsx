import type { MetaFunction } from "react-router";
import { Dashboard } from "../components/dashboard";

export const meta: MetaFunction = () => [
  { title: "My events · Promenadis" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function DashboardRoute() {
  return <Dashboard />;
}
