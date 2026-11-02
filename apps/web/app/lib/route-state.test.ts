import { afterEach, describe, expect, it } from "vitest";
import {
  emptyRoute,
  loadRoute,
  markStopVisited,
  moveStop,
  saveRoute,
  setMustSee,
  setSelected,
  type SavedRoute,
  setSkipped,
  step,
} from "./route-state";

const key = "c".repeat(32);
const later = new Date(Date.now() + 3_600_000).toISOString();
const plan = {
  arrivals: [1, 2, 3],
  departures: [2, 3, 4],
  incomplete: false,
  legs: [],
  missedSellerIds: [],
  order: ["a", "b", "c"],
  paths: [],
  walkSeconds: 60,
};

afterEach(() => localStorage.clear());

describe("route state", () => {
  it("keeps the route on this device until the event expires", () => {
    const route = { ...emptyRoute(key, later), selected: ["s1"] };
    expect(saveRoute(route)).toBe(true);
    expect(loadRoute(key, later).selected).toEqual(["s1"]);
    expect(loadRoute(key, later, Date.now() + 7_200_000).selected).toEqual([]);
    expect(localStorage.getItem(`promenadis-route:${key}`)).toBeNull();
  });

  it("caps must-see at ten and drops it with the selection", () => {
    let route = emptyRoute(key, later);
    for (let i = 0; i < 11; i++) route = setMustSee(route, `s${i}`, true);
    expect(route.mustSee).toHaveLength(10);
    expect(route.selected).toHaveLength(10);
    route = setSelected(route, "s0", false);
    expect(route.mustSee).not.toContain("s0");
  });

  it("tracks progress, skips and manual reordering with locks", () => {
    let route: SavedRoute = { ...emptyRoute(key, later), active: true, plan };
    route = step(step(step(route, 1), 1), 1);
    expect(route.progress.current).toBe(2);
    route = markStopVisited(route, "a", ["s1", "s2"], true);
    expect(route.progress.visitedSellers).toEqual(["s1", "s2"]);
    route = setSkipped(route, "b", true);
    route = setSkipped(route, "b", false);
    expect(route.progress.skipped).toEqual([]);
    route = moveStop(route, "c", -1);
    expect(route.plan?.order).toEqual(["a", "c", "b"]);
    expect(route.locked).toEqual({ b: 2, c: 1 });
    expect(route.planStale).toBe(true);
  });
});
