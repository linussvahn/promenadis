/**
 * Scripts run only from this origin or with the response's nonce; workers
 * also from blob: URLs, which the map library uses for its tile workers.
 */
export function contentSecurityPolicy(nonce: string) {
  return [
    `script-src 'self' 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
