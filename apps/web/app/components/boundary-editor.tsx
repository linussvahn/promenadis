import { useExpectedAccountId } from "../lib/account-session";
import { PromenadisApiError } from "@promenadis/api-client";
import type { BoundaryPoint, DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import MapView, { Layer, Source } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { getPromenadisApiClient, getBrowserAuthClient } from "../lib/supabase";

const DEFAULT_CENTER: BoundaryPoint = [18.0686, 59.3293];
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

class MapErrorBoundary extends Component<
  { readonly children: ReactNode; readonly fallback: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function openRing(event: DraftEventSummary): BoundaryPoint[] {
  const ring = event.boundary?.ring ?? [];
  const first = ring[0];
  const last = ring.at(-1);
  return first && last && first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : [...ring];
}

function centerFor(ring: readonly BoundaryPoint[]): BoundaryPoint {
  if (ring.length === 0) return DEFAULT_CENTER;
  const total = ring.reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1]] as BoundaryPoint,
    [0, 0] as BoundaryPoint,
  );
  return [total[0] / ring.length, total[1] / ring.length];
}

export function BoundaryEditor({
  events,
  locale,
  onSaved,
}: {
  readonly events: readonly DraftEventSummary[];
  readonly locale: Locale;
  readonly onSaved: () => Promise<void>;
}) {
  const expectedAccountId = useExpectedAccountId();
  const [selectedEventId, setSelectedEventId] = useState(events[0]?.id ?? "");
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0];
  const [ring, setRing] = useState<BoundaryPoint[]>(selectedEvent ? openRing(selectedEvent) : []);
  const [pointIds, setPointIds] = useState<string[]>(() =>
    (selectedEvent ? openRing(selectedEvent) : []).map(() => crypto.randomUUID()),
  );
  const [displayLabel, setDisplayLabel] = useState(selectedEvent?.boundary?.displayLabel ?? "");
  const [longitude, setLongitude] = useState(String(DEFAULT_CENTER[0]));
  const [latitude, setLatitude] = useState(String(DEFAULT_CENTER[1]));
  const [addingOnMap, setAddingOnMap] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const loadedEventId = useRef<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!selectedEvent || loadedEventId.current === selectedEvent.id) return;
    loadedEventId.current = selectedEvent.id;
    const nextRing = openRing(selectedEvent);
    setRing(nextRing);
    setPointIds(nextRing.map(() => crypto.randomUUID()));
    setDisplayLabel(selectedEvent.boundary?.displayLabel ?? "");
    setStatus("");
  }, [selectedEvent]);

  const mapCenter = useMemo(() => centerFor(ring), [ring]);
  const closedRing = ring.length >= 3 ? [...ring, ring[0]] : ring;
  const polygonData = {
    type: "Feature" as const,
    properties: {},
    geometry:
      ring.length >= 3
        ? { type: "Polygon" as const, coordinates: [closedRing] }
        : { type: "LineString" as const, coordinates: ring },
  };
  const pointData = {
    type: "FeatureCollection" as const,
    features: ring.map((point, index) => ({
      type: "Feature" as const,
      properties: { index: index + 1 },
      geometry: { type: "Point" as const, coordinates: point },
    })),
  };

  if (!selectedEvent) {
    return <p>{translate(locale, "boundary.needsEvent")}</p>;
  }

  const addPoint = (point: BoundaryPoint) => {
    if (ring.length >= 50) {
      setStatus(translate(locale, "boundary.tooManyPoints"));
      return;
    }
    setRing((current) => [...current, point]);
    setPointIds((current) => [...current, crypto.randomUUID()]);
    setStatus("");
  };

  const addStructuredPoint = () => {
    const nextLongitude = Number(longitude);
    const nextLatitude = Number(latitude);
    if (
      !Number.isFinite(nextLongitude) ||
      !Number.isFinite(nextLatitude) ||
      nextLongitude < -180 ||
      nextLongitude > 180 ||
      nextLatitude < -90 ||
      nextLatitude > 90
    ) {
      setStatus(translate(locale, "boundary.invalidCoordinate"));
      return;
    }
    addPoint([nextLongitude, nextLatitude]);
  };

  const updatePoint = (index: number, coordinate: 0 | 1, value: string) => {
    const parsed = Number(value);
    const valid =
      Number.isFinite(parsed) &&
      (coordinate === 0 ? parsed >= -180 && parsed <= 180 : parsed >= -90 && parsed <= 90);
    if (!valid) return;
    setRing((current) =>
      current.map((point, pointIndex) => {
        if (pointIndex !== index) return point;
        const updated: BoundaryPoint = [...point];
        updated[coordinate] = parsed;
        return updated;
      }),
    );
  };

  const movePoint = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= ring.length) return;
    setRing((current) => {
      const updated = [...current];
      [updated[index], updated[target]] = [
        updated[target] as BoundaryPoint,
        updated[index] as BoundaryPoint,
      ];
      return updated;
    });
    setPointIds((current) => {
      const updated = [...current];
      [updated[index], updated[target]] = [updated[target] as string, updated[index] as string];
      return updated;
    });
  };

  const saveBoundary = async () => {
    if (ring.length < 3) {
      setStatus(translate(locale, "boundary.needsThreePoints"));
      return;
    }
    const api = getPromenadisApiClient();
    const supabase = getBrowserAuthClient(expectedAccountId);
    if (!api || !supabase) return;
    setBusy(true);
    setStatus("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setStatus(translate(locale, "dashboard.sessionExpired"));
        return;
      }
      const boundary = await api.saveEventBoundary(data.session.user.id, selectedEvent.id, {
        displayLabel,
        expectedVersion: selectedEvent.boundary?.version ?? null,
        ring,
      });
      await onSaved();
      setStatus(
        `${translate(locale, "boundary.saved")} ${boundary.areaSquareKilometers.toFixed(2)} km² · ${boundary.spanKilometers.toFixed(2)} km`,
      );
    } catch (error) {
      const key =
        error instanceof PromenadisApiError && error.code === "version_conflict"
          ? "boundary.versionConflict"
          : error instanceof PromenadisApiError && error.code === "boundary_too_large"
            ? "boundary.areaLimit"
            : error instanceof PromenadisApiError && error.code === "boundary_too_wide"
              ? "boundary.spanLimit"
              : "boundary.invalid";
      setStatus(translate(locale, key));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="boundary-editor">
      {events.length > 1 ? (
        <>
          <label htmlFor="boundary-event">{translate(locale, "boundary.event")}</label>
          <select
            id="boundary-event"
            onChange={(event) => setSelectedEventId(event.currentTarget.value)}
            value={selectedEvent.id}
          >
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <label htmlFor="boundary-label">{translate(locale, "boundary.displayLabel")}</label>
      <input
        id="boundary-label"
        maxLength={120}
        onChange={(event) => setDisplayLabel(event.currentTarget.value)}
        placeholder={translate(locale, "boundary.displayLabelPlaceholder")}
        value={displayLabel}
      />

      <div className="boundary-map-toolbar">
        <p className="field-help">{translate(locale, "boundary.instructions")}</p>
        <div className="boundary-map-actions">
          <button
            aria-pressed={addingOnMap}
            className="secondary-button"
            onClick={() => setAddingOnMap((current) => !current)}
            type="button"
          >
            {addingOnMap
              ? translate(locale, "boundary.stopAdding")
              : translate(locale, "boundary.addOnMap")}
          </button>
          <button
            className="quiet-button"
            disabled={ring.length === 0}
            onClick={() => {
              setRing((current) => current.slice(0, -1));
              setPointIds((current) => current.slice(0, -1));
            }}
            type="button"
          >
            {translate(locale, "boundary.undo")}
          </button>
          <button
            className="quiet-button"
            disabled={ring.length === 0}
            onClick={() => {
              setRing([]);
              setPointIds([]);
            }}
            type="button"
          >
            {translate(locale, "boundary.clear")}
          </button>
        </div>
      </div>

      <section aria-label={translate(locale, "boundary.mapLabel")} className="boundary-map">
        {mounted ? (
          <MapErrorBoundary
            fallback={
              <p className="map-fallback">{translate(locale, "boundary.mapUnavailable")}</p>
            }
            key={selectedEvent.id}
          >
            <MapView
              cursor={addingOnMap ? "crosshair" : "grab"}
              initialViewState={{
                latitude: mapCenter[1],
                longitude: mapCenter[0],
                zoom: ring.length ? 14 : 10,
              }}
              mapStyle={MAP_STYLE}
              onClick={({ lngLat }) => {
                if (addingOnMap) addPoint([lngLat.lng, lngLat.lat]);
              }}
            >
              {ring.length >= 2 ? (
                <Source data={polygonData} id="draft-boundary" type="geojson">
                  {ring.length >= 3 ? (
                    <Layer
                      id="draft-boundary-fill"
                      paint={{ "fill-color": "#bd5b35", "fill-opacity": 0.2 }}
                      type="fill"
                    />
                  ) : null}
                  <Layer
                    id="draft-boundary-line"
                    paint={{ "line-color": "#8d3d22", "line-width": 3 }}
                    type="line"
                  />
                </Source>
              ) : null}
              <Source data={pointData} id="draft-boundary-points" type="geojson">
                <Layer
                  id="draft-boundary-point-circles"
                  paint={{
                    "circle-color": "#fffdf8",
                    "circle-radius": 7,
                    "circle-stroke-color": "#8d3d22",
                    "circle-stroke-width": 3,
                  }}
                  type="circle"
                />
              </Source>
            </MapView>
          </MapErrorBoundary>
        ) : null}
      </section>

      <div className="boundary-save-row">
        <p className="boundary-point-count">
          {ring.length === 1
            ? translate(locale, "boundary.onePoint")
            : translate(locale, "boundary.pointCount").replace("{count}", String(ring.length))}
        </p>
        <button
          className="primary-button"
          disabled={busy || ring.length < 3}
          onClick={saveBoundary}
          type="button"
        >
          {busy ? translate(locale, "boundary.saving") : translate(locale, "boundary.save")}
        </button>
      </div>
      {selectedEvent.boundary?.warnings.length ? (
        <ul className="notice notice-warning">
          {selectedEvent.boundary.warnings.map((warning) => (
            <li key={warning}>{translate(locale, `boundary.warning.${warning}`)}</li>
          ))}
        </ul>
      ) : null}
      <p aria-live="polite" className="form-status">
        {status}
      </p>

      <details className="advanced-editor">
        <summary>{translate(locale, "boundary.advanced")}</summary>
        <p className="field-help">{translate(locale, "boundary.advancedHelp")}</p>
        <div className="advanced-editor-content">
          <fieldset className="boundary-points">
            <legend>{translate(locale, "boundary.points")}</legend>
            {ring.length === 0 ? <p>{translate(locale, "boundary.noPoints")}</p> : null}
            <ol>
              {ring.map((point, index) => (
                <li key={pointIds[index]}>
                  <span className="point-number">{index + 1}</span>
                  <label>
                    {translate(locale, "boundary.longitude")}
                    <input
                      aria-label={`${translate(locale, "boundary.longitude")} ${index + 1}`}
                      max="180"
                      min="-180"
                      onChange={(event) => updatePoint(index, 0, event.currentTarget.value)}
                      step="0.000001"
                      type="number"
                      value={point[0]}
                    />
                  </label>
                  <label>
                    {translate(locale, "boundary.latitude")}
                    <input
                      aria-label={`${translate(locale, "boundary.latitude")} ${index + 1}`}
                      max="90"
                      min="-90"
                      onChange={(event) => updatePoint(index, 1, event.currentTarget.value)}
                      step="0.000001"
                      type="number"
                      value={point[1]}
                    />
                  </label>
                  <div className="point-actions">
                    <button
                      disabled={index === 0}
                      onClick={() => movePoint(index, -1)}
                      type="button"
                    >
                      {translate(locale, "boundary.moveUp")}
                    </button>
                    <button
                      disabled={index === ring.length - 1}
                      onClick={() => movePoint(index, 1)}
                      type="button"
                    >
                      {translate(locale, "boundary.moveDown")}
                    </button>
                    <button
                      onClick={() => {
                        setRing((current) => current.filter((_, item) => item !== index));
                        setPointIds((current) => current.filter((_, item) => item !== index));
                      }}
                      type="button"
                    >
                      {translate(locale, "boundary.remove")}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </fieldset>

          <fieldset className="add-coordinate">
            <legend>{translate(locale, "boundary.addCoordinate")}</legend>
            <label htmlFor="new-boundary-longitude">
              {translate(locale, "boundary.longitude")}
            </label>
            <input
              id="new-boundary-longitude"
              max="180"
              min="-180"
              onChange={(event) => setLongitude(event.currentTarget.value)}
              step="0.000001"
              type="number"
              value={longitude}
            />
            <label htmlFor="new-boundary-latitude">{translate(locale, "boundary.latitude")}</label>
            <input
              id="new-boundary-latitude"
              max="90"
              min="-90"
              onChange={(event) => setLatitude(event.currentTarget.value)}
              step="0.000001"
              type="number"
              value={latitude}
            />
            <button className="secondary-button" onClick={addStructuredPoint} type="button">
              {translate(locale, "boundary.addPoint")}
            </button>
          </fieldset>

          {selectedEvent.boundary ? (
            <p className="boundary-metrics">
              {translate(locale, "boundary.currentMetrics")}:{" "}
              {selectedEvent.boundary.areaSquareKilometers.toFixed(2)} km² ·{" "}
              {selectedEvent.boundary.spanKilometers.toFixed(2)} km · v
              {selectedEvent.boundary.version}
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}
