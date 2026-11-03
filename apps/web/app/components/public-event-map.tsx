import type {
  PublicEventManifest,
  PublicSafetyFeed,
  PublicSnapshot,
  RoutingPackageContract,
} from "@promenadis/contracts";
import { formatCurrency, formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView, { Layer, type MapRef, Marker, Source } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { accuracyRing, useWatchedPosition } from "../lib/geolocation";
import { loadOffline, resetOfflineData, saveOffline, unpinOffline } from "../lib/offline-store";
import {
  applySafetyFeed,
  clusterStops,
  filterStops,
  isOpenNow,
  noFilters,
  type PublicSeller,
  type StopFilters,
  type VisibleStop,
} from "../lib/public-stops";
import {
  emptyRoute,
  loadRoute,
  type SavedRoute,
  saveRoute,
  setMustSee,
  setSelected,
} from "../lib/route-state";
import { hasContent, useRouteSync } from "../lib/route-sync";
import { getPromenadisApiClient } from "../lib/supabase";
import { cn } from "../lib/utils";
import { DEFAULT_CENTER, MAP_STYLE, MapErrorBoundary } from "./boundary-editor";
import { RoutePlanner } from "./route-planner";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";

const stopMarker =
  "grid min-h-9 min-w-9 cursor-pointer place-items-center rounded-full border-[3px] border-[#ffffff] bg-primary px-2 font-display text-[0.95rem] font-extrabold text-primary-foreground shadow-[0_0.2rem_0.6rem_rgb(70_45_20/30%)] transition-transform hover:scale-110";

/** A toggle pill around a native checkbox; fills when checked. */
const togglePill =
  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-input bg-card py-2 pr-4 pl-3 text-sm font-semibold transition-colors hover:border-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring [&_input]:accent-current";

type Route = "public" | "unlisted";
type LoadState =
  | { readonly kind: "loading" | "unavailable" | "ended" | "expired" }
  | {
      readonly kind: "ready";
      readonly feed: PublicSafetyFeed;
      readonly snapshot: PublicSnapshot | null;
      readonly checkedAt: Date;
      /** The walking network the manifest selects, when one is approved. */
      readonly pkg: RoutingPackageContract | null;
      readonly graphVersion: string | null;
      /** Served from the device's offline copy; safety state is not current. */
      readonly offline: boolean;
    };

const FEED_INTERVAL_MS = 15_000;
const MANIFEST_INTERVAL_MS = 60_000;

// Fresh clients validate the manifest and safety feed before showing any
// precise location, refuse expired data, and apply the feed over the older
// full snapshot. While open, the feed is polled about every 15 seconds.
function usePublicStops(route: Route, eventKey: string) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const snapshotRef = useRef<PublicSnapshot | null>(null);
  const manifestRef = useRef<PublicEventManifest | null>(null);
  const feedRef = useRef<PublicSafetyFeed | null>(null);
  // Set once the visitor starts a walk: fresh data is then kept offline too.
  const admittedRef = useRef<{ pinned: boolean } | null>(null);
  const [storageRefused, setStorageRefused] = useState(false);
  const persist = useCallback(async () => {
    const admitted = admittedRef.current;
    const snapshot = snapshotRef.current;
    const manifest = manifestRef.current;
    const feed = feedRef.current;
    if (!admitted || !snapshot || !manifest || !feed) return;
    const saved = await saveOffline({
      eventKey,
      expiresAt: snapshot.expiresAt,
      feed,
      graphVersion: packageRef.current?.id ?? null,
      manifest,
      pinned: admitted.pinned,
      pkg: packageRef.current?.pkg ?? null,
      snapshot,
    });
    setStorageRefused(!saved);
  }, [eventKey]);
  const admit = useCallback(
    (active: boolean) => {
      admittedRef.current = active ? { pinned: true } : null;
      if (active) void persist();
      else void unpinOffline(eventKey);
    },
    [eventKey, persist],
  );
  const packageRef = useRef<{ id: string; pkg: RoutingPackageContract } | null>(null);
  useEffect(() => {
    const api = getPromenadisApiClient();
    if (!api) {
      setState({ kind: "unavailable" });
      return;
    }
    let cancelled = false;
    let lastManifestAt = 0;
    let lastSequence: number | null = null;
    const expired = (iso: string) => Date.parse(iso) <= Date.now();
    const refresh = async () => {
      try {
        if (Date.now() - lastManifestAt >= MANIFEST_INTERVAL_MS || !snapshotRef.current) {
          const manifest = await api.getPublicManifest(route, eventKey);
          lastManifestAt = Date.now();
          manifestRef.current = manifest;
          if (manifest.state !== "published" && manifest.state !== "active") {
            snapshotRef.current = null;
            if (!cancelled) setState({ kind: "ended" });
            return;
          }
          if (expired(manifest.expiresAt)) {
            snapshotRef.current = null;
            if (!cancelled) setState({ kind: "expired" });
            return;
          }
          if (!manifest.snapshot) snapshotRef.current = null;
          else if (snapshotRef.current?.revision !== manifest.publicRevision) {
            snapshotRef.current = await api.getPublicSnapshot(manifest.snapshot.id);
          }
          if (!manifest.routing) packageRef.current = null;
          else if (packageRef.current?.id !== manifest.routing.id) {
            const pkg = await api.getPublicRoutingPackage(manifest.routing.id);
            packageRef.current = { id: manifest.routing.id, pkg };
          }
        }
        const feed = await api.getPublicSafetyFeed(route, eventKey);
        feedRef.current = feed;
        // A new safety sequence means a rebuilt snapshot is on its way; a new
        // required graph means a new walking network to fetch (and accept).
        if (lastSequence !== null && feed.sequence !== lastSequence) lastManifestAt = 0;
        if (feed.requiredGraphVersion && feed.requiredGraphVersion !== packageRef.current?.id) {
          lastManifestAt = 0;
        }
        lastSequence = feed.sequence;
        if (feed.state !== "published" && feed.state !== "active") {
          snapshotRef.current = null;
          if (!cancelled) setState({ kind: "ended" });
          return;
        }
        const snapshot = snapshotRef.current;
        if (snapshot && expired(snapshot.expiresAt)) {
          snapshotRef.current = null;
          if (!cancelled) setState({ kind: "expired" });
          return;
        }
        if (!cancelled) {
          setState({
            checkedAt: new Date(),
            feed,
            graphVersion: packageRef.current?.id ?? null,
            kind: "ready",
            offline: false,
            pkg: packageRef.current?.pkg ?? null,
            snapshot,
          });
          void persist();
        }
      } catch {
        // Without a fresh feed, precise data is shown only from a copy the
        // visitor took for an active walk, and only before its hard expiry.
        snapshotRef.current = null;
        const copy = await loadOffline(eventKey);
        if (cancelled) return;
        if (copy) {
          lastManifestAt = 0;
          setState({
            checkedAt: new Date(copy.savedAt),
            feed: copy.feed,
            graphVersion: copy.graphVersion,
            kind: "ready",
            offline: true,
            pkg: copy.pkg,
            snapshot: copy.snapshot,
          });
        } else {
          setState({ kind: "unavailable" });
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), FEED_INTERVAL_MS);
    // On reconnect, validate the manifest and feed before anything else.
    const onOnline = () => {
      lastManifestAt = 0;
      void refresh();
    };
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [route, eventKey, persist]);
  return { admit, state, storageRefused };
}

function categoryLabel(snapshot: PublicSnapshot, locale: Locale, id: string | null) {
  return snapshot.categories.find((category) => category.id === id)?.labels[locale] ?? "";
}

function SellerDetails({
  seller,
  snapshot,
  locale,
  route,
  walk,
  onWalkChange,
}: {
  readonly seller: PublicSeller;
  readonly snapshot: PublicSnapshot;
  readonly locale: Locale;
  readonly route: Route;
  readonly walk: SavedRoute;
  readonly onWalkChange: (walk: SavedRoute) => void;
}) {
  const chosen = walk.selected.includes(seller.id);
  const facts = [
    seller.accessibility.stepFree ? translate(locale, "map.stepFree") : null,
    seller.accessibility.stairs ? translate(locale, "map.stairs") : null,
    seller.accessibility.elevator ? translate(locale, "map.elevator") : null,
    seller.accessibility.strollerFriendly ? translate(locale, "map.stroller") : null,
    seller.accessibility.setting
      ? translate(locale, `map.setting.${seller.accessibility.setting}`)
      : null,
  ].filter(Boolean);
  return (
    <article className="grid gap-1.5 border-dashed [article+&]:mt-5 [article+&]:border-t [article+&]:pt-5">
      <h4 className="flex flex-wrap items-center gap-2 text-xl font-extrabold">
        {seller.title ?? seller.displayName}
        {seller.status === "away" ? (
          <Badge variant="secondary">{translate(locale, "map.away")}</Badge>
        ) : null}
      </h4>
      {seller.title ? <p className="text-sm text-muted-foreground">{seller.displayName}</p> : null}
      {seller.description ? <p>{seller.description}</p> : null}
      <p className="text-sm font-semibold text-primary">
        {seller.categoryIds.map((id) => categoryLabel(snapshot, locale, id)).join(" · ")}
      </p>
      {seller.tags.length > 0 ? (
        <ul className="m-0 my-1 flex list-none flex-wrap gap-1.5 p-0">
          {seller.tags.map((tag) => (
            <li key={tag}>
              <Badge variant="secondary">{tag}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {seller.items.length > 0 ? (
        <ul className="m-0 my-2 grid list-none gap-1 rounded-lg bg-muted px-4 py-3">
          {seller.items.map((item) => (
            <li key={`${item.name}|${item.categoryId}|${item.priceMinor}|${item.status}`}>
              {item.name}
              {item.priceMinor !== null
                ? ` · ${formatCurrency(locale, item.priceMinor, item.currency)}`
                : ""}
              {item.status === "sold" ? ` · ${translate(locale, "map.sold")}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {facts.length > 0 ? (
        <p className="text-sm text-muted-foreground">{facts.join(" · ")}</p>
      ) : null}
      {seller.availability.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate(locale, "map.hours")}:{" "}
          {seller.availability
            .map(
              (window) =>
                `${formatDateTime(locale, window.startsAt, snapshot.event.timezone)} – ${formatDateTime(locale, window.endsAt, snapshot.event.timezone)}`,
            )
            .join(", ")}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label
          className={cn(
            togglePill,
            "has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground",
          )}
        >
          <Checkbox
            checked={chosen}
            onChange={(event) =>
              onWalkChange(setSelected(walk, seller.id, event.currentTarget.checked))
            }
          />
          <span>{translate(locale, "route.add")}</span>
        </label>
        {chosen ? (
          <label
            className={cn(
              togglePill,
              "has-checked:border-sun has-checked:bg-sun has-checked:text-sun-foreground",
            )}
          >
            <Checkbox
              checked={walk.mustSee.includes(seller.id)}
              disabled={!walk.mustSee.includes(seller.id) && walk.mustSee.length >= 10}
              onChange={(event) =>
                onWalkChange(setMustSee(walk, seller.id, event.currentTarget.checked))
              }
            />
            <span>{translate(locale, "route.mustSee")}</span>
          </label>
        ) : null}
        <a
          className="ms-auto p-2 text-sm text-muted-foreground"
          href={`/report?key=${snapshot.eventKey}&route=${route}&type=participation&subject=${seller.id}`}
          rel="nofollow"
        >
          {translate(locale, "map.report")}
        </a>
      </div>
    </article>
  );
}

function routeFeatures(
  walk: SavedRoute,
  stops: readonly VisibleStop[],
  locationStart: readonly [number, number] | null,
) {
  const plan = walk.plan;
  if (!plan || walk.planStale) return null;
  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  const point = (id: string | null) => {
    const stop = id ? byId.get(id) : null;
    return stop ? [stop.longitude, stop.latitude] : (locationStart ?? walk.preferences.startPoint);
  };
  return {
    features: plan.legs.flatMap((leg, index) => {
      const path = plan.paths[index];
      const coordinates = path ?? [point(leg.fromStopId), point(leg.toStopId)].filter(Boolean);
      return coordinates.length >= 2
        ? [
            {
              geometry: { coordinates: coordinates as number[][], type: "LineString" as const },
              properties: { gap: leg.manualGap },
              type: "Feature" as const,
            },
          ]
        : [];
    }),
    type: "FeatureCollection" as const,
  };
}

function StopsMap({
  stops,
  snapshot,
  locale,
  onSelect,
  walk,
  onPick,
  position,
  start,
}: {
  readonly stops: readonly VisibleStop[];
  readonly snapshot: PublicSnapshot;
  readonly locale: Locale;
  readonly onSelect: (stopId: string) => void;
  readonly walk: SavedRoute;
  readonly onPick: ((point: readonly [number, number]) => void) | null;
  readonly position: {
    readonly accuracy: number;
    readonly point: readonly [number, number];
  } | null;
  readonly start: readonly [number, number] | null;
}) {
  const lines = routeFeatures(walk, stops, start);
  const shownStart =
    start ?? (walk.preferences.startKind === "map" ? walk.preferences.startPoint : null);
  const mapRef = useRef<MapRef | null>(null);
  const [zoom, setZoom] = useState(15);
  const ring = snapshot.event.boundary?.coordinates[0] ?? [];
  const center = ring.length
    ? [
        ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
        ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
      ]
    : DEFAULT_CENTER;
  return (
    <MapView
      initialViewState={{ latitude: center[1] ?? 0, longitude: center[0] ?? 0, zoom: 15 }}
      mapStyle={MAP_STYLE}
      onClick={({ lngLat }) => onPick?.([lngLat.lng, lngLat.lat])}
      onMove={({ viewState }) => setZoom(viewState.zoom)}
      ref={mapRef}
    >
      {lines ? (
        <Source data={lines} id="public-route" type="geojson">
          <Layer
            filter={["!", ["get", "gap"]]}
            id="public-route-walk"
            paint={{ "line-color": "#15803d", "line-width": 4 }}
            type="line"
          />
          {/* Manual connection: dotted, never a normal route line. */}
          <Layer
            filter={["get", "gap"]}
            id="public-route-gap"
            paint={{ "line-color": "#3f3f46", "line-dasharray": [1, 2], "line-width": 3 }}
            type="line"
          />
        </Source>
      ) : null}
      {shownStart ? (
        <Marker latitude={shownStart[1]} longitude={shownStart[0]}>
          <span
            aria-label={translate(locale, "route.start")}
            className="block size-5 rounded-full border-[3px] border-[#ffffff] bg-[#18181b] shadow-[0_0.2rem_0.6rem_rgb(70_45_20/30%)]"
            role="img"
          />
        </Marker>
      ) : null}
      {position ? (
        <Source
          data={{
            geometry: {
              coordinates: [accuracyRing(position.point, position.accuracy)],
              type: "Polygon",
            },
            properties: {},
            type: "Feature",
          }}
          id="public-position-accuracy"
          type="geojson"
        >
          <Layer
            id="public-position-accuracy-fill"
            paint={{ "fill-color": "#2f6fd6", "fill-opacity": 0.12 }}
            type="fill"
          />
          <Layer
            id="public-position-accuracy-line"
            paint={{ "line-color": "#2f6fd6", "line-opacity": 0.5, "line-width": 1 }}
            type="line"
          />
        </Source>
      ) : null}
      {position ? (
        <Marker latitude={position.point[1]} longitude={position.point[0]}>
          <span
            aria-label={`${translate(locale, "location.you")} ± ${position.accuracy} m`}
            className="block size-[1.1rem] rounded-full border-[3px] border-white bg-[#2f6fd6] shadow-[0_0_0_0.5rem_rgb(47_111_214/25%)]"
            role="img"
          />
        </Marker>
      ) : null}
      {ring.length >= 3 ? (
        <Source
          data={{
            geometry: { coordinates: [ring], type: "Polygon" },
            properties: {},
            type: "Feature",
          }}
          id="public-event-area"
          type="geojson"
        >
          <Layer
            id="public-event-area-line"
            paint={{ "line-color": "#3f3f46", "line-width": 2 }}
            type="line"
          />
        </Source>
      ) : null}
      {clusterStops(stops, zoom).map((cluster) =>
        cluster.stops.length === 1 && cluster.stops[0] ? (
          <Marker key={cluster.key} latitude={cluster.latitude} longitude={cluster.longitude}>
            <button
              aria-label={`${translate(locale, "map.stop")} ${cluster.stops[0].number}`}
              className={stopMarker}
              onClick={() => onSelect(cluster.stops[0]?.id ?? "")}
              type="button"
            >
              {cluster.stops[0].number}
            </button>
          </Marker>
        ) : (
          <Marker key={cluster.key} latitude={cluster.latitude} longitude={cluster.longitude}>
            <button
              aria-label={`${cluster.stops.length} ${translate(locale, "map.stops")}. ${translate(locale, "map.zoomIn")}`}
              className={cn(stopMarker, "min-h-11 min-w-11 bg-success")}
              onClick={() =>
                mapRef.current?.flyTo({
                  center: [cluster.longitude, cluster.latitude],
                  zoom: Math.max(zoom + 2, 15),
                })
              }
              type="button"
            >
              {cluster.stops.length}
            </button>
          </Marker>
        ),
      )}
    </MapView>
  );
}

export function PublicEventMap({
  route,
  eventKey,
  locale,
}: {
  readonly route: Route;
  readonly eventKey: string;
  readonly locale: Locale;
}) {
  const { admit, state, storageRefused } = usePublicStops(route, eventKey);
  const [filters, setFilters] = useState<StopFilters>(noFilters);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ready = state.kind === "ready" ? state : null;
  const allStops = useMemo(
    () => (ready?.snapshot ? applySafetyFeed(ready.snapshot, ready.feed) : []),
    [ready],
  );
  const stops = useMemo(
    () => (ready?.snapshot ? filterStops(allStops, ready.snapshot, filters, ready.checkedAt) : []),
    [allStops, ready, filters],
  );
  const expiresAt = ready?.snapshot?.expiresAt ?? null;
  const [walk, setWalk] = useState<SavedRoute>(() =>
    emptyRoute(eventKey, new Date(0).toISOString()),
  );
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    if (expiresAt) setWalk(loadRoute(eventKey, expiresAt));
  }, [eventKey, expiresAt]);
  const [locationStart, setLocationStart] = useState<readonly [number, number] | null>(null);
  const [showPosition, setShowPosition] = useState(false);
  const live = useWatchedPosition(showPosition && walk.active);
  const changeWalk = useCallback(
    (next: SavedRoute) => {
      if (walk.active && !next.active) {
        admit(false);
        setShowPosition(false);
      }
      setWalk(next);
      setStorageFailed(!saveRoute(next));
    },
    [admit, walk.active],
  );
  const sync = useRouteSync(
    route,
    walk,
    changeWalk,
    Boolean(expiresAt) && walk.expiresAt === expiresAt,
  );
  // Starting (or resuming) a walk is the explicit action that keeps the
  // event's data on the device for offline use.
  useEffect(() => {
    if (walk.active) admit(true);
  }, [walk.active, admit]);
  const select = (stopId: string) => {
    const element = document.getElementById(`stop-${stopId}`);
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
    element?.focus();
  };

  if (state.kind !== "ready") {
    return state.kind === "loading" ? (
      <p role="status">{translate(locale, `map.${state.kind}`)}</p>
    ) : (
      <Alert role="status">{translate(locale, `map.${state.kind}`)}</Alert>
    );
  }
  const snapshot = state.snapshot;
  const sellerCount = allStops.reduce((sum, stop) => sum + stop.sellers.length, 0);
  const openCount = snapshot
    ? allStops
        .flatMap((stop) => stop.sellers)
        .filter((seller) => isOpenNow(seller, state.checkedAt, snapshot.event.intervals)).length
    : 0;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground" role="status">
        {allStops.length} {translate(locale, "map.stops")} · {sellerCount}{" "}
        {translate(locale, "map.sellers")} · {openCount} {translate(locale, "map.openNowCount")} ·{" "}
        {translate(locale, "map.updated")}{" "}
        {state.checkedAt.toLocaleTimeString(locale === "sv" ? "sv-SE" : "en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      {state.offline ? (
        <Alert role="alert" variant="warning">
          {translate(locale, "offline.banner")}
        </Alert>
      ) : null}
      {storageRefused ? <Alert>{translate(locale, "offline.refused")}</Alert> : null}
      {!snapshot || allStops.length === 0 ? (
        <Alert>{translate(locale, "map.noStopsYet")}</Alert>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(22rem,0.85fr)_minmax(0,1.15fr)] lg:items-start">
          <section
            aria-label={translate(locale, "map.mapLabel")}
            className="h-[min(62vh,30rem)] min-h-72 overflow-hidden rounded-2xl bg-[#e9ebe4] shadow-xl shadow-amber-950/10 lg:sticky lg:top-4 lg:order-2 lg:h-[calc(100vh-2rem)] lg:max-h-[52rem]"
          >
            {mounted ? (
              <MapErrorBoundary
                fallback={
                  <p className="m-8 max-w-prose rounded-lg bg-card p-4">
                    {translate(locale, "boundary.mapUnavailable")}
                  </p>
                }
              >
                <StopsMap
                  locale={locale}
                  onPick={
                    walk.preferences.startKind === "map" && !walk.active
                      ? (point) =>
                          changeWalk({
                            ...walk,
                            preferences: { ...walk.preferences, startPoint: [point[0], point[1]] },
                          })
                      : null
                  }
                  onSelect={select}
                  position={live?.kind === "ok" ? live : null}
                  snapshot={snapshot}
                  start={walk.preferences.startKind === "location" ? locationStart : null}
                  stops={stops}
                  walk={walk}
                />
              </MapErrorBoundary>
            ) : null}
          </section>
          <div className="grid min-w-0 content-start gap-5">
            <search>
              <Card asChild className="gap-4">
                <form onSubmit={(event) => event.preventDefault()}>
                  <CardContent className="gap-4">
                    <Field>
                      <Label htmlFor="stop-search">{translate(locale, "map.search")}</Label>
                      <Input
                        id="stop-search"
                        maxLength={100}
                        onChange={(event) =>
                          setFilters({ ...filters, query: event.currentTarget.value })
                        }
                        type="search"
                        value={filters.query}
                      />
                    </Field>
                    <Field>
                      <Label htmlFor="stop-category">{translate(locale, "map.category")}</Label>
                      <NativeSelect
                        id="stop-category"
                        onChange={(event) =>
                          setFilters({ ...filters, categoryId: event.currentTarget.value || null })
                        }
                        value={filters.categoryId ?? ""}
                      >
                        <option value="">{translate(locale, "map.allCategories")}</option>
                        {snapshot.categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.labels[locale]}
                            {snapshot.counts.byCategory[category.id]
                              ? ` (${snapshot.counts.byCategory[category.id]})`
                              : ""}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ["openNow", "map.filterOpen"],
                          ["stepFree", "map.filterStepFree"],
                          ["stroller", "map.filterStroller"],
                        ] as const
                      ).map(([key, label]) => (
                        <label
                          className={cn(
                            togglePill,
                            "has-checked:border-success has-checked:bg-success has-checked:text-primary-foreground",
                          )}
                          key={key}
                        >
                          <Checkbox
                            checked={filters[key]}
                            onChange={(event) =>
                              setFilters({ ...filters, [key]: event.currentTarget.checked })
                            }
                          />
                          <span>{translate(locale, label)}</span>
                        </label>
                      ))}
                    </div>
                  </CardContent>
                </form>
              </Card>
            </search>
            <RoutePlanner
              blockedEdgeIds={state.feed.blockedEdgeIds}
              graphVersion={state.graphVersion}
              livePosition={live}
              locale={locale}
              locationStart={locationStart}
              onChange={changeWalk}
              onLocationStart={setLocationStart}
              onShowPosition={setShowPosition}
              showPosition={showPosition}
              pkg={state.pkg}
              route={walk}
              snapshot={snapshot}
              stops={allStops}
            />
            {storageFailed ? <Alert>{translate(locale, "route.notSaved")}</Alert> : null}
            {sync.signedIn ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground" role="status">
                  {translate(locale, `route.sync.${sync.state}`)}
                </p>
                {sync.state === "synced" && hasContent(walk) ? (
                  <Button onClick={() => void sync.remove()} type="button" variant="link">
                    {translate(locale, "route.sync.remove")}
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-sm">
                <a className="font-semibold" href="/sign-in">
                  {translate(locale, "route.sync.signIn")}
                </a>
              </p>
            )}
            <section aria-labelledby="stop-list-heading" className="grid gap-3">
              <h2 className="text-2xl font-extrabold" id="stop-list-heading">
                {translate(locale, "map.listLabel")}
              </h2>
              <p className="text-sm text-muted-foreground">{translate(locale, "map.listIntro")}</p>
              {stops.length === 0 ? (
                <p role="status">{translate(locale, "map.noMatches")}</p>
              ) : (
                <ol className="m-0 grid list-none gap-4 p-0">
                  {stops.map((stop) => (
                    <Card asChild key={stop.id}>
                      <li
                        className="scroll-mt-4 gap-0 px-6 focus:border-primary"
                        id={`stop-${stop.id}`}
                        tabIndex={-1}
                      >
                        <h3 className="mb-4 flex items-center gap-2.5 font-sans text-sm font-extrabold tracking-[0.06em] text-muted-foreground uppercase">
                          <span
                            aria-hidden="true"
                            className="grid size-8 place-items-center rounded-full bg-primary font-display text-[0.95rem] tracking-normal text-primary-foreground"
                          >
                            {stop.number}
                          </span>
                          {translate(locale, "map.stop")} {stop.number}
                        </h3>
                        {stop.manualAccess ? (
                          <p className="mb-3 text-sm text-muted-foreground">
                            {translate(locale, "route.manualAccess")}
                          </p>
                        ) : null}
                        {stop.sellers.map((seller) => (
                          <SellerDetails
                            key={seller.id}
                            locale={locale}
                            onWalkChange={changeWalk}
                            route={route}
                            seller={seller}
                            snapshot={snapshot}
                            walk={walk}
                          />
                        ))}
                      </li>
                    </Card>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      )}
      <p className="text-sm text-muted-foreground">{translate(locale, "map.offlineNote")}</p>
      <p>
        <Button
          onClick={() =>
            void resetOfflineData().then(() => {
              setWalk(emptyRoute(eventKey, walk.expiresAt));
              setLocationStart(null);
            })
          }
          type="button"
          variant="link"
        >
          {translate(locale, "offline.reset")}
        </Button>
      </p>
    </div>
  );
}
