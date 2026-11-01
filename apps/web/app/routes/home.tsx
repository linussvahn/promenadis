import { Welcome } from "../components/welcome";
import type { Route } from "./+types/home";

export const meta: Route.MetaFunction = () => [
  { title: "Promenadis — upptäck kvarteret till fots" },
];

export default function Home() {
  return <Welcome />;
}
