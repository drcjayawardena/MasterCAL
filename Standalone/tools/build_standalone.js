#!/usr/bin/env node
/* Build ONE self-contained HTML file: MasterCAL UI (FrontEND) + engine + local backend + model.
 * Usage: node build_standalone.js model.json out.html
 * The output holds the rates/formulas: never commit it or model.json to the public repo. */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", ".."), FE = path.join(ROOT, "FrontEND"), SA = path.join(ROOT, "Standalone");
const [modelPath, outPath] = process.argv.slice(2);
if (!modelPath || !outPath) { console.error("usage: build_standalone.js (model.json | --template) out.html"); process.exit(1); }
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
app = patch(app, 'lsSet("mastercal_phone", data.phone || ""); loadApp(); return;', 'lsSet("mastercal_phone", data.phone || ""); if (window.__mcRemote) { loadApp(); if (window.__mcAfterLogin) window.__mcAfterLogin(); } else hideGate(); return;', "login success");
app = patch(app, "function vcClipTry() {", "function vcClipTry() { return; /* standalone: no automatic clipboard read (the browser would ask every time) */", "clip try");
app = patch(app, "if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(function (t) { vcClipBase = t; }, function () {});", "/* standalone: no clipboard read */", "clip base");
app = patch(app, "and come back to this tab: the prices are calculated automatically (if your browser asks to allow clipboard access, choose Allow). Otherwise paste here:", "then come back here, click in the box below, press <b>Ctrl+V</b> and press <b>Calculate prices</b>:", "clip hint");
app = patch(app, 'action !== "sendQuote");', 'action !== "sendQuote" && action !== "adminWho" && action !== "adminUsers" && action !== "adminSetStatus");', "isCalc");
app = patch(app, 'vcheck: "vcheckPanel" };', 'vcheck: "vcheckPanel", admin: "adminPanel" };', "panels");
app = patch(app, "if (!getToken()) { showLogin(); return; }", "if (window.__mcRemote && !getToken()) { showLogin(); return; }   /* online mode: MasterCAL login */", "login gate");
app = patch(app, "  setupWhatsAppQuotes();\n", "  /* standalone: no WhatsApp */\n", "whatsapp");
app = patch(app, /^warmServer\(\);$/m, "/* standalone: no warm-up */", "warm-up");

/* ---- index.html ---- */
let html = rd(path.join(FE, "index.html"));
html = html.replace(/<meta property="og:[^>]*>\n?/g, "").replace(/<meta name="twitter:[^>]*>\n?/g, "");
html = html.replace(/<link rel="(manifest|icon|apple-touch-icon|preconnect)"[^>]*>\n?/g, "");
html = patch(html, '<button type="button" class="tab" data-tab="vcheck">Valuations</button>', '<button type="button" class="tab" data-tab="vcheck">Valuations</button>\n    <button type="button" class="tab" data-tab="admin" hidden>Admin</button>', "admin tab");
html = patch(html, '<div id="vcheckPanel"', '<div id="adminPanel" class="vcPanel" hidden></div>\n  <div id="vcheckPanel"', "admin panel");
html = patch(html, '<link rel="stylesheet" href="styles.css">', "<style>\n" + rd(path.join(FE, "styles.css")) +
  "\n.tab[hidden]{display:none!important}#installBar{display:none!important}#mcVcCancel{position:fixed;top:14px;right:16px;z-index:100000;padding:8px 14px;border:0;border-radius:8px;background:#fff;color:#1c5e3a;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)}\n</style>", "css");
const i0 = html.indexOf('<script src="app.js'); if (i0 < 0) throw new Error("script tag not found");
const head = html.slice(0, i0);
const TEMPLATE = modelPath === "--template";   /* code only: the model is injected later (Sheet menu: Publish Standalone) */
const modelText = TEMPLATE ? "__MC_MODEL__" : safe(JSON.stringify(JSON.parse(rd(modelPath))));

const prelude = rd(path.join(SA, "app", "prelude.js")).replace("__REMOTE_URL__", () => REMOTE);

const b64 = (txt) => Buffer.from(txt, "utf8").toString("base64").replace(/(.{100})/g, "$1\n");
const part = (txt) => '<script type="text/plain" class="mcCode">\n' + b64(txt) + "\n</script>\n";
const out = head +
  '<script id="mc-model" type="application/json">' + modelText + "</script>\n" +
  part(rd(path.join(SA, "engine", "engine.js"))) +
  part(rd(path.join(SA, "app", "local_backend.js"))) +
  part(prelude) +
  part(rd(path.join(SA, "app", "auth_gate.js"))) +
  part(app) +
  part(rd(path.join(SA, "app", "online_mode.js"))) +
  "<script>\n" + rd(path.join(SA, "app", "loader.js")) + "\n</script>\n</body>\n</html>\n";
fs.writeFileSync(outPath, out);
console.log("wrote", outPath, (out.length / 1024).toFixed(0) + " KB");
