import type { PublicSafetyFeed, PublicSnapshot } from "@promenadis/contracts";
import { formatCurrency, formatDateTime, type Locale, translate } from "@promenadis/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { getPromenadisApiClient } from "../lib/supabase";
import { DEFAULT_CENTER, MAP_STYLE, MapErrorBoundary } from "./boundary-editor";

type Route = "public" | "unlisted";
type LoadState =
  | { readonly kind: "loading" | "unavailable" | "ended" | "expired" }
  | {
      readonly kind: "ready";
      readonly feed: PublicSafetyFeed;
      readonly snapshot: PublicSnapshot | null;
      readonly checkedAt: Date;
    };

const FEED_INTERVAL_MS = 15_000;
const MANIFEST_INTERVAL_MS = 60_000;

// Fresh clients validate the manifest and safety feed before showing any
// precise location, refuse expired data, and apply the feed over the older
// full snapshot. While open, the feed is polled about every 15 seconds.
function usePublicStops(route: Route, eventKey: string) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const snapshotRef = useRef<PublicSnapshot | null>(null);
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
        }
        const feed = await api.getPublicSafetyFeed(route, eventKey);
        // A new safety sequence means a rebuilt snapshot is on its way.
        if (lastSequence !== null && feed.sequence !== lastSequence) lastManifestAt = 0;
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
        if (!cancelled) setState({ checkedAt: new Date(), feed, kind: "ready", snapshot });
      } catch {
        // Without a fresh feed, precise data is not shown.
        snapshotRef.current = null;
        if (!cancelled) setState({ kind: "unavailable" });
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), FEED_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [route, eventKey]);
  return state;
}

function categoryLabel(snapshot: PublicSnapshot, locale: Locale, id: string | null) {
  return snapshot.categories.find((category) => category.id === id)?.labels[locale] ?? "";
}

function SellerDetails({
  seller,
  snapshot,
  locale,
  route,
}: {
  readonly seller: PublicSeller;
  readonly snapshot: PublicSnapshot;
  readonly locale: Locale;
  readonly route: Route;
}) {
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

function StopsMap({
  stops,
  snapshot,
  locale,
  onSelect,
}: {
  readonly stops: readonly VisibleStop[];
  readonly snapshot: PublicSnapshot;
  readonly locale: Locale;
  readonly onSelect: (stopId: string) => void;
}) {
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
      onMove={({ viewState }) => setZoom(viewState.zoom)}
      ref={mapRef}
    >
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
  const state = usePublicStops(route, eventKey);
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
                <StopsMap locale={locale} onSelect={select} snapshot={snapshot} stops={stops} />
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
                    {stop.sellers.map((seller) => (
                      <SellerDetails
                        key={seller.id}
                        locale={locale}
                        route={route}
                        seller={seller}
                        snapshot={snapshot}
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
    </div>
  );
}
