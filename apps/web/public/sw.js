// Versioned caches for the app shell, built assets and public page HTML.
// Event data, snapshots and walking packages are not cached here: the app
// keeps those in its own managed store with hard expiry. A new version waits
// until the visitor accepts it; it never forces a reload mid-walk.
const VERSION = "v5";
const SHELL_CACHE = `promenadis-shell-${VERSION}`;
const PAGE_CACHE = `promenadis-pages-${VERSION}`;
const ASSET_CACHE = `promenadis-assets-${VERSION}`;
const CURRENT = [SHELL_CACHE, PAGE_CACHE, ASSET_CACHE];
const SHELL_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/theme.js",
  "/register-sw.js",
];
// Landing and map shells hold event-level text only, never locations.
const CACHEABLE_PAGE = /^\/(e|u)\/[0-9a-f]{32}(\/map)?$/u;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !CURRENT.includes(key)).map((key) => caches.delete(key))),
      )
      // The first install controls the open page at once, so the page that
      // installed it can be reloaded offline. Updates only activate after the
      // visitor accepts them, and the page then reloads.
      .then(() => self.clients.claim()),
  );
});

// Pages report what they loaded before this worker controlled them.
async function cacheLoaded({ assets, page }) {
  const own = (value) => {
    try {
      const url = new URL(value, self.location.origin);
      return url.origin === self.location.origin ? url : null;
    } catch {
      return null;
    }
  };
  const assetCache = await caches.open(ASSET_CACHE);
  for (const value of Array.isArray(assets) ? assets.slice(0, 200) : []) {
    const url = own(value);
    if (!url?.pathname.startsWith("/assets/") || (await assetCache.match(url.pathname))) continue;
    const response = await fetch(url.pathname).catch(() => null);
    if (response?.ok) await assetCache.put(url.pathname, response);
  }
  const pageUrl = typeof page === "string" ? own(page) : null;
  if (pageUrl && CACHEABLE_PAGE.test(pageUrl.pathname)) {
    const response = await fetch(pageUrl.pathname).catch(() => null);
    if (response?.ok) await (await caches.open(PAGE_CACHE)).put(pageUrl.pathname, response);
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "promenadis:activate-update") self.skipWaiting();
  else if (event.data?.type === "promenadis:cache-loaded") event.waitUntil(cacheLoaded(event.data));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && CACHEABLE_PAGE.test(url.pathname)) {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(url.pathname)) ?? caches.match("/offline.html")),
    );
    return;
  }

  // Unhashed shell files: fresh when online, the installed copy offline.
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(() => caches.match(url.pathname)));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
