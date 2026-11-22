/* Runs before app.js: replaces the server with the local engine.
 * The page holds no rates (model = {"remote":true}). After the MasterCAL login the model is downloaded
 * (approved users only) and every calculation runs on this device. */
(function () {
  var REMOTE = "__REMOTE_URL__";
  var REMOTE_ACTIONS = { login: 1, register: 1, syncCopy: 1, checkVehicle: 1, vcIkman: 1, vcGradeYears: 1, adminWho: 1, adminUsers: 1, adminSetStatus: 1, adminPublish: 1 };
  window.__mcRemote = true;   /* online_mode.js runs only when this is set */
  var L = null;
  window.__mcPublished = "";
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  var NETERR = "Cannot reach the MasterCAL server (Google). Check the internet connection; the company firewall may be blocking script.google.com.";

  function reply(o) { return { ok: true, json: function () { return Promise.resolve(o); } }; }
  function later(o) { return new Promise(function (res) { setTimeout(function () { res(reply(o)); }, 0); }); }
  function ensureModel(token) {
    if (L) return Promise.resolve(L);
    return realFetch(REMOTE, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow",
                               body: JSON.stringify({ action: "standaloneModel", args: [], token: token }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.ok !== true) { var e = new Error((j && j.error) || "Could not load the app data."); e.access = j && j.access; throw e; }
        L = window.__mc = MasterLocal.create(j.data, { now: new Date() });
        window.__mcPublished = j.data.published || "";
        showVer();
        return L;
      });
  }
  function showVer() {
    if (!window.__mcPublished || document.getElementById("mcVer")) return;
    var v = document.createElement("div"); v.id = "mcVer"; v.textContent = "Rates updated: " + String(window.__mcPublished).slice(0, 10);
    document.body.appendChild(v);
  }

  window.fetch = function (url, opt) {
    if (String(url).indexOf("local://") < 0 && realFetch) return realFetch(url, opt);
    var body = opt && opt.body ? JSON.parse(opt.body) : null;
    if (!body) return Promise.resolve(reply({}));
    if (REMOTE_ACTIONS[body.action] && realFetch) {
      if (body.action !== "login" && body.action !== "register" && !body.token) return later({ ok: false, access: "LOGIN", error: "Access LOGIN" });
      return realFetch(REMOTE, opt).catch(function () { return reply({ ok: false, error: NETERR }); });
    }
    function run() {
      try { return later({ ok: true, data: L.dispatch(body.action, body.args || []) }); }
      catch (e) { return later({ ok: false, error: String(e && e.message ? e.message : e) }); }
    }
    if (L) return run();
    if (!body.token) return later({ ok: false, access: "LOGIN", error: "Access LOGIN" });
    return ensureModel(body.token).then(run, function (e) {
      return later({ ok: false, access: e.access, error: e.access ? "Access " + e.access : (e.message || NETERR) });
    });
  };
})();
