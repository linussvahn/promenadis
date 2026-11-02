import type {
  PublicEventManifest,
  PublicSafetyFeed,
  PublicSnapshot,
  RoutingPackageContract,
} from "@promenadis/contracts";

// Managed offline copies of public event data. Only an explicit "start the
// walk" admits an event; copies never outlive the event's hard expiry and
// are evicted least-recently-used beyond 50 MiB, except the active walk.
export const OFFLINE_BUDGET_BYTES = 50 * 1024 * 1024;

export interface OfflineEntry {
  readonly bytes: number;
  readonly eventKey: string;
  readonly expiresAt: string;
  readonly feed: PublicSafetyFeed;
  readonly graphVersion: string | null;
  readonly lastUsedAt: number;
  readonly manifest: PublicEventManifest;
  readonly pinned: boolean;
  readonly pkg: RoutingPackageContract | null;
  readonly savedAt: number;
  readonly snapshot: PublicSnapshot;
}

/** Keys to evict so `incoming` fits; never the pinned or incoming event. */
export function planEviction(
  entries: ReadonlyArray<Pick<OfflineEntry, "bytes" | "eventKey" | "lastUsedAt" | "pinned">>,
  incoming: { readonly bytes: number; readonly eventKey: string },
  budget = OFFLINE_BUDGET_BYTES,
): { readonly evict: string[]; readonly fits: boolean } {
  const others = entries.filter((entry) => entry.eventKey !== incoming.eventKey);
  let used = others.reduce((sum, entry) => sum + entry.bytes, 0) + incoming.bytes;
  const evict: string[] = [];
  for (const entry of [...others]
    .filter((e) => !e.pinned)
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt)) {
    if (used <= budget) break;
    evict.push(entry.eventKey);
    used -= entry.bytes;
  }
  return { evict, fits: used <= budget };
}

export function isUsable(entry: Pick<OfflineEntry, "expiresAt">, now = Date.now()) {
  return Date.parse(entry.expiresAt) > now;
}

const DB_NAME = "promenadis-offline";
const STORE = "events";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE, { keyPath: "eventKey" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | undefined,
) {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const transaction = db.transaction(STORE, mode);
          const request = work(transaction.objectStore(STORE));
          transaction.oncomplete = () => resolve(request ? (request.result ?? null) : null);
          transaction.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

async function allEntries(): Promise<OfflineEntry[]> {
  return ((await run("readonly", (store) => store.getAll())) as OfflineEntry[] | null) ?? [];
}

/** Stores an event for offline use; false when storage is denied or full. */
export async function saveOffline(
  entry: Omit<OfflineEntry, "bytes" | "lastUsedAt" | "savedAt">,
): Promise<boolean> {
  const bytes = new TextEncoder().encode(JSON.stringify(entry)).length;
  const now = Date.now();
  const entries = await allEntries();
  // Expired copies go first, whatever the budget.
  const expired = entries.filter((existing) => !isUsable(existing, now)).map((e) => e.eventKey);
  const plan = planEviction(
    entries.filter((existing) => isUsable(existing, now)),
    { bytes, eventKey: entry.eventKey },
  );
  if (!plan.fits) return false;
  for (const key of [...expired, ...plan.evict])
    await run("readwrite", (store) => store.delete(key));
  const stored = await run("readwrite", (store) =>
    store.put({ ...entry, bytes, lastUsedAt: now, savedAt: now } satisfies OfflineEntry),
  );
  return stored !== null;
}

export async function loadOffline(eventKey: string): Promise<OfflineEntry | null> {
  const entry = (await run("readonly", (store) => store.get(eventKey))) as OfflineEntry | null;
  if (!entry) return null;
  if (!isUsable(entry)) {
    await run("readwrite", (store) => store.delete(eventKey));
    return null;
  }
  await run("readwrite", (store) => store.put({ ...entry, lastUsedAt: Date.now() }));
  return entry;
}

export async function unpinOffline(eventKey: string) {
  const entry = (await run("readonly", (store) => store.get(eventKey))) as OfflineEntry | null;
  if (entry) await run("readwrite", (store) => store.put({ ...entry, pinned: false }));
}

/** Cache repair: removes every offline copy, saved route and shell cache. */
export async function resetOfflineData() {
  await run("readwrite", (store) => store.clear());
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("promenadis-route:")) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing saved there.
  }
  if (typeof caches !== "undefined") {
    for (const key of await caches.keys()) await caches.delete(key);
  }
}
