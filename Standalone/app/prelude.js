/* Runs before app.js: replaces the server with the local engine.
 * The page holds no rates (model = {"remote":true}). After the MasterCAL login the model is downloaded
 * (approved users only) and every calculation runs on this device.
 *
 * Offline (e.g. mobile data drops during a phone call): the last downloaded model is kept in this
 * browser (IndexedDB) for the same login and used when the server cannot be reached, for at most
 * OFFLINE_DAYS since the last successful download. It is deleted on logout, when the server says the
 * login is no longer valid (LOGIN / PENDING / BLOCKED), and when the page opens without a login. */
(function () {
  var REMOTE = "__REMOTE_URL__";
  var REMOTE_ACTIONS = { login: 1, register: 1, syncCopy: 1, checkVehicle: 1, vcIkman: 1, vcGradeYears: 1, adminWho: 1, adminUsers: 1, adminSetStatus: 1, adminPublish: 1, resetRequest: 1, adminReset: 1, adminSetRole: 1 };
  var TOKEN_KEY = "mastercal_session_token";   /* same key as app.js */
  var OFFLINE_DAYS = 7, FETCH_TIMEOUT_MS = 8000;
  window.__mcRemote = true;   /* online_mode.js runs only when this is set */
  var L = null, usingSaved = 0;   /* usingSaved = time the saved model was downloaded, 0 when online */
  window.__mcPublished = "";
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  var NETERR = "Cannot reach the MasterCAL server (Google). Check the internet connection; the company firewall may be blocking script.google.com.";

  /* the app reads answers with res.text() (and older code with res.json()) */
  function reply(o) { return { ok: true, json: function () { return Promise.resolve(o); }, text: function () { return Promise.resolve(JSON.stringify(o)); } }; }
  function later(o) { return new Promise(function (res) { setTimeout(function () { res(reply(o)); }, 0); }); }
  function day(t) { return new Date(t).toISOString().slice(0, 10); }

  /* ---------- saved model (IndexedDB: one record) ---------- */
  function idb(mode, work) {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open("mastercal_standalone", 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
        rq.onerror = function () { res(null); };
        rq.onsuccess = function () {
          try {
            var db = rq.result, tx = db.transaction("kv", mode), r = work(tx.objectStore("kv"));
            tx.oncomplete = function () { db.close(); res(r && "result" in r ? r.result : null); };
            tx.onerror = tx.onabort = function () { db.close(); res(null); };
          } catch (e) { res(null); }
        };
      } catch (e) { res(null); }   /* no IndexedDB (private mode, some embedded pages): offline use is simply not available */
    });
  }
  function saveModel(token, data) { return idb("readwrite", function (s) { return s.put({ token: token, data: data, savedAt: Date.now() }, "model"); }); }
  function readModel() { return idb("readonly", function (s) { return s.get("model"); }); }
  function forget() { return idb("readwrite", function (s) { return s.delete("model"); }); }
  window.__mcForget = forget;
  try { if (!localStorage.getItem(TOKEN_KEY)) forget(); } catch (e) {}

  /* ---------- download ---------- */
  function fetchModel(token) {
    if (navigator.onLine === false) return Promise.reject(new Error(NETERR));
    var timer;
    var timeout = new Promise(function (_, rej) { timer = setTimeout(function () { rej(new Error(NETERR)); }, FETCH_TIMEOUT_MS); });
    var get = realFetch(REMOTE, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow",
                                  body: JSON.stringify({ action: "standaloneModel", args: [], token: token }) })
      .then(function (r) { return r.json(); }, function () { throw new Error(NETERR); })
      .then(null, function (e) { throw e && e.message === NETERR ? e : new Error(NETERR); })   /* not JSON: a Wi-Fi login page etc. */
      .then(function (j) {
        if (!j || j.ok !== true) { var e = new Error((j && j.error) || "Could not load the app data."); e.access = j && j.access; e.server = true; throw e; }
        return j.data;
      });
    return Promise.race([get, timeout]).then(function (d) { clearTimeout(timer); return d; }, function (e) { clearTimeout(timer); throw e; });
  }
  function use(data, savedAt) {
    L = window.__mc = MasterLocal.create(data, { now: new Date() });
    window.__mcPublished = data.published || "";
    usingSaved = savedAt || 0;
    showVer();
    return L;
  }
  function ensureModel(token) {
    if (L) return Promise.resolve(L);
    return fetchModel(token).then(function (data) {
      saveModel(token, data);
      return use(data, 0);
    }, function (e) {
      if (e.access) { forget(); throw e; }   /* the server said no: never fall back to the saved copy */
      if (e.server) throw e;
      return readModel().then(function (rec) {
        if (!rec || rec.token !== token || !rec.data) throw e;
        if (Date.now() - rec.savedAt > OFFLINE_DAYS * 864e5)
          throw new Error("You have been offline for more than " + OFFLINE_DAYS + " days. Connect to the internet once to keep using MasterCAL.");
        return use(rec.data, rec.savedAt);
      });
    });
  }

  /* Back online after using the saved copy: check the login and download the latest rates in the background. */
  function recheck() {
    if (!usingSaved) return;
    var token = ""; try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch (e) {}
    if (!token) return;
    fetchModel(token).then(function (data) {
      saveModel(token, data);
      var newer = (data.published || "") !== window.__mcPublished;
      usingSaved = 0;
      if (newer) { notice("New rates are available. Tap here to load them.", function () { location.reload(); }); }
      else showVer();
    }, function (e) {
      if (!e.access) return;   /* still offline: try again on the next "online" event */
      forget().then(function () { try { localStorage.removeItem(TOKEN_KEY); } catch (x) {} location.reload(); });
    });
  }
  window.addEventListener("online", function () { setTimeout(recheck, 1500); });

  function verBox() {
    var v = document.getElementById("mcVer");
    if (!v && document.body) { v = document.createElement("div"); v.id = "mcVer"; document.body.appendChild(v); }
    return v;
  }
  function showVer() {
    var v = verBox(); if (!v) return;
    v.onclick = null; v.style.cursor = ""; v.style.color = "";
    v.textContent = window.__mcPublished ? "Rates updated: " + String(window.__mcPublished).slice(0, 10) : "";
    if (usingSaved) { v.textContent += " · offline (saved " + day(usingSaved) + ")"; v.style.color = "#b26a00"; }
  }
  function notice(text, onClick) {
    var v = verBox(); if (!v) return;
    v.textContent = text; v.style.color = "#1c5e3a"; v.style.cursor = "pointer"; v.onclick = onClick;
  }

  /* ---------- the "server" the app talks to ---------- */
  window.fetch = function (url, opt) {
    if (String(url).indexOf("local://") < 0 && realFetch) return realFetch(url, opt);
    var body = opt && opt.body ? JSON.parse(opt.body) : null;
    if (!body) return Promise.resolve(reply({}));
    if (REMOTE_ACTIONS[body.action] && realFetch) {
      if (body.action !== "login" && body.action !== "register" && body.action !== "resetRequest" && !body.token) return later({ ok: false, access: "LOGIN", error: "Access LOGIN" });
      return realFetch(REMOTE, opt).catch(function () { return reply({ ok: false, error: NETERR }); });
    }
    function run() {
      try { return later({ ok: true, data: L.dispatch(body.action, body.args || []) }); }
      catch (e) { return later({ ok: false, error: String(e && e.message ? e.message : e) }); }
    }
    if (L) return run();
    if (!body.token) { forget(); return later({ ok: false, access: "LOGIN", error: "Access LOGIN" }); }
    return ensureModel(body.token).then(run, function (e) {
      return later({ ok: false, access: e.access, error: e.access ? "Access " + e.access : (e.message || NETERR) });
    });
  };

  /* Offline page (GitHub Pages copy only: it is the one with a manifest; the Google /exec page cannot use a service worker). */
  if ("serviceWorker" in navigator && document.querySelector('link[rel="manifest"]')) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
