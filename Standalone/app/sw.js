/* Service worker of the online Standalone page on GitHub Pages (/MasterCAL/standalone/).
 * Keeps a copy of the page (code only, no rates) so it opens without internet, e.g. while mobile data
 * is off during a phone call. The page is network-first: online it is always the latest version.
 * The rates are not cached here (prelude.js keeps the last downloaded model for the logged-in user).
 * __BUILD__ is replaced by build_pages.js, so every new page gets a new cache. */
var CACHE = "mc-standalone-__BUILD__";
var SHELL = ["./", "./manifest.json", "../icons/favicon-32.png", "../icons/icon-192.png", "../icons/apple-touch-icon.png"];
var PAGE_TIMEOUT_MS = 5000;

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return fetch(new Request(u, { cache: "reload" })).then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("mc-standalone-") === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;   /* the MasterCAL server: never cached */

  if (req.mode === "navigate") {   /* the page: latest when online, saved copy when offline or very slow */
    e.respondWith(new Promise(function (resolve) {
      var done = false;
      function fromCache() {
        return caches.open(CACHE).then(function (c) { return c.match("./"); }).then(function (hit) {
          return hit || new Response("MasterCAL needs an internet connection the first time it is opened.",
                                     { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        });
      }
      var t = setTimeout(function () {
        caches.open(CACHE).then(function (c) { return c.match("./"); }).then(function (hit) { if (hit && !done) { done = true; resolve(hit); } });
      }, PAGE_TIMEOUT_MS);
      fetch(req).then(function (r) {
        clearTimeout(t);
        if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put("./", copy); }); }
        if (!done) { done = true; resolve(r); }
      }, function () {
        clearTimeout(t);
        if (!done) { done = true; resolve(fromCache()); }
      });
    }));
    return;
  }

  /* icons, manifest: saved copy first */
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      return hit || fetch(req).then(function (r) { if (r.ok) c.put(req, r.clone()); return r; });
    });
  }));
});
