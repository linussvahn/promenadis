import type { PublicSnapshot, RoutingPackageContract } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { MAX_ROUTE_STOPS, type Pace, visitMinutes } from "@promenadis/routing";
import { useState } from "react";
import type { ComputedPlan, ComputeResult } from "../lib/route-compute";
import { planRoute } from "../lib/route-planner";
import {
  clearRoute,
  emptyRoute,
  markSellerVisited,
  markStopVisited,
  moveStop,
  type SavedRoute,
  setSkipped,
  step,
} from "../lib/route-state";
import type { VisibleStop } from "../lib/public-stops";

const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

function clock(locale: Locale, time: number, timeZone: string) {
  return new Intl.DateTimeFormat(locale === "sv" ? "sv-SE" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(time));
}

// Plans and follows a walk on this device only. A new plan or a changed
// network is offered, never applied silently to an active route.
export function RoutePlanner({
  blockedEdgeIds,
  graphVersion,
  locale,
  onChange,
  pkg,
  route,
  snapshot,
  stops,
}: {
  readonly blockedEdgeIds: readonly string[];
  readonly graphVersion: string | null;
  readonly locale: Locale;
  readonly onChange: (route: SavedRoute) => void;
  readonly pkg: RoutingPackageContract | null;
  readonly route: SavedRoute;
  readonly snapshot: PublicSnapshot;
  readonly stops: readonly VisibleStop[];
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComputeResult | null>(null);
  const [failed, setFailed] = useState(false);
  const selected = new Set(route.selected);
  const selectedStops = stops.filter((stop) =>
    stop.sellers.some((seller) => selected.has(seller.id)),
  );
  const stopById = new Map(stops.map((stop) => [stop.id, stop]));
  const preferences = route.preferences;
  const update = (patch: Partial<SavedRoute["preferences"]>) =>
    onChange({ ...route, preferences: { ...preferences, ...patch } });

  const plan = async (keepLocks: boolean) => {
    if (!pkg || selectedStops.length === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const startStop =
        preferences.startKind === "stop" ? stopById.get(preferences.startStopId ?? "") : null;
      const start =
        preferences.startKind === "map"
          ? preferences.startPoint
          : startStop
            ? ([
                startStop.entrance?.longitude ?? startStop.longitude,
                startStop.entrance?.latitude ?? startStop.latitude,
              ] as const)
            : null;
      const computed = await planRoute({
        blockedEdgeIds,
        includeUnreachable: route.includeUnreachable,
        mode: preferences.mode,
        pkg,
        returnToStart: preferences.returnToStart && start !== null,
        start,
        startTime: Math.max(
          Date.now(),
          Date.parse(snapshot.event.intervals[0]?.startsAt ?? "") || 0,
        ),
        stops: selectedStops.slice(0, MAX_ROUTE_STOPS).map((stop) => {
          const chosen = stop.sellers.filter((seller) => selected.has(seller.id));
          return {
            id: stop.id,
            ...(keepLocks && route.locked[stop.id] !== undefined
              ? { lockedPosition: route.locked[stop.id] }
              : {}),
            point: [
              stop.entrance?.longitude ?? stop.longitude,
              stop.entrance?.latitude ?? stop.latitude,
            ] as const,
            sellers: chosen.map((seller) => ({
              id: seller.id,
              mustSee: route.mustSee.includes(seller.id),
              windows: (seller.availability.length > 0
                ? seller.availability
                : snapshot.event.intervals
              ).map((window) => ({
                endsAt: Date.parse(window.endsAt),
                startsAt: Date.parse(window.startsAt),
              })),
            })),
            visitSeconds: visitMinutes(preferences.pace, chosen.length) * 60,
          };
        }),
      });
      setResult(computed);
      if (!route.active) {
        onChange({
          ...route,
          blockedEdgeIds: [...blockedEdgeIds],
          graphVersion,
          locked: keepLocks ? route.locked : {},
          plan: computed.plan,
          planStale: false,
        });
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const accept = (chosen: ComputedPlan) => {
    onChange({
      ...route,
      blockedEdgeIds: [...blockedEdgeIds],
      graphVersion,
      plan: chosen,
      planStale: false,
      progress: route.active ? route.progress : { ...route.progress, current: 0 },
    });
    setResult(null);
  };

  const active = route.active && route.plan;
  const networkChanged =
    Boolean(route.plan) &&
    (route.graphVersion !== graphVersion || route.blockedEdgeIds.join() !== blockedEdgeIds.join());

  return (
    <section aria-labelledby="planner-heading" className="panel form-panel route-planner">
      <h2 id="planner-heading">{translate(locale, "route.title")}</h2>
      {!pkg ? <p className="notice">{translate(locale, "route.noNetwork")}</p> : null}
      {pkg ? (
        <p className="field-hint">
          {translate(locale, "route.network")}: {pkg.attribution} · {pkg.license}
        </p>
      ) : null}
      <p role="status">
        {route.selected.length} {translate(locale, "map.sellers")} · {selectedStops.length}{" "}
        {translate(locale, "map.stops")}
        {selectedStops.length > MAX_ROUTE_STOPS ? ` · ${translate(locale, "route.tooMany")}` : ""}
      </p>
      {route.selected.length === 0 ? (
        <p className="field-hint">{translate(locale, "route.selectHint")}</p>
      ) : null}

      {!active ? (
        <>
          <label htmlFor="route-pace">{translate(locale, "route.pace")}</label>
          <select
            id="route-pace"
            onChange={(event) => update({ pace: event.currentTarget.value as Pace })}
            value={preferences.pace}
          >
            {(["quick", "standard", "leisurely"] as const).map((pace) => (
              <option key={pace} value={pace}>
                {translate(locale, `route.pace.${pace}`)}
              </option>
            ))}
          </select>
          <fieldset className="choice-group">
            <legend>{translate(locale, "route.mode")}</legend>
            {(["availability", "shortest"] as const).map((mode) => (
              <label className="checkbox-field" key={mode}>
                <input
                  checked={preferences.mode === mode}
                  name="route-mode"
                  onChange={() => update({ mode })}
                  type="radio"
                />
                <span>{translate(locale, `route.mode.${mode}`)}</span>
              </label>
            ))}
          </fieldset>
          <label htmlFor="route-start">{translate(locale, "route.start")}</label>
          <select
            id="route-start"
            onChange={(event) => {
              const value = event.currentTarget.value;
              update(
                value === "none" || value === "map"
                  ? { startKind: value, startStopId: null }
                  : { startKind: "stop", startStopId: value },
              );
            }}
            value={
              preferences.startKind === "stop"
                ? (preferences.startStopId ?? "none")
                : preferences.startKind
            }
          >
            <option value="none">{translate(locale, "route.start.none")}</option>
            <option value="map">{translate(locale, "route.start.map")}</option>
            {selectedStops.map((stop) => (
              <option key={stop.id} value={stop.id}>
                {translate(locale, "map.stop")} {stop.number}
              </option>
            ))}
          </select>
          {preferences.startKind === "map" ? (
            <p className="field-hint">
              {preferences.startPoint
                ? translate(locale, "route.start.picked")
                : translate(locale, "route.start.pickHint")}
            </p>
          ) : null}
          {preferences.startKind === "none" ? (
            <p className="field-hint">{translate(locale, "route.start.noneHint")}</p>
          ) : null}
          {preferences.startKind !== "none" ? (
            <label className="checkbox-field">
              <input
                checked={preferences.returnToStart}
                onChange={(event) => update({ returnToStart: event.currentTarget.checked })}
                type="checkbox"
              />
              <span>{translate(locale, "route.returnToStart")}</span>
            </label>
          ) : null}
          <button
            className="primary-button"
            disabled={busy || !pkg || selectedStops.length === 0}
            onClick={() => void plan(false)}
            type="button"
          >
            {translate(locale, "route.plan")}
          </button>
        </>
      ) : null}
      {failed ? <p className="notice notice-error">{translate(locale, "route.failed")}</p> : null}

      {result?.startStatus === "out_of_area" ? (
        <p className="notice">{translate(locale, "route.startOutOfArea")}</p>
      ) : null}
      {result?.startStatus === "snapped" && (result.startConnectorMeters ?? 0) > 10 ? (
        <p className="field-hint">{translate(locale, "route.startUnverified")}</p>
      ) : null}
      {result && result.excluded.length > 0 ? (
        <div className="notice">
          <p>{translate(locale, "route.excluded")}</p>
          <ul>
            {result.excluded.map((id) => (
              <li key={id}>
                {translate(locale, "map.stop")} {stopById.get(id)?.number}{" "}
                <button
                  className="quiet-button"
                  onClick={() =>
                    onChange({ ...route, includeUnreachable: [...route.includeUnreachable, id] })
                  }
                  type="button"
                >
                  {translate(locale, "route.includeAnyway")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result?.alternative ? (
        <div className="notice">
          <p>{translate(locale, "route.tradeoff")}</p>
          <div className="button-row">
            <button className="secondary-button" onClick={() => accept(result.plan)} type="button">
              {translate(locale, "route.keepShorter")} ({result.plan.missedSellerIds.length}{" "}
              {translate(locale, "route.missedCount")})
            </button>
            <button
              className="secondary-button"
              onClick={() => accept(result.alternative as ComputedPlan)}
              type="button"
            >
              {translate(locale, "route.reachMore")} (+
              {minutes(result.alternative.walkSeconds - result.plan.walkSeconds)} min)
            </button>
          </div>
        </div>
      ) : null}
      {route.active && result && !result.alternative ? (
        <div className="notice">
          <p>{translate(locale, "route.revision")}</p>
          <button className="secondary-button" onClick={() => accept(result.plan)} type="button">
            {translate(locale, "route.acceptRevision")}
          </button>
        </div>
      ) : null}
      {networkChanged ? (
        <div className="notice" role="alert">
          <p>{translate(locale, "route.networkChanged")}</p>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void plan(true)}
            type="button"
          >
            {translate(locale, "route.recalculate")}
          </button>
        </div>
      ) : null}

      {route.plan ? (
        <RouteSteps
          locale={locale}
          onChange={onChange}
          onRecalculate={() => void plan(true)}
          route={route}
          snapshot={snapshot}
          stopById={stopById}
        />
      ) : null}
    </section>
  );
}

function RouteSteps({
  locale,
  onChange,
  onRecalculate,
  route,
  snapshot,
  stopById,
}: {
  readonly locale: Locale;
  readonly onChange: (route: SavedRoute) => void;
  readonly onRecalculate: () => void;
  readonly route: SavedRoute;
  readonly snapshot: PublicSnapshot;
  readonly stopById: ReadonlyMap<string, VisibleStop>;
}) {
  const plan = route.plan as ComputedPlan;
  const timezone = snapshot.event.timezone;
  const eventEnd = Date.parse(snapshot.event.intervals.at(-1)?.endsAt ?? "");
  const missed = new Set(plan.missedSellerIds);
  const selected = new Set(route.selected);
  const visitSeconds =
    plan.departures.reduce((sum, departure, i) => sum + (departure - (plan.arrivals[i] ?? 0)), 0) /
    1000;
  // The leg arriving at each stop; unknown after a manual reorder.
  const legInto = (position: number) =>
    route.planStale
      ? null
      : (plan.legs.find((leg) => leg.toStopId === plan.order[position]) ?? null);
  return (
    <div className="route-steps">
      <p>
        {translate(locale, "route.walking")} {minutes(plan.walkSeconds)} min ·{" "}
        {translate(locale, "route.visits")} {minutes(visitSeconds)} min
        {plan.departures.length > 0 && !route.planStale
          ? ` · ${translate(locale, "route.done")} ${clock(locale, plan.departures.at(-1) as number, timezone)}`
          : ""}
      </p>
      {plan.incomplete ? <p className="notice">{translate(locale, "route.incomplete")}</p> : null}
      {!route.planStale && (plan.departures.at(-1) ?? 0) > eventEnd ? (
        <p className="notice">{translate(locale, "route.overrunsEvent")}</p>
      ) : null}
      {route.planStale ? (
        <div className="notice">
          <p>{translate(locale, "route.reordered")}</p>
          <button className="secondary-button" onClick={onRecalculate} type="button">
            {translate(locale, "route.recalculate")}
          </button>
        </div>
      ) : null}
      <ol className="stop-list">
        {plan.order.map((stopId, position) => {
          const stop = stopById.get(stopId);
          const leg = legInto(position);
          const current = route.active && route.progress.current === position;
          const visited = route.progress.visitedStops.includes(stopId);
          const skipped = route.progress.skipped.includes(stopId);
          const sellers = (stop?.sellers ?? []).filter((seller) => selected.has(seller.id));
          return (
            <li
              aria-current={current ? "step" : undefined}
              className={current ? "panel route-current" : "panel"}
              key={stopId}
            >
              {leg ? (
                <p className="field-hint">
                  {leg.manualGap
                    ? translate(locale, "route.manualGap")
                    : `${minutes(leg.seconds ?? 0)} min ${translate(locale, "route.walk")}`}
                </p>
              ) : null}
              <h3>
                {position + 1}. {translate(locale, "map.stop")} {stop?.number ?? "?"}
                {skipped ? ` · ${translate(locale, "route.skipped")}` : ""}
                {visited ? ` · ${translate(locale, "route.visited")}` : ""}
              </h3>
              {!stop ? <p className="notice">{translate(locale, "route.stopGone")}</p> : null}
              {!route.planStale && plan.arrivals[position] !== undefined ? (
                <p className="field-hint">
                  {translate(locale, "route.arrive")}{" "}
                  {clock(locale, plan.arrivals[position] as number, timezone)}
                </p>
              ) : null}
              <ul>
                {sellers.map((seller) => (
                  <li key={seller.id}>
                    {route.active ? (
                      <label className="checkbox-field">
                        <input
                          checked={route.progress.visitedSellers.includes(seller.id)}
                          onChange={(event) =>
                            onChange(
                              markSellerVisited(route, seller.id, event.currentTarget.checked),
                            )
                          }
                          type="checkbox"
                        />
                        <span>{seller.title ?? seller.displayName}</span>
                      </label>
                    ) : (
                      (seller.title ?? seller.displayName)
                    )}
                    {missed.has(seller.id) && !route.planStale
                      ? ` · ${translate(locale, "route.likelyMissed")}`
                      : ""}
                  </li>
                ))}
              </ul>
              <div className="button-row">
                <button
                  aria-label={`${translate(locale, "route.moveUp")} ${position + 1}`}
                  className="quiet-button"
                  disabled={position === 0}
                  onClick={() => onChange(moveStop(route, stopId, -1))}
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label={`${translate(locale, "route.moveDown")} ${position + 1}`}
                  className="quiet-button"
                  disabled={position === plan.order.length - 1}
                  onClick={() => onChange(moveStop(route, stopId, 1))}
                  type="button"
                >
                  ↓
                </button>
                {route.active ? (
                  <>
                    <button
                      className="quiet-button"
                      onClick={() =>
                        onChange(
                          markStopVisited(
                            route,
                            stopId,
                            sellers.map((s) => s.id),
                            !visited,
                          ),
                        )
                      }
                      type="button"
                    >
                      {translate(locale, visited ? "route.unvisit" : "route.markVisited")}
                    </button>
                    <button
                      className="quiet-button"
                      onClick={() => onChange(setSkipped(route, stopId, !skipped))}
                      type="button"
                    >
                      {translate(locale, skipped ? "route.undoSkip" : "route.skip")}
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="button-row">
        {route.active ? (
          <>
            <button
              className="secondary-button"
              onClick={() => onChange(step(route, -1))}
              type="button"
            >
              {translate(locale, "route.previous")}
            </button>
            <button
              className="primary-button"
              onClick={() => onChange(step(route, 1))}
              type="button"
            >
              {translate(locale, "route.next")}
            </button>
            <button
              className="quiet-button"
              onClick={() => {
                clearRoute(route.eventKey);
                onChange(emptyRoute(route.eventKey, route.expiresAt));
              }}
              type="button"
            >
              {translate(locale, "route.end")}
            </button>
          </>
        ) : (
          <button
            className="primary-button"
            onClick={() =>
              onChange({ ...route, active: true, progress: { ...route.progress, current: 0 } })
            }
            type="button"
          >
            {translate(locale, "route.startWalk")}
          </button>
        )}
      </div>
    </div>
  );
}
