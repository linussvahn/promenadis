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
  { name: "theme-color", content: "#f5efe2" },
];

export function Layout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="sv" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        {/* The bootstrap sets only the root theme attribute before hydration. */}
        <script src="/theme.js" />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
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
    heading = error.status === 404 ? "Sidan hittades inte" : `Fel ${error.status}`;
    message = error.statusText || message;
  }

  return (
    <main className="error-page" id="main" tabIndex={-1}>
      <p className="eyebrow">Promenadis</p>
      <h1>{heading}</h1>
      <p>{message}</p>
      <a href="/">Till startsidan</a>
    </main>
  );
}
