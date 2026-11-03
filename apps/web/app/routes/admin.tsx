import { createFileRoute } from "@tanstack/react-router";
import { AdminConsole } from "../components/admin-console";

export const Route = createFileRoute("/admin")({
  component: () => <AdminConsole />,
  head: () => ({
    meta: [{ title: "Admin · Promenadis" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});
