import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createIsomorphicFn, getGlobalStartContext } from "@tanstack/react-start";
import { parseSearch, stringifySearch } from "./lib/search";
import { routeTree } from "./routeTree.gen";

// The server entry puts a fresh nonce in each request's context; the router
// passes it to every script it renders. Browsers hide nonce values, so the
// client has none to give.
const requestNonce = createIsomorphicFn()
  .server(() => (getGlobalStartContext() as { nonce?: string } | undefined)?.nonce)
  .client(() => undefined);

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: true, retry: 1, staleTime: 30_000 },
    },
  });
  const nonce = requestNonce();
  const router = createRouter({
    context: { queryClient },
    defaultPreload: "intent",
    parseSearch,
    stringifySearch,
    routeTree,
    scrollRestoration: true,
    ...(nonce ? { ssr: { nonce } } : {}),
  });
  setupRouterSsrQueryIntegration({ queryClient, router });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
