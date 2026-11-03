import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  type ErrorComponentProps,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Eyebrow } from "../components/page";
import { httpStatus } from "../lib/public-api";
import stylesheet from "../styles/app.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    links: [
      { rel: "stylesheet", href: stylesheet },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Promenadis" },
      {
        name: "description",
        content: "Plan and explore accessible neighbourhood walking events.",
      },
      { name: "theme-color", content: "#fbf5ea" },
    ],
  }),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
  errorComponent: ({ error }: ErrorComponentProps) => (
    <RootDocument>
      <ErrorPage status={httpStatus(error)} />
    </RootDocument>
  ),
  notFoundComponent: ({ data }) => <ErrorPage status={httpStatus(data) ?? 404} />,
});

function RootDocument({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="sv" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* The bootstrap sets only the root theme attribute before hydration. */}
        <script src="/theme.js" />
      </head>
      <body>
        {children}
        <Scripts />
        <script src="/register-sw.js" />
      </body>
    </html>
  );
}

function ErrorPage({ status }: { readonly status: number | null }) {
  let heading = "Något gick fel";
  let message = "Försök igen. Om problemet kvarstår kan tjänsten vara tillfälligt otillgänglig.";
  if (status === 404) heading = "Sidan hittades inte";
  else if (status === 410) {
    heading = "Sidan finns inte längre";
    message = "Länken har bytts ut eller evenemanget har tagits bort.";
  } else if (status) heading = `Fel ${status}`;
  return (
    <main className="mx-auto my-[10vh] grid w-[min(100%-2rem,52rem)] gap-4" id="main" tabIndex={-1}>
      <Eyebrow>Promenadis</Eyebrow>
      <h1 className="text-4xl font-extrabold sm:text-5xl">{heading}</h1>
      <p className="text-lg text-muted-foreground">{message}</p>
      <a className="font-semibold" href="/">
        Till startsidan
      </a>
    </main>
  );
}
