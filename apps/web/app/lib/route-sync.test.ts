import type { SyncedRoute } from "@promenadis/contracts";
import { describe, expect, it } from "vitest";
import { emptyRoute, markStopVisited, setSelected } from "./route-state";
import { isDirty, markSynced, reconcile, syncedFields } from "./route-sync";

const key = "d".repeat(32);
const later = new Date(Date.now() + 3_600_000).toISOString();
const seller = (n: number) => String(n).repeat(24);
const stop = (n: number) => `${n}`.repeat(24).replace(/^./u, "a");
const account = "01992026-1108-7100-8000-000000000001";

function server(overrides: Partial<SyncedRoute> = {}): SyncedRoute {
  return {
    deleted: false,
    mustSee: [],
    preferences: { mode: "availability", pace: "standard", returnToStart: false },
    selected: [seller(1)],
    skipped: [],
    version: 3,
    visitedSellers: [],
    visitedStops: [stop(1)],
    ...overrides,
  };
}

describe("syncedFields", () => {
  it("sends chosen sellers, progress and route-wide preferences, never the start", () => {
    const route = {
      ...setSelected(emptyRoute(key, later), seller(2), true),
      preferences: {
        ...emptyRoute(key, later).preferences,
        startKind: "map" as const,
        startPoint: [18.06, 59.33] as const,
      },
    };
    const fields = syncedFields(route);
    expect(Object.keys(fields).sort()).toEqual([
      "mustSee",
      "preferences",
      "selected",
      "skipped",
      "visitedSellers",
      "visitedStops",
    ]);
    expect(Object.keys(fields.preferences).sort()).toEqual(["mode", "pace", "returnToStart"]);
    expect(JSON.stringify(fields)).not.toContain("18.06");
  });
});

describe("reconcile", () => {
  it("uploads a local route when the account has none", () => {
    const local = setSelected(emptyRoute(key, later), seller(2), true);
    expect(reconcile(local, null, account)).toMatchObject({ push: 0, route: local });
  });

  it("does nothing for an empty route the account does not have", () => {
    expect(reconcile(emptyRoute(key, later), null, account).push).toBeNull();
  });

  it("adopts the account's route on a fresh device", () => {
    const result = reconcile(emptyRoute(key, later), server(), account);
    expect(result.push).toBeNull();
    expect(result.route.selected).toEqual([seller(1)]);
    expect(result.route.progress.visitedStops).toEqual([stop(1)]);
    expect(isDirty(result.route, account)).toBe(false);
  });

  it("adopts newer changes from another device when nothing changed here", () => {
    const synced = markSynced(setSelected(emptyRoute(key, later), seller(1), true), account, 2);
    const result = reconcile(synced, server({ selected: [seller(1), seller(3)] }), account);
    expect(result.push).toBeNull();
    expect(result.route.selected).toEqual([seller(1), seller(3)]);
    expect(result.route.sync?.version).toBe(3);
  });

  it("merges when both sides changed and saves against the newer version", () => {
    const synced = markSynced(emptyRoute(key, later), account, 2);
    const local = markStopVisited(setSelected(synced, seller(2), true), stop(2), [seller(2)], true);
    const result = reconcile(local, server(), account);
    expect(result.push).toBe(3);
    expect(result.route.selected).toEqual([seller(1), seller(2)]);
    expect(result.route.progress.visitedStops).toEqual([stop(1), stop(2)]);
  });

  it("saves local changes when the account has not moved on", () => {
    const synced = markSynced(emptyRoute(key, later), account, 3);
    const local = setSelected(synced, seller(2), true);
    expect(reconcile(local, server(), account).push).toBe(3);
    expect(reconcile(synced, server({ selected: [], visitedStops: [] }), account).push).toBeNull();
  });

  it("clears this copy when the route was deleted on another device", () => {
    const local = markSynced(setSelected(emptyRoute(key, later), seller(1), true), account, 3);
    const deleted = server({ deleted: true, selected: [], version: 4, visitedStops: [] });
    const result = reconcile(local, deleted, account);
    expect(result.push).toBeNull();
    expect(result.route.selected).toEqual([]);
  });

  it("never moves a route synced for another account into this one", () => {
    const other = markSynced(
      setSelected(emptyRoute(key, later), seller(9), true),
      "01992026-1108-7100-8000-000000000002",
      5,
    );
    expect(reconcile(other, null, account)).toMatchObject({ push: null });
    expect(reconcile(other, null, account).route.selected).toEqual([]);
    expect(reconcile(other, server(), account).route.selected).toEqual([seller(1)]);
  });
});
