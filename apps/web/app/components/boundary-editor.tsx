import { PromenadisApiError } from "@promenadis/api-client";
import type { BoundaryPoint, DraftEventSummary } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useMutation } from "@tanstack/react-query";
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import MapView, { Layer, Source } from "react-map-gl/maplibre";
import { useExpectedAccountId } from "../lib/account-session";
import "maplibre-gl/dist/maplibre-gl.css";
import { getBrowserAuthClient, getPromenadisApiClient } from "../lib/supabase";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Field, FieldLegend, FieldSet } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

const coordinateBox = "gap-3 rounded-xl border p-4";
const coordinateLabel = "grid gap-1.5 text-sm font-semibold";

export const DEFAULT_CENTER: BoundaryPoint = [18.0686, 59.3293];
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export class MapErrorBoundary extends Component<
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

  // The parent's onSaved re-reads the events, which carry the boundary.
  const save = useMutation({
    mutationFn: async ({
      api,
      eventId,
      input,
      supabase,
    }: {
      readonly api: NonNullable<ReturnType<typeof getPromenadisApiClient>>;
      readonly eventId: string;
      readonly input: Parameters<
        NonNullable<ReturnType<typeof getPromenadisApiClient>>["saveEventBoundary"]
      >[2];
      readonly supabase: NonNullable<ReturnType<typeof getBrowserAuthClient>>;
    }) => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return null;
      return api.saveEventBoundary(data.session.user.id, eventId, input);
    },
    onSuccess: async (boundary) => {
      if (boundary) await onSaved();
    },
  });
  const busy = save.isPending;

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
    setStatus("");
    try {
      const boundary = await save.mutateAsync({
        api,
        eventId: selectedEvent.id,
        input: {
          displayLabel,
          expectedVersion: selectedEvent.boundary?.version ?? null,
          ring,
        },
        supabase,
      });
      if (!boundary) {
        setStatus(translate(locale, "dashboard.sessionExpired"));
        return;
      }
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
    }
  };

  return (
    <div className="grid gap-5">
      {events.length > 1 ? (
        <Field>
          <Label htmlFor="boundary-event">{translate(locale, "boundary.event")}</Label>
          <NativeSelect
            id="boundary-event"
            onChange={(event) => setSelectedEventId(event.currentTarget.value)}
            value={selectedEvent.id}
          >
            {events.map((event) => (
              <NativeSelectOption key={event.id} value={event.id}>
                {event.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      ) : null}

      <Field>
        <Label htmlFor="boundary-label">{translate(locale, "boundary.displayLabel")}</Label>
        <Input
          id="boundary-label"
          maxLength={120}
          onChange={(event) => setDisplayLabel(event.currentTarget.value)}
          placeholder={translate(locale, "boundary.displayLabelPlaceholder")}
          value={displayLabel}
        />
      </Field>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-prose text-sm text-muted-foreground">
          {translate(locale, "boundary.instructions")}
        </p>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button
            aria-pressed={addingOnMap}
            className="col-span-full w-full sm:w-auto"
            onClick={() => setAddingOnMap((current) => !current)}
            type="button"
          >
            {addingOnMap
              ? translate(locale, "boundary.stopAdding")
              : translate(locale, "boundary.addOnMap")}
          </Button>
          <Button
            disabled={ring.length === 0}
            onClick={() => {
              setRing((current) => current.slice(0, -1));
              setPointIds((current) => current.slice(0, -1));
            }}
            type="button"
            variant="ghost"
          >
            {translate(locale, "boundary.undo")}
          </Button>
          <Button
            disabled={ring.length === 0}
            onClick={() => {
              setRing([]);
              setPointIds([]);
            }}
            type="button"
            variant="ghost"
          >
            {translate(locale, "boundary.clear")}
          </Button>
        </div>
      </div>

      <section
        aria-label={translate(locale, "boundary.mapLabel")}
        className="h-[clamp(20rem,55vw,34rem)] overflow-hidden rounded-2xl border border-input bg-[#e9ebe4]"
      >
        {mounted ? (
          <MapErrorBoundary
            fallback={
              <p className="m-8 max-w-xl rounded-lg bg-card p-4">
                {translate(locale, "boundary.mapUnavailable")}
              </p>
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
              style={{ height: "100%", width: "100%" }}
            >
              {ring.length >= 2 ? (
                <Source data={polygonData} id="draft-boundary" type="geojson">
                  {ring.length >= 3 ? (
                    <Layer
                      id="draft-boundary-fill"
                      paint={{ "fill-color": "#15803d", "fill-opacity": 0.2 }}
                      type="fill"
                    />
                  ) : null}
                  <Layer
                    id="draft-boundary-line"
                    paint={{ "line-color": "#3f3f46", "line-width": 3 }}
                    type="line"
                  />
                </Source>
              ) : null}
              <Source data={pointData} id="draft-boundary-points" type="geojson">
                <Layer
                  id="draft-boundary-point-circles"
                  paint={{
                    "circle-color": "#ffffff",
                    "circle-radius": 7,
                    "circle-stroke-color": "#3f3f46",
                    "circle-stroke-width": 3,
                  }}
                  type="circle"
                />
              </Source>
            </MapView>
          </MapErrorBoundary>
        ) : null}
      </section>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-bold text-muted-foreground">
          {ring.length === 1
            ? translate(locale, "boundary.onePoint")
            : translate(locale, "boundary.pointCount").replace("{count}", String(ring.length))}
        </p>
        <Button disabled={busy || ring.length < 3} onClick={saveBoundary} type="button">
          {busy ? translate(locale, "boundary.saving") : translate(locale, "boundary.save")}
        </Button>
      </div>
      {selectedEvent.boundary?.warnings.length ? (
        <ul className="grid max-w-2xl list-disc gap-1 rounded-xl border border-sun/60 bg-warning-soft py-3 ps-8 pe-4 text-sm text-warning-foreground">
          {selectedEvent.boundary.warnings.map((warning) => (
            <li key={warning}>{translate(locale, `boundary.warning.${warning}`)}</li>
          ))}
        </ul>
      ) : null}
      <p aria-live="polite" className="min-h-6 text-sm font-semibold">
        {status}
      </p>

      <details className="mt-2 border-t pt-5 [&>summary]:min-h-11 [&>summary]:cursor-pointer [&>summary]:content-center [&>summary]:font-semibold">
        <summary>{translate(locale, "boundary.advanced")}</summary>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          {translate(locale, "boundary.advancedHelp")}
        </p>
        <div className="mt-4 grid gap-4">
          <FieldSet className={coordinateBox}>
            <FieldLegend className="px-1.5">{translate(locale, "boundary.points")}</FieldLegend>
            {ring.length === 0 ? (
              <p className="text-muted-foreground">{translate(locale, "boundary.noPoints")}</p>
            ) : null}
            <ol className="m-0 grid list-none gap-3 p-0">
              {ring.map((point, index) => (
                <li
                  className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl bg-muted p-3 sm:grid-cols-[auto_repeat(2,minmax(0,1fr))]"
                  key={pointIds[index]}
                >
                  <span className="grid size-8 place-items-center rounded-full bg-primary font-extrabold text-primary-foreground">
                    {index + 1}
                  </span>
                  <label className={coordinateLabel}>
                    {translate(locale, "boundary.longitude")}
                    <Input
                      aria-label={`${translate(locale, "boundary.longitude")} ${index + 1}`}
                      max="180"
                      min="-180"
                      onChange={(event) => updatePoint(index, 0, event.currentTarget.value)}
                      step="0.000001"
                      type="number"
                      value={point[0]}
                    />
                  </label>
                  <label className={cn(coordinateLabel, "col-start-2 sm:col-start-auto")}>
                    {translate(locale, "boundary.latitude")}
                    <Input
                      aria-label={`${translate(locale, "boundary.latitude")} ${index + 1}`}
                      max="90"
                      min="-90"
                      onChange={(event) => updatePoint(index, 1, event.currentTarget.value)}
                      step="0.000001"
                      type="number"
                      value={point[1]}
                    />
                  </label>
                  <div className="col-start-2 flex flex-wrap gap-2 sm:col-end-[-1]">
                    <Button
                      disabled={index === 0}
                      onClick={() => movePoint(index, -1)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {translate(locale, "boundary.moveUp")}
                    </Button>
                    <Button
                      disabled={index === ring.length - 1}
                      onClick={() => movePoint(index, 1)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {translate(locale, "boundary.moveDown")}
                    </Button>
                    <Button
                      onClick={() => {
                        setRing((current) => current.filter((_, item) => item !== index));
                        setPointIds((current) => current.filter((_, item) => item !== index));
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {translate(locale, "boundary.remove")}
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          </FieldSet>

          <FieldSet className={cn(coordinateBox, "sm:grid-cols-2")}>
            <FieldLegend className="px-1.5">
              {translate(locale, "boundary.addCoordinate")}
            </FieldLegend>
            <Field>
              <Label htmlFor="new-boundary-longitude">
                {translate(locale, "boundary.longitude")}
              </Label>
              <Input
                id="new-boundary-longitude"
                max="180"
                min="-180"
                onChange={(event) => setLongitude(event.currentTarget.value)}
                step="0.000001"
                type="number"
                value={longitude}
              />
            </Field>
            <Field>
              <Label htmlFor="new-boundary-latitude">
                {translate(locale, "boundary.latitude")}
              </Label>
              <Input
                id="new-boundary-latitude"
                max="90"
                min="-90"
                onChange={(event) => setLatitude(event.currentTarget.value)}
                step="0.000001"
                type="number"
                value={latitude}
              />
            </Field>
            <Button
              className="justify-self-start sm:col-span-full"
              onClick={addStructuredPoint}
              type="button"
              variant="outline"
            >
              {translate(locale, "boundary.addPoint")}
            </Button>
          </FieldSet>

          {selectedEvent.boundary ? (
            <p className="font-bold">
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
