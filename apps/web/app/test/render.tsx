import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { parseSearch, stringifySearch } from "../lib/search";

/**
 * Renders a component inside a real TanStack router and a fresh query
 * client. `path` is the route pattern (e.g. "/events/$eventId") and `url`
 * the address the test starts at, so `useParams` and `useSearch` work.
 */
export async function renderWithRouter(
  ui: ReactNode,
  { path = "/", url }: { readonly path?: string; readonly url?: string } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: () => <Outlet />,
  });
  const pageRoute = createRoute({
    component: () => <>{ui}</>,
    getParentRoute: () => rootRoute,
    path,
  });
  // Links to other pages resolve to an empty route instead of a not-found error.
  const elsewhere = createRoute({
    component: () => null,
    getParentRoute: () => rootRoute,
    path: "$",
  });
  const router = createRouter({
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url ?? path] }),
    parseSearch,
    stringifySearch,
    routeTree: rootRoute.addChildren([pageRoute, elsewhere]),
  });
  await router.load();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient, router };
}
