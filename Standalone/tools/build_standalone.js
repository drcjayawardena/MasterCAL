#!/usr/bin/env node
/* Build the online Standalone page template: MasterCAL UI (FrontEND) + engine + local backend, code only (no rates).
 * Usage: node build_standalone.js Standalone/template/MasterCAL_Standalone_template.html
 * The rates are downloaded after the MasterCAL login (approved users only). The __MC_MODEL__ placeholder is
 * replaced with {"remote":true} by the server ("Publish Standalone app" / "Update app") and by build_pages.js. */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", ".."), FE = path.join(ROOT, "FrontEND"), SA = path.join(ROOT, "Standalone");
let outPath = process.argv[2];
if (outPath === "--template") outPath = process.argv[3];   /* old usage */
if (!outPath) { console.error("usage: build_standalone.js out.html"); process.exit(1); }
const rd = p => fs.readFileSync(p, "utf8");

function patch(src, from, to, label) {
  if (typeof from === "string") { if (src.indexOf(from) < 0) throw new Error("patch not found: " + label); return src.replace(from, () => to); }
  if (!from.test(src)) throw new Error("patch not found: " + label); return src.replace(from, () => to);
}

/* ---- app.js: local engine instead of the server, Admin tab, no WhatsApp, no warm-up ---- */
let app = rd(path.join(FE, "app.js"));
const REMOTE = (/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/.exec(app) || [])[0]; if (!REMOTE) throw new Error("API url not found");
app = patch(app, /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/, "local://mastercal", "api url");
app = patch(app, 'lsSet("mastercal_phone", data.phone || ""); loadApp(); return;', 'lsSet("mastercal_phone", data.phone || ""); loadApp(); if (window.__mcAfterLogin) window.__mcAfterLogin(); return;', "login success");
app = patch(app, 'action !== "sendQuote");', 'action !== "sendQuote" && action !== "adminWho" && action !== "adminUsers" && action !== "adminSetStatus" && action !== "adminPublish" && action !== "adminReset" && action !== "adminSetRole");', "isCalc");
app = patch(app, 'vcheck: "vcheckPanel" };', 'vcheck: "vcheckPanel", admin: "adminPanel" };', "panels");
app = patch(app, "  setupWhatsAppQuotes();\n", "  /* standalone: no WhatsApp */\n", "whatsapp");
app = patch(app, /^warmServer\(\);$/m, "/* standalone: no warm-up */", "warm-up");

/* ---- index.html ---- */
let html = rd(path.join(FE, "index.html"));
html = html.replace(/<meta property="og:[^>]*>\n?/g, "").replace(/<meta name="twitter:[^>]*>\n?/g, "");
html = html.replace(/<link rel="(manifest|icon|apple-touch-icon|preconnect)"[^>]*>\n?/g, "");
html = patch(html, "You are offline — calculations need an internet connection. The app will keep working once you reconnect.",
  "You are offline — calculations use the rates saved on this device. Valuations need an internet connection.", "offline bar");
html = patch(html, '<button type="button" class="tab" data-tab="vcheck">Valuations</button>', '<button type="button" class="tab" data-tab="vcheck">Valuations</button>\n    <button type="button" class="tab" data-tab="admin" hidden>Admin</button>', "admin tab");
html = patch(html, '<div id="vcheckPanel"', '<div id="adminPanel" class="vcPanel" hidden></div>\n  <div id="vcheckPanel"', "admin panel");
html = patch(html, '<link rel="stylesheet" href="styles.css">', "<style>\n" + rd(path.join(FE, "styles.css")) +
  "\n.tab[hidden]{display:none!important}#installBar{display:none!important}\n</style>", "css");
const i0 = html.indexOf('<script src="app.js'); if (i0 < 0) throw new Error("script tag not found");
const head = html.slice(0, i0);

const prelude = rd(path.join(SA, "app", "prelude.js")).replace("__REMOTE_URL__", () => REMOTE);

const b64 = (txt) => Buffer.from(txt, "utf8").toString("base64").replace(/(.{100})/g, "$1\n");
const part = (txt) => '<script type="text/plain" class="mcCode">\n' + b64(txt) + "\n</script>\n";
const out = head +
  '<script id="mc-model" type="application/json">__MC_MODEL__</script>\n' +
  part(rd(path.join(SA, "engine", "engine.js"))) +
  part(rd(path.join(SA, "app", "local_backend.js"))) +
  part(prelude) +
  part(app) +
  part(rd(path.join(SA, "app", "online_mode.js"))) +
  "<script>\n" + rd(path.join(SA, "app", "loader.js")) + "\n</script>\n</body>\n</html>\n";
fs.writeFileSync(outPath, out);
console.log("wrote", outPath, (out.length / 1024).toFixed(0) + " KB");
