// Server-side geocoding adapter. Provider keys never reach the browser and the
// rest of the BFF sees only a normalized point. Results are proposals: the
// seller confirms or moves the pin.

export interface GeocodeQuery {
  readonly addressLine: string;
  readonly postalCode: string;
  readonly locality: string;
}

export interface GeocodePoint {
  readonly longitude: number;
  readonly latitude: number;
}

export interface Geocoder {
  readonly provider: "fixture" | "geoapify";
  lookup(query: GeocodeQuery): Promise<GeocodePoint | null>;
}

// Deterministic synthetic addresses for local development and tests only:
// "Testgatan N" / "Provgatan N" map to points inside the synthetic Stockholm
// test areas. Anything else is "not found", which exercises the manual pin.
const fixtureStreets: Record<string, GeocodePoint> = {
  provgatan: { latitude: 59.3322, longitude: 18.0605 },
  testgatan: { latitude: 59.331, longitude: 18.0605 },
};

export const fixtureGeocoder: Geocoder = {
  provider: "fixture",
  lookup(query) {
    const match = query.addressLine
      .trim()
      .toLowerCase()
      .match(/^(testgatan|provgatan)\s+(\d{1,3})\b/u);
    const street = match ? fixtureStreets[match[1] ?? ""] : undefined;
    if (!match || !street) return Promise.resolve(null);
    const number = Number(match[2]);
    return Promise.resolve({
      latitude: street.latitude,
      longitude: Number((street.longitude + number * 0.0001).toFixed(6)),
    });
  },
};

// Geoapify EU endpoint. Not exercised locally (no keys, no spend); enable only
// with a dedicated key after the provider review in PROVIDER_ENVIRONMENT_INVENTORY.
export function geoapifyGeocoder(apiKey: string): Geocoder {
  return {
    provider: "geoapify",
    async lookup(query) {
      const url = new URL("https://api.geoapify.com/v1/geocode/search");
      url.searchParams.set("street", query.addressLine);
      if (query.postalCode) url.searchParams.set("postcode", query.postalCode);
      if (query.locality) url.searchParams.set("city", query.locality);
      url.searchParams.set("filter", "countrycode:se");
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "1");
      url.searchParams.set("apiKey", apiKey);
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error("geocoder_unavailable");
      const body = (await response.json()) as { results?: { lon?: unknown; lat?: unknown }[] };
      const first = body.results?.[0];
      return typeof first?.lon === "number" && typeof first.lat === "number"
        ? { latitude: first.lat, longitude: first.lon }
        : null;
    },
  };
}

// Hosted deployments get no geocoder unless one is configured explicitly.
export function configuredGeocoder(env: (name: string) => string | undefined): Geocoder | null {
  const provider = env("GEOCODER_PROVIDER") ?? (env("DENO_DEPLOYMENT_ID") ? "none" : "fixture");
  if (provider === "fixture") return fixtureGeocoder;
  const key = env("GEOAPIFY_API_KEY");
  if (provider === "geoapify" && key) return geoapifyGeocoder(key);
  return null;
}

export function normalizedGeocodeKey(query: GeocodeQuery): string {
  return [query.addressLine, query.postalCode.replace(/\s+/gu, ""), query.locality]
    .map((part) => part.trim().replace(/\s+/gu, " ").toLowerCase())
    .join("|");
}
