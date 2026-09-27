/******************************************************
 * MasterCAL Pro — Service Worker  (v30)
 *
 * Strategy:
 *   - App shell (html/css/js/icons/manifest):
 *     cache-first, so the app opens instantly and even offline.
 *   - API calls to Apps Script (script.google.com):
 *     never cached — always network, because the Sheet does
 *     the live calculation.
 *
 * Bump CACHE_VERSION whenever any shell file changes so users
 * pick up the new version.
 ******************************************************/

const CACHE_VERSION = "mastercal-v45";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];


/* Install: pre-cache the shell (ignore any single miss so install never fails). */
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { /* skip a missing file */ });
      }));
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
    return;
  }

  /* Only GET requests are cacheable. */
  if (event.request.method !== "GET") return;

  /* Shell: cache-first, fall back to network, then index for navigations. */
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).catch(function () {
        return caches.match("./index.html");
      });
    })
  );
});
