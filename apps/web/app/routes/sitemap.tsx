import { loadPublic } from "../lib/public-api.server";
import type { Route } from "./+types/sitemap";

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/gu, (character) => `&#${character.charCodeAt(0)};`);
}

// Derived from the same visibility/lifecycle state as discovery: published
// public events and their organizers only. Never unlisted or archived events.
export async function loader({ request }: Route.LoaderArgs) {
  const origin = new URL(request.url).origin;
  const sitemap = await loadPublic((api) => api.getPublicSitemap());
  const entries = [
    { loc: `${origin}/discover`, lastmod: null as string | null },
    ...sitemap.events.map((entry) => ({
      loc: `${origin}/e/${entry.publicKey}`,
      lastmod: entry.updatedAt,
    })),
    ...sitemap.organizers.map((entry) => ({
      loc: `${origin}/o/${entry.publicKey}`,
      lastmod: entry.updatedAt,
    })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (entry) =>
      `  <url><loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>
`;
  return new Response(body, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "application/xml; charset=utf-8",
    },
  });
}
