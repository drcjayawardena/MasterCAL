#!/usr/bin/env node
/* Build the online Standalone page for GitHub Pages (https://drcjayawardena.github.io/MasterCAL/standalone/).
 * Usage: node build_pages.js out_dir   (CI: FrontEND/standalone)
 * Same page as "<exec URL>?app=standalone": code only, model = {"remote":true}. The rates are downloaded
 * from the server after the MasterCAL login (approved users only), so nothing here holds rates. */
const fs = require("fs"), path = require("path");
const SA = path.join(__dirname, "..");
const outDir = process.argv[2];
if (!outDir) { console.error("usage: build_pages.js out_dir"); process.exit(1); }

let html = fs.readFileSync(path.join(SA, "template", "MasterCAL_Standalone_template.html"), "utf8");
/* the placeholder proves this is the code-only template, not a built file with rates */
if (html.split("__MC_MODEL__").length !== 2) throw new Error("template must contain __MC_MODEL__ exactly once");
html = html.replace("__MC_MODEL__", () => '{"remote":true}');
if (html.split("</head>").length !== 2) throw new Error("</head> not found exactly once");
html = html.replace("</head>", () =>
  '<link rel="manifest" href="manifest.json">\n<link rel="icon" href="../icons/favicon-32.png">\n' +
  '<link rel="apple-touch-icon" href="../icons/apple-touch-icon.png">\n</head>');

const manifest = {
  name: "MasterCAL Standalone", short_name: "MC Standalone",
  description: "Vehicle Leasing Rental Calculator (fast, calculates on this device)",
  start_url: "./", scope: "./", display: "standalone", orientation: "any",
  background_color: "#f4f6fa", theme_color: "#1c5e3a",
  icons: [
    { src: "../icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "../icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "../icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
  ]
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), html);
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("standalone page: " + path.join(outDir, "index.html") + " (" + html.length + " chars)");
