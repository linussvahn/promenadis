// Route ordering over a walking-distance matrix, kept separate from street
// pathfinding so either can change on its own.

export const WALKING_METERS_PER_SECOND = 1.25;
export const DETOUR_GUARDRAIL = 1.2;
export const MAX_ROUTE_STOPS = 50;
export const MAX_MUST_SEE = 10;

export type Pace = "quick" | "standard" | "leisurely";

const PACE_MINUTES: Record<Pace, readonly [number, number]> = {
  leisurely: [10, 5],
  quick: [2, 1],
  standard: [5, 2],
};

/** Visit minutes for one location from its selected seller count. */
export function visitMinutes(pace: Pace, sellers: number, customBase?: number) {
  const [base, extra] = PACE_MINUTES[pace];
  return (customBase ?? base) + extra * Math.max(0, sellers - 1);
}

export interface Window {
  readonly endsAt: number;
  readonly startsAt: number;
}

export interface RouteStop {
  readonly id: string;
  /** Position the visitor locked this stop to, if any (0-based in the route). */
  readonly lockedPosition?: number;
  readonly sellers: ReadonlyArray<{
    readonly id: string;
    readonly mustSee: boolean;
    readonly windows: readonly Window[];
  }>;
  readonly visitSeconds: number;
}

export interface OrderInput {
  /** Matrix over [start?, ...stops]; Infinity marks no walking path. */
  readonly matrix: readonly (readonly number[])[];
  readonly mode: "availability" | "shortest";
  readonly returnToStart: boolean;
  /** True when matrix row/column 0 is the start point. */
  readonly hasStart: boolean;
  readonly startTime: number;
  readonly stops: readonly RouteStop[];
}

export interface PlannedLeg {
  readonly from: number | null;
  readonly manualGap: boolean;
  readonly meters: number | null;
  readonly seconds: number | null;
  readonly to: number | null;
}

export interface RoutePlan {
  readonly arrivals: readonly number[];
  readonly departures: readonly number[];
  readonly legs: readonly PlannedLeg[];
  readonly missedSellerIds: readonly string[];
  /** Stop indices in visiting order. */
  readonly order: readonly number[];
  readonly incomplete: boolean;
  readonly walkSeconds: number;
}

export interface OrderResult {
  /** Present when reaching more sellers needs more than the 20% detour. */
  readonly alternative: RoutePlan | null;
  readonly plan: RoutePlan;
  readonly shortest: RoutePlan;
}

function legMeters(input: OrderInput, from: number | null, to: number | null) {
  const offset = input.hasStart ? 1 : 0;
  if (from === null && !input.hasStart) return 0;
  const row = from === null ? 0 : from + offset;
  const column = to === null ? 0 : to + offset;
  return input.matrix[row]?.[column] ?? Number.POSITIVE_INFINITY;
}

/** Walk the order in time, waiting for windows that have not opened yet. */
export function schedule(input: OrderInput, order: readonly number[]): RoutePlan {
  let time = input.startTime;
  let walkSeconds = 0;
  let incomplete = false;
  const legs: PlannedLeg[] = [];
  const arrivals: number[] = [];
  const departures: number[] = [];
  const missed: string[] = [];
  let previous: number | null = null;
  const addLeg = (from: number | null, to: number | null) => {
    if (from === null && to !== null && !input.hasStart) return;
    const meters = legMeters(input, from, to);
    if (!Number.isFinite(meters)) {
      // A manual gap: no verified path and no invented travel time.
      incomplete = true;
      legs.push({ from, manualGap: true, meters: null, seconds: null, to });
      return;
    }
    const seconds = Math.round(meters / WALKING_METERS_PER_SECOND);
    walkSeconds += seconds;
    time += seconds * 1000;
    legs.push({ from, manualGap: false, meters: Math.round(meters), seconds, to });
  };
  for (const index of order) {
    addLeg(previous, index);
    const stop = input.stops[index] as RouteStop;
    const opens = Math.min(
      ...stop.sellers.flatMap((seller) => seller.windows.map((window) => window.startsAt)),
      Number.POSITIVE_INFINITY,
    );
    if (Number.isFinite(opens) && time < opens) time = opens;
    arrivals.push(time);
    for (const seller of stop.sellers) {
      if (!seller.windows.some((window) => window.startsAt <= time && time < window.endsAt)) {
        missed.push(seller.id);
      }
    }
    time += stop.visitSeconds * 1000;
    departures.push(time);
    previous = index;
  }
  if (input.returnToStart && input.hasStart && previous !== null) addLeg(previous, null);
  return {
    arrivals,
    departures,
    incomplete,
    legs,
    missedSellerIds: missed,
    order: [...order],
    walkSeconds,
  };
}

function walkingOnly(input: OrderInput, order: readonly number[]) {
  let total = 0;
  let previous: number | null = null;
  for (const index of order) {
    if (previous !== null || input.hasStart) {
      const meters = legMeters(input, previous, index);
      // Manual gaps cost a large constant so connected stops cluster together.
      total += Number.isFinite(meters) ? meters : 1e7;
    }
    previous = index;
  }
  if (input.returnToStart && input.hasStart && previous !== null) {
    const meters = legMeters(input, previous, null);
    total += Number.isFinite(meters) ? meters : 1e7;
  }
  return total;
}

function respectsLocks(input: OrderInput, order: readonly number[]) {
  return order.every((stop, position) => {
    const locked = input.stops[stop]?.lockedPosition;
    return locked === undefined || locked === position;
  });
}

function nearestNeighbour(input: OrderInput): number[] {
  const count = input.stops.length;
  const remaining = new Set(Array.from({ length: count }, (_, i) => i));
  const order: number[] = new Array(count);
  const placed = new Set<number>();
  for (const [index, stop] of input.stops.entries()) {
    if (
      stop.lockedPosition !== undefined &&
      stop.lockedPosition < count &&
      !placed.has(stop.lockedPosition)
    ) {
      order[stop.lockedPosition] = index;
      placed.add(stop.lockedPosition);
      remaining.delete(index);
    }
  }
  let previous: number | null = null;
  for (let position = 0; position < count; position++) {
    if (placed.has(position)) {
      previous = order[position] as number;
      continue;
    }
    let best = -1;
    let bestMeters = Number.POSITIVE_INFINITY;
    for (const candidate of remaining) {
      const meters =
        previous === null && !input.hasStart ? 0 : legMeters(input, previous, candidate);
      if (best < 0 || meters < bestMeters) {
        best = candidate;
        bestMeters = meters;
      }
    }
    order[position] = best;
    remaining.delete(best);
    previous = best;
  }
  return order;
}

// Local search with reversal and relocation moves under a cost function.
function improve(input: OrderInput, start: number[], cost: (order: number[]) => number) {
  let order = [...start];
  let best = cost(order);
  for (let pass = 0; pass < 50; pass++) {
    let improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const reversed = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        if (respectsLocks(input, reversed)) {
          const value = cost(reversed);
          if (value < best - 1e-9) {
            order = reversed;
            best = value;
            improved = true;
          }
        }
        const moved = [...order];
        const [item] = moved.splice(i, 1);
        moved.splice(j, 0, item as number);
        if (respectsLocks(input, moved)) {
          const value = cost(moved);
          if (value < best - 1e-9) {
            order = moved;
            best = value;
            improved = true;
          }
        }
      }
    }
    if (!improved) break;
  }
  return order;
}

/**
 * Availability-aware ordering: fewest sellers reached after closing within a
 * 20% walking detour over the shortest plan, then least walking. Must-see
 * sellers may exceed the guardrail. When a plan beyond the guardrail reaches
 * more sellers, it is returned as the alternative, never applied silently.
 */
export function orderRoute(input: OrderInput): OrderResult {
  if (input.stops.length === 0) {
    const empty = schedule(input, []);
    return { alternative: null, plan: empty, shortest: empty };
  }
  const shortestOrder = improve(input, nearestNeighbour(input), (order) =>
    walkingOnly(input, order),
  );
  const shortest = schedule(input, shortestOrder);
  if (input.mode === "shortest") return { alternative: null, plan: shortest, shortest };

  const mustSee = new Set(
    input.stops.flatMap((stop) =>
      stop.sellers.filter((seller) => seller.mustSee).map((seller) => seller.id),
    ),
  );
  const baseline = walkingOnly(input, shortestOrder);
  const misses = (order: number[]) => {
    const plan = schedule(input, order);
    const mustMissed = plan.missedSellerIds.filter((id) => mustSee.has(id)).length;
    return { mustMissed, others: plan.missedSellerIds.length - mustMissed, plan };
  };
  const costOf = (limit: number) => (order: number[]) => {
    const walk = walkingOnly(input, order);
    const result = misses(order);
    const over = walk > limit ? 1 : 0;
    return result.mustMissed * 1e12 + over * (result.others + 1) * 1e9 + result.others * 1e8 + walk;
  };
  const guarded = improve(input, shortestOrder, costOf(baseline * DETOUR_GUARDRAIL));
  const plan = schedule(input, guarded);
  const unbounded = improve(input, guarded, costOf(Number.POSITIVE_INFINITY));
  const unboundedPlan = schedule(input, unbounded);
  const alternative =
    unboundedPlan.missedSellerIds.length < plan.missedSellerIds.length ? unboundedPlan : null;
  return { alternative, plan, shortest };
}
