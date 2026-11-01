import { AuthCallback } from "../components/auth-callback";
import type { Route } from "./+types/auth-callback";

export const meta: Route.MetaFunction = () => [
  { title: "Slutför inloggning — Promenadis" },
  { name: "robots", content: "noindex, nofollow, nosnippet" },
];

export default function AuthCallbackRoute() {
  return <AuthCallback />;
}
