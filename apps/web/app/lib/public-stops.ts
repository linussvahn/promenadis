import type { PublicSafetyFeed, PublicSnapshot } from "@promenadis/contracts";

export type PublicSeller = PublicSnapshot["sellers"][number];
export type PublicCategory = PublicSnapshot["categories"][number];

export interface VisibleStop {
  readonly cluster: PublicSnapshot["stops"][number]["cluster"];
  readonly entrance: PublicSnapshot["stops"][number]["entrance"];
  readonly id: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly manualAccess: boolean;
  /** Stable 1-based number from the snapshot order, kept when filtering. */
  readonly number: number;
  readonly sellers: readonly PublicSeller[];
}

export interface StopFilters {
  readonly categoryId: string | null;
  readonly openNow: boolean;
  readonly query: string;
  readonly stepFree: boolean;
  readonly stroller: boolean;
}

export const noFilters: StopFilters = {
  categoryId: null,
  openNow: false,
  query: "",
  stepFree: false,
  stroller: false,
};

// The live safety feed wins over the older full snapshot: removed sellers and
// stops disappear, and away status comes from the feed only.
export function applySafetyFeed(snapshot: PublicSnapshot, feed: PublicSafetyFeed): VisibleStop[] {
  const removedSellers = new Set(feed.removedSellerIds);
  const removedStops = new Set(feed.removedStopIds);
  const away = new Set(feed.awaySellerIds);
  const sellers = new Map(
    snapshot.sellers
      .filter((seller) => !removedSellers.has(seller.id))
      .map((seller) => [
        seller.id,
        { ...seller, status: away.has(seller.id) ? ("away" as const) : ("open" as const) },
      ]),
  );
  return snapshot.stops
    .map((stop, index) => ({
      cluster: stop.cluster,
      entrance: stop.entrance,
      id: stop.id,
      latitude: stop.latitude,
      longitude: stop.longitude,
      manualAccess: stop.manualAccess,
      number: index + 1,
      sellers: stop.sellerIds.flatMap((id) => {
        const seller = sellers.get(id);
        return seller ? [seller] : [];
      }),
    }))
    .filter((stop) => !removedStops.has(stop.id) && stop.sellers.length > 0);
}

function normalize(text: string) {
  return text.normalize("NFC").toLocaleLowerCase("sv");
}

// Searches both languages' category labels and reviewed synonyms, so a
// Swedish word finds an English-labelled listing and vice versa.
export function sellerSearchText(seller: PublicSeller, categories: readonly PublicCategory[]) {
  const sellerCategories = categories.filter(
    (category) =>
      seller.categoryIds.includes(category.id) ||
      seller.items.some((item) => item.categoryId === category.id),
  );
  return normalize(
    [
      seller.displayName,
      seller.title ?? "",
      seller.description,
      ...seller.tags,
      ...seller.items.map((item) => item.name),
      ...sellerCategories.flatMap((category) => [
        category.labels.sv,
        category.labels.en,
        ...category.synonyms.sv,
        ...category.synonyms.en,
      ]),
    ].join(" "),
  );
}

export function isOpenNow(
  seller: PublicSeller,
  now: Date,
  eventIntervals: PublicSnapshot["event"]["intervals"],
) {
  if (seller.status !== "open") return false;
  const windows = seller.availability.length > 0 ? seller.availability : eventIntervals;
  const time = now.getTime();
  return windows.some(
    (window) => Date.parse(window.startsAt) <= time && time < Date.parse(window.endsAt),
  );
}

export function filterStops(
  stops: readonly VisibleStop[],
  snapshot: PublicSnapshot,
  filters: StopFilters,
  now: Date,
): VisibleStop[] {
  const words = normalize(filters.query).split(/\s+/u).filter(Boolean);
  const matches = (seller: PublicSeller) => {
    if (filters.categoryId && !seller.categoryIds.includes(filters.categoryId)) return false;
    if (filters.openNow && !isOpenNow(seller, now, snapshot.event.intervals)) return false;
    if (filters.stepFree && seller.accessibility.stepFree !== true) return false;
    if (filters.stroller && seller.accessibility.strollerFriendly !== true) return false;
    if (words.length === 0) return true;
    const text = sellerSearchText(seller, snapshot.categories);
    return words.every((word) => text.includes(word));
  };
  return stops.flatMap((stop) => {
    const sellers = stop.sellers.filter(matches);
    return sellers.length > 0 ? [{ ...stop, sellers }] : [];
  });
}

export interface StopCluster {
  readonly key: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly stops: readonly VisibleStop[];
}

// Server-derived grid cells: one marker per cell when zoomed out.
export function clusterStops(stops: readonly VisibleStop[], zoom: number): StopCluster[] {
  if (zoom >= 15) {
    return stops.map((stop) => ({
      key: stop.id,
      latitude: stop.latitude,
      longitude: stop.longitude,
      stops: [stop],
    }));
  }
  const cell = zoom < 13 ? "z13" : "z15";
  const groups = new Map<string, VisibleStop[]>();
  for (const stop of stops) {
    const key = stop.cluster[cell];
    groups.set(key, [...(groups.get(key) ?? []), stop]);
  }
  return [...groups].map(([key, members]) => ({
    key,
    latitude: members.reduce((sum, stop) => sum + stop.latitude, 0) / members.length,
    longitude: members.reduce((sum, stop) => sum + stop.longitude, 0) / members.length,
    stops: members,
  }));
}
