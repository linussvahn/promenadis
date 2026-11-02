import type { MetaFunction } from "react-router";
import { SellerJoin } from "../components/seller-join";

export const meta: MetaFunction = () => [
  { title: "Sell at an event · Promenadis" },
  { name: "robots", content: "noindex, nofollow" },
];

export default function EventJoinRoute() {
  return <SellerJoin />;
}
