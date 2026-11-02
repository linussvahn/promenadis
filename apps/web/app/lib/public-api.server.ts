import { createPromenadisApiClient, PromenadisApiError } from "@promenadis/api-client";
import { data } from "react-router";

// Server-side loaders read public pages directly from the BFF, anonymously.
function serverApi() {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!baseUrl) return null;
  return createPromenadisApiClient({ baseUrl, ...(publishableKey ? { publishableKey } : {}) });
}

type ServerApi = NonNullable<ReturnType<typeof serverApi>>;

// 404 and 410 pass through as route errors; anything else is a 503 so a
// backend outage never looks like a removed page.
export async function loadPublic<T>(load: (api: ServerApi) => Promise<T>): Promise<T> {
  const api = serverApi();
  if (!api) throw data(null, { status: 503 });
  try {
    return await load(api);
  } catch (error) {
    if (error instanceof PromenadisApiError && (error.status === 404 || error.status === 410)) {
      throw data(null, { status: error.status });
    }
    throw data(null, { status: 503 });
  }
}

export const noIndexHeaders = {
  "x-robots-tag": "noindex, nofollow, nosnippet, noimageindex",
} as const;
