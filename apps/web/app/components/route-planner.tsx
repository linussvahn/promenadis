import type { PublicSnapshot, RoutingPackageContract } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { MAX_ROUTE_STOPS, type Pace, visitMinutes } from "@promenadis/routing";
import { useState } from "react";
import {
  locationPermissionState,
  MAX_START_ACCURACY_METERS,
  type PositionResult,
  requestPosition,
} from "../lib/geolocation";
import type { VisibleStop } from "../lib/public-stops";
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
import { cn } from "../lib/utils";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Checkbox, Radio } from "./ui/checkbox";
import { ChoiceField, FieldLegend, FieldSet } from "./ui/field";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";

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
  livePosition,
  locale,
  locationStart,
  onChange,
  onLocationStart,
  onShowPosition,
  pkg,
  route,
  showPosition,
  snapshot,
  stops,
}: {
  readonly blockedEdgeIds: readonly string[];
  readonly graphVersion: string | null;
  readonly livePosition: PositionResult | null;
  readonly locale: Locale;
  readonly locationStart: readonly [number, number] | null;
  readonly onChange: (route: SavedRoute) => void;
  readonly onLocationStart: (point: readonly [number, number] | null) => void;
  readonly onShowPosition: (on: boolean) => void;
  readonly showPosition: boolean;
  readonly pkg: RoutingPackageContract | null;
  readonly route: SavedRoute;
  readonly snapshot: PublicSnapshot;
  readonly stops: readonly VisibleStop[];
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComputeResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState("");
  const locate = async () => {
    setLocating(true);
    setLocationNote("");
    const result = await requestPosition();
    setLocating(false);
    if (result.kind === "ok" && result.accuracy <= MAX_START_ACCURACY_METERS) {
      onLocationStart(result.point);
      setLocationNote(`${translate(locale, "location.found")} ± ${result.accuracy} m`);
      return;
    }
    onLocationStart(null);
    if (result.kind === "ok") {
      setLocationNote(`${translate(locale, "location.inaccurate")} (± ${result.accuracy} m)`);
    } else if (result.kind === "denied") {
      const state = await locationPermissionState();
      setLocationNote(
        translate(locale, state === "denied" ? "location.blocked" : "location.denied"),
      );
    } else {
      setLocationNote(translate(locale, `location.${result.kind}`));
    }
  };
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
        preferences.startKind === "location"
          ? locationStart
          : preferences.startKind === "map"
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
    <Card asChild>
      <section aria-labelledby="planner-heading">
        <CardHeader>
          <CardTitle className="text-2xl" id="planner-heading">
            {translate(locale, "route.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!pkg ? <Alert>{translate(locale, "route.noNetwork")}</Alert> : null}
          {pkg ? (
            <p className="text-sm text-muted-foreground">
              {translate(locale, "route.network")}: {pkg.attribution} · {pkg.license}
            </p>
          ) : null}
          <p role="status">
            {route.selected.length} {translate(locale, "map.sellers")} · {selectedStops.length}{" "}
            {translate(locale, "map.stops")}
            {selectedStops.length > MAX_ROUTE_STOPS
              ? ` · ${translate(locale, "route.tooMany")}`
              : ""}
          </p>
          {route.selected.length === 0 ? (
            <p className="text-sm text-muted-foreground">{translate(locale, "route.selectHint")}</p>
          ) : null}

          {!active ? (
            <>
              <Label htmlFor="route-pace">{translate(locale, "route.pace")}</Label>
              <NativeSelect
                id="route-pace"
                onChange={(event) => update({ pace: event.currentTarget.value as Pace })}
                value={preferences.pace}
              >
                {(["quick", "standard", "leisurely"] as const).map((pace) => (
                  <option key={pace} value={pace}>
                    {translate(locale, `route.pace.${pace}`)}
                  </option>
                ))}
              </NativeSelect>
              <FieldSet>
                <FieldLegend>{translate(locale, "route.mode")}</FieldLegend>
                {(["availability", "shortest"] as const).map((mode) => (
                  <ChoiceField key={mode}>
                    <Radio
                      checked={preferences.mode === mode}
                      name="route-mode"
                      onChange={() => update({ mode })}
                    />
                    <span>{translate(locale, `route.mode.${mode}`)}</span>
                  </ChoiceField>
                ))}
              </FieldSet>
              <Label htmlFor="route-start">{translate(locale, "route.start")}</Label>
              <NativeSelect
                id="route-start"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  update(
                    value === "none" || value === "map" || value === "location"
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
                <option value="location">{translate(locale, "route.start.location")}</option>
                {selectedStops.map((stop) => (
                  <option key={stop.id} value={stop.id}>
                    {translate(locale, "map.stop")} {stop.number}
                  </option>
                ))}
              </NativeSelect>
              {preferences.startKind === "map" ? (
                <p className="text-sm text-muted-foreground">
                  {preferences.startPoint
                    ? translate(locale, "route.start.picked")
                    : translate(locale, "route.start.pickHint")}
                </p>
              ) : null}
              {preferences.startKind === "location" ? (
                <div>
                  <p className="text-sm text-muted-foreground">
                    {translate(locale, "location.purpose")}
                  </p>
                  <Button
                    variant="outline"
                    disabled={locating}
                    onClick={() => void locate()}
                    type="button"
                  >
                    {translate(locale, locationStart ? "location.retry" : "location.use")}
                  </Button>
                  <p aria-live="polite" role="status">
                    {locating ? translate(locale, "location.locating") : locationNote}
                  </p>
                </div>
              ) : null}
              {preferences.startKind === "none" ? (
                <p className="text-sm text-muted-foreground">
                  {translate(locale, "route.start.noneHint")}
                </p>
              ) : null}
              {preferences.startKind !== "none" ? (
                <ChoiceField>
                  <Checkbox
                    checked={preferences.returnToStart}
                    onChange={(event) => update({ returnToStart: event.currentTarget.checked })}
                  />
                  <span>{translate(locale, "route.returnToStart")}</span>
                </ChoiceField>
              ) : null}
              <Button
                disabled={busy || !pkg || selectedStops.length === 0}
                onClick={() => void plan(false)}
                type="button"
              >
                {translate(locale, "route.plan")}
              </Button>
            </>
          ) : null}
          {failed ? <Alert variant="destructive">{translate(locale, "route.failed")}</Alert> : null}

          {result?.startStatus === "out_of_area" ? (
            <Alert>{translate(locale, "route.startOutOfArea")}</Alert>
          ) : null}
          {result?.startStatus === "snapped" && (result.startConnectorMeters ?? 0) > 10 ? (
            <p className="text-sm text-muted-foreground">
              {translate(locale, "route.startUnverified")}
            </p>
          ) : null}
          {result && result.excluded.length > 0 ? (
            <Alert>
              <AlertDescription>
                <p>{translate(locale, "route.excluded")}</p>
                <ul>
                  {result.excluded.map((id) => (
                    <li key={id}>
                      {translate(locale, "map.stop")} {stopById.get(id)?.number}{" "}
                      <Button
                        variant="link"
                        onClick={() =>
                          onChange({
                            ...route,
                            includeUnreachable: [...route.includeUnreachable, id],
                          })
                        }
                        type="button"
                      >
                        {translate(locale, "route.includeAnyway")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {result?.alternative ? (
            <Alert>
              <AlertDescription>
                <p>{translate(locale, "route.tradeoff")}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => accept(result.plan)} type="button">
                    {translate(locale, "route.keepShorter")} ({result.plan.missedSellerIds.length}{" "}
                    {translate(locale, "route.missedCount")})
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => accept(result.alternative as ComputedPlan)}
                    type="button"
                  >
                    {translate(locale, "route.reachMore")} (+
                    {minutes(result.alternative.walkSeconds - result.plan.walkSeconds)} min)
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          {route.active && result && !result.alternative ? (
            <Alert>
              <AlertDescription>
                <p>{translate(locale, "route.revision")}</p>
                <Button variant="outline" onClick={() => accept(result.plan)} type="button">
                  {translate(locale, "route.acceptRevision")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {networkChanged ? (
            <Alert role="alert">
              <AlertDescription>
                <p>{translate(locale, "route.networkChanged")}</p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void plan(true)}
                  type="button"
                >
                  {translate(locale, "route.recalculate")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {route.active ? (
            <div>
              <ChoiceField>
                <Checkbox
                  checked={showPosition}
                  onChange={(event) => onShowPosition(event.currentTarget.checked)}
                />
                <span>{translate(locale, "location.show")}</span>
              </ChoiceField>
              {showPosition ? (
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  {livePosition?.kind === "ok"
                    ? `${translate(locale, "location.you")} ± ${livePosition.accuracy} m`
                    : livePosition
                      ? translate(locale, `location.${livePosition.kind}`)
                      : translate(locale, "location.locating")}
                </p>
              ) : null}
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
        </CardContent>
      </section>
    </Card>
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
    <div className="grid gap-4">
      <p>
        {translate(locale, "route.walking")} {minutes(plan.walkSeconds)} min ·{" "}
        {translate(locale, "route.visits")} {minutes(visitSeconds)} min
        {plan.departures.length > 0 && !route.planStale
          ? ` · ${translate(locale, "route.done")} ${clock(locale, plan.departures.at(-1) as number, timezone)}`
          : ""}
      </p>
      {plan.incomplete ? <Alert>{translate(locale, "route.incomplete")}</Alert> : null}
      {!route.planStale && (plan.departures.at(-1) ?? 0) > eventEnd ? (
        <Alert>{translate(locale, "route.overrunsEvent")}</Alert>
      ) : null}
      {route.planStale ? (
        <Alert>
          <AlertDescription>
            <p>{translate(locale, "route.reordered")}</p>
            <Button variant="outline" onClick={onRecalculate} type="button">
              {translate(locale, "route.recalculate")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <ol className="m-0 grid list-none gap-3 p-0">
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
              className={cn(
                "grid gap-2 rounded-xl border bg-card p-4",
                current && "border-2 border-primary ring-4 ring-brand-soft",
              )}
              key={stopId}
            >
              {leg ? (
                <p className="text-sm text-muted-foreground">
                  {leg.manualGap
                    ? translate(locale, "route.manualGap")
                    : `${minutes(leg.seconds ?? 0)} min ${translate(locale, "route.walk")}`}
                </p>
              ) : null}
              <h3 className="text-lg font-extrabold">
                {position + 1}. {translate(locale, "map.stop")} {stop?.number ?? "?"}
                {skipped ? ` · ${translate(locale, "route.skipped")}` : ""}
                {visited ? ` · ${translate(locale, "route.visited")}` : ""}
              </h3>
              {!stop ? <Alert>{translate(locale, "route.stopGone")}</Alert> : null}
              {!route.planStale && plan.arrivals[position] !== undefined ? (
                <p className="text-sm text-muted-foreground">
                  {translate(locale, "route.arrive")}{" "}
                  {clock(locale, plan.arrivals[position] as number, timezone)}
                </p>
              ) : null}
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {sellers.map((seller) => (
                  <li key={seller.id}>
                    {route.active ? (
                      <ChoiceField>
                        <Checkbox
                          checked={route.progress.visitedSellers.includes(seller.id)}
                          onChange={(event) =>
                            onChange(
                              markSellerVisited(route, seller.id, event.currentTarget.checked),
                            )
                          }
                        />
                        <span>{seller.title ?? seller.displayName}</span>
                      </ChoiceField>
                    ) : (
                      (seller.title ?? seller.displayName)
                    )}
                    {missed.has(seller.id) && !route.planStale
                      ? ` · ${translate(locale, "route.likelyMissed")}`
                      : ""}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  aria-label={`${translate(locale, "route.moveUp")} ${position + 1}`}
                  size="icon"
                  variant="outline"
                  disabled={position === 0}
                  onClick={() => onChange(moveStop(route, stopId, -1))}
                  type="button"
                >
                  ↑
                </Button>
                <Button
                  aria-label={`${translate(locale, "route.moveDown")} ${position + 1}`}
                  size="icon"
                  variant="outline"
                  disabled={position === plan.order.length - 1}
                  onClick={() => onChange(moveStop(route, stopId, 1))}
                  type="button"
                >
                  ↓
                </Button>
                {route.active ? (
                  <>
                    <Button
                      variant="link"
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
                    </Button>
                    <Button
                      variant="link"
                      onClick={() => onChange(setSkipped(route, stopId, !skipped))}
                      type="button"
                    >
                      {translate(locale, skipped ? "route.undoSkip" : "route.skip")}
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        {route.active ? (
          <>
            <Button variant="outline" onClick={() => onChange(step(route, -1))} type="button">
              {translate(locale, "route.previous")}
            </Button>
            <Button onClick={() => onChange(step(route, 1))} type="button">
              {translate(locale, "route.next")}
            </Button>
            <Button
              variant="link"
              onClick={() => {
                clearRoute(route.eventKey);
                // Keeping the sync marker lets an account sync clear the route too.
                onChange({
                  ...emptyRoute(route.eventKey, route.expiresAt),
                  ...(route.sync ? { sync: route.sync } : {}),
                });
              }}
              type="button"
            >
              {translate(locale, "route.end")}
            </Button>
          </>
        ) : (
          <Button
            onClick={() =>
              onChange({ ...route, active: true, progress: { ...route.progress, current: 0 } })
            }
            type="button"
          >
            {translate(locale, "route.startWalk")}
          </Button>
        )}
      </div>
    </div>
  );
}
