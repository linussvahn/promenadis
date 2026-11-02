import { createContext, useContext } from "react";

// The per-response script nonce, set during server rendering. Browsers hide
// nonce values by emptying the attribute, so the client renders "" to match.
export const CspNonceContext = createContext("");

export const useCspNonce = () => useContext(CspNonceContext);

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
