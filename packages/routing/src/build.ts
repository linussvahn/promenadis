// Walking-network compiler. Self-contained (no imports) so the same file runs
// in the Deno BFF for local builds and in Node/browser tests.
//
// Input: OpenStreetMap ways/nodes (Overpass JSON shape), the event boundary,
// event-scoped overrides and the private seller locations for diagnostics.
// Output: a compact public package containing only street-graph data with
// OSM attribution, plus private diagnostics for the host preview. Seller
// locations never enter the package.

export const COMPILER_VERSION = "promenadis-routing/1";
export const BUFFER_METERS = 150;
export const LOCATION_SNAP_METERS = 60;
export const CONNECTOR_MAX_METERS = 100;
export const CONNECTOR_ENDPOINT_METERS = 15;
export const ENTRANCE_MAX_METERS = 25;
export const PACKAGE_TARGET_BYTES = 2 * 1024 * 1024;
export const PACKAGE_HARD_LIMIT_BYTES = 5 * 1024 * 1024;

export type LngLat = readonly [number, number];

export interface OsmSource {
  readonly elements: ReadonlyArray<
    | { readonly type: "node"; readonly id: number; readonly lat: number; readonly lon: number }
    | {
        readonly type: "way";
        readonly id: number;
        readonly nodes: readonly number[];
        readonly tags?: Readonly<Record<string, string>>;
      }
  >;
}

export interface SourceMetadata {
  readonly attribution: string;
  readonly license: string;
  readonly name: string;
  readonly retrievedAt: string;
  readonly sha256: string;
  readonly url: string;
}

export type RoutingOverride =
  | { readonly id: string; readonly kind: "block_edge"; readonly edgeKey: string }
  | { readonly id: string; readonly kind: "manual_access"; readonly locationId: string }
  | {
      readonly id: string;
      readonly kind: "entrance";
      readonly locationId: string;
      readonly point: LngLat;
    }
  | { readonly id: string; readonly kind: "connector"; readonly from: LngLat; readonly to: LngLat };

export interface BuildLocation {
  readonly id: string;
  readonly point: LngLat;
}

export interface RoutingPackage {
  readonly attribution: string;
  readonly bbox: readonly [number, number, number, number];
  readonly compilerVersion: string;
  /** Flat [from, to, lengthDecimetres, flags] per edge; flag 1 = steps, 2 = organizer-confirmed connector. */
  readonly edges: readonly number[];
  /** Stable per-edge keys ("osmA-osmB" or "c:overrideId") for safety-feed blocks. */
  readonly edgeKeys: readonly string[];
  readonly license: string;
  /** Flat [lng, lat] per node, six decimals. */
  readonly nodes: readonly number[];
  readonly schemaVersion: "1.0";
  readonly source: Omit<SourceMetadata, "attribution" | "license">;
}

export type LocationStatus = "connected" | "disconnected" | "manual_access";

export interface BuildDiagnostics {
  readonly componentCount: number;
  readonly edgeCount: number;
  readonly locations: ReadonlyArray<{
    readonly component: number | null;
    readonly detourRatio: number | null;
    readonly id: string;
    readonly snapMeters: number | null;
    readonly status: LocationStatus;
  }>;
  readonly mainComponentNodes: number;
  readonly nodeCount: number;
  readonly rejectedConnectors: readonly string[];
  readonly warnings: readonly string[];
}

const WALKABLE = new Set([
  "footway",
  "path",
  "pedestrian",
  "living_street",
  "residential",
  "service",
  "unclassified",
  "tertiary",
  "tertiary_link",
  "secondary",
  "secondary_link",
  "primary",
  "primary_link",
  "steps",
  "track",
  "cycleway",
]);

export function isWalkable(tags: Readonly<Record<string, string>> | undefined) {
  if (!tags?.highway || !WALKABLE.has(tags.highway)) return false;
  if (tags.foot === "no" || tags.access === "private" || tags.access === "no")
    return tags.foot === "yes";
  if (tags.highway === "cycleway") return tags.foot === "yes" || tags.foot === "designated";
  return true;
}

const EARTH_RADIUS = 6_371_008.8;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceMeters(a: LngLat, b: LngLat) {
  const dLat = radians(b[1] - a[1]);
  const dLng = radians(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Nearest point on segment a-b to p in a local metric plane; returns metres and fraction. */
export function projectToSegment(p: LngLat, a: LngLat, b: LngLat) {
  const scale = Math.cos(radians(p[1]));
  const ax = (a[0] - p[0]) * scale;
  const ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * scale;
  const by = b[1] - p[1];
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  const point: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { fraction: t, meters: distanceMeters(p, point), point };
}

function pointInRing(p: LngLat, ring: readonly LngLat[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as LngLat;
    const b = ring[j] as LngLat;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Inside the polygon or within `buffer` metres of its edge. */
export function withinBuffered(p: LngLat, ring: readonly LngLat[], buffer = BUFFER_METERS) {
  if (pointInRing(p, ring)) return true;
  for (let i = 0; i + 1 < ring.length; i++) {
    if (projectToSegment(p, ring[i] as LngLat, ring[i + 1] as LngLat).meters <= buffer) return true;
  }
  return false;
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** Binary min-heap of (priority, value) pairs. */
export class MinHeap {
  private readonly priorities: number[] = [];
  private readonly values: number[] = [];
  get size() {
    return this.values.length;
  }
  push(priority: number, value: number) {
    this.priorities.push(priority);
    this.values.push(value);
    let i = this.values.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.priorities[parent] as number) <= priority) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.priorities[0] as number, this.values[0] as number];
    const lastPriority = this.priorities.pop() as number;
    const lastValue = this.values.pop() as number;
    if (this.values.length > 0) {
      this.priorities[0] = lastPriority;
      this.values[0] = lastValue;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (
          left < this.values.length &&
          (this.priorities[left] as number) < (this.priorities[smallest] as number)
        )
          smallest = left;
        if (
          right < this.values.length &&
          (this.priorities[right] as number) < (this.priorities[smallest] as number)
        )
          smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.priorities[a], this.priorities[b]] = [
      this.priorities[b] as number,
      this.priorities[a] as number,
    ];
    [this.values[a], this.values[b]] = [this.values[b] as number, this.values[a] as number];
  }
}

class UnionFind {
  readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root] as number;
    let node = x;
    while (this.parent[node] !== root) {
      const next = this.parent[node] as number;
      this.parent[node] = root;
      node = next;
    }
    return root;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

export interface BuildInput {
  readonly boundary: readonly LngLat[];
  readonly locations: readonly BuildLocation[];
  readonly overrides: readonly RoutingOverride[];
  readonly source: OsmSource;
  readonly sourceMetadata: SourceMetadata;
}

export interface BuildResult {
  readonly body: string;
  readonly diagnostics: BuildDiagnostics;
  readonly pkg: RoutingPackage;
}

export function buildRoutingPackage(input: BuildInput): BuildResult {
  const ring = input.boundary;
  const osmNodes = new Map<number, LngLat>();
  for (const element of input.source.elements) {
    if (element.type === "node") osmNodes.set(element.id, [element.lon, element.lat]);
  }
  const blocked = new Set(
    input.overrides.flatMap((override) =>
      override.kind === "block_edge" ? [override.edgeKey] : [],
    ),
  );

  // Keep walkable segments with at least one end inside the buffered area.
  const nodeIndex = new Map<number, number>();
  const nodes: number[] = [];
  const edges: number[] = [];
  const edgeKeys: string[] = [];
  const seenKeys = new Set<string>();
  const indexOf = (osmId: number, point: LngLat) => {
    let index = nodeIndex.get(osmId);
    if (index === undefined) {
      index = nodes.length / 2;
      nodeIndex.set(osmId, index);
      nodes.push(round6(point[0]), round6(point[1]));
    }
    return index;
  };
  const inside = new Map<number, boolean>();
  const isInside = (osmId: number, point: LngLat) => {
    let value = inside.get(osmId);
    if (value === undefined) {
      value = withinBuffered(point, ring);
      inside.set(osmId, value);
    }
    return value;
  };
  for (const element of input.source.elements) {
    if (element.type !== "way" || !isWalkable(element.tags)) continue;
    const steps = element.tags?.highway === "steps" ? 1 : 0;
    for (let i = 0; i + 1 < element.nodes.length; i++) {
      const aId = element.nodes[i] as number;
      const bId = element.nodes[i + 1] as number;
      const a = osmNodes.get(aId);
      const b = osmNodes.get(bId);
      if (!a || !b || aId === bId) continue;
      if (!isInside(aId, a) && !isInside(bId, b)) continue;
      const key = aId < bId ? `${aId}-${bId}` : `${bId}-${aId}`;
      if (seenKeys.has(key) || blocked.has(key)) continue;
      seenKeys.add(key);
      edges.push(
        indexOf(aId, a),
        indexOf(bId, b),
        Math.max(1, Math.round(distanceMeters(a, b) * 10)),
        steps,
      );
      edgeKeys.push(key);
    }
  }

  const nodePoint = (index: number): LngLat => [
    nodes[index * 2] as number,
    nodes[index * 2 + 1] as number,
  ];
  const nearestNode = (point: LngLat) => {
    let best = -1;
    let bestMeters = Number.POSITIVE_INFINITY;
    for (let i = 0; i < nodes.length / 2; i++) {
      const meters = distanceMeters(point, nodePoint(i));
      if (meters < bestMeters) {
        bestMeters = meters;
        best = i;
      }
    }
    return { index: best, meters: bestMeters };
  };

  // Organizer-confirmed connectors join existing graph nodes or location pins.
  const rejectedConnectors: string[] = [];
  const locationPoints = input.locations.map((location) => location.point);
  for (const override of input.overrides) {
    if (override.kind !== "connector") continue;
    const ends = [override.from, override.to].map((point) => {
      const near = nearestNode(point);
      if (near.index >= 0 && near.meters <= CONNECTOR_ENDPOINT_METERS) return near.index;
      if (locationPoints.some((pin) => distanceMeters(pin, point) <= CONNECTOR_ENDPOINT_METERS)) {
        nodes.push(round6(point[0]), round6(point[1]));
        return nodes.length / 2 - 1;
      }
      return -1;
    });
    const [from, to] = ends as [number, number];
    const meters =
      from >= 0 && to >= 0 ? distanceMeters(nodePoint(from), nodePoint(to)) : Number.NaN;
    if (
      from < 0 ||
      to < 0 ||
      from === to ||
      !(meters <= CONNECTOR_MAX_METERS) ||
      !withinBuffered(override.from, ring) ||
      !withinBuffered(override.to, ring)
    ) {
      rejectedConnectors.push(override.id);
      continue;
    }
    edges.push(from, to, Math.max(1, Math.round(meters * 10)), 2);
    edgeKeys.push(`c:${override.id}`);
  }

  // Connected components.
  const nodeCount = nodes.length / 2;
  const sets = new UnionFind(nodeCount);
  for (let e = 0; e < edges.length; e += 4) sets.union(edges[e] as number, edges[e + 1] as number);
  const componentSize = new Map<number, number>();
  for (let i = 0; i < nodeCount; i++) {
    const root = sets.find(i);
    componentSize.set(root, (componentSize.get(root) ?? 0) + 1);
  }
  const ranked = [...componentSize].sort((a, b) => b[1] - a[1]);
  const componentNumber = new Map(ranked.map(([root], rank) => [root, rank]));
  const mainRoot = ranked[0]?.[0];

  // Snap each location (or its corrected entrance) to the nearest edge.
  const manual = new Set(
    input.overrides.flatMap((override) =>
      override.kind === "manual_access" ? [override.locationId] : [],
    ),
  );
  const entrances = new Map(
    input.overrides.flatMap((override) =>
      override.kind === "entrance" ? [[override.locationId, override.point] as const] : [],
    ),
  );
  const snaps = input.locations.map((location) => {
    const point = entrances.get(location.id) ?? location.point;
    let best = { edge: -1, meters: Number.POSITIVE_INFINITY };
    for (let e = 0; e < edges.length; e += 4) {
      const projected = projectToSegment(
        point,
        nodePoint(edges[e] as number),
        nodePoint(edges[e + 1] as number),
      );
      if (projected.meters < best.meters) best = { edge: e, meters: projected.meters };
    }
    const snapped = best.edge >= 0 && best.meters <= LOCATION_SNAP_METERS;
    const root = snapped ? sets.find(edges[best.edge] as number) : null;
    return {
      location,
      point,
      root,
      snapMeters: best.edge >= 0 ? Math.round(best.meters) : null,
      snapped,
    };
  });

  // Detour outliers: network distance to the nearest other connected location
  // far longer than the straight line suggests a missing or wrong path.
  const adjacency: Array<Array<[number, number]>> = Array.from({ length: nodeCount }, () => []);
  for (let e = 0; e < edges.length; e += 4) {
    const a = edges[e] as number;
    const b = edges[e + 1] as number;
    const length = (edges[e + 2] as number) / 10;
    adjacency[a]?.push([b, length]);
    adjacency[b]?.push([a, length]);
  }
  const networkFrom = (start: number) => {
    const distance = new Float64Array(nodeCount).fill(Number.POSITIVE_INFINITY);
    distance[start] = 0;
    const heap = new MinHeap();
    heap.push(0, start);
    while (heap.size > 0) {
      const [d, node] = heap.pop();
      if (d > (distance[node] as number)) continue;
      for (const [next, length] of adjacency[node] ?? []) {
        const candidate = d + length;
        if (candidate < (distance[next] as number)) {
          distance[next] = candidate;
          heap.push(candidate, next);
        }
      }
    }
    return distance;
  };
  const connected = snaps.filter((snap) => snap.snapped && snap.root === mainRoot);
  const detour = new Map<string, number>();
  if (connected.length >= 2 && connected.length <= 60) {
    for (const snap of connected) {
      const start = nearestNode(snap.point).index;
      const distances = networkFrom(start);
      let bestRatio: number | null = null;
      let nearestStraight = Number.POSITIVE_INFINITY;
      for (const other of connected) {
        if (other === snap) continue;
        const straight = distanceMeters(snap.point, other.point);
        if (straight < nearestStraight && straight >= 20) {
          nearestStraight = straight;
          const network = distances[nearestNode(other.point).index] as number;
          bestRatio = Number.isFinite(network) ? Math.round((network / straight) * 10) / 10 : null;
        }
      }
      if (bestRatio !== null) detour.set(snap.location.id, bestRatio);
    }
  }

  const warnings: string[] = [];
  if (nodeCount === 0) warnings.push("empty_graph");
  if (rejectedConnectors.length > 0) warnings.push("connector_rejected");
  if ([...detour.values()].some((ratio) => ratio > 3)) warnings.push("detour_outlier");

  const bbox = nodes.length
    ? ([
        Math.min(...nodes.filter((_, i) => i % 2 === 0)),
        Math.min(...nodes.filter((_, i) => i % 2 === 1)),
        Math.max(...nodes.filter((_, i) => i % 2 === 0)),
        Math.max(...nodes.filter((_, i) => i % 2 === 1)),
      ] as const)
    : ([0, 0, 0, 0] as const);
  const { attribution, license, ...source } = input.sourceMetadata;
  const pkg: RoutingPackage = {
    attribution,
    bbox,
    compilerVersion: COMPILER_VERSION,
    edgeKeys,
    edges,
    license,
    nodes,
    schemaVersion: "1.0",
    source,
  };
  const body = JSON.stringify(pkg);
  if (new TextEncoder().encode(body).length > PACKAGE_TARGET_BYTES)
    warnings.push("over_size_target");

  return {
    body,
    diagnostics: {
      componentCount: componentSize.size,
      edgeCount: edges.length / 4,
      locations: snaps.map((snap) => ({
        component: snap.root === null ? null : (componentNumber.get(snap.root) ?? null),
        detourRatio: detour.get(snap.location.id) ?? null,
        id: snap.location.id,
        snapMeters: snap.snapMeters,
        status: manual.has(snap.location.id)
          ? "manual_access"
          : snap.snapped && snap.root === mainRoot
            ? "connected"
            : "disconnected",
      })),
      mainComponentNodes: ranked[0]?.[1] ?? 0,
      nodeCount,
      rejectedConnectors,
      warnings,
    },
    pkg,
  };
}

/** Structural validation of a package before storage or use. */
export function validateRoutingPackage(value: unknown): value is RoutingPackage {
  if (!value || typeof value !== "object") return false;
  const pkg = value as Partial<RoutingPackage>;
  if (pkg.schemaVersion !== "1.0" || !Array.isArray(pkg.nodes) || !Array.isArray(pkg.edges))
    return false;
  if (!Array.isArray(pkg.edgeKeys) || pkg.edges.length !== pkg.edgeKeys.length * 4) return false;
  if (pkg.nodes.length % 2 !== 0 || typeof pkg.attribution !== "string" || !pkg.license)
    return false;
  const nodeCount = pkg.nodes.length / 2;
  for (let e = 0; e < pkg.edges.length; e += 4) {
    const a = pkg.edges[e] as number;
    const b = pkg.edges[e + 1] as number;
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a < 0 ||
      b < 0 ||
      a >= nodeCount ||
      b >= nodeCount
    ) {
      return false;
    }
  }
  const allowed = new Set([
    "attribution",
    "bbox",
    "compilerVersion",
    "edgeKeys",
    "edges",
    "license",
    "nodes",
    "schemaVersion",
    "source",
  ]);
  return Object.keys(pkg).every((key) => allowed.has(key));
}
