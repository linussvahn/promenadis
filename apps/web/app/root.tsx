import type { ReactNode } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import { Eyebrow } from "./components/page";
import { useCspNonce } from "./lib/csp-nonce";
import stylesheet from "./styles/app.css?url";

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "icon", href: "/icons/icon.svg", type: "image/svg+xml" },
];

export const meta: Route.MetaFunction = () => [
  { title: "Promenadis" },
  {
    name: "description",
    content: "Plan and explore accessible neighbourhood walking events.",
  },
  { name: "theme-color", content: "#fbf5ea" },
];

export function Layout({ children }: { readonly children: ReactNode }) {
  const nonce = useCspNonce();
  return (
    <html lang="sv" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        {/* The bootstrap sets only the root theme attribute before hydration. */}
        <script src="/theme.js" />
        <Links nonce={nonce} />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
        <script src="/register-sw.js" />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let heading = "Något gick fel";
  let message = "Försök igen. Om problemet kvarstår kan tjänsten vara tillfälligt otillgänglig.";

  if (isRouteErrorResponse(error)) {
    heading =
      error.status === 404
        ? "Sidan hittades inte"
        : error.status === 410
          ? "Sidan finns inte längre"
          : `Fel ${error.status}`;
    message = error.statusText || message;
    if (error.status === 410) message = "Länken har bytts ut eller evenemanget har tagits bort.";
  }

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
