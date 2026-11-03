import type { BoundaryPoint } from "@promenadis/contracts";
import { type Locale, translate } from "@promenadis/i18n";
import { useEffect, useState } from "react";
import MapView, { Layer, Source } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_CENTER, MAP_STYLE, MapErrorBoundary } from "./boundary-editor";
import { Field, FieldDescription, FieldLegend, FieldSet } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

// Click the map or type coordinates; the typed fields are the non-map path.
export function PinPicker({
  boundary,
  idPrefix = "pin",
  locale,
  onChange,
  value,
}: {
  readonly boundary: readonly BoundaryPoint[] | null;
  readonly idPrefix?: string;
  readonly locale: Locale;
  readonly onChange: (point: BoundaryPoint) => void;
  readonly value: BoundaryPoint | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState<[string, string]>(["", ""]);
  useEffect(() => setMounted(true), []);
  // Map clicks update the typed fields; typing only commits complete numbers.
  useEffect(() => {
    if (!value) return;
    setText((current) =>
      Number(current[0]) === value[0] && Number(current[1]) === value[1]
        ? current
        : [String(value[0]), String(value[1])],
    );
  }, [value]);
  const ring = boundary ?? [];
  const center =
    value ??
    (ring.length
      ? ([
          ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
          ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
        ] as BoundaryPoint)
      : DEFAULT_CENTER);

  const setCoordinate = (index: 0 | 1, input: string) => {
    setText((current) => (index === 0 ? [input, current[1]] : [current[0], input]));
    const number = Number(input);
    if (input.trim() === "" || !Number.isFinite(number)) return;
    const next: BoundaryPoint = [...(value ?? center)] as BoundaryPoint;
    next[index] = number;
    onChange(next);
  };

  return (
    <div className="grid gap-5">
      <section
        aria-label={translate(locale, "seller.mapLabel")}
        className="h-[clamp(18rem,55vw,30rem)] overflow-hidden rounded-xl border border-input bg-muted [&_.maplibregl-map]:size-full"
      >
        {mounted ? (
          <MapErrorBoundary
            fallback={
              <p className="m-6 max-w-xl rounded-lg bg-card p-4 text-sm">
                {translate(locale, "boundary.mapUnavailable")}
              </p>
            }
          >
            <MapView
              cursor="crosshair"
              initialViewState={{ latitude: center[1], longitude: center[0], zoom: 15 }}
              mapStyle={MAP_STYLE}
              onClick={({ lngLat }) => onChange([lngLat.lng, lngLat.lat])}
            >
              {ring.length >= 3 ? (
                <Source
                  data={{
                    geometry: { coordinates: [ring], type: "Polygon" },
                    properties: {},
                    type: "Feature",
                  }}
                  id={`${idPrefix}-event-area`}
                  type="geojson"
                >
                  <Layer
                    id={`${idPrefix}-event-area-fill`}
                    paint={{ "fill-color": "#15803d", "fill-opacity": 0.12 }}
                    type="fill"
                  />
                  <Layer
                    id={`${idPrefix}-event-area-line`}
                    paint={{ "line-color": "#3f3f46", "line-width": 2 }}
                    type="line"
                  />
                </Source>
              ) : null}
              {value ? (
                <Source
                  data={{
                    geometry: { coordinates: value, type: "Point" },
                    properties: {},
                    type: "Feature",
                  }}
                  id={`${idPrefix}-marker`}
                  type="geojson"
                >
                  <Layer
                    id={`${idPrefix}-marker-circle`}
                    paint={{
                      "circle-color": "#3f3f46",
                      "circle-radius": 8,
                      "circle-stroke-color": "#ffffff",
                      "circle-stroke-width": 3,
                    }}
                    type="circle"
                  />
                </Source>
              ) : null}
            </MapView>
          </MapErrorBoundary>
        ) : null}
      </section>
      <FieldSet>
        <FieldLegend>{translate(locale, "seller.coordinates")}</FieldLegend>
        <FieldDescription>{translate(locale, "seller.coordinatesHelp")}</FieldDescription>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label htmlFor={`${idPrefix}-latitude`}>{translate(locale, "boundary.latitude")}</Label>
            <Input
              id={`${idPrefix}-latitude`}
              inputMode="decimal"
              onChange={(event) => setCoordinate(1, event.currentTarget.value)}
              value={text[1]}
            />
          </Field>
          <Field>
            <Label htmlFor={`${idPrefix}-longitude`}>
              {translate(locale, "boundary.longitude")}
            </Label>
            <Input
              id={`${idPrefix}-longitude`}
              inputMode="decimal"
              onChange={(event) => setCoordinate(0, event.currentTarget.value)}
              value={text[0]}
            />
          </Field>
        </div>
      </FieldSet>
    </div>
  );
}
