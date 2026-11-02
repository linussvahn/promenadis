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
import { accuracyRing, useWatchedPosition } from "../lib/geolocation";
import { loadOffline, resetOfflineData, saveOffline, unpinOffline } from "../lib/offline-store";
import {
  emptyRoute,
  loadRoute,
  type SavedRoute,
  saveRoute,
  setMustSee,
  setSelected,
} from "../lib/route-state";
import { getPromenadisApiClient } from "../lib/supabase";
import { DEFAULT_CENTER, MAP_STYLE, MapErrorBoundary } from "./boundary-editor";
import { RoutePlanner } from "./route-planner";

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
    <article className="public-seller">
      <h4>
        {seller.title ?? seller.displayName}
        {seller.status === "away" ? (
          <span className="status-pill status-pill-muted">{translate(locale, "map.away")}</span>
        ) : null}
      </h4>
      {seller.title ? <p className="field-hint">{seller.displayName}</p> : null}
      {seller.description ? <p>{seller.description}</p> : null}
      <p className="public-seller-categories">
        {seller.categoryIds.map((id) => categoryLabel(snapshot, locale, id)).join(" · ")}
      </p>
      {seller.tags.length > 0 ? (
        <ul className="tag-list">
          {seller.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      ) : null}
      {seller.items.length > 0 ? (
        <ul className="public-items">
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
      {facts.length > 0 ? <p className="field-hint">{facts.join(" · ")}</p> : null}
      {seller.availability.length > 0 ? (
        <p className="field-hint">
          {translate(locale, "map.hours")}:{" "}
          {seller.availability
            .map(
              (window) =>
                `${formatDateTime(locale, window.startsAt, snapshot.event.timezone)} – ${formatDateTime(locale, window.endsAt, snapshot.event.timezone)}`,
            )
            .join(", ")}
        </p>
      ) : null}
      <label className="checkbox-field">
        <input
          checked={chosen}
          onChange={(event) =>
            onWalkChange(setSelected(walk, seller.id, event.currentTarget.checked))
          }
          type="checkbox"
        />
        <span>{translate(locale, "route.add")}</span>
      </label>
      {chosen ? (
        <label className="checkbox-field">
          <input
            checked={walk.mustSee.includes(seller.id)}
            disabled={!walk.mustSee.includes(seller.id) && walk.mustSee.length >= 10}
            onChange={(event) =>
              onWalkChange(setMustSee(walk, seller.id, event.currentTarget.checked))
            }
            type="checkbox"
          />
          <span>{translate(locale, "route.mustSee")}</span>
        </label>
      ) : null}
      <a
        className="text-link"
        href={`/report?key=${snapshot.eventKey}&route=${route}&type=participation&subject=${seller.id}`}
        rel="nofollow"
      >
        {translate(locale, "map.report")}
      </a>
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
            paint={{ "line-color": "#20322b", "line-width": 4 }}
            type="line"
          />
          {/* Manual connection: dotted, never a normal route line. */}
          <Layer
            filter={["get", "gap"]}
            id="public-route-gap"
            paint={{ "line-color": "#8d3d22", "line-dasharray": [1, 2], "line-width": 3 }}
            type="line"
          />
        </Source>
      ) : null}
      {shownStart ? (
        <Marker latitude={shownStart[1]} longitude={shownStart[0]}>
          <span
            aria-label={translate(locale, "route.start")}
            className="map-start-marker"
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
            className="map-position-puck"
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
            paint={{ "line-color": "#8d3d22", "line-width": 2 }}
            type="line"
          />
        </Source>
      ) : null}
      {clusterStops(stops, zoom).map((cluster) =>
        cluster.stops.length === 1 && cluster.stops[0] ? (
          <Marker key={cluster.key} latitude={cluster.latitude} longitude={cluster.longitude}>
            <button
              aria-label={`${translate(locale, "map.stop")} ${cluster.stops[0].number}`}
              className="map-stop-marker"
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
              className="map-stop-marker map-cluster-marker"
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
    return (
      <p className={state.kind === "loading" ? "" : "notice"} role="status">
        {translate(locale, `map.${state.kind}`)}
      </p>
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
    <div className="public-map-page">
      <p className="field-hint" role="status">
        {allStops.length} {translate(locale, "map.stops")} · {sellerCount}{" "}
        {translate(locale, "map.sellers")} · {openCount} {translate(locale, "map.openNowCount")} ·{" "}
        {translate(locale, "map.updated")}{" "}
        {state.checkedAt.toLocaleTimeString(locale === "sv" ? "sv-SE" : "en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      {state.offline ? (
        <p className="notice" role="alert">
          {translate(locale, "offline.banner")}
        </p>
      ) : null}
      {storageRefused ? <p className="notice">{translate(locale, "offline.refused")}</p> : null}
      {!snapshot || allStops.length === 0 ? (
        <p className="notice">{translate(locale, "map.noStopsYet")}</p>
      ) : (
        <>
          <search>
            <form
              className="panel form-panel discovery-search"
              onSubmit={(event) => event.preventDefault()}
            >
              <label htmlFor="stop-search">{translate(locale, "map.search")}</label>
              <input
                id="stop-search"
                maxLength={100}
                onChange={(event) => setFilters({ ...filters, query: event.currentTarget.value })}
                type="search"
                value={filters.query}
              />
              <label htmlFor="stop-category">{translate(locale, "map.category")}</label>
              <select
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
              </select>
              {(
                [
                  ["openNow", "map.filterOpen"],
                  ["stepFree", "map.filterStepFree"],
                  ["stroller", "map.filterStroller"],
                ] as const
              ).map(([key, label]) => (
                <label className="checkbox-field" key={key}>
                  <input
                    checked={filters[key]}
                    onChange={(event) =>
                      setFilters({ ...filters, [key]: event.currentTarget.checked })
                    }
                    type="checkbox"
                  />
                  <span>{translate(locale, label)}</span>
                </label>
              ))}
            </form>
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
          {storageFailed ? <p className="notice">{translate(locale, "route.notSaved")}</p> : null}
          <section
            aria-label={translate(locale, "map.mapLabel")}
            className="boundary-map public-map"
          >
            {mounted ? (
              <MapErrorBoundary
                fallback={
                  <p className="map-fallback">{translate(locale, "boundary.mapUnavailable")}</p>
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
          <section aria-labelledby="stop-list-heading" className="public-stop-list">
            <h2 id="stop-list-heading">{translate(locale, "map.listLabel")}</h2>
            <p className="field-hint">{translate(locale, "map.listIntro")}</p>
            {stops.length === 0 ? (
              <p role="status">{translate(locale, "map.noMatches")}</p>
            ) : (
              <ol className="stop-list">
                {stops.map((stop) => (
                  <li className="panel" id={`stop-${stop.id}`} key={stop.id} tabIndex={-1}>
                    <h3>
                      {translate(locale, "map.stop")} {stop.number}
                    </h3>
                    {stop.manualAccess ? (
                      <p className="field-hint">{translate(locale, "route.manualAccess")}</p>
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
                ))}
              </ol>
            )}
          </section>
        </>
      )}
      <p className="field-hint">{translate(locale, "map.offlineNote")}</p>
      <p>
        <button
          className="quiet-button"
          onClick={() =>
            void resetOfflineData().then(() => {
              setWalk(emptyRoute(eventKey, walk.expiresAt));
              setLocationStart(null);
            })
          }
          type="button"
        >
          {translate(locale, "offline.reset")}
        </button>
      </p>
    </div>
  );
}
