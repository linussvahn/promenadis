import { PromenadisApiError } from "@promenadis/api-client";
import type {
  AddRoutingOverrideRequest,
  DraftEventSummary,
  EventRouting,
  RoutingPackageContract,
} from "@promenadis/contracts";
import { type Locale, type MessageKey, translate } from "@promenadis/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import MapView, { Layer, type MapLayerMouseEvent, Source } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useExpectedAccountId } from "../lib/account-session";
import { getPromenadisApiClient } from "../lib/supabase";
import { accountKey } from "../lib/use-account-data";
import { DEFAULT_CENTER, MAP_STYLE, MapErrorBoundary } from "./boundary-editor";
import { SummaryList } from "./page";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { ChoiceField, Field, FieldGroup } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

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
  const accountId = useExpectedAccountId();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [edgeKey, setEdgeKey] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const canEdit = event.role === "owner" || event.role === "co_host";
  const live = event.state === "active";
  const routingKey = accountKey(accountId, "event", event.id, "routing");

  const errorText = (error: unknown) => {
    const code = error instanceof PromenadisApiError ? error.code : "";
    return translate(locale, errorKeys[code] ?? "walking.error.generic");
  };

  const routingQuery = useQuery({
    queryKey: routingKey,
    queryFn: async () => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      return api && token ? api.getEventRouting(token, event.id) : null;
    },
  });
  const routing: EventRouting | null = routingQuery.data ?? null;

  // Every routing write answers with the event's current routing state.
  const write = useMutation({
    mutationFn: async (
      action: (
        api: NonNullable<ReturnType<typeof getPromenadisApiClient>>,
        token: string,
      ) => Promise<EventRouting>,
    ) => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      return api && token ? action(api, token) : null;
    },
    onSuccess: (next) => {
      if (next) queryClient.setQueryData(routingKey, next);
    },
  });
  const busy = write.isPending;

  const run = async (
    action: (
      api: NonNullable<ReturnType<typeof getPromenadisApiClient>>,
      token: string,
    ) => Promise<EventRouting>,
  ) => {
    setStatus("");
    try {
      await write.mutateAsync(action);
    } catch (error) {
      setStatus(errorText(error));
    }
  };

  const latest = routing?.latest ?? null;
  const previewQuery = useQuery({
    enabled: Boolean(latest?.packageId),
    queryKey: accountKey(accountId, "event", event.id, "routing-preview", latest?.id),
    queryFn: async () => {
      const api = getPromenadisApiClient();
      const token = await accessToken();
      return api && token && latest
        ? api.getRoutingPreviewPackage(token, event.id, latest.id)
        : null;
    },
  });
  const preview: RoutingPackageContract | null =
    latest?.packageId && !previewQuery.isError ? (previewQuery.data ?? null) : null;

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
    return (
      <p aria-live="polite" className="text-muted-foreground">
        {status ||
          (routingQuery.isError
            ? errorText(routingQuery.error)
            : translate(locale, "common.loading"))}
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      <Card aria-labelledby="walking-status" asChild>
        <section>
          <CardHeader>
            <CardTitle id="walking-status">{translate(locale, "walking.status")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              <Badge variant={routing.ready ? "success" : "secondary"}>
                {translate(locale, routing.ready ? "walking.ready" : "walking.notReady")}
              </Badge>
            </p>
            {latest ? (
              <SummaryList>
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
                  <dd className="break-words">
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
              </SummaryList>
            ) : (
              <p className="text-muted-foreground">{translate(locale, "walking.noBuild")}</p>
            )}
            {canEdit ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={busy}
                  onClick={() => void run((api, token) => api.buildEventRouting(token, event.id))}
                  type="button"
                >
                  {translate(locale, "walking.build")}
                </Button>
                {latest?.state === "awaiting_host_preview" ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run((api, token) => api.confirmRoutingBuild(token, event.id, latest.id))
                    }
                    type="button"
                    variant="outline"
                  >
                    {translate(locale, "walking.confirm")}
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {translate(locale, "walking.inspectOnly")}
              </p>
            )}
            <p aria-live="polite" className="min-h-6 text-sm font-semibold" role="status">
              {status}
            </p>
          </CardContent>
        </section>
      </Card>

      {lines ? (
        <section aria-label={translate(locale, "walking.mapLabel")} className="grid gap-2">
          <div className="h-[clamp(20rem,55vw,34rem)] overflow-hidden rounded-2xl border border-input bg-[#e9ebe4]">
            {mounted ? (
              <MapErrorBoundary
                fallback={
                  <p className="m-8 max-w-xl rounded-lg bg-card p-4">
                    {translate(locale, "boundary.mapUnavailable")}
                  </p>
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
                  style={{ height: "100%", width: "100%" }}
                >
                  <Source data={lines} id="walking-network" type="geojson">
                    <Layer
                      id="walking-edges"
                      paint={{
                        "line-color": ["case", ["get", "connector"], "#15803d", "#18181b"],
                        "line-width": 3,
                      }}
                      type="line"
                    />
                  </Source>
                </MapView>
              </MapErrorBoundary>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{translate(locale, "walking.mapHint")}</p>
        </section>
      ) : null}

      {latest ? (
        <Card aria-labelledby="walking-locations" asChild>
          <section>
            <CardHeader>
              <CardTitle id="walking-locations">{translate(locale, "walking.locations")}</CardTitle>
            </CardHeader>
            <CardContent>
              {latest.locations.length === 0 ? (
                <p className="text-muted-foreground">{translate(locale, "walking.noLocations")}</p>
              ) : null}
              <ul className="m-0 grid list-none divide-y p-0">
                {latest.locations.map((location) => (
                  <li className="grid gap-3 py-4 first:pt-0 last:pb-0" key={location.id}>
                    <h3 className="text-lg font-bold break-words">
                      {location.sellerNames.join(", ") || location.id}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      <Badge
                        variant={location.status === "disconnected" ? "destructive" : "secondary"}
                      >
                        {translate(locale, `walking.location.${location.status}`)}
                      </Badge>{" "}
                      {location.snapMeters !== null
                        ? `${location.snapMeters} m ${translate(locale, "walking.toPath")}`
                        : ""}
                      {location.detourRatio !== null && location.detourRatio > 3
                        ? ` · ${translate(locale, "walking.detour")}`
                        : ""}
                    </p>
                    {canEdit && location.status === "disconnected" ? (
                      <form
                        className="flex max-w-xl flex-wrap items-end gap-3"
                        onSubmit={(formEvent) => markManual(location.id, formEvent)}
                      >
                        <Field className="min-w-0 flex-1 basis-56">
                          <Label htmlFor={`manual-${location.id}`}>
                            {translate(locale, "walking.reason")}
                          </Label>
                          <Input
                            id={`manual-${location.id}`}
                            maxLength={500}
                            minLength={3}
                            name="reason"
                            required
                          />
                        </Field>
                        <Button disabled={busy} type="submit" variant="outline">
                          {translate(locale, "walking.markManual")}
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </section>
        </Card>
      ) : null}

      {canEdit ? (
        <>
          <Card asChild>
            <form onSubmit={submitBlock}>
              <CardHeader>
                <CardTitle>{translate(locale, "walking.blockTitle")}</CardTitle>
                <CardDescription>
                  {translate(locale, live ? "walking.blockLiveHint" : "walking.blockHint")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup className="max-w-xl">
                  <Field>
                    <Label htmlFor="block-edge">{translate(locale, "walking.edgeKey")}</Label>
                    <Input
                      id="block-edge"
                      name="edgeKey"
                      onChange={(changeEvent) => setEdgeKey(changeEvent.currentTarget.value)}
                      pattern="[0-9]+-[0-9]+"
                      required
                      value={edgeKey}
                    />
                  </Field>
                  <Field>
                    <Label htmlFor="block-reason">{translate(locale, "walking.reason")}</Label>
                    <Input id="block-reason" maxLength={500} minLength={3} name="reason" required />
                  </Field>
                </FieldGroup>
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={busy} type="submit" variant="outline">
                    {translate(locale, "walking.block")}
                  </Button>
                </div>
              </CardContent>
            </form>
          </Card>
          {live ? null : (
            <Card asChild>
              <form onSubmit={submitConnector}>
                <CardHeader>
                  <CardTitle>{translate(locale, "walking.connectorTitle")}</CardTitle>
                  <CardDescription>{translate(locale, "walking.connectorHint")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <FieldGroup className="max-w-xl">
                    <Field>
                      <Label htmlFor="connector-from">
                        {translate(locale, "walking.connectorFrom")}
                      </Label>
                      <Input
                        id="connector-from"
                        name="from"
                        placeholder="18.0612, 59.3121"
                        required
                      />
                    </Field>
                    <Field>
                      <Label htmlFor="connector-to">
                        {translate(locale, "walking.connectorTo")}
                      </Label>
                      <Input id="connector-to" name="to" placeholder="18.0615, 59.3123" required />
                    </Field>
                    <Field>
                      <Label htmlFor="connector-reason">
                        {translate(locale, "walking.reason")}
                      </Label>
                      <Input
                        id="connector-reason"
                        maxLength={500}
                        minLength={3}
                        name="reason"
                        required
                      />
                    </Field>
                    <ChoiceField>
                      <Checkbox name="attested" required />
                      <span>{translate(locale, "walking.attest")}</span>
                    </ChoiceField>
                  </FieldGroup>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button disabled={busy} type="submit" variant="outline">
                      {translate(locale, "walking.addConnector")}
                    </Button>
                  </div>
                </CardContent>
              </form>
            </Card>
          )}
        </>
      ) : null}

      {routing.overrides.length > 0 ? (
        <Card aria-labelledby="walking-overrides" asChild>
          <section>
            <CardHeader>
              <CardTitle id="walking-overrides">{translate(locale, "walking.overrides")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="m-0 grid list-none divide-y p-0">
                {routing.overrides.map((override) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                    key={override.id}
                  >
                    <p className="min-w-0 break-words">
                      <strong>{translate(locale, `walking.override.${override.kind}`)}</strong>
                      {override.edgeKey ? ` · ${override.edgeKey}` : ""} · {override.reason}
                    </p>
                    {canEdit ? (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run((api, token) =>
                            api.removeRoutingOverride(token, event.id, override.id),
                          )
                        }
                        type="button"
                        variant="link"
                      >
                        {translate(locale, "walking.remove")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </section>
        </Card>
      ) : null}
    </div>
  );
}
