/******************************************************
 * MasterCAL Pro — Standalone.gs
 * Menu: "Publish Standalone app": builds the single-file offline MasterCAL (4W/3W/BIKE)
 * from THIS sheet's formulas and saves it in Drive (folder "MasterCAL_Standalone").
 *
 * The page/engine template (code only, no rates) is fetched from GitHub; the model
 * (formulas + rates of this sheet) is injected here and the result stays in Drive.
 * Never touches the user-copies folder. Never reads USERS / APPROVED_USERS.
 ******************************************************/

var SA_STORE_SHEET = "_SA_STORE";
var SA_SKIP_SHEETS = { "USERS": 1, "APPROVED_USERS": 1, "Formula Dump": 1, "_SA_STORE": 1 };
var SA_FOLDER = "MasterCAL_Standalone";
var SA_TEMPLATE_URL = "https://raw.githubusercontent.com/drcjayawardena/MasterCAL/main/Standalone/template/MasterCAL_Standalone_template.html";
var SA_FILE_NAME = "MasterCAL_Pro_Standalone.html";
var SA_APP_FILE = "online_app.html", SA_MODEL_FILE = "online_model.json";
var SA_EXEC_URL = "https://script.google.com/macros/s/AKfycbx8m_v6iMUy8tTSGzxSfxi79ZyTfJgpy89WjVkqRMO3dvnm734znkdTvjpW92DhO-xN/exec";

/* formulas whose result can spill over neighbouring cells */
var SA_ARRAYISH = /ARRAYFORMULA|FILTER\(|UNIQUE\(|QUERY\(|SORT\(|SORTN\(|TRANSPOSE\(|SPLIT\(|FLATTEN\(|SEQUENCE\(|CHOOSECOLS\(|CHOOSEROWS\(|VSTACK\(|HSTACK\(|ARRAY_CONSTRAIN\(|MAP\(|BYROW\(|BYCOL\(|\{/i;

function saA1_(r, c) { var s = ""; for (var n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s + (r + 1); }

/* Pure function (also unit-tested in Node).
   sheets: [{name, hidden, formulas[][], values[][], formats[][], dvs:[{r:"A1:A5", f:"..."}]}]
   values: numbers/strings/booleans; dates already converted to Excel serial numbers. */
function standaloneBuildModel_(sheets) {
  var model = { sheets: {}, order: [], fmts: [] }, fmtIx = {};
  sheets.forEach(function (sh) {
    var F = sh.formulas, V = sh.values, N = sh.formats, nR = F.length, nC = nR ? F[0].length : 0;
    var f = {}, v = {}, n = {}, soft = {};
    function isF(r, c) { return typeof F[r][c] === "string" && F[r][c].charAt(0) === "="; }
    function blank(x) { return x === "" || x === null || x === undefined; }
    for (var r = 0; r < nR; r++) for (var c = 0; c < nC; c++) if (isF(r, c)) f[saA1_(r, c)] = F[r][c].slice(1).trim();
    /* "soft" cells: possibly filled by an array formula (reached from an anchor over formula-free cells; one blank
       gap allowed down, e.g. UNIQUE's blank row). The engine drops their stored value where a spill really covers them. */
    for (r = 0; r < nR; r++) for (c = 0; c < nC; c++) {
      if (!isF(r, c) || !SA_ARRAYISH.test(F[r][c])) continue;
      var w = 1, h = 1, gap, k, j;
      for (k = c + 1; k < nC && !isF(r, k) && !blank(V[r][k]); k++) w = k - c + 1;      /* across: no gaps */
      for (j = c; j < c + w; j++) {                                                      /* down: one blank allowed */
        for (k = r + 1, gap = 0; k < nR && !isF(k, j); k++) { if (blank(V[k][j])) { if (++gap > 1) break; } else { gap = 0; h = Math.max(h, k - r + 1); } }
      }
      for (var rr = r; rr < r + h; rr++) for (var cc = c; cc < c + w; cc++) if ((rr !== r || cc !== c) && !isF(rr, cc)) soft[saA1_(rr, cc)] = 1;
    }
    for (r = 0; r < nR; r++) for (c = 0; c < nC; c++) {
      var a = saA1_(r, c), x = V[r][c];
      if (!isF(r, c) && !blank(x)) v[a] = x;
      if ((isF(r, c) || !blank(x) || r < 200) && N[r][c] && N[r][c] !== "General" && N[r][c] !== "0.###############") {
        var nf = N[r][c];
        if (fmtIx[nf] === undefined) { fmtIx[nf] = model.fmts.length; model.fmts.push(nf); }
        n[a] = fmtIx[nf];
      }
    }
    for (var sk in soft) if (v[sk] === undefined) delete soft[sk];
    model.sheets[sh.name] = { f: f, v: v, s: soft, n: n, dv: sh.dvs || [], hidden: !!sh.hidden };
    model.order.push(sh.name);
  });
  return model;
}

/* ---------- reading this spreadsheet ---------- */

function saSerial_(d, tz) {
  var p = Utilities.formatDate(d, tz, "yyyy,M,d,H,m,s").split(",").map(Number);
  return (Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) - Date.UTC(1899, 11, 30)) / 86400000;
}

function saDvRules_(rng) {
  var grid = rng.getDataValidations(), byRule = {}, out = [], T = SpreadsheetApp.DataValidationCriteria;
  for (var r = 0; r < grid.length; r++) for (var c = 0; c < grid[r].length; c++) {
    var rule = grid[r][c]; if (!rule) continue;
    var type = rule.getCriteriaType(), vals = rule.getCriteriaValues(), f = null;
    if (type === T.VALUE_IN_LIST) f = '"' + (vals[0] || []).join(",") + '"';
    else if (type === T.VALUE_IN_RANGE && vals[0]) f = "'" + vals[0].getSheet().getName().replace(/'/g, "''") + "'!" + vals[0].getA1Notation();
    if (!f) continue;
    (byRule[f] = byRule[f] || []).push(saA1_(r, c));
  }
  for (var k in byRule) out.push({ r: byRule[k], f: k });
  return out;
}

function standaloneCollect_(ss) {
  var tz = ss.getSpreadsheetTimeZone(), sheets = [];
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName(); if (SA_SKIP_SHEETS[name]) return;
    var nR = Math.max(1, Math.min(sh.getMaxRows(), 1200)), nC = Math.max(1, sh.getLastColumn());
    var rng = sh.getRange(1, 1, nR, nC), V = rng.getValues();
    for (var r = 0; r < V.length; r++) for (var c = 0; c < V[r].length; c++) if (V[r][c] instanceof Date) V[r][c] = saSerial_(V[r][c], tz);
    sheets.push({ name: name, hidden: sh.isSheetHidden(), formulas: rng.getFormulas(), values: V, formats: rng.getNumberFormats(), dvs: saDvRules_(rng) });
  });
  return sheets;
}

/* ---------- publish ---------- */

function standalonePublish_() {
  var t0 = Date.now(), ss = SpreadsheetApp.getActiveSpreadsheet();
  var res = UrlFetchApp.fetch(SA_TEMPLATE_URL, { muteHttpExceptions: true });
  var tpl = res.getContentText();
  if (res.getResponseCode() !== 200 || tpl.indexOf("__MC_MODEL__") < 0) throw new Error("Could not load the app template from GitHub (HTTP " + res.getResponseCode() + "). Try again in a minute.");
  var model = standaloneBuildModel_(standaloneCollect_(ss));
  model.published = new Date().toISOString();
  var nF = 0, nDv = 0;
  model.order.forEach(function (n) { nF += Object.keys(model.sheets[n].f).length; nDv += model.sheets[n].dv.length; });
  ["CALCULATOR_TEMPLATE", "3W", "BIKE"].forEach(function (n) { if (!model.sheets[n]) throw new Error("Sheet '" + n + "' is missing: the app cannot be published."); });
  if (nF < 1000) throw new Error("Only " + nF + " formulas were found: something is wrong, nothing was published.");
  var json = JSON.stringify(model).replace(/<\//g, "<\\/");
  var html = tpl.split("__MC_MODEL__").join(json);
  var it = DriveApp.getFoldersByName(SA_FOLDER), folder = it.hasNext() ? it.next() : DriveApp.createFolder(SA_FOLDER);
  var file = saPutFile_(folder, SA_FILE_NAME, html, MimeType.HTML);
  /* online mode (link): the page without rates + the model that only approved users can download */
  /* kept inside the master Sheet (hidden sheet): the web app may run as a different Google account than the one who clicks Publish,
     and could not see a Drive folder of that other account */
  saStoreWrite_({ "online_app.html": tpl.split("__MC_MODEL__").join('{"remote":true}'), "online_model.json": JSON.stringify(model) });
  return { id: file.getId(), folderUrl: folder.getUrl(), formulas: nF, dropdownRules: nDv, sheets: model.order.length,
           kb: Math.round(html.length / 1024), seconds: Math.round((Date.now() - t0) / 100) / 10, when: new Date() };
}

function menuPublishStandalone_() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert("Publish Standalone app?",
    "Builds the offline MasterCAL file (4W / 3W / BIKE) from the CURRENT formulas and rates of this sheet and saves it in your Drive folder '" + SA_FOLDER + "'. " +
    "The staff link (…?app=standalone) is updated at the same time. It takes about 20-40 seconds. Continue?", ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var r;
  try { r = standalonePublish_(); }
  catch (e) { ui.alert("Publish failed", String(e && e.message ? e.message : e), ui.ButtonSet.OK); return; }
  var dl = "https://drive.google.com/uc?export=download&id=" + r.id;
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;font-size:14px;line-height:1.5">' +
    '<p><b>Done \u2705</b> ' + r.sheets + ' sheets, ' + r.formulas + ' formulas, ' + r.kb + ' KB, ' + r.seconds + ' s.</p>' +
    '<p><b>Staff link</b> (always the latest, approved MasterCAL users only):<br>' +
    '<input readonly style="width:100%;font-size:12px" value="' + SA_EXEC_URL + '?app=standalone" onclick="this.select()"></p>' +
    '<p style="color:#666">Offline file (optional): <a href="' + dl + '" target="_blank">download</a> &middot; ' +
    '<a href="' + r.folderUrl + '" target="_blank">' + SA_FOLDER + ' folder</a></p></div>')
    .setWidth(460).setHeight(270);
  ui.showModalDialog(html, "Publish Standalone app");
}

function saPutFile_(folder, name, content, mime) {
  var it = folder.getFilesByName(name), f;
  if (it.hasNext()) { f = it.next(); f.setContent(content); } else f = folder.createFile(name, content, mime);
  return f;
}
function saStoreWrite_(files) {
  var ss = master_(), sh = ss.getSheetByName(SA_STORE_SHEET) || ss.insertSheet(SA_STORE_SHEET);
  var rows = [], CH = 45000;
  Object.keys(files).forEach(function (name) {
    var t = files[name], n = Math.max(1, Math.ceil(t.length / CH));
    for (var i = 0; i < n; i++) rows.push([name, i, t.substr(i * CH, CH)]);
  });
  sh.clear();
  var need = rows.length + 1; if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  sh.getRange(1, 1, 1, 3).setValues([["file", "part", "text (do not edit)"]]);
  sh.getRange(2, 1, rows.length, 3).setNumberFormat("@").setValues(rows);
  sh.hideSheet();
}
function saRead_(name) {
  var sh = master_().getSheetByName(SA_STORE_SHEET); if (!sh || sh.getLastRow() < 2) return null;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().filter(function (r) { return r[0] === name; });
  if (!v.length) return null;
  v.sort(function (a, b) { return a[1] - b[1]; });
  return v.map(function (r) { return r[2]; }).join("");
}

/* ---------- online mode: the page (public code only) and the model (approved users only) ---------- */

function standalonePage_() {
  var html = saRead_(SA_APP_FILE);
  if (!html) return HtmlService.createHtmlOutput('<div style="font-family:Arial;padding:40px;text-align:center">MasterCAL Standalone has not been published yet.<br>Ask the administrator to use the Sheet menu "Publish Standalone app".</div>');
  return HtmlService.createHtmlOutput(html).setTitle("MasterCAL Pro")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function standaloneModel_() {
  var txt = saRead_(SA_MODEL_FILE);
  if (!txt) throw new Error("The Standalone app has not been published yet.");
  return JSON.parse(txt);
}

/* ---------- admins ("Role" column in the USERS sheet = ADMIN) ---------- */

function saRoleCol_(s) {
  var h = s.getRange(1, 1, 1, Math.max(s.getLastColumn(), 1)).getValues()[0];
  for (var i = 0; i < h.length; i++) if (String(h[i]).trim().toLowerCase() === "role") return i + 1;
  return 0;
}

function isAdmin_(key) {
  key = normEmail_(key); if (!key) return false;
  var s = getUsersSheet_(), col = saRoleCol_(s); if (!col) return false;
  var n = Math.max(s.getLastRow(), 1), keys = s.getRange(1, 1, n, 1).getValues(), roles = s.getRange(1, col, n, 1).getValues();
  for (var i = 1; i < n; i++) if (normEmail_(keys[i][0]) === key) return String(roles[i][0]).trim().toUpperCase() === "ADMIN";
  return false;
}

/* [{key, phone, name, status, requested, approved, admin}] : pending first. Never returns passwords. */
function standaloneAdminUsers_() {
  var s = getUsersSheet_(), n = Math.max(s.getLastRow(), 1);
  if (n < 2) return [];
  var col = saRoleCol_(s), d = s.getRange(1, 1, n, 5).getValues(), roles = col ? s.getRange(1, col, n, 1).getValues() : null, out = [];
  for (var i = 1; i < n; i++) {
    var key = normEmail_(d[i][0]); if (!key) continue;
    out.push({ key: key, phone: keyToPhone_(key), name: String(d[i][1] || ""), status: String(d[i][2] || "PENDING").trim().toUpperCase(),
               requested: d[i][3] instanceof Date ? d[i][3].toISOString() : String(d[i][3] || ""),
               approved: d[i][4] instanceof Date ? d[i][4].toISOString() : String(d[i][4] || ""),
               admin: roles ? String(roles[i][0]).trim().toUpperCase() === "ADMIN" : false });
  }
  var rank = { PENDING: 0, APPROVED: 1, BLOCKED: 2 };
  out.sort(function (a, b) { return (rank[a.status] == null ? 3 : rank[a.status]) - (rank[b.status] == null ? 3 : rank[b.status]); });
  return out;
}

function standaloneSetStatus_(adminKey, key, status) {
  key = normEmail_(key); status = String(status || "").toUpperCase();
  if (["APPROVED", "BLOCKED", "PENDING"].indexOf(status) < 0) throw new Error("Bad status.");
  if (key === normEmail_(adminKey) && status !== "APPROVED") throw new Error("You cannot block your own account.");
  var s = getUsersSheet_(), n = Math.max(s.getLastRow(), 1), d = s.getRange(1, 1, n, 1).getValues();
  for (var i = 1; i < n; i++) {
    if (normEmail_(d[i][0]) === key) {
      s.getRange(i + 1, 3).setValue(status);
      if (status === "APPROVED") s.getRange(i + 1, 5).setValue(new Date());
      accessCacheClear_(key);
      return { key: key, status: status };
    }
  }
  throw new Error("User not found.");
}

/* Menu: give a registered user the Admin tab of the Standalone app. */
function menuMakeAdmin_() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt("Make a user Admin", "WhatsApp number of the (registered) user who should get the Admin tab:", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var key = phoneKey_(r.getResponseText());
  if (!key) { ui.alert("Please enter a valid WhatsApp number."); return; }
  var s = getUsersSheet_(), col = saRoleCol_(s);
  if (!col) { col = Math.max(s.getLastColumn(), 10) + 1; s.getRange(1, col).setValue("Role").setFontWeight("bold"); }
  var n = Math.max(s.getLastRow(), 1), d = s.getRange(1, 1, n, 1).getValues();
  for (var i = 1; i < n; i++) {
    if (normEmail_(d[i][0]) === key) { s.getRange(i + 1, col).setValue("ADMIN"); ui.alert("Done", keyToPhone_(key) + " is now an Admin.", ui.ButtonSet.OK); return; }
  }
  ui.alert("Not found", keyToPhone_(key) + " has not registered yet.", ui.ButtonSet.OK);
}
