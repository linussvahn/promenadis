import { createFileRoute } from "@tanstack/react-router";
import { optionalStrings } from "../../../lib/search";
import { SellerJoin } from "../../../components/seller-join";

export const Route = createFileRoute("/events/$eventId/join")({
  validateSearch: optionalStrings("invite"),
  component: () => <SellerJoin />,
  head: () => ({
    meta: [
      { title: "Sell at an event · Promenadis" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});
