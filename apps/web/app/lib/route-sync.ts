import { PromenadisApiError } from "@promenadis/api-client";
import type { SaveSyncedRouteRequest, SyncedRoute } from "@promenadis/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeSessionChanges } from "./account-session";
import { emptyRoute, type SavedRoute } from "./route-state";
import { getBrowserAuthClient, getPromenadisApiClient } from "./supabase";

// Signed-in route sync. Only these fields leave the device: the chosen
// sellers, progress and route-wide preferences. The start, any position and
// the computed plan stay local.
export type SyncedFields = Omit<SaveSyncedRouteRequest, "expectedVersion">;

const sorted = (list: readonly string[]) => [...new Set(list)].sort();

export function syncedFields(route: SavedRoute): SyncedFields {
  return {
    mustSee: sorted(route.mustSee),
    preferences: {
      mode: route.preferences.mode,
      pace: route.preferences.pace,
      returnToStart: route.preferences.returnToStart,
    },
    selected: sorted(route.selected),
    skipped: sorted(route.progress.skipped),
    visitedSellers: sorted(route.progress.visitedSellers),
    visitedStops: sorted(route.progress.visitedStops),
  };
}

const fingerprint = (fields: SyncedFields) => JSON.stringify(fields);

export function hasContent(route: SavedRoute) {
  return (
    route.selected.length > 0 ||
    route.progress.visitedStops.length > 0 ||
    route.progress.visitedSellers.length > 0 ||
    route.progress.skipped.length > 0
  );
}

/** Local changes since the last confirmed sync for this account. */
export function isDirty(route: SavedRoute, accountId: string) {
  return (
    route.sync?.accountId !== accountId ||
    route.sync.fingerprint !== fingerprint(syncedFields(route))
  );
}

export function markSynced(route: SavedRoute, accountId: string, version: number): SavedRoute {
  return { ...route, sync: { accountId, fingerprint: fingerprint(syncedFields(route)), version } };
}

/** Replaces the synced fields with the server's; the start and plan stay. */
export function applySynced(route: SavedRoute, server: SyncedRoute, accountId: string): SavedRoute {
  const selectionChanged = sorted(route.selected).join() !== sorted(server.selected).join();
  const next: SavedRoute = {
    ...route,
    mustSee: server.mustSee,
    planStale: route.planStale || (selectionChanged && Boolean(route.plan)),
    preferences: { ...route.preferences, ...server.preferences },
    progress: {
      ...route.progress,
      skipped: server.skipped,
      visitedSellers: server.visitedSellers,
      visitedStops: server.visitedStops,
    },
    selected: server.selected,
  };
  return markSynced(next, accountId, server.version);
}

const union = (a: readonly string[], b: readonly string[]) => sorted([...a, ...b]);

/** Both sides changed: keep everything chosen or visited on either. */
export function mergeRoutes(route: SavedRoute, server: SyncedRoute): SavedRoute {
  return {
    ...route,
    mustSee: union(route.mustSee, server.mustSee).slice(0, 10),
    progress: {
      ...route.progress,
      skipped: union(route.progress.skipped, server.skipped),
      visitedSellers: union(route.progress.visitedSellers, server.visitedSellers),
      visitedStops: union(route.progress.visitedStops, server.visitedStops),
    },
    selected: union(route.selected, server.selected),
  };
}

export interface Reconciled {
  readonly route: SavedRoute;
  /** Version to save against, or null when the server already matches. */
  readonly push: number | null;
}

export function reconcile(
  local: SavedRoute,
  server: SyncedRoute | null,
  accountId: string,
): Reconciled {
  const known = local.sync?.accountId === accountId ? local.sync : null;
  // A route synced for another account never moves into this one.
  const base =
    local.sync && !known
      ? { ...emptyRoute(local.eventKey, local.expiresAt), preferences: local.preferences }
      : local;
  const dirty = !known || isDirty(base, accountId);
  if (!server) {
    return hasContent(base) ? { push: 0, route: base } : { push: null, route: base };
  }
  if (known && known.version === server.version) {
    return { push: dirty ? server.version : null, route: base };
  }
  if (server.deleted) {
    // Removed on another device: clear this copy too.
    if (known) return { push: null, route: applySynced(base, server, accountId) };
    return hasContent(base)
      ? { push: server.version, route: base }
      : { push: null, route: markSynced(base, accountId, server.version) };
  }
  if (dirty && hasContent(base)) {
    return { push: server.version, route: mergeRoutes(base, server) };
  }
  return { push: null, route: applySynced(base, server, accountId) };
}

export type SyncState = "off" | "saving" | "synced" | "offline" | "closed";

/**
 * Keeps a signed-in visitor's route in step with their account. `walk` must
 * already be loaded for this event; `apply` stores a reconciled route.
 */
export function useRouteSync(
  visibility: "public" | "unlisted",
  walk: SavedRoute,
  apply: (route: SavedRoute) => void,
  enabled: boolean,
) {
  const [state, setState] = useState<SyncState>("off");
  const [accountId, setAccountId] = useState<string | null>(null);
  const latest = useRef({ apply, walk });
  latest.current = { apply, walk };
  const busy = useRef(false);
  // Bumped by remove(): a sync already in flight must not restore the walk.
  const generation = useRef(0);
  const eventKey = walk.eventKey;

  const run = useCallback(
    async (read: boolean) => {
      const api = getPromenadisApiClient();
      const auth = getBrowserAuthClient();
      if (!api || !auth || busy.current) return;
      busy.current = true;
      const started = generation.current;
      const stale = () => started !== generation.current;
      try {
        const { data } = await auth.auth.getSession();
        const account = data.session?.user.id ?? null;
        setAccountId(account);
        if (!account) {
          setState("off");
          return;
        }
        let current = latest.current.walk;
        let server: SyncedRoute | null | undefined;
        if (read || current.sync?.accountId !== account) {
          server = (await api.getSyncedRoute(account, visibility, eventKey)).route;
          // The visitor may have changed the walk while the read was in flight.
          current = latest.current.walk;
        } else if (!isDirty(current, account)) {
          setState("synced");
          return;
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const result =
            server === undefined
              ? { push: current.sync?.version ?? 0, route: current }
              : reconcile(current, server, account);
          if (stale()) return;
          if (result.route !== current) latest.current.apply(result.route);
          current = result.route;
          if (result.push === null) {
            setState("synced");
            return;
          }
          setState("saving");
          const sent = syncedFields(current);
          const saved = await api.saveSyncedRoute(account, visibility, eventKey, {
            ...sent,
            expectedVersion: result.push,
          });
          if (!saved.conflict && saved.route) {
            if (stale()) return;
            // The visitor may have changed the walk while this was in flight.
            const now = latest.current.walk;
            const confirmed = {
              ...now,
              sync: {
                accountId: account,
                fingerprint: fingerprint(sent),
                version: saved.route.version,
              },
            };
            latest.current.apply(confirmed);
            setState(isDirty(confirmed, account) ? "saving" : "synced");
            return;
          }
          server = saved.route;
          current = latest.current.walk;
        }
        setState("offline");
      } catch (error) {
        setState(
          error instanceof PromenadisApiError && error.status === 410 ? "closed" : "offline",
        );
      } finally {
        busy.current = false;
      }
    },
    [eventKey, visibility],
  );

  // Read on load, when the session changes, on focus and when back online.
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => void run(true);
    refresh();
    const unsubscribe = subscribeSessionChanges(refresh);
    window.addEventListener("online", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("online", refresh);
    };
  }, [enabled, run]);

  // Save shortly after the last local change.
  const pending = accountId && isDirty(walk, accountId) ? fingerprint(syncedFields(walk)) : null;
  useEffect(() => {
    if (!enabled || !pending || state === "closed") return;
    const timer = window.setTimeout(() => void run(false), 800);
    return () => window.clearTimeout(timer);
  }, [enabled, pending, run, state]);

  /** Deletes the synced route on every device, and this device's copy. */
  const remove = useCallback(async () => {
    const api = getPromenadisApiClient();
    if (!api || !accountId) return;
    generation.current += 1;
    try {
      const removed = await api.deleteSyncedRoute(accountId, visibility, eventKey);
      generation.current += 1;
      const cleared = emptyRoute(eventKey, latest.current.walk.expiresAt);
      latest.current.apply(
        removed.route ? markSynced(cleared, accountId, removed.route.version) : cleared,
      );
      setState("synced");
    } catch {
      setState("offline");
    }
  }, [accountId, eventKey, visibility]);

  return { remove, signedIn: accountId !== null, state } as const;
}
