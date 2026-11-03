import { createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl, setResponseStatus } from "@tanstack/react-start/server";

// Public pages read the BFF anonymously, always on the server: the first
// render and later client navigations alike call these server functions.
function serverApi() {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!baseUrl) return null;
  return createPromenadisApiClient({ baseUrl, ...(publishableKey ? { publishableKey } : {}) });
}

type ServerApi = NonNullable<ReturnType<typeof serverApi>>;

// 404 and 410 become not-found pages with that status; anything else is a
// 503 so a backend outage never looks like a removed page.
async function loadPublic<T>(load: (api: ServerApi) => Promise<T>): Promise<T> {
  const api = serverApi();
  if (!api) {
    setResponseStatus(503);
    throw new Error("unavailable");
  }
  try {
    return await load(api);
  } catch (error) {
    if (error instanceof PromenadisApiError && (error.status === 404 || error.status === 410)) {
      setResponseStatus(error.status);
      throw notFound({ data: { status: error.status } });
    }
    setResponseStatus(503);
    throw new Error("unavailable");
  }
}

const origin = () => getRequestUrl().origin;

export const getPublicEvent = createServerFn({ method: "GET" })
  .validator((input: { route: "public" | "unlisted"; key: string }) => input)
  .handler(async ({ data }) => {
    const event = await loadPublic((api) => api.getPublicEvent(data.route, data.key));
    return { event, origin: origin() };
  });

export const listPublicEvents = createServerFn({ method: "GET" })
  .validator((input: { after: string | null; liveOnly: boolean; query: string }) => input)
  .handler(async ({ data }) => {
    const list = await loadPublic((api) => api.listPublicEvents(data));
    return { list, origin: origin() };
  });

export const getPublicOrganizer = createServerFn({ method: "GET" })
  .validator((input: { key: string }) => input)
  .handler(async ({ data }) => {
    const organizer = await loadPublic((api) => api.getPublicOrganizer(data.key));
    return { organizer, origin: origin() };
  });

export const getPublicSitemap = createServerFn({ method: "GET" }).handler(() =>
  loadPublic((api) => api.getPublicSitemap()),
);

/** The HTTP status carried by a not-found or error value, if any. */
export function httpStatus(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { status?: unknown; data?: { status?: unknown } };
  if (typeof record.status === "number") return record.status;
  if (typeof record.data?.status === "number") return record.data.status;
  return null;
}

export const noIndexHeaders = {
  "x-robots-tag": "noindex, nofollow, nosnippet, noimageindex",
} as const;
