import type { LngLat, Pace } from "@promenadis/routing";
import type { ComputedPlan } from "./route-compute";

// The visitor's route lives only on this device. Start points, positions and
// progress are never uploaded, logged or synced, and expire with the event.
export interface RoutePreferences {
  readonly mode: "availability" | "shortest";
  readonly pace: Pace;
  readonly returnToStart: boolean;
  /** "location" uses an in-memory position that is never stored. */
  readonly startKind: "none" | "stop" | "map" | "location";
  readonly startPoint: LngLat | null;
  readonly startStopId: string | null;
}

export interface RouteProgress {
  readonly current: number;
  readonly skipped: readonly string[];
  readonly visitedSellers: readonly string[];
  readonly visitedStops: readonly string[];
}

export interface SavedRoute {
  readonly active: boolean;
  /** Safety-feed blocks the plan was computed with. */
  readonly blockedEdgeIds: readonly string[];
  readonly eventKey: string;
  readonly expiresAt: string;
  readonly graphVersion: string | null;
  readonly includeUnreachable: readonly string[];
  /** Stop ID -> position the visitor fixed by reordering. */
  readonly locked: Readonly<Record<string, number>>;
  readonly mustSee: readonly string[];
  readonly plan: ComputedPlan | null;
  /** The visitor reordered stops; times and paths need a recalculation. */
  readonly planStale: boolean;
  readonly preferences: RoutePreferences;
  readonly progress: RouteProgress;
  readonly selected: readonly string[];
  readonly version: 1;
}

export const defaultPreferences: RoutePreferences = {
  mode: "availability",
  pace: "standard",
  returnToStart: false,
  startKind: "none",
  startPoint: null,
  startStopId: null,
};

export function emptyRoute(eventKey: string, expiresAt: string): SavedRoute {
  return {
    active: false,
    blockedEdgeIds: [],
    eventKey,
    expiresAt,
    graphVersion: null,
    includeUnreachable: [],
    locked: {},
    mustSee: [],
    plan: null,
    planStale: false,
    preferences: defaultPreferences,
    progress: { current: 0, skipped: [], visitedSellers: [], visitedStops: [] },
    selected: [],
    version: 1,
  };
}

const storageKey = (eventKey: string) => `promenadis-route:${eventKey}`;

export function loadRoute(eventKey: string, expiresAt: string, now = Date.now()): SavedRoute {
  try {
    const raw = window.localStorage.getItem(storageKey(eventKey));
    const saved = raw ? (JSON.parse(raw) as SavedRoute) : null;
    if (saved?.version === 1 && saved.eventKey === eventKey && Date.parse(saved.expiresAt) > now) {
      return { ...saved, expiresAt };
    }
    if (saved) window.localStorage.removeItem(storageKey(eventKey));
  } catch {
    // Storage may be blocked; the route then lives in memory only.
  }
  return emptyRoute(eventKey, expiresAt);
}

/** False when the route could not be stored (shown as a loss-risk warning). */
export function saveRoute(route: SavedRoute): boolean {
  try {
    window.localStorage.setItem(storageKey(route.eventKey), JSON.stringify(route));
    return true;
  } catch {
    return false;
  }
}

export function clearRoute(eventKey: string) {
  try {
    window.localStorage.removeItem(storageKey(eventKey));
  } catch {
    // Nothing stored.
  }
}

const toggle = (list: readonly string[], id: string, on: boolean) =>
  on ? [...new Set([...list, id])] : list.filter((item) => item !== id);

export function setSelected(route: SavedRoute, sellerId: string, on: boolean): SavedRoute {
  return {
    ...route,
    mustSee: on ? route.mustSee : route.mustSee.filter((id) => id !== sellerId),
    selected: toggle(route.selected, sellerId, on),
  };
}

export function setMustSee(route: SavedRoute, sellerId: string, on: boolean): SavedRoute {
  if (on && route.mustSee.length >= 10) return route;
  return {
    ...route,
    mustSee: toggle(route.mustSee, sellerId, on),
    selected: on ? toggle(route.selected, sellerId, true) : route.selected,
  };
}

export function step(route: SavedRoute, delta: number): SavedRoute {
  const length = route.plan?.order.length ?? 0;
  const current = Math.min(Math.max(0, route.progress.current + delta), Math.max(0, length - 1));
  return { ...route, progress: { ...route.progress, current } };
}

export function markStopVisited(
  route: SavedRoute,
  stopId: string,
  sellerIds: readonly string[],
  on: boolean,
) {
  const visitedSellers = sellerIds.reduce(
    (list, id) => toggle(list, id, on),
    route.progress.visitedSellers,
  );
  return {
    ...route,
    progress: {
      ...route.progress,
      visitedSellers,
      visitedStops: toggle(route.progress.visitedStops, stopId, on),
    },
  };
}

export function markSellerVisited(route: SavedRoute, sellerId: string, on: boolean): SavedRoute {
  return {
    ...route,
    progress: {
      ...route.progress,
      visitedSellers: toggle(route.progress.visitedSellers, sellerId, on),
    },
  };
}

export function setSkipped(route: SavedRoute, stopId: string, on: boolean): SavedRoute {
  return {
    ...route,
    progress: { ...route.progress, skipped: toggle(route.progress.skipped, stopId, on) },
  };
}

/** Manual reorder: moves a stop and locks the moved stops where the visitor put them. */
export function moveStop(route: SavedRoute, stopId: string, delta: -1 | 1): SavedRoute {
  if (!route.plan) return route;
  const order = [...route.plan.order];
  const from = order.indexOf(stopId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return route;
  [order[from], order[to]] = [order[to] as string, order[from] as string];
  return {
    ...route,
    locked: { ...route.locked, [order[to] as string]: to, [order[from] as string]: from },
    plan: { ...route.plan, order },
    planStale: true,
  };
}
