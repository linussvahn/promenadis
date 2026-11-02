import type { RoutingPackageContract } from "@promenadis/contracts";
import {
  type LngLat,
  type OrderResult,
  orderRoute,
  type RoutePlan,
  START_SNAP_METERS,
  STOP_SNAP_METERS,
  WalkingGraph,
} from "@promenadis/routing";

export interface ComputeStop {
  readonly id: string;
  readonly lockedPosition?: number;
  readonly point: LngLat;
  readonly sellers: ReadonlyArray<{
    readonly id: string;
    readonly mustSee: boolean;
    readonly windows: ReadonlyArray<{ readonly endsAt: number; readonly startsAt: number }>;
  }>;
  readonly visitSeconds: number;
}

export interface ComputeRequest {
  readonly blockedEdgeIds: readonly string[];
  /** Stops the visitor chose to include although no walking path reaches them. */
  readonly includeUnreachable: readonly string[];
  readonly mode: "availability" | "shortest";
  readonly pkg: RoutingPackageContract;
  readonly returnToStart: boolean;
  readonly start: LngLat | null;
  readonly startTime: number;
  readonly stops: readonly ComputeStop[];
}

export interface ComputedLeg {
  /** Null for the start point. */
  readonly fromStopId: string | null;
  readonly manualGap: boolean;
  readonly meters: number | null;
  readonly seconds: number | null;
  readonly toStopId: string | null;
}

export interface ComputedPlan extends Omit<RoutePlan, "order" | "legs"> {
  readonly legs: readonly ComputedLeg[];
  /** Stop IDs in visiting order. */
  readonly order: readonly string[];
  /** Street geometry per leg; null for manual gaps. */
  readonly paths: ReadonlyArray<readonly LngLat[] | null>;
}

export interface ComputeResult {
  readonly alternative: ComputedPlan | null;
  /** Unreachable stops left out of the connected route. */
  readonly excluded: readonly string[];
  readonly plan: ComputedPlan;
  readonly shortest: ComputedPlan;
  /** "snapped" within 100 m (an unverified connector), "out_of_area", or "none". */
  readonly startStatus: "snapped" | "out_of_area" | "none";
  readonly startConnectorMeters: number | null;
}

// Pure and synchronous: runs in the worker, or inline when workers fail.
export function computeRoute(request: ComputeRequest): ComputeResult {
  const graph = new WalkingGraph(request.pkg, new Set(request.blockedEdgeIds));
  const startSnap = request.start ? graph.snap(request.start, START_SNAP_METERS) : null;
  const startStatus = !request.start ? "none" : startSnap ? "snapped" : "out_of_area";
  const snaps = request.stops.map((stop) => graph.snap(stop.point, STOP_SNAP_METERS));
  const full = graph.matrix(startSnap ? [startSnap, ...snaps] : snaps);
  const offset = startSnap ? 1 : 0;

  // The connected part is the one reaching the most stops.
  const reach = request.stops.map(
    (_, i) => full[i + offset]?.filter((meters) => Number.isFinite(meters)).length ?? 0,
  );
  const anchor = reach.indexOf(Math.max(0, ...reach));
  const connected = request.stops.map(
    (_, i) =>
      anchor >= 0 &&
      Number.isFinite(full[i + offset]?.[anchor + offset] ?? Number.POSITIVE_INFINITY),
  );
  const included = request.stops
    .map((stop, i) => ({ i, stop }))
    .filter(({ i, stop }) => connected[i] || request.includeUnreachable.includes(stop.id));
  const excluded = request.stops.filter(
    (stop, i) => !connected[i] && !request.includeUnreachable.includes(stop.id),
  );
  const rows = startSnap ? [0, ...included.map(({ i }) => i + offset)] : included.map(({ i }) => i);
  const matrix = rows.map((row) =>
    rows.map((column) => full[row]?.[column] ?? Number.POSITIVE_INFINITY),
  );
  const result: OrderResult = orderRoute({
    hasStart: startSnap !== null,
    matrix,
    mode: request.mode,
    returnToStart: request.returnToStart,
    startTime: request.startTime,
    stops: included.map(({ stop }) => stop),
  });

  const points = included.map(({ i }) => snaps[i]);
  const idOf = (index: number | null) =>
    index === null ? null : (included[index]?.stop.id ?? null);
  const named = (plan: RoutePlan): ComputedPlan => ({
    ...plan,
    legs: plan.legs.map((leg) => ({
      fromStopId: idOf(leg.from),
      manualGap: leg.manualGap,
      meters: leg.meters,
      seconds: leg.seconds,
      toStopId: idOf(leg.to),
    })),
    order: plan.order.map((index) => included[index]?.stop.id as string),
    paths: plan.legs.map((leg) => {
      if (leg.manualGap) return null;
      const from = leg.from === null ? startSnap : points[leg.from];
      const to = leg.to === null ? startSnap : points[leg.to];
      return from && to ? (graph.path(from, to)?.coordinates ?? null) : null;
    }),
  });
  return {
    alternative: result.alternative ? named(result.alternative) : null,
    excluded: excluded.map((stop) => stop.id),
    plan: named(result.plan),
    shortest: named(result.shortest),
    startConnectorMeters: startSnap ? Math.round(startSnap.meters) : null,
    startStatus,
  };
}
