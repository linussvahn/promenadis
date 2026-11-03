/**
 * A `validateSearch` that keeps the named query-string values as optional
 * strings and drops everything else. Optional keys keep links that omit
 * them type-correct.
 */
export function optionalStrings<const K extends string>(...keys: readonly K[]) {
  return (search: Record<string, unknown>): Partial<Record<K, string>> => {
    const result: Partial<Record<K, string>> = {};
    for (const key of keys) {
      const value = search[key];
      if (typeof value === "string" || typeof value === "number") result[key] = String(value);
    }
    return result;
  };
}

/** Plain query strings (`?new=1`), not the router's JSON-encoded values. */
export function parseSearch(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search));
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
