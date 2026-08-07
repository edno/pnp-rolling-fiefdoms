const CACHE_VERSION = "v1.33";
const CACHE_NAME = `rf-cache-${CACHE_VERSION}`;
const APP_VERSION = "v8";
const SHEET_VERSION = "v2.0";
const SHEET_BASE_PATH = "/resources/rolling-fiefdoms-player-sheet";
const SHEET_BASE_PATH_FR = "/resources/rolling-fiefdoms-player-sheet-fr";
const ASSETS = [
  "/",
  "/index.html",
  `/app/app.js?v=${APP_VERSION}`,
  "/assets/css/styles.css",
  "/assets/css/fonts.css",
  /* LAZY_CHUNKS_PLACEHOLDER */
  "/assets/fonts/Shadows_Into_Light/ShadowsIntoLight-Regular.woff2",
  "/assets/fonts/Lobster_Two/LobsterTwo-Regular.woff2",
  "/assets/fonts/Lobster_Two/LobsterTwo-Bold.woff2",
  "/assets/fonts/QT_Black_Forest/QTBlackForest.woff2",
  "/assets/fonts/Roboto/Roboto-VariableFont_wdth,wght.woff2",
  "/assets/fonts/Roboto/Roboto-Italic-VariableFont_wdth,wght.woff2",
  "/assets/img/forfeit.svg",
  "/assets/img/windrose.svg",
  "/assets/img/die-event.svg",
  "/assets/img/die-windrose.svg",
  "/assets/img/rules.webp",
  "/assets/img/playersheet.webp",
  "/assets/img/github.webp",
  "/assets/img/fullscreen.webp",
  "/assets/img/bgg.webp",
  `${SHEET_BASE_PATH}.webp?v=${SHEET_VERSION}`,
  `${SHEET_BASE_PATH}@2x.webp?v=${SHEET_VERSION}`,
  `${SHEET_BASE_PATH_FR}.webp?v=${SHEET_VERSION}`,
  `${SHEET_BASE_PATH_FR}@2x.webp?v=${SHEET_VERSION}`,
  "/robots.txt",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          ASSETS.map((url) =>
            cache.add(url).catch(() => {
              // Ignore missing assets to avoid install failure; they'll fall back to network if needed.
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // For navigation requests, don't intercept - let browser handle naturally
  // Only provide offline fallback if network fails
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // For assets, use cache-first
  event.respondWith(
    caches
      .match(event.request)
      .then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((resp) => {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
            return resp;
          })
          .catch(() => caches.match(event.request));
      })
      .catch(() => undefined),
  );
});
