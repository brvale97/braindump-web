const CACHE_NAME = "braindump-shell-v14";
const APP_SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/manifest.json",
  "/favicon.svg",
  "/js/app.js",
  "/js/api.js",
  "/js/state.js",
  "/js/ui.js",
  "/js/feedSpace.js",
  "/js/overview.js",
  "/js/sharedOverview.js",
  "/js/uploads.js",
  "/js/settings.js",
  "/js/pwa.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
