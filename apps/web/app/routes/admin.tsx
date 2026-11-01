import type { MetaFunction } from "react-router";
import { AdminConsole } from "../components/admin-console";

export const meta: MetaFunction = () => [
  { title: "Admin · Promenadis" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function AdminRoute() {
  return <AdminConsole />;
}
