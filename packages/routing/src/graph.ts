import {
  distanceMeters,
  type LngLat,
  MinHeap,
  projectToSegment,
  type RoutingPackage,
} from "./build";

/** Start connectors and stop snaps beyond this are not routed. */
export const START_SNAP_METERS = 100;
export const STOP_SNAP_METERS = 60;

export interface Snap {
  readonly edge: number;
  /** 0 at the edge's first node, 1 at its second. */
  readonly fraction: number;
  /** Distance from the requested point to the network. */
  readonly meters: number;
  readonly point: LngLat;
}

export interface PathResult {
  readonly coordinates: LngLat[];
  readonly meters: number;
}

/**
 * Immutable in-memory graph from a validated package. Blocked edge keys from
 * the live safety feed are excluded before any route is computed.
 */
export class WalkingGraph {
  readonly nodeCount: number;
  private readonly lng: Float64Array;
  private readonly lat: Float64Array;
  private readonly edgeFrom: Int32Array;
  private readonly edgeTo: Int32Array;
  private readonly edgeLength: Float64Array;
  private readonly adjacencyStart: Int32Array;
  private readonly adjacencyEdge: Int32Array;
  private readonly grid = new Map<string, number[]>();
  private readonly cellDegrees = 0.001;

  constructor(pkg: RoutingPackage, blockedKeys: ReadonlySet<string> = new Set()) {
    this.nodeCount = pkg.nodes.length / 2;
    this.lng = Float64Array.from({ length: this.nodeCount }, (_, i) => pkg.nodes[i * 2] as number);
    this.lat = Float64Array.from(
      { length: this.nodeCount },
      (_, i) => pkg.nodes[i * 2 + 1] as number,
    );
    const kept: number[] = [];
    for (let e = 0; e < pkg.edgeKeys.length; e++) {
      if (!blockedKeys.has(pkg.edgeKeys[e] as string)) kept.push(e);
    }
    this.edgeFrom = Int32Array.from(kept, (e) => pkg.edges[e * 4] as number);
    this.edgeTo = Int32Array.from(kept, (e) => pkg.edges[e * 4 + 1] as number);
    this.edgeLength = Float64Array.from(kept, (e) => (pkg.edges[e * 4 + 2] as number) / 10);

    // Compressed adjacency: for each node the incident edge indices.
    const degree = new Int32Array(this.nodeCount + 1);
    const bump = (array: Int32Array, index: number) => {
      const value = array[index] as number;
      array[index] = value + 1;
      return value;
    };
    for (let e = 0; e < kept.length; e++) {
      bump(degree, (this.edgeFrom[e] as number) + 1);
      bump(degree, (this.edgeTo[e] as number) + 1);
    }
    for (let i = 0; i < this.nodeCount; i++)
      degree[i + 1] = (degree[i + 1] as number) + (degree[i] as number);
    this.adjacencyStart = degree;
    this.adjacencyEdge = new Int32Array(kept.length * 2);
    const fill = degree.slice(0, this.nodeCount);
    for (let e = 0; e < kept.length; e++) {
      const a = this.edgeFrom[e] as number;
      const b = this.edgeTo[e] as number;
      this.adjacencyEdge[bump(fill, a)] = e;
      this.adjacencyEdge[bump(fill, b)] = e;
    }

    // Uniform grid over edge bounding boxes for snapping.
    for (let e = 0; e < kept.length; e++) {
      const a = this.edgeFrom[e] as number;
      const b = this.edgeTo[e] as number;
      const minX = Math.floor(
        Math.min(this.lng[a] as number, this.lng[b] as number) / this.cellDegrees,
      );
      const maxX = Math.floor(
        Math.max(this.lng[a] as number, this.lng[b] as number) / this.cellDegrees,
      );
      const minY = Math.floor(
        Math.min(this.lat[a] as number, this.lat[b] as number) / this.cellDegrees,
      );
      const maxY = Math.floor(
        Math.max(this.lat[a] as number, this.lat[b] as number) / this.cellDegrees,
      );
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const key = `${x}:${y}`;
          const bucket = this.grid.get(key);
          if (bucket) bucket.push(e);
          else this.grid.set(key, [e]);
        }
      }
    }
  }

  private node(index: number): LngLat {
    return [this.lng[index] as number, this.lat[index] as number];
  }

  /** Nearest point on the network within maxMeters, or null. */
  snap(point: LngLat, maxMeters: number): Snap | null {
    const cx = Math.floor(point[0] / this.cellDegrees);
    const cy = Math.floor(point[1] / this.cellDegrees);
    // About 55 m per cell east-west at 60° N; search enough rings to cover maxMeters.
    const rings = Math.max(1, Math.ceil(maxMeters / 50));
    let best: Snap | null = null;
    const seen = new Set<number>();
    for (let x = cx - rings; x <= cx + rings; x++) {
      for (let y = cy - rings; y <= cy + rings; y++) {
        for (const e of this.grid.get(`${x}:${y}`) ?? []) {
          if (seen.has(e)) continue;
          seen.add(e);
          const projected = projectToSegment(
            point,
            this.node(this.edgeFrom[e] as number),
            this.node(this.edgeTo[e] as number),
          );
          if (projected.meters <= maxMeters && (!best || projected.meters < best.meters)) {
            best = {
              edge: e,
              fraction: projected.fraction,
              meters: projected.meters,
              point: projected.point,
            };
          }
        }
      }
    }
    return best;
  }

  /** Dijkstra from a snapped point; returns node distances and predecessors. */
  distancesFrom(start: Snap) {
    const distance = new Float64Array(this.nodeCount).fill(Number.POSITIVE_INFINITY);
    const previous = new Int32Array(this.nodeCount).fill(-1);
    const heap = new MinHeap();
    const length = this.edgeLength[start.edge] as number;
    const a = this.edgeFrom[start.edge] as number;
    const b = this.edgeTo[start.edge] as number;
    distance[a] = start.fraction * length;
    distance[b] = Math.min(distance[b] as number, (1 - start.fraction) * length);
    heap.push(distance[a] as number, a);
    heap.push(distance[b] as number, b);
    while (heap.size > 0) {
      const [d, node] = heap.pop();
      if (d > (distance[node] as number)) continue;
      for (
        let i = this.adjacencyStart[node] as number;
        i < (this.adjacencyStart[node + 1] as number);
        i++
      ) {
        const e = this.adjacencyEdge[i] as number;
        const next =
          (this.edgeFrom[e] as number) === node
            ? (this.edgeTo[e] as number)
            : (this.edgeFrom[e] as number);
        const candidate = d + (this.edgeLength[e] as number);
        if (candidate < (distance[next] as number)) {
          distance[next] = candidate;
          previous[next] = node;
          heap.push(candidate, next);
        }
      }
    }
    return { distance, previous };
  }

  private toSnap(from: Snap, field: { distance: Float64Array }, target: Snap) {
    const length = this.edgeLength[target.edge] as number;
    if (target.edge === from.edge) return Math.abs(target.fraction - from.fraction) * length;
    const a = this.edgeFrom[target.edge] as number;
    const b = this.edgeTo[target.edge] as number;
    return Math.min(
      (field.distance[a] as number) + target.fraction * length,
      (field.distance[b] as number) + (1 - target.fraction) * length,
    );
  }

  /** Walking metres between every pair of snaps; Infinity when unreachable. */
  matrix(snaps: ReadonlyArray<Snap | null>): number[][] {
    return snaps.map((from) => {
      if (!from) return snaps.map(() => Number.POSITIVE_INFINITY);
      const field = this.distancesFrom(from);
      return snaps.map((target) =>
        target ? this.toSnap(from, field, target) : Number.POSITIVE_INFINITY,
      );
    });
  }

  /** Street geometry of the shortest walk between two snaps. */
  path(from: Snap, to: Snap): PathResult | null {
    if (from.edge === to.edge) {
      return { coordinates: [from.point, to.point], meters: distanceMeters(from.point, to.point) };
    }
    const field = this.distancesFrom(from);
    const meters = this.toSnap(from, field, to);
    if (!Number.isFinite(meters)) return null;
    const length = this.edgeLength[to.edge] as number;
    const a = this.edgeFrom[to.edge] as number;
    const b = this.edgeTo[to.edge] as number;
    let node =
      (field.distance[a] as number) + to.fraction * length <=
      (field.distance[b] as number) + (1 - to.fraction) * length
        ? a
        : b;
    const reversed: LngLat[] = [to.point];
    while (node >= 0) {
      reversed.push(this.node(node));
      node = field.previous[node] as number;
    }
    reversed.push(from.point);
    return { coordinates: reversed.reverse(), meters };
  }
}
