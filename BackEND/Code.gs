/******************************************************
 * MasterCAL Pro
 * Code.gs  (v3 — per-user Sheet copies)
 *
 * Multi-user model:
 *   - The spreadsheet this script is bound to is the MASTER
 *     (template). Users NEVER touch it.
 *   - Each user (identified by a userId from the PWA) gets
 *     their OWN COPY of the whole spreadsheet in the owner's
 *     Drive. All their reads/writes go to that copy, so there
 *     is no cross-talk and the real formulas (iterative calc,
 *     QUERY, everything) run correctly.
 *   - A registry (Script Properties) maps userId -> copyId.
 *
 * Deploy: Execute as = Me, Who has access = Anyone.
 ******************************************************/

const SHEET_NAME = "CALCULATOR_TEMPLATE";
const MASTER_ID  = SpreadsheetApp.getActiveSpreadsheet().getId();

/* Per-request user spreadsheet (set by Api.gs before dispatch). */
var CURRENT_SS = null;


/*====================================================
  PER-USER COPY MANAGEMENT
====================================================*/

const USER_COPIES_FOLDER = "MasterCAL_UserCopies";

/* All per-user copies live in one Drive folder (created once). */
function getUserCopiesFolder_() {
  const it = DriveApp.getFoldersByName(USER_COPIES_FOLDER);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(USER_COPIES_FOLDER);
}

/*====================================================
  MASTER VERSION  ->  automatic refresh of the user copies

  Script Property MASTER_VER is a stamp that changes whenever the
  MASTER sheet is edited by a person (triggers below) or when the
  admin chooses "Refresh user copies" in the menu. Each user's copy
  remembers the stamp it was made from (copyver_<userId>). When the
  stamps differ, that user's copy is stale: the API answers
  { stale: true } and the app shows "Updating…" while syncCopy builds
  a fresh copy (the old one is trashed afterwards). Nothing is deleted
  until the user next opens the app.
====================================================*/

const MASTER_VER_KEY = "MASTER_VER";
/* Master tabs that change by themselves / are not part of the calculator. */
const MASTER_IGNORE_SHEETS = ["USERS", "APPROVED_USERS", "Formula Dump"];

/* Tabs that hold OTHER PEOPLE'S data (phone numbers, e-mails, password hashes). They exist in the
   master, but a user's copy must never carry them: the copy is that user's own workspace. */
const PRIVATE_SHEETS = ["USERS", "APPROVED_USERS"];

/* SPEED: every request needs to know "which copy is mine, and is it up to date?". That used to read
   ALL Script Properties (it grows with every user). Now ONE cache read answers it (master stamp +
   this user's copy id / stamp). The Script Properties stay the source of truth and are read only
   when the cache is empty. */
const COPY_CACHE_SECONDS = 300;
var COPY_STATE_MEMO = {};   /* per request (a new request starts empty) */

function scriptCache_() {
  try { return CacheService.getScriptCache(); } catch (e) { return null; }
}

/* The master stamp straight from the Script Properties (never cached). */
function masterVerFresh_() {
  return PropertiesService.getScriptProperties().getProperty(MASTER_VER_KEY) || "0";
}

function masterVer_() {
  const cache = scriptCache_();
  if (cache) { try { const v = cache.get("mv"); if (v) return v; } catch (e) {} }
  const v = masterVerFresh_();
  if (cache) { try { cache.put("mv", v, COPY_CACHE_SECONDS); } catch (e) {} }
  return v;
}

function bumpMasterVersion_() {
  const v = String(Date.now());
  PropertiesService.getScriptProperties().setProperty(MASTER_VER_KEY, v);
  const cache = scriptCache_();
  if (cache) { try { cache.put("mv", v, COPY_CACHE_SECONDS); } catch (e) {} }
}

/* { id, ver, scrubbed } of a user's copy straight from the Script Properties. */
function copyInfoFresh_(userId) {
  const p = PropertiesService.getScriptProperties();
  return { id: p.getProperty("copy_" + userId) || "",
           ver: p.getProperty("copyver_" + userId) || "0",
           scrubbed: p.getProperty("scrub_" + userId) === "1" };
}

function copyInfoInvalidate_(userId) {
  delete COPY_STATE_MEMO[userId];
  const cache = scriptCache_();
  if (cache) { try { cache.remove("ci_" + userId); } catch (e) {} }
}

function copyInfoSet_(userId, id, ver, scrubbed) {
  const p = PropertiesService.getScriptProperties();
  p.setProperty("copy_" + userId, id);
  p.setProperty("copyver_" + userId, ver);
  if (scrubbed) p.setProperty("scrub_" + userId, "1"); else p.deleteProperty("scrub_" + userId);
  delete COPY_STATE_MEMO[userId];
  const cache = scriptCache_();
  if (cache) { try { cache.put("ci_" + userId, JSON.stringify({ id: id, ver: ver, scrubbed: !!scrubbed }), COPY_CACHE_SECONDS); } catch (e) {} }
}

function copyInfoDrop_(userId) {
  const p = PropertiesService.getScriptProperties();
  p.deleteProperty("copy_" + userId);
  p.deleteProperty("copyver_" + userId);
  p.deleteProperty("scrub_" + userId);
  copyInfoInvalidate_(userId);
}

/* { id, ver, scrubbed, master } — ONE cache read (two keys) on the normal path. */
function copyState_(userId) {
  if (COPY_STATE_MEMO[userId]) return COPY_STATE_MEMO[userId];
  const cache = scriptCache_();
  var hit = {};
  if (cache) { try { hit = cache.getAll(["mv", "ci_" + userId]) || {}; } catch (e) { hit = {}; } }
  var info = null;
  if (hit["ci_" + userId]) { try { info = JSON.parse(hit["ci_" + userId]); } catch (e) { info = null; } }
  if (!info) {
    info = copyInfoFresh_(userId);
    if (info.id && cache) { try { cache.put("ci_" + userId, JSON.stringify(info), COPY_CACHE_SECONDS); } catch (e) {} }
  }
  const st = { id: info.id, ver: info.ver, scrubbed: !!info.scrubbed, master: hit.mv || masterVer_() };
  COPY_STATE_MEMO[userId] = st;
  return st;
}

/* No copy yet, or the copy was made from an older master.
   fresh = true: look at the Script Properties, not the cache (used while holding the lock). */
function copyIsStale_(userId, fresh) {
  if (fresh) {
    const i = copyInfoFresh_(userId);
    return !i.id || i.ver !== masterVerFresh_();
  }
  const s = copyState_(userId);
  return !s.id || s.ver !== s.master;
}

/* Empty the tabs that hold other people's data. Cleared, not deleted: a formula that points at a
   deleted tab would turn into #REF!. */
function scrubPrivateTabs_(ss) {
  PRIVATE_SHEETS.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (sheet) sheet.clear();
  });
  SpreadsheetApp.flush();
}

/* A new copy of the master for this user, private tabs emptied. If that cannot be done the copy is
   trashed and the request fails: a copy that still carries user data is never handed out. */
function makeUserCopy_(userId) {
  const file = DriveApp.getFileById(MASTER_ID)
    .makeCopy("MasterCAL — user " + userId, getUserCopiesFolder_());
  try {
    const ss = SpreadsheetApp.openById(file.getId());
    scrubPrivateTabs_(ss);
    return ss;
  } catch (e) {
    try { file.setTrashed(true); } catch (e2) {}
    throw e;
  }
}

/* Copies made before this existed: empty the private tabs once, the first time the copy is used.
   A failure is only logged (the user can still work); it is tried again on the next request. */
function scrubExistingCopy_(userId, ss) {
  try {
    scrubPrivateTabs_(ss);
    PropertiesService.getScriptProperties().setProperty("scrub_" + userId, "1");
    copyInfoInvalidate_(userId);
  } catch (e) {
    try { Logger.log("scrubExistingCopy_ " + userId + ": " + (e && e.message ? e.message : e)); } catch (e2) {}
  }
}

/* Build a fresh copy for this user, then trash the old one. */
function syncUserCopy_(userId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    if (!copyIsStale_(userId, true)) {
      copyInfoInvalidate_(userId);   /* another request already did it: drop any outdated cache entry */
      return { updated: false };
    }
    const ver = masterVerFresh_();   /* read BEFORE copying: an edit made meanwhile keeps this copy marked as outdated */
    const oldId = copyInfoFresh_(userId).id;
    const copy = makeUserCopy_(userId);
    copyInfoSet_(userId, copy.getId(), ver, true);
    if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) {} }
    return { updated: true };
  } finally {
    lock.releaseLock();
  }
}

/* Installable triggers (set up once from the menu). They fire only for edits made
   by a person, never for the script's own writes, so approving users etc. does not count. */
function masterEditTrigger(e) {
  try {
    const name = e && e.range ? e.range.getSheet().getName() : "";
    if (MASTER_IGNORE_SHEETS.indexOf(name) !== -1) return;
    bumpMasterVersion_();
  } catch (err) { Logger.log("masterEditTrigger: " + err); }
}

function masterChangeTrigger(e) {            /* rows / columns / tabs added or removed, formatting ... */
  try {
    if (e && e.changeType === "EDIT") return;   /* plain edits are handled (with the tab name) above */
    bumpMasterVersion_();
  } catch (err) { Logger.log("masterChangeTrigger: " + err); }
}

function installAutoRefreshTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const h = t.getHandlerFunction();
    if (h === "masterEditTrigger" || h === "masterChangeTrigger") ScriptApp.deleteTrigger(t);
  });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger("masterEditTrigger").forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger("masterChangeTrigger").forSpreadsheet(ss).onChange().create();
}

function setUserContext_(userId) {
  CURRENT_SS = getUserSpreadsheet_(userId);
  return CURRENT_SS;
}

function getUserSpreadsheet_(userId) {
  if (!userId) throw new Error("Missing userId.");

  const st = copyState_(userId);
  if (st.id) {
    var ss = null;
    try { ss = SpreadsheetApp.openById(st.id); }
    catch (e) { copyInfoDrop_(userId); }   /* copy was deleted */
    if (ss) {
      if (!st.scrubbed) scrubExistingCopy_(userId, ss);
      return ss;
    }
  }

  /* Create the copy once. Lock only around creation so two
     first-time requests from the same user don't double-create. */
  const lock = LockService.getScriptLock();
  lock.waitLock(45000);
  try {
    const cur = copyInfoFresh_(userId);
    if (cur.id) {
      try { return SpreadsheetApp.openById(cur.id); } catch (e) {}
    }
    const ver = masterVerFresh_();   /* before copying, see syncUserCopy_ */
    const copy = makeUserCopy_(userId);
    copyInfoSet_(userId, copy.getId(), ver, true);
    return copy;
  } finally {
    lock.releaseLock();
  }
}


/*====================================================
  SHEET / RANGE HELPERS  (operate on the USER'S copy)
====================================================*/

function ssActive_() {
  return CURRENT_SS || SpreadsheetApp.getActiveSpreadsheet();
}

function sh() {
  const sheet = ssActive_().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("Sheet '" + SHEET_NAME + "' not found.");
  return sheet;
}

/* Range by CFG key: named range first (on the user's copy), A1 fallback. */
function rng(key) {
  const named = ssActive_().getRangeByName(key);
  if (named) return named;
  const a1 = CFG[key];
  if (!a1) throw new Error("Unknown range key: " + key);
  return sh().getRange(a1);
}

const CFG = {
  PRODUCT_TYPES:      "AY3:AY",
  IN_PRODUCT_TYPE:    "D1",
  IN_MAIN:            "D5:D10",
  IN_SCHEDULE_TYPE:   "F1",
  SCHED_FROM:         "F3:F14",
  SCHED_TO:           "G3:G14",
  SCHED_AMOUNT:       "H3:H14",
  SCHED_BLOCK:        "F3:H14",
  OUT_BLOCK:          "D11:M18",
  RENTAL_SCHEDULE:    "A27:F112"
};


/*====================================================
  READS
  SPEED: one Sheets call reads A1:P18 and serves the outputs, the
  labels, the charges block, the stamp-duty list, the bullet schedule
  and its TO column. (Before, each of these was a separate call and
  every call costs time.)  The positions are the ones the app has
  always used:
     OUT_BLOCK D11:M18 · charges J1:L14 · labels A5:A10 ·
     SCHED_BLOCK F3:H14 · SCHED_TO G3:G14 · stamp duty P1:P3 ·
     field switches Q6:Q8 · Express switch N1
====================================================*/

const BLOCK_A1 = "A1:Q28";

/* withRentalSchedule: widen the read to A1:P112 so the rental
   schedule (A27:F112) comes back in the same single call. */
function readBlock_(withRentalSchedule, sheet) {
  return (sheet || sh()).getRange(withRentalSchedule ? "A1:Q112" : BLOCK_A1).getDisplayValues();
}

/* Q6 / Q7 / Q8 decide whether the BIC / INSURANCE / STAMP DUTY text boxes are usable:
     YES -> ENABLE      NO -> DISABLE
   Anything else (blank, #N/A while no product is chosen yet) keeps the box enabled. */
function fieldOn_(v) { return String(v == null ? "" : v).trim().toUpperCase() !== "NO"; }

/* Keep the SHEET in step with what the screen locks.
   1) A box whose switch is NO (Q6 / Q7 / Q8) must hold NOTHING in the sheet either. The
      formulas still read D6 / D7 / D8 directly (E6 returns D6 when D6 > 2, the stamp-duty
      text in D8 picks the schedule block and the charges ...), so a value left over from
      another product would silently change the result while the screen shows an empty box.
   2) Express products (N1 = "EXPRESS") have a fixed PERIOD (E10 = 12): D10 is set to it,
      so when the user goes back to a normal product the Period box and the sheet agree.
   Costs one extra recalculation ONLY when something has to be corrected. */
function enforceDisabled_(s, b, withRs) {
  var dirty = false;

  const stale = [];
  [[5, "D6"], [6, "D7"], [7, "D8"]].forEach(function (f) {
    const switchOn = fieldOn_(b[f[0]][16]);                    /* Q6 / Q7 / Q8 */
    const hasValue = String(b[f[0]][3] == null ? "" : b[f[0]][3]).trim() !== "";   /* D6 / D7 / D8 */
    if (!switchOn && hasValue) stale.push(f[1]);
  });
  if (stale.length) { s.getRangeList(stale).clearContent(); dirty = true; }

  if (isExpress_(b[0][13])) {                                  /* N1 */
    var per = parseFloat(String(b[9][4] == null ? "" : b[9][4]).replace(/,/g, ""));   /* E10 */
    if (!(per > 0)) per = 12;
    if (String(b[9][3] == null ? "" : b[9][3]).trim() !== String(per)) {                /* D10 */
      s.getRange("D10").setValue(per);
      dirty = true;
    }
  }

  if (!dirty) return b;
  SpreadsheetApp.flush();
  return readBlock_(withRs, s);
}

/* N1 = "EXPRESS" (EXPRESS CASH, EXPRESS CASH/AUTO LOANS, EXPRESS OD): the sheet
   fixes the PERIOD at 12 months for these products, so the app locks the Period box. */
function isExpress_(v) { return String(v == null ? "" : v).trim().toUpperCase() === "EXPRESS"; }

function outputsLiteFrom_(b) {
  return {
    monthlyRental:      b[10][4], /* E11 */
    totalInterest:      b[12][4], /* E13 */
    totalPaid:          b[13][4], /* E14 */
    lastMonthRental:    b[14][4], /* E15 */
    lastMonthInterest:  b[16][4], /* E17 */
    lastMonthTotalPaid: b[17][4], /* E18 */
    bulkAmount:         b[15][3], /* D16 */
    rate100:            b[13][12],/* M14 */
    capitalRecoverFirstRental: b[27][5], /* F28 */
    /* Capitalized amounts shown on the BIC / INSURANCE / STAMP DUTY labels */
    capAmounts:         [ b[5][4], b[6][4], b[7][4] ],   /* E6, E7, E8 */
    express: isExpress_(b[0][13]),                       /* N1 */
    enabled: {                                           /* Q6 BIC, Q7 INSURANCE, Q8 STAMP DUTY */
      bic:       fieldOn_(b[5][16]),
      insurance: fieldOn_(b[6][16]),
      stampDuty: fieldOn_(b[7][16])
    },
    /* Charges breakdown block J1:L14 (label=J, sub=K, amount=L) */
    charges:            b.slice(0, 14).map(function (r) { return [r[9], r[10], r[11]]; })
  };
}

/* Dynamic field labels A5:A10 -> facility, bic, insurance, stamp, irr, period */
function outputsFrom_(b) {
  const out = outputsLiteFrom_(b);
  out.labels = b.slice(4, 10).map(function (r) { return r[0]; });
  return out;
}

function scheduleFrom_(b) {                       /* F3:H14 */
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push({ from: b[2 + i][5], to: b[2 + i][6], amount: b[2 + i][7] });
  return rows;
}
function toColumnFrom_(b)       { return b.slice(2, 14).map(function (r) { return r[6]; }); }   /* G3:G14 */
function stampDutyFrom_(b)      { return b.slice(0, 3).map(function (r) { return r[15]; }).filter(String); }   /* P1:P3 */
function rentalScheduleFrom_(b) { return b.slice(26, 112).map(function (r) { return r.slice(0, 6); }); }       /* A27:F112 */

/* RMV charge type options: Charges!B where A = "RMV CHARGES". */
function getRmvTypes_() {
  const ch = ssActive_().getSheetByName("Charges");
  if (!ch) return [];
  const data = ch.getRange("A2:B30").getDisplayValues();
  const out = [];
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === "RMV CHARGES" &&
        String(data[i][1]).trim() !== "") {
      out.push(data[i][1]);
    }
  }
  return out;
}

/* Set an RMV charge type dropdown (J13 or J14) and recompute. */
function setRmvType(value, cell) {
  const target = (cell === "J13" || cell === "J14") ? cell : "J14";
  sh().getRange(target).setValue(cellValue_(value));
  SpreadsheetApp.flush();
  return { success: true, outputs: outputsFrom_(readBlock_()) };
}

function getRentalSchedule() {
  return { success: true, rows: rng("RENTAL_SCHEDULE").getDisplayValues() };
}

/* Clear every user input in ONE call (RangeList).
   The ADDITIONAL SERVICE CHARGES amount is typed by the user too, so it starts empty. */
function clearInputs_() {
  const list = [CFG.IN_PRODUCT_TYPE, CFG.IN_MAIN, CFG.IN_SCHEDULE_TYPE, CFG.SCHED_FROM, CFG.SCHED_AMOUNT];
  const addl = addlChargeCell_();
  if (addl) list.push(addl);
  sh().getRangeList(list).clearContent();
}

/* ADDITIONAL SERVICE CHARGES: the amount (column L) of the charges-block row (J1:J14)
   whose label is "ADDITIONAL SERVICE CHARGES". The user types it in the app.
   The row is looked up by its label (cached 6 h), so moving the row in the
   template needs no code change. "" when the template has no such row. */
function addlChargeCell_() {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  const hit = cache ? cache.get("addl_cell") : null;
  if (hit !== null && hit !== undefined) return hit === "-" ? "" : hit;
  const j = sh().getRange("J1:J14").getDisplayValues();
  var cell = "";
  for (var i = 0; i < j.length; i++) {
    if (/ADDITIONAL\s+SERVICE\s+CHARGE/i.test(String(j[i][0]))) { cell = "L" + (i + 1); break; }
  }
  if (cache) { try { cache.put("addl_cell", cell || "-", 21600); } catch (e) {} }
  return cell;
}

/* The user typed an ADDITIONAL SERVICE CHARGES amount ("" clears it). */
function setAdditionalCharge(value) {
  const cell = addlChargeCell_();
  if (!cell) throw new Error("ADDITIONAL SERVICE CHARGES row not found in the sheet.");
  const v = String(value == null ? "" : value).replace(/,/g, "").trim();
  if (v !== "" && !(Number(v) >= 0)) throw new Error("Please enter a valid amount.");
  const s = sh();
  if (v === "") s.getRange(cell).clearContent(); else s.getRange(cell).setValue(Number(v));
  SpreadsheetApp.flush();
  return { success: true, outputs: outputsFrom_(readBlock_()) };
}


/*====================================================
  APP LOAD  (one round trip)
====================================================*/

function initApp() {
  clearInputs_();
  SpreadsheetApp.flush();
  const b = readBlock_();
  const stamp = stampDutyFrom_(b);
  return {
    success:   true,
    dropdowns: {
      productTypes: rng("PRODUCT_TYPES").getDisplayValues().flat().filter(String),
      stampDuty:    stamp,
      rmvTypes:     getRmvTypes_()
    },
    stampDuty: stamp,
    outputs:   outputsFrom_(b),
    schedule:  scheduleFrom_(b)
  };
}

/*====================================================
  WRITES  (each on the user's OWN copy — no shared lock needed)
====================================================*/

/* Everything the browser sends ends up in a sheet cell, and a cell that starts with = + - or @ is
   read as a FORMULA (it could read other tabs or fetch web pages). Bike.gs already refuses those;
   this is the same rule for the other calculators. Plain numbers (-5, +5, 1e3) are fine. */
const CELL_NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
function cellValue_(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.length > 200) throw new Error("Value is too long.");
  const t = s.trim();
  if (/^[=+\-@]/.test(t) && t !== "-" && !CELL_NUM_RE.test(t)) throw new Error("Invalid value.");
  return s;
}

function saveProductType(productType) {
  const s = sh();
  s.getRange(CFG.IN_PRODUCT_TYPE).setValue(cellValue_(productType));
  s.getRangeList([CFG.SCHED_FROM, CFG.SCHED_AMOUNT]).clearContent();
  SpreadsheetApp.flush();
  const b = enforceDisabled_(s, readBlock_(false, s), false);
  return { success: true, stampDuty: stampDutyFrom_(b), outputs: outputsFrom_(b), schedule: scheduleFrom_(b) };
}

/* Live field edits: writes inputs, returns ONLY outputs.
   SPEED: one write per block, ONE read afterwards. If the caller
   has the rental schedule open it sets data.withSchedule = true and
   gets the rental schedule in the same response (no 2nd request). */
function calcInputs(data) {
  data = data || {};
  const s = sh();
  /* data.same = ["productType", "scheduleType"]: the app says these two are unchanged since its last
     calculation, so they are not written again (less sheet work per keystroke). An older app version
     sends no "same" and everything is written, as before. */
  const same = {};
  (Array.isArray(data.same) ? data.same : []).forEach(function (k) { same[k] = true; });

  const productType  = cellValue_(data.productType);
  const scheduleType = cellValue_(data.scheduleType);
  const main = [
    [ cellValue_(data.facilityAmount) ],
    [ cellValue_(data.bic) ],
    [ cellValue_(data.insurance) ],
    [ cellValue_(data.stampDuty) ],
    [ cellValue_(data.irr) ],
    [ cellValue_(data.period) ]
  ];

  if (!same.productType) s.getRange(CFG.IN_PRODUCT_TYPE).setValue(productType);
  s.getRange(CFG.IN_MAIN).setValues(main);
  if (!same.scheduleType) s.getRange(CFG.IN_SCHEDULE_TYPE).setValue(scheduleType);
  /* no flush here: the read below already sees the writes (removed on purpose, commit 729086f) */

  const withRs = data.withSchedule === true;
  const b = enforceDisabled_(s, readBlock_(withRs, s), withRs);
  /* outputsFrom_ = outputs + labels (A5:A10) + capAmounts (E6:E8): labels such as
     "ONLY CAPITALIZED 1% AS BIC" depend on what the user just typed */
  const res = { success: true, outputs: outputsFrom_(b) };
  if (withRs) res.rentalSchedule = rentalScheduleFrom_(b);
  return res;
}

function saveScheduleType(scheduleType) {
  const s = sh();
  s.getRange(CFG.IN_SCHEDULE_TYPE).setValue(cellValue_(scheduleType));
  s.getRangeList([CFG.SCHED_FROM, CFG.SCHED_AMOUNT]).clearContent();
  SpreadsheetApp.flush();
  const b = readBlock_(false, s);
  return { success: true, outputs: outputsFrom_(b), schedule: scheduleFrom_(b) };
}

/* Bullet schedule cells: FROM = column F, AMOUNT = column H, first row 3
   (SCHED_FROM F3:F14 / SCHED_AMOUNT H3:H14). */
const SCHED_ROW0 = 3, SCHED_FROM_COL = 6, SCHED_AMOUNT_COL = 8;
function schedFromCell_(idx)  { return sh().getRange(SCHED_ROW0 + idx, SCHED_FROM_COL); }
function schedAmountCell_(idx){ return sh().getRange(SCHED_ROW0 + idx, SCHED_AMOUNT_COL); }
function validIndex_(index){ const i = Number(index); if (isNaN(i) || i < 0 || i > 11) throw new Error("Invalid schedule row: " + index); return i; }

/* Express facilities (N1 = "EXPRESS") cannot have bullet payments. The screen disables the
   button; this makes the server refuse too, whatever the browser sends. */
function assertNotExpress_() {
  if (isExpress_(sh().getRange("N1").getDisplayValue())) {
    throw new Error("Bullet payments are not available for Express facilities.");
  }
}

/* Shared reply of every schedule edit: ONE read gives outputs + schedule + TO. */
function scheduleReply_(b, extra) {
  const out = outputsFrom_(b);
  const res = { success: true };
  Object.keys(extra || {}).forEach(function (k) { res[k] = extra[k]; });
  res.to = toColumnFrom_(b);
  res.monthlyRental = out.monthlyRental;
  res.outputs = out;
  res.schedule = scheduleFrom_(b);
  return res;
}

function addScheduleRow(index, from, amount) {
  const idx = validIndex_(index);
  assertNotExpress_();
  schedFromCell_(idx).setValue(cellValue_(from));
  schedAmountCell_(idx).setValue(cellValue_(amount));
  SpreadsheetApp.flush();
  const b = readBlock_();
  return scheduleReply_(b, { index: idx, from: b[2 + idx][5], amount: b[2 + idx][7] });
}

function updateScheduleFrom(index, value) {
  const idx = validIndex_(index);
  assertNotExpress_();
  schedFromCell_(idx).setValue(cellValue_(value));
  SpreadsheetApp.flush();
  const b = readBlock_();
  return scheduleReply_(b, { row: SCHED_ROW0 + idx, value: b[2 + idx][5] });
}

function updateScheduleAmount(index, value) {
  const idx = validIndex_(index);
  assertNotExpress_();
  schedAmountCell_(idx).setValue(cellValue_(value));
  SpreadsheetApp.flush();
  const b = readBlock_();
  return scheduleReply_(b, { row: SCHED_ROW0 + idx, value: b[2 + idx][7] });
}

function deleteScheduleRow(index) {
  const idx = validIndex_(index);
  schedFromCell_(idx).clearContent();
  schedAmountCell_(idx).clearContent();
  SpreadsheetApp.flush();
  return scheduleReply_(readBlock_(), { row: SCHED_ROW0 + idx });
}

function clearScheduleInputs() {
  sh().getRangeList([CFG.SCHED_FROM, CFG.SCHED_AMOUNT]).clearContent();
  SpreadsheetApp.flush();
  return scheduleReply_(readBlock_());
}


/*====================================================
  ADMIN / MAINTENANCE  (used by the sheet menu)
====================================================*/

/* Delete ALL user copies (trash) and clear the registry. Use with care. */
function adminDeleteAllCopies() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let removed = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf("copy_") === 0) {
      try { DriveApp.getFileById(all[k]).setTrashed(true); } catch (e) {}
      copyInfoDrop_(k.slice(5));   /* copy_, copyver_, scrub_ and the cache entry */
      removed++;
    } else if (k.indexOf("copyver_") === 0 || k.indexOf("scrub_") === 0) {
      props.deleteProperty(k);
    }
  });
  Logger.log("Removed " + removed + " copies.");
  return removed;
}

/*====================================================
  THREE-WHEEL (3W) CALCULATOR
  Reads/writes a separate tab in the user's copy whose
  A1 == "VALUATION & EXPOSURE CALCULATION".
  Inputs are column B; outputs column C. Dropdown option
  lists are read straight from each cell's data validation.
====================================================*/

const THREE_WHEEL_SHEET = "3W";   /* fast path — auto-detected if named differently */
const IN_CELLS_3W = ["B2","B3","B4","B5","B10","B11","B12","B13","B14","B15","B22","B23"];

function sh3W_() {
  const ss = ssActive_();
  var s = ss.getSheetByName(THREE_WHEEL_SHEET);
  if (s) return s;
  const sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getRange("A1").getDisplayValue()).trim().toUpperCase()
        === "VALUATION & EXPOSURE CALCULATION") return sheets[i];
  }
  throw new Error("Three-wheel sheet not found (need a tab with A1 = 'VALUATION & EXPOSURE CALCULATION').");
}

function dropdownOptions3W_(rg) {
  try {
    const dv = rg.getDataValidation();
    if (!dv) return null;
    const type = String(dv.getCriteriaType());
    const vals = dv.getCriteriaValues();
    if (type === "VALUE_IN_LIST") {
      return (vals[0] || []).map(function (v) { return String(v); })
        .filter(function (v) { return v.trim() !== ""; });
    }
    if (type === "VALUE_IN_RANGE") {
      const disp = vals[0].getDisplayValues();
      const out = [];
      for (var i = 0; i < disp.length; i++) {
        for (var j = 0; j < disp[i].length; j++) {
          const v = String(disp[i][j]).trim();
          if (v !== "" && out.indexOf(v) === -1) out.push(v);
        }
      }
      return out;
    }
  } catch (e) {}
  return null;
}

/* Non-empty, de-duplicated values down one column of the 3W sheet. */
function colOptions3W_(s, col) {
  const last = s.getLastRow();
  if (last < 1) return [];
  const disp = s.getRange(col + "1:" + col + last).getDisplayValues();
  const out = [];
  const isErr = /^#(N\/A|REF!|DIV\/0!|VALUE!|NUM!|NAME\?|NULL!|ERROR!|CYCLE!)/i;
  for (var i = 0; i < disp.length; i++) {
    const v = String(disp[i][0]).trim();
    if (v !== "" && !isErr.test(v) && out.indexOf(v) === -1) out.push(v);
  }
  return out;
}

/* F13 = "YES" -> RMV CHARGES (B23) is switched off. */
function rmv3WOff_(v) { return String(v == null ? "" : v).trim().toUpperCase() === "YES"; }

function snap3W_(s) { return s.getRange("A1:F34").getDisplayValues(); }

function get3WData_(s, snap, includeOptions) {
  const inputs = {};
  IN_CELLS_3W.forEach(function (c) {
    const row = parseInt(c.slice(1), 10);
    /* VEHICLE NO (B3) options come from the 3W sheet's own D column
       (its cell validation points at the wrong sheet). */
    const info = { value: snap[row - 1][1] };
    if (includeOptions) info.options = (c === "B3") ? colOptions3W_(s, "D") : dropdownOptions3W_(s.getRange(c));
    inputs[c] = info;
  });
  const g = function (row) { return snap[row - 1][2] == null ? "" : snap[row - 1][2]; };
  return {
    inputs: inputs,
    labelFacility: snap[9][0],
    totalCapPct:   snap[5][1],
    rmvDisabled:   rmv3WOff_(snap[12][5]),
    out: {
      cfValuation:   g(3),
      maxFacility:   g(5),
      totCapVal:     g(6),
      facilityAmt:   g(10),
      bic:           g(11),
      insurance:     g(12),
      rmv:           g(13),
      monthlyRental: g(15),
      chargesTotal:  g(21),
      cribCharge:    g(22),
      rmvCharge:     g(23),
      insCharge:     g(24),
      valCharge:     g(25),
      svcCharge:     g(26),
      vat:           g(27),
      totCapital:    g(30),
      totPaid:       g(31),
      totInterest:   g(32),
      rate100:       g(33),
      flatRate:      g(34)
    }
  };
}

function get3W() {
  const s = sh3W_();
  return get3WData_(s, snap3W_(s), true);
}

function set3W(cell, value) {
  if (IN_CELLS_3W.indexOf(cell) === -1) throw new Error("Invalid 3W cell: " + cell);
  const s = sh3W_();
  var snap = snap3W_(s);
  const row = parseInt(cell.slice(1), 10);
  const before = String(snap[row - 1][1] == null ? "" : snap[row - 1][1]);
  var changed = false;
  if (cell === "B23" && rmv3WOff_(snap[12][5])) {
    if (before.trim() !== "") { s.getRange("B23").clearContent(); changed = true; }
  } else {
    const clean = cellValue_(value);
    if (before !== clean) { s.getRange(cell).setValue(clean); changed = true; }
  }
  if (changed) {
    SpreadsheetApp.flush();
    snap = snap3W_(s);
    if (rmv3WOff_(snap[12][5]) && String(snap[22][1]).trim() !== "") {
      s.getRange("B23").clearContent();
      SpreadsheetApp.flush();
      snap = snap3W_(s);
    }
  }
  return get3WData_(s, snap, false);
}

/* Opening the 3W tab starts a fresh calculation: clear the Rental Calculation inputs. */
function reset3W() {
  const s = sh3W_();
  s.getRangeList(["B10","B11","B12","B13","B14","B15"]).clearContent();
  SpreadsheetApp.flush();
  var snap = snap3W_(s);
  if (rmv3WOff_(snap[12][5]) && String(snap[22][1]).trim() !== "") {
    s.getRange("B23").clearContent();
    SpreadsheetApp.flush();
    snap = snap3W_(s);
  }
  return get3WData_(s, snap, true);
}
