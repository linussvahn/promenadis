import type { Route } from "./+types/robots";

// Crawl hints only: robots.txt is never access control, so no-index pages
// stay fetchable and unlisted paths are deliberately not named here.
export function loader({ request }: Route.LoaderArgs) {
  const origin = new URL(request.url).origin;
  return new Response(
    `User-agent: *\nDisallow: /api/\nDisallow: /dashboard\nDisallow: /settings\nDisallow: /admin\n\nSitemap: ${origin}/sitemap.xml\n`,
    {
      headers: {
        "cache-control": "public, max-age=3600",
        "content-type": "text/plain; charset=utf-8",
      },
    },
  );
}
