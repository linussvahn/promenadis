import { createFileRoute } from "@tanstack/react-router";
import { Welcome } from "../components/welcome";

export const Route = createFileRoute("/")({
  component: () => <Welcome />,
  head: () => ({ meta: [{ title: "Promenadis — upptäck kvarteret till fots" }] }),
});
