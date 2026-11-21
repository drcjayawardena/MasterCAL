#!/usr/bin/env node
/* Compares the engine against Google's own cached values.  node check_model.js model.json cached.json
 * Prints a short report; exit code 2 if the Sheet uses something the engine cannot do. */
const fs = require("fs"), path = require("path");
const { Engine, isErr } = require(path.join(__dirname, "..", "engine", "engine.js"));
const model = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), cached = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const en = new Engine(model, { now: new Date() });
const norm = v => { if (v == null || v === "") return ""; if (isErr(v)) return "#ERR"; if (typeof v === "number") return Math.round(v * 1e4) / 1e4; return typeof v === "boolean" ? v : String(v).trim(); };
let tot = 0, ok = 0; const bad = [];
for (const sh of model.order) {
  const s = model.sheets[sh];
  for (const a of Object.keys(s.f)) {
    tot++;
    let g = norm((cached[sh] || {})[a]), v = norm(en.get(sh, a));
    if (typeof g === "string" && g[0] === "#") g = "#ERR";
    const good = g === v || (typeof g === "number" && typeof v === "number" && Math.abs(g - v) <= Math.max(0.01, Math.abs(g) * 1e-6)) || (g === "" && v === 0) || (g === 0 && v === "");
    if (good) ok++; else bad.push(sh + "!" + a);
  }
}
const uns = [...en.unsupported], pe = en.parseErrors || [];
console.log("Formula cells:", tot, "| match Google:", ok, "(" + (100 * ok / Math.max(tot, 1)).toFixed(1) + "%)");
console.log("Formula parse errors:", pe.length, pe.slice(0, 5).map(String).join("; "));
console.log("Functions the engine cannot do:", uns.length ? uns.join(", ") : "none");
console.log("Differences (first 15):", bad.slice(0, 15).join(", ") || "none");
process.exit(uns.length || pe.length ? 2 : 0);
