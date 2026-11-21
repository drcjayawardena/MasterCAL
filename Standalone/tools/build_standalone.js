#!/usr/bin/env node
/* Build ONE self-contained HTML file: MasterCAL UI (FrontEND) + engine + local backend + model.
 * Usage: node build_standalone.js model.json out.html
 * The output holds the rates/formulas: never commit it or model.json to the public repo. */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", ".."), FE = path.join(ROOT, "FrontEND"), SA = path.join(ROOT, "Standalone");
const [modelPath, outPath] = process.argv.slice(2);
if (!modelPath || !outPath) { console.error("usage: build_standalone.js model.json out.html"); process.exit(1); }
const rd = p => fs.readFileSync(p, "utf8");
const safe = s => s.replace(/<\/(script)/gi, "<\\/$1");

function patch(src, from, to, label) {
  if (typeof from === "string") { if (src.indexOf(from) < 0) throw new Error("patch not found: " + label); return src.replace(from, () => to); }
  if (!from.test(src)) throw new Error("patch not found: " + label); return src.replace(from, () => to);
}

/* ---- app.js: remove login gate, WhatsApp, warm-up ---- */
let app = rd(path.join(FE, "app.js"));
const REMOTE = (/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/.exec(app) || [])[0]; if (!REMOTE) throw new Error("API url not found");
app = patch(app, /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/, "local://mastercal", "api url");
app = patch(app, 'if (which === "vcheck") setupVehicleCheck();', 'if (which === "vcheck") { setupVehicleCheck(); if (!getToken()) showLogin("Valuations need your MasterCAL web account (approved users only)."); }', "vcheck tab");
app = patch(app, 'lsSet("mastercal_phone", data.phone || ""); loadApp(); return;', 'lsSet("mastercal_phone", data.phone || ""); hideGate(); return;', "login success");
app = patch(app, "if (!getToken()) { showLogin(); return; }", "/* standalone: no login */", "login gate");
app = patch(app, "  setupWhatsAppQuotes();\n", "  /* standalone: no WhatsApp */\n", "whatsapp");
app = patch(app, /^warmServer\(\);$/m, "/* standalone: no warm-up */", "warm-up");

/* ---- index.html ---- */
let html = rd(path.join(FE, "index.html"));
html = html.replace(/<meta property="og:[^>]*>\n?/g, "").replace(/<meta name="twitter:[^>]*>\n?/g, "");
html = html.replace(/<link rel="(manifest|icon|apple-touch-icon|preconnect)"[^>]*>\n?/g, "");
html = patch(html, '<link rel="stylesheet" href="styles.css">', "<style>\n" + rd(path.join(FE, "styles.css")) +
  "\n#installBar{display:none!important}#mcVcCancel{position:fixed;top:14px;right:16px;z-index:100000;padding:8px 14px;border:0;border-radius:8px;background:#fff;color:#1c5e3a;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)}\n</style>", "css");
const i0 = html.indexOf('<script src="app.js'); if (i0 < 0) throw new Error("script tag not found");
const head = html.slice(0, i0);
const model = JSON.parse(rd(modelPath));

const prelude = `
(function(){
  var model = JSON.parse(document.getElementById("mc-model").textContent);
  var L = MasterLocal.create(model, { now: new Date() });
  window.__mc = L;
  var REMOTE = ${JSON.stringify(REMOTE)};
  var REMOTE_ACTIONS = { login: 1, register: 1, syncCopy: 1, checkVehicle: 1, vcIkman: 1, vcGradeYears: 1 };
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opt) {
    if (String(url).indexOf("local://") < 0 && realFetch) return realFetch(url, opt);
    var out;
    try {
      var body = opt && opt.body ? JSON.parse(opt.body) : null;
      if (!body) return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } });
      if (REMOTE_ACTIONS[body.action] && realFetch) {
        if (body.action !== "login" && body.action !== "register" && !body.token)
          return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: false, access: "LOGIN", error: "Access LOGIN" }); } });
        return realFetch(REMOTE, opt);
      }
      out = { ok: true, data: L.dispatch(body.action, body.args || []) };
    } catch (e) { out = { ok: false, error: String(e && e.message ? e.message : e) }; }
    return new Promise(function (res) { setTimeout(function () { res({ ok: true, json: function () { return Promise.resolve(out); } }); }, 0); });
  };
  /* "Cancel" on the web-account login (Valuations tab) so the user can go back to the calculator */
  setInterval(function () {
    var g = document.getElementById("gate"), b = document.getElementById("mcVcCancel");
    var on = g && g.style.display !== "none" && g.style.display !== "";
    if (on && !b) {
      b = document.createElement("button"); b.id = "mcVcCancel"; b.type = "button"; b.textContent = "Cancel";
      b.onclick = function () { g.style.display = "none"; var t = document.querySelector('.tab[data-tab=vehicle]'); if (t) t.click(); };
      document.body.appendChild(b);
    } else if (!on && b) b.remove();
  }, 300);
})();`;

const out = head +
  '<script id="mc-model" type="application/json">' + safe(JSON.stringify(model)) + "</script>\n" +
  "<script>\n" + safe(rd(path.join(SA, "engine", "engine.js"))) + "\n</script>\n" +
  "<script>\n" + safe(rd(path.join(SA, "app", "local_backend.js"))) + "\n</script>\n" +
  "<script>" + prelude + "</script>\n" +
  "<script>\n" + safe(rd(path.join(SA, "app", "auth_gate.js"))) + "\n</script>\n" +
  "<script>\n" + safe(app) + "\n</script>\n</body>\n</html>\n";
fs.writeFileSync(outPath, out);
console.log("wrote", outPath, (out.length / 1024).toFixed(0) + " KB");
