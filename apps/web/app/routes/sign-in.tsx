import { SignIn } from "../components/sign-in";
import type { Route } from "./+types/sign-in";

export const meta: Route.MetaFunction = () => [{ title: "Logga in — Promenadis" }];

export default function SignInRoute() {
  return <SignIn />;
}
