/******************************************************
 * MasterCAL Pro — Service Worker
 *
 * Strategy:
 *   - App shell (html/css/js/icons/manifest):
 *     cache-first, so the app opens instantly and even
 *     offline.
 *   - API calls to Apps Script (script.google.com):
 *     never cached — always go to network, because the
 *     Sheet does the live calculation. Offline, these
 *     fail and the UI shows an offline state.
 *
 * Bump CACHE_VERSION whenever you change any shell file
 * so users pick up the new version.
 ******************************************************/

const CACHE_VERSION = "mastercal-v25";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];


/* Install: pre-cache the shell. */
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(SHELL);
    })
  );
  self.skipWaiting();
});


/* Activate: drop old caches. */
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== CACHE_VERSION; })
          .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});


/* Fetch. */
self.addEventListener("fetch", function (event) {

  const url = new URL(event.request.url);

  /* Never cache the Apps Script API — always network. */
  if (url.hostname.indexOf("script.google.com") !== -1 ||
      url.hostname.indexOf("googleusercontent.com") !== -1) {
    return; /* let the browser handle it (network) */
  }

  /* Only GET requests are cacheable. */
  if (event.request.method !== "GET") {
    return;
  }

  /* Shell: cache-first, fall back to network, update cache. */
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;

      return fetch(event.request).then(function (response) {
        return response;
      }).catch(function () {
        /* Offline and not in cache: fall back to index. */
        return caches.match("./index.html");
      });
    })
  );
});
