/******************************************************
 * MasterCAL Pro — Standalone.gs
 * Menu: "Publish Standalone app": builds the single-file offline MasterCAL (4W/3W/BIKE)
 * from THIS sheet's formulas and saves it in Drive (folder "MasterCAL_Standalone").
 *
 * The page/engine template (code only, no rates) is fetched from GitHub; the model
 * (formulas + rates of this sheet) is injected here and the result stays in Drive.
 * Never touches the user-copies folder. Never reads USERS / APPROVED_USERS.
 ******************************************************/

var SA_SKIP_SHEETS = { "USERS": 1, "APPROVED_USERS": 1, "Formula Dump": 1 };
var SA_FOLDER = "MasterCAL_Standalone";
var SA_TEMPLATE_URL = "https://raw.githubusercontent.com/drcjayawardena/MasterCAL/main/Standalone/template/MasterCAL_Standalone_template.html";
var SA_FILE_NAME = "MasterCAL_Pro_Standalone.html";

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
  var nF = 0, nDv = 0;
  model.order.forEach(function (n) { nF += Object.keys(model.sheets[n].f).length; nDv += model.sheets[n].dv.length; });
  ["CALCULATOR_TEMPLATE", "3W", "BIKE"].forEach(function (n) { if (!model.sheets[n]) throw new Error("Sheet '" + n + "' is missing: the app cannot be published."); });
  if (nF < 1000) throw new Error("Only " + nF + " formulas were found: something is wrong, nothing was published.");
  var json = JSON.stringify(model).replace(/<\//g, "<\\/");
  var html = tpl.split("__MC_MODEL__").join(json);
  var it = DriveApp.getFoldersByName(SA_FOLDER), folder = it.hasNext() ? it.next() : DriveApp.createFolder(SA_FOLDER);
  var files = folder.getFilesByName(SA_FILE_NAME), file;
  if (files.hasNext()) { file = files.next(); file.setContent(html); }
  else file = folder.createFile(SA_FILE_NAME, html, MimeType.HTML);
  return { id: file.getId(), folderUrl: folder.getUrl(), formulas: nF, dropdownRules: nDv, sheets: model.order.length,
           kb: Math.round(html.length / 1024), seconds: Math.round((Date.now() - t0) / 100) / 10, when: new Date() };
}

function menuPublishStandalone_() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert("Publish Standalone app?",
    "Builds the offline MasterCAL file (4W / 3W / BIKE) from the CURRENT formulas and rates of this sheet and saves it in your Drive folder '" + SA_FOLDER + "'. " +
    "It takes about 20-40 seconds. Continue?", ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var r;
  try { r = standalonePublish_(); }
  catch (e) { ui.alert("Publish failed", String(e && e.message ? e.message : e), ui.ButtonSet.OK); return; }
  var dl = "https://drive.google.com/uc?export=download&id=" + r.id;
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;font-size:14px;line-height:1.5">' +
    '<p><b>Done \u2705</b> ' + r.sheets + ' sheets, ' + r.formulas + ' formulas, ' + r.kb + ' KB, ' + r.seconds + ' s.</p>' +
    '<p>1. <a href="' + dl + '" target="_blank">Download the file</a><br>' +
    '2. Or open the Drive folder: <a href="' + r.folderUrl + '" target="_blank">' + SA_FOLDER + '</a> and share it with your staff.</p>' +
    '<p style="color:#666">Staff must open the new file (double-click, Edge). Old copies do not update by themselves.</p></div>')
    .setWidth(440).setHeight(230);
  ui.showModalDialog(html, "Publish Standalone app");
}
