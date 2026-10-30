/******************************************************
 * MasterCAL Pro
 * Bike.gs — BIKE LEASING calculator  (sheet "BIKE")
 *
 * A SEPARATE product from the three-wheeler: it reads only the
 * "BIKE" sheet in the user's copy and shares no formulas with "3W".
 * (It only reuses the app's per-user-copy plumbing: ssActive_().)
 *
 * BIKE sheet layout this file is written for (column B = inputs,
 * column C = results):
 *
 *   B2  MAKE        dropdown  (list built by D1)
 *   B3  MODEL       dropdown  (list depends on MAKE)
 *   B4  YEAR        dropdown  (list depends on MODEL)
 *   B5  EXPOSURE    input     (C5 = C3 * B5   = maximum facility)
 *   B7  FACILITY AMOUNT
 *   B8  BIC ( % )   dropdown  (1 / 2)
 *   B9  INSURANCE   MANUAL input (amount)
 *   B10 CAPITALISED RMV dropdown (amount shown in C10)
 *   B11 PERIOD      (months)
 *   B12 IRR         (percent, e.g. 28)
 *   B20 CRIB CHARGES (quantity)
 *   B21 INITIAL RMV CHARGES dropdown (disabled when D21 = YES)
 *   C3 CF valuation, C5 max facility, C7 facility, C8 BIC amount,
 *   C9 insurance, C10 capitalised RMV, C13 MONTHLY RENTAL,
 *   C15 total capitalized, C16 total paid, C17 total interest,
 *   C19 initial charges total, C20..C24 crib / RMV / valuation / service / VAT
 *
 * SPEED (every call to the sheet costs time, so there are few of them)
 *   - ONE read of A1:D24 gives the labels, the inputs, the results and D21.
 *   - A value that is already in the cell is not written again (no recalculation).
 *   - Dropdown lists are kept in the script cache (keyed by master version and, for
 *     MODEL / YEAR, by the parent choice) and are sent back only when they can change.
 *
 * SAFETY NET
 *   - The A-column labels are checked on every call. If someone
 *     moves rows in the sheet, the app stops with a clear message
 *     instead of silently reading the wrong cells.
 *   - Every value is validated here (dropdown values must exist in
 *     the sheet's own list, numbers must be in range, nothing that
 *     looks like a formula is ever written).
 *   - Changing MAKE clears MODEL and YEAR; changing MODEL clears YEAR.
 ******************************************************/

const BIKE_SHEET = "BIKE";

const BIKE_IN_CELLS     = ["B2", "B3", "B4", "B5", "B7", "B8", "B9", "B10", "B11", "B12", "B20", "B21"];
const BIKE_READONLY    = ["B5"];   /* exposure: shown only, like the 3W tab */
const BIKE_SELECT_CELLS = ["B2", "B3", "B4", "B8", "B10", "B21"];

/* row -> what the A-column label must start with (upper-case) */
const BIKE_LABELS = {
  2: "MAKE", 3: "MODEL", 4: "YEAR", 5: "EXPOSURE", 7: "FACILITY AMOUNT", 8: "BIC",
  9: "INSURANCE", 10: "RMV CHARGES", 11: "PERIOD", 12: "IRR", 13: "MONTHLY RENTAL",
  15: "TOTAL CAPITALIZED", 16: "TOTAL PAID", 17: "TOTAL INTEREST",
  20: "CRIB CHARGES", 21: "RMV CHARGES", 22: "VALUATION CHARGES",
  23: "SERVICE CHARGES", 24: "VAT"
};


/* ---------- helpers ---------- */

function bikeSheet_() {
  const s = ssActive_().getSheetByName(BIKE_SHEET);
  if (!s) throw new Error("Bike sheet not found in your copy. Ask the admin to refresh the user copies.");
  return s;
}

/* One read of A1:D24 (labels, inputs, results, D21): 2 sheet calls. */
function bikeSnap_(s) {
  const rng = s.getRange(1, 1, 24, 4);
  return { D: rng.getDisplayValues(), V: rng.getValues() };
}

function bikeCheckLayout_(s) {
  bikeCheckLabels_(s.getRange(1, 1, 24, 1).getDisplayValues());   /* used by the admin menu check */
}

function bikeCheckLabels_(a) {                         /* a = rows already read, column 0 = label */
  Object.keys(BIKE_LABELS).forEach(function (row) {
    const want = BIKE_LABELS[row];
    const got = String(a[row - 1][0]).trim().toUpperCase();
    if (got.charAt(0) === "#") return;                 /* label formula showing an error: skip */
    if (got.indexOf(want) !== 0) {
      throw new Error("The BIKE sheet layout changed: A" + row + " should start with '" + want +
        "' but is '" + String(a[row - 1][0]).trim() + "'. Please contact the admin.");
    }
  });
}

function bikeNum_(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const n = parseFloat(String(v == null ? "" : v).replace(/[,\s%]/g, ""));
  return isFinite(n) ? n : 0;
}

/* 1234567.5 -> "1,234,567.50" (no locale dependence). */
function bikeFmt_(n) {
  if (!isFinite(n)) n = 0;
  const parts = Math.abs(n).toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-" : "") + parts.join(".");
}

/* Dropdown values of a cell, read from its own data validation.
   Header words, a footnote and blanks that the sheet's lists contain are removed. */
function bikeOptions_(rg) {
  var raw = [];
  try {
    const dv = rg.getDataValidation();
    if (!dv) return [];
    const type = String(dv.getCriteriaType());
    const vals = dv.getCriteriaValues();
    if (type === "VALUE_IN_LIST") {
      raw = (vals[0] || []).map(String);
    } else if (type === "VALUE_IN_RANGE") {
      const disp = vals[0].getDisplayValues();
      for (var i = 0; i < disp.length; i++) for (var j = 0; j < disp[i].length; j++) raw.push(String(disp[i][j]));
    }
  } catch (e) { return []; }

  const skip = { "MAKE": 1, "MODEL": 1, "YEAR": 1 };
  const out = [];
  raw.forEach(function (v) {
    v = v.trim();
    if (v === "" || v.charAt(0) === "#" || skip[v.toUpperCase()] || /^NOTE\s*:/i.test(v)) return;
    if (out.indexOf(v) === -1) out.push(v);
  });
  return out;
}

const BIKE_OPT_TTL = 3600;   /* seconds; the key also holds the master version, so a master change shows at once */

/* Dropdown list of a cell. MODEL needs a MAKE and YEAR needs a MODEL: without one the list is empty. */
function bikeOptionsFor_(s, cell, snap, ver) {
  const make = String(snap.D[1][1]).trim(), model = String(snap.D[2][1]).trim();
  if (cell === "B3" && !make) return [];
  if (cell === "B4" && (!make || !model)) return [];

  var key = "bk:" + ver + ":" + cell;
  if (cell === "B3") key += ":" + make;
  else if (cell === "B4") key += ":" + make + ":" + model;
  key = key.slice(0, 240);

  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache) {
    try { const hit = cache.get(key); if (hit) return JSON.parse(hit); } catch (e) {}
  }
  const list = bikeOptions_(s.getRange(cell));
  if (cache && list.length) { try { cache.put(key, JSON.stringify(list), BIKE_OPT_TTL); } catch (e) {} }
  return list;
}

/* Value to write for a dropdown cell: the sheet's own option (numbers as numbers). */
function bikePickOption_(options, raw) {
  for (var i = 0; i < options.length; i++) {
    const o = options[i];
    if (o === raw || (/^\d+(\.\d+)?$/.test(o) && /^\d+(\.\d+)?$/.test(raw) && Number(o) === Number(raw))) {
      return /^\d+(\.\d+)?$/.test(o) ? Number(o) : o;
    }
  }
  return undefined;
}

/* Validate + convert one value from the browser. Returns what to write ("" = clear). */
function bikeValidate_(s, cell, value, snap) {
  const raw = (value == null ? "" : String(value)).trim();
  if (raw.length > 100) throw new Error("Value is too long.");
  if (raw === "") return "";

  if (BIKE_SELECT_CELLS.indexOf(cell) !== -1) {
    const picked = bikePickOption_(bikeOptionsFor_(s, cell, snap, masterVer_()), raw);
    if (picked === undefined) throw new Error("'" + raw + "' is not an allowed value for " + cell + ".");
    return picked;
  }

  if (/^[=+@]/.test(raw) || (raw.charAt(0) === "-")) throw new Error("Invalid value.");
  const num = Number(raw.replace(/[,\s]/g, "").replace(/%$/, ""));
  if (!isFinite(num) || !/^[\d.,\s]+%?$/.test(raw)) throw new Error("Enter a number.");
  const isPct = /%$/.test(raw);

  switch (cell) {
    case "B7": case "B9":
      if (num > 1e10) throw new Error("Amount is too large.");
      return num;
    case "B11":
      if (num !== Math.floor(num) || num < 1 || num > 120) throw new Error("Period must be a whole number of months (1–120).");
      return num;
    case "B12":                                    /* percent number, e.g. 28 */
      if (num < 0 || num > 100) throw new Error("IRR must be between 0 and 100.");
      return num;
    case "B20":
      if (num !== Math.floor(num) || num < 0 || num > 50) throw new Error("Crib charges: a whole number (0–50).");
      return num;
    default:
      throw new Error("Invalid BIKE cell: " + cell);
  }
}


/* ---------- read ---------- */

/* optCells: which dropdown lists to send (null = all). A list that is not sent keeps its
   previous content in the app. */
function bikeRead_(s, snap, optCells, t0) {
  const D = snap.D, V = snap.V;
  const d = function (row, col) { return String(D[row - 1][col - 1] == null ? "" : D[row - 1][col - 1]); };
  const n = function (row, col) { return bikeNum_(V[row - 1][col - 1]); };
  const ver = masterVer_();

  const inputs = {};
  BIKE_IN_CELLS.forEach(function (c) {
    const info = { value: d(parseInt(c.slice(1), 10), 2) };
    if (BIKE_SELECT_CELLS.indexOf(c) === -1) info.options = null;
    else if (!optCells || optCells.indexOf(c) !== -1) info.options = bikeOptionsFor_(s, c, snap, ver);
    inputs[c] = info;
  });

  /* The sheet gives a rental even with empty inputs (it adds a fixed amount),
     so only show results once facility, period and IRR are all entered. */
  const ready = n(7, 3) > 0 && n(11, 3) > 0 && n(12, 3) > 0;
  const zero = "0.00";
  const cf = n(3, 3);

  const a7 = d(7, 1);
  return {
    inputs: inputs,
    ready: ready,
    rmvDisabled: bikeRmvOff_(snap),
    labelFacility: (a7 && a7.charAt(0) !== "#") ? a7 : "FACILITY AMOUNT",
    vatLabel: d(24, 1) || "VAT",
    exposurePct: cf > 0 ? bikeFmt_(n(7, 3) / cf * 100) + "%" : "",
    ms: t0 ? Date.now() - t0 : null,                 /* server time of this call (shown in the browser console) */
    out: {
      cfValuation:   d(3, 3),
      maxFacility:   d(5, 3),
      facilityAmt:   d(7, 3),
      bic:           d(8, 3),
      insurance:     d(9, 3),
      capitalizedRmv: d(10, 3),
      monthlyRental: ready ? d(13, 3) : zero,
      totCapital:    ready ? d(15, 3) : zero,
      totPaid:       ready ? d(16, 3) : zero,
      totInterest:   ready ? d(17, 3) : zero,
      rate100:       ready ? bikeFmt_(n(13, 3) / (n(7, 3) / 100000)) : zero,
      chargesTotal:  d(19, 3),
      cribCharge:    d(20, 3),
      rmvCharge:     d(21, 3),
      valCharge:     d(22, 3),
      svcCharge:     d(23, 3),
      vat:           d(24, 3)
    }
  };
}

/* BIKE!D21 = YES -> initial RMV charges are already covered; clear and disable B21.
   Capitalised RMV in B10 remains available in Rental Calculation. */
function bikeRmvOff_(snap) {
  return String(snap.D[20][3] || "").trim().toUpperCase() === "YES";
}

/* Clears B21 when D21 = YES (and re-reads, because the results change). */
function bikeEnforceRmv_(s, snap) {
  if (bikeRmvOff_(snap) && String(snap.D[20][1]).trim() !== "") {
    s.getRange("B21").clearContent();
    SpreadsheetApp.flush();
    return bikeSnap_(s);
  }
  return snap;
}


/* ---------- public actions (wired in Api.gs -> dispatch_) ---------- */

function getBike() {
  const t0 = Date.now();
  const s = bikeSheet_();
  var snap = bikeSnap_(s);
  bikeCheckLabels_(snap.D);
  snap = bikeEnforceRmv_(s, snap);
  return bikeRead_(s, snap, null, t0);
}

function setBike(cell, value) {
  const t0 = Date.now();
  if (BIKE_IN_CELLS.indexOf(cell) === -1) throw new Error("Invalid BIKE cell: " + cell);
  if (BIKE_READONLY.indexOf(cell) !== -1) throw new Error(cell + " is read-only.");
  const s = bikeSheet_();
  var snap = bikeSnap_(s);
  bikeCheckLabels_(snap.D);

  const row = parseInt(cell.slice(1), 10);
  var changed = true;

  if (cell === "B21" && bikeRmvOff_(snap)) {
    if (String(snap.D[row - 1][1]).trim() === "") changed = false;
    else s.getRange("B21").clearContent();
  } else {
    const clean = bikeValidate_(s, cell, value, snap);
    const before = String(snap.D[row - 1][1]);

    if (snap.V[row - 1][1] === clean || String(clean) === before) {
      changed = false;                               /* already in the cell: nothing to write or recalculate */
    } else {
      s.getRange(cell).setValue(clean);
      /* dependent dropdowns: a new MAKE invalidates MODEL + YEAR; a new MODEL invalidates YEAR */
      if (cell === "B2") s.getRange("B3:B4").clearContent();
      else if (cell === "B3") s.getRange("B4").clearContent();
    }
  }

  if (changed) {
    SpreadsheetApp.flush();
    snap = bikeEnforceRmv_(s, bikeSnap_(s));
  }

  /* only the dropdown lists that can have changed go back to the app */
  const optCells = !changed ? [] : cell === "B2" ? ["B3", "B4"] : cell === "B3" ? ["B4"] : [];
  return bikeRead_(s, snap, optCells, t0);
}


/* Opening the BIKE tab starts a fresh calculation: clear the Rental Calculation inputs. */
function resetBike() {
  const t0 = Date.now();
  const s = bikeSheet_();
  bikeCheckLayout_(s);
  s.getRange("B7:B12").clearContent();
  SpreadsheetApp.flush();
  const snap = bikeEnforceRmv_(s, bikeSnap_(s));
  return bikeRead_(s, snap, null, t0);
}
