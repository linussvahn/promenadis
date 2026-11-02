import type { MetaFunction } from "react-router";
import { ReportPage } from "../components/report-form";

export const meta: MetaFunction = () => [
  { title: "Report · Promenadis" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function ReportRoute() {
  return <ReportPage />;
}
