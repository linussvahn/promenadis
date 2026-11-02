import { PromenadisApiError } from "@promenadis/api-client";
import type {
  AddRoutingOverrideRequest,
  DraftEventSummary,
  EventRouting,
  RoutingPackageContract,
} from "@promenadis/contracts";
import { type Locale, type MessageKey, translate } from "@promenadis/i18n";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import MapView, { Layer, type MapLayerMouseEvent, Source } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { getPromenadisApiClient } from "../lib/supabase";
import { DEFAULT_CENTER, MAP_STYLE, MapErrorBoundary } from "./boundary-editor";

const errorKeys: Record<string, MessageKey> = {
  boundary_required: "walking.error.boundary",
  build_outdated: "walking.error.outdated",
  build_running: "walking.error.running",
  build_warnings: "walking.error.warnings",
  disconnected_locations: "walking.error.disconnected",
  recent_auth_required: "lifecycle.recentAuth",
};

function packageLines(pkg: RoutingPackageContract) {
  const features = [];
  for (let e = 0; e < pkg.edges.length; e += 4) {
    const a = pkg.edges[e] as number;
    const b = pkg.edges[e + 1] as number;
    features.push({
      geometry: {
        coordinates: [
          [pkg.nodes[a * 2] as number, pkg.nodes[a * 2 + 1] as number],
          [pkg.nodes[b * 2] as number, pkg.nodes[b * 2 + 1] as number],
        ],
        type: "LineString" as const,
      },
      properties: { connector: (pkg.edges[e + 3] as number) === 2, key: pkg.edgeKeys[e / 4] ?? "" },
      type: "Feature" as const,
    });
  }
  return { features, type: "FeatureCollection" as const };
}

// Host preview of the walking network: build, inspect, correct, confirm.
export function WalkingNetwork({
  accessToken,
  event,
  locale,
}: {
  readonly accessToken: () => Promise<string | null>;
  readonly event: DraftEventSummary;
  readonly locale: Locale;
}) {
  const [routing, setRouting] = useState<EventRouting | null>(null);
  const [preview, setPreview] = useState<RoutingPackageContract | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [edgeKey, setEdgeKey] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const canEdit = event.role === "owner" || event.role === "co_host";
  const live = event.state === "active";

  const run = useCallback(
    async (
      action: (
        api: NonNullable<ReturnType<typeof getPromenadisApiClient>>,
        token: string,
      ) => Promise<EventRouting>,
    ) => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      if (!api || !token) return;
      setBusy(true);
      setStatus("");
      try {
        setRouting(await action(api, token));
      } catch (error) {
        const code = error instanceof PromenadisApiError ? error.code : "";
        setStatus(translate(locale, errorKeys[code] ?? "walking.error.generic"));
      } finally {
        setBusy(false);
      }
    },
    [accessToken, locale],
  );

  useEffect(() => {
    void run((api, token) => api.getEventRouting(token, event.id));
  }, [event.id, run]);

  const latest = routing?.latest ?? null;
  useEffect(() => {
    const api = getPromenadisApiClient();
    if (!api || !latest?.packageId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const buildId = latest.id;
    void accessToken()
      .then((token) => (token ? api.getRoutingPreviewPackage(token, event.id, buildId) : null))
      .then((pkg) => {
        if (!cancelled) setPreview(pkg);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, event.id, latest?.id, latest?.packageId]);

  const lines = useMemo(() => (preview ? packageLines(preview) : null), [preview]);
  const center = preview
    ? ([(preview.bbox[0] + preview.bbox[2]) / 2, (preview.bbox[1] + preview.bbox[3]) / 2] as const)
    : DEFAULT_CENTER;

  const addOverride = (input: AddRoutingOverrideRequest, form?: HTMLFormElement) =>
    run(async (api, token) => {
      const next = await api.addRoutingOverride(token, event.id, input);
      form?.reset();
      setEdgeKey("");
      return next;
    });

  const submitBlock = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    void addOverride(
      {
        edgeKey: String(form.get("edgeKey") ?? "").trim(),
        kind: "block_edge",
        reason: String(form.get("reason") ?? ""),
      },
      formEvent.currentTarget,
    );
  };
  const submitConnector = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const point = (name: string) =>
      String(form.get(name) ?? "")
        .split(",")
        .map((part) => Number(part.trim())) as unknown as [number, number];
    void addOverride(
      {
        from: point("from"),
        kind: "connector",
        reason: String(form.get("reason") ?? ""),
        safeWalkingAttested: true,
        to: point("to"),
      },
      formEvent.currentTarget,
    );
  };
  const markManual = (locationId: string, formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const reason = String(new FormData(formEvent.currentTarget).get("reason") ?? "");
    void addOverride({ kind: "manual_access", locationId, reason }, formEvent.currentTarget);
  };

  if (!routing) {
    return <p aria-live="polite">{status || translate(locale, "common.loading")}</p>;
  }

  return (
    <div className="form-stack">
      <section aria-labelledby="walking-status" className="panel">
        <h2 id="walking-status">{translate(locale, "walking.status")}</h2>
        <p>
          <span className="status-pill status-pill-muted">
            {translate(locale, routing.ready ? "walking.ready" : "walking.notReady")}
          </span>
        </p>
        {latest ? (
          <dl className="summary-list">
            <div>
              <dt>{translate(locale, "walking.latestBuild")}</dt>
              <dd>{translate(locale, `walking.state.${latest.state}`)}</dd>
            </div>
            <div>
              <dt>{translate(locale, "walking.graph")}</dt>
              <dd>
                {latest.nodeCount ?? 0} {translate(locale, "walking.nodes")} ·{" "}
                {latest.edgeCount ?? 0} {translate(locale, "walking.edges")} ·{" "}
                {latest.componentCount ?? 0} {translate(locale, "walking.components")}
              </dd>
            </div>
            <div>
              <dt>{translate(locale, "walking.source")}</dt>
              <dd>
                {String(latest.source.name ?? "")} · {String(latest.source.license ?? "")} ·{" "}
                {String(latest.source.attribution ?? "")}
              </dd>
            </div>
            {latest.warnings.length > 0 ? (
              <div>
                <dt>{translate(locale, "walking.warnings")}</dt>
                <dd>{latest.warnings.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p>{translate(locale, "walking.noBuild")}</p>
        )}
        {canEdit ? (
          <div className="button-row">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void run((api, token) => api.buildEventRouting(token, event.id))}
              type="button"
            >
              {translate(locale, "walking.build")}
            </button>
            {latest?.state === "awaiting_host_preview" ? (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run((api, token) => api.confirmRoutingBuild(token, event.id, latest.id))
                }
                type="button"
              >
                {translate(locale, "walking.confirm")}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="field-hint">{translate(locale, "walking.inspectOnly")}</p>
        )}
        <p aria-live="polite" role="status">
          {status}
        </p>
      </section>

      {lines ? (
        <section aria-label={translate(locale, "walking.mapLabel")} className="boundary-map">
          {mounted ? (
            <MapErrorBoundary
              fallback={
                <p className="map-fallback">{translate(locale, "boundary.mapUnavailable")}</p>
              }
            >
              <MapView
                initialViewState={{ latitude: center[1], longitude: center[0], zoom: 15 }}
                interactiveLayerIds={["walking-edges"]}
                mapStyle={MAP_STYLE}
                onClick={(mapEvent: MapLayerMouseEvent) => {
                  const key = mapEvent.features?.[0]?.properties?.key;
                  if (typeof key === "string" && !key.startsWith("c:")) setEdgeKey(key);
                }}
              >
                <Source data={lines} id="walking-network" type="geojson">
                  <Layer
                    id="walking-edges"
                    paint={{
                      "line-color": ["case", ["get", "connector"], "#bd5b35", "#2e6b4f"],
                      "line-width": 3,
                    }}
                    type="line"
                  />
                </Source>
              </MapView>
            </MapErrorBoundary>
          ) : null}
          <p className="field-hint">{translate(locale, "walking.mapHint")}</p>
        </section>
      ) : null}

      {latest ? (
        <section aria-labelledby="walking-locations" className="panel">
          <h2 id="walking-locations">{translate(locale, "walking.locations")}</h2>
          {latest.locations.length === 0 ? <p>{translate(locale, "walking.noLocations")}</p> : null}
          <ul className="stop-list">
            {latest.locations.map((location) => (
              <li className="review-item" key={location.id}>
                <h3>{location.sellerNames.join(", ") || location.id}</h3>
                <p>
                  <span className="status-pill status-pill-muted">
                    {translate(locale, `walking.location.${location.status}`)}
                  </span>{" "}
                  {location.snapMeters !== null
                    ? `${location.snapMeters} m ${translate(locale, "walking.toPath")}`
                    : ""}
                  {location.detourRatio !== null && location.detourRatio > 3
                    ? ` · ${translate(locale, "walking.detour")}`
                    : ""}
                </p>
                {canEdit && location.status === "disconnected" ? (
                  <form
                    className="form-panel"
                    onSubmit={(formEvent) => markManual(location.id, formEvent)}
                  >
                    <label htmlFor={`manual-${location.id}`}>
                      {translate(locale, "walking.reason")}
                    </label>
                    <input
                      id={`manual-${location.id}`}
                      maxLength={500}
                      minLength={3}
                      name="reason"
                      required
                    />
                    <button className="secondary-button" disabled={busy} type="submit">
                      {translate(locale, "walking.markManual")}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canEdit ? (
        <>
          <form className="panel form-panel" onSubmit={submitBlock}>
            <h2>{translate(locale, "walking.blockTitle")}</h2>
            <p className="field-hint">
              {translate(locale, live ? "walking.blockLiveHint" : "walking.blockHint")}
            </p>
            <label htmlFor="block-edge">{translate(locale, "walking.edgeKey")}</label>
            <input
              id="block-edge"
              name="edgeKey"
              onChange={(changeEvent) => setEdgeKey(changeEvent.currentTarget.value)}
              pattern="[0-9]+-[0-9]+"
              required
              value={edgeKey}
            />
            <label htmlFor="block-reason">{translate(locale, "walking.reason")}</label>
            <input id="block-reason" maxLength={500} minLength={3} name="reason" required />
            <button className="secondary-button" disabled={busy} type="submit">
              {translate(locale, "walking.block")}
            </button>
          </form>
          {live ? null : (
            <form className="panel form-panel" onSubmit={submitConnector}>
              <h2>{translate(locale, "walking.connectorTitle")}</h2>
              <p className="field-hint">{translate(locale, "walking.connectorHint")}</p>
              <label htmlFor="connector-from">{translate(locale, "walking.connectorFrom")}</label>
              <input id="connector-from" name="from" placeholder="18.0612, 59.3121" required />
              <label htmlFor="connector-to">{translate(locale, "walking.connectorTo")}</label>
              <input id="connector-to" name="to" placeholder="18.0615, 59.3123" required />
              <label htmlFor="connector-reason">{translate(locale, "walking.reason")}</label>
              <input id="connector-reason" maxLength={500} minLength={3} name="reason" required />
              <label className="checkbox-field">
                <input name="attested" required type="checkbox" />
                <span>{translate(locale, "walking.attest")}</span>
              </label>
              <button className="secondary-button" disabled={busy} type="submit">
                {translate(locale, "walking.addConnector")}
              </button>
            </form>
          )}
        </>
      ) : null}

      {routing.overrides.length > 0 ? (
        <section aria-labelledby="walking-overrides" className="panel">
          <h2 id="walking-overrides">{translate(locale, "walking.overrides")}</h2>
          <ul className="stop-list">
            {routing.overrides.map((override) => (
              <li className="review-item" key={override.id}>
                <p>
                  <strong>{translate(locale, `walking.override.${override.kind}`)}</strong>
                  {override.edgeKey ? ` · ${override.edgeKey}` : ""} · {override.reason}
                </p>
                {canEdit ? (
                  <button
                    className="quiet-button"
                    disabled={busy}
                    onClick={() =>
                      void run((api, token) =>
                        api.removeRoutingOverride(token, event.id, override.id),
                      )
                    }
                    type="button"
                  >
                    {translate(locale, "walking.remove")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
