import { createFileRoute } from "@tanstack/react-router";
import { optionalStrings } from "../lib/search";
import { ReportPage } from "../components/report-form";

export const Route = createFileRoute("/report")({
  validateSearch: optionalStrings("key", "event", "type", "subject"),
  component: () => <ReportPage />,
  head: () => ({
    meta: [{ title: "Report · Promenadis" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});
