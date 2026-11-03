import { randomBytes } from "node:crypto";
import handler from "@tanstack/react-start/server-entry";
import { contentSecurityPolicy } from "./lib/csp-nonce";

// Every response gets the security headers; HTML responses get a fresh
// script nonce that the router also stamps on its own scripts.
export default {
  async fetch(request: Request) {
    const nonce = randomBytes(16).toString("base64");
    const response = await handler.fetch(request, { context: { nonce } });
    const headers = new Headers(response.headers);
    // Location may be asked for by this origin only, never by embedded frames.
    headers.set("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
    headers.set("X-Frame-Options", "DENY");
    headers.set("X-Content-Type-Options", "nosniff");
    // Unlisted pages set a stricter referrer policy themselves.
    if (!headers.has("Referrer-Policy")) {
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    }
    if (headers.get("content-type")?.startsWith("text/html")) {
      headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
    }
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  },
};
