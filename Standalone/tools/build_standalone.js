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
app = patch(app, /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/, "local://mastercal", "api url");
app = patch(app, "if (!getToken()) { showLogin(); return; }", "/* standalone: no login */", "login gate");
app = patch(app, "  setupWhatsAppQuotes();\n", "  /* standalone: no WhatsApp */\n", "whatsapp");
app = patch(app, /^warmServer\(\);$/m, "/* standalone: no warm-up */", "warm-up");

/* ---- index.html ---- */
let html = rd(path.join(FE, "index.html"));
html = html.replace(/<meta property="og:[^>]*>\n?/g, "").replace(/<meta name="twitter:[^>]*>\n?/g, "");
html = html.replace(/<link rel="(manifest|icon|apple-touch-icon|preconnect)"[^>]*>\n?/g, "");
html = patch(html, '<link rel="stylesheet" href="styles.css">', "<style>\n" + rd(path.join(FE, "styles.css")) +
  "\n.tab[data-tab=vcheck],#installBar{display:none!important}\n</style>", "css");
const i0 = html.indexOf('<script src="app.js'); if (i0 < 0) throw new Error("script tag not found");
const head = html.slice(0, i0);
const model = JSON.parse(rd(modelPath));

const prelude = `
(function(){
  var model = JSON.parse(document.getElementById("mc-model").textContent);
  var L = MasterLocal.create(model, { now: new Date() });
  window.__mc = L;
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opt) {
    if (String(url).indexOf("local://") < 0 && realFetch) return realFetch(url, opt);
    var out;
    try {
      var body = opt && opt.body ? JSON.parse(opt.body) : null;
      if (!body) return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } });
      out = { ok: true, data: L.dispatch(body.action, body.args || []) };
    } catch (e) { out = { ok: false, error: String(e && e.message ? e.message : e) }; }
    return new Promise(function (res) { setTimeout(function () { res({ ok: true, json: function () { return Promise.resolve(out); } }); }, 0); });
  };
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
