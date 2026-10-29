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
 *   B10 PERIOD      (months)
 *   B11 IRR         (percent, e.g. 28)
 *   B19 CRIB CHARGES (quantity)
 *   B20 RMV CHARGES dropdown  (KEY!Y:Y)
 *   C3 CF valuation, C5 max facility, C7 facility, C8 BIC amount,
 *   C9 insurance, C12 MONTHLY RENTAL, C14 total capitalized,
 *   C15 total paid, C16 total interest, C18 initial charges total,
 *   C19..C23 crib / RMV / valuation / service / VAT
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

const BIKE_IN_CELLS     = ["B2", "B3", "B4", "B5", "B7", "B8", "B9", "B10", "B11", "B19", "B20"];
const BIKE_READONLY    = ["B5"];   /* exposure: shown only, like the 3W tab */
const BIKE_SELECT_CELLS = ["B2", "B3", "B4", "B8", "B20"];

/* row -> what the A-column label must start with (upper-case) */
const BIKE_LABELS = {
  2: "MAKE", 3: "MODEL", 4: "YEAR", 5: "EXPOSURE", 7: "FACILITY AMOUNT", 8: "BIC",
  9: "INSURANCE", 10: "PERIOD", 11: "IRR", 12: "MONTHLY RENTAL",
  14: "TOTAL CAPITALIZED", 15: "TOTAL PAID", 16: "TOTAL INTEREST",
  19: "CRIB CHARGES", 20: "RMV CHARGES", 21: "VALUATION CHARGES",
  22: "SERVICE CHARGES", 23: "VAT"
};


/* ---------- helpers ---------- */

function bikeSheet_() {
  const s = ssActive_().getSheetByName(BIKE_SHEET);
  if (!s) throw new Error("Bike sheet not found in your copy. Ask the admin to refresh the user copies.");
  return s;
}

function bikeCheckLayout_(s) {
  const a = s.getRange(1, 1, 23, 1).getDisplayValues();
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
function bikeValidate_(s, cell, value) {
  const raw = (value == null ? "" : String(value)).trim();
  if (raw.length > 100) throw new Error("Value is too long.");
  if (raw === "") return "";

  if (BIKE_SELECT_CELLS.indexOf(cell) !== -1) {
    const picked = bikePickOption_(bikeOptions_(s.getRange(cell)), raw);
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
    case "B10":
      if (num !== Math.floor(num) || num < 1 || num > 120) throw new Error("Period must be a whole number of months (1–120).");
      return num;
    case "B11":                                    /* percent number, e.g. 28 */
      if (num < 0 || num > 100) throw new Error("IRR must be between 0 and 100.");
      return num;
    case "B19":
      if (num !== Math.floor(num) || num < 0 || num > 50) throw new Error("Crib charges: a whole number (0–50).");
      return num;
    default:
      throw new Error("Invalid BIKE cell: " + cell);
  }
}


/* ---------- read ---------- */

function bikeRead_(s) {
  bikeCheckLayout_(s);
  const rng = s.getRange(1, 1, 23, 3);
  const D = rng.getDisplayValues(), V = rng.getValues();
  const d = function (row, col) { return String(D[row - 1][col - 1] == null ? "" : D[row - 1][col - 1]); };
  const n = function (row, col) { return bikeNum_(V[row - 1][col - 1]); };

  const inputs = {};
  BIKE_IN_CELLS.forEach(function (c) {
    inputs[c] = {
      value:   d(parseInt(c.slice(1), 10), 2),
      options: BIKE_SELECT_CELLS.indexOf(c) !== -1 ? bikeOptions_(s.getRange(c)) : null
    };
  });

  /* The sheet gives a rental even with empty inputs (it adds a fixed amount),
     so only show results once facility, period and IRR are all entered. */
  const ready = n(7, 3) > 0 && n(10, 3) > 0 && n(11, 3) > 0;
  const zero = "0.00";
  const cf = n(3, 3);

  const a7 = d(7, 1);
  return {
    inputs: inputs,
    ready: ready,
    labelFacility: (a7 && a7.charAt(0) !== "#") ? a7 : "FACILITY AMOUNT",
    vatLabel: d(23, 1) || "VAT",
    exposurePct: cf > 0 ? bikeFmt_(n(7, 3) / cf * 100) + "%" : "",
    out: {
      cfValuation:   d(3, 3),
      maxFacility:   d(5, 3),
      facilityAmt:   d(7, 3),
      bic:           d(8, 3),
      insurance:     d(9, 3),
      monthlyRental: ready ? d(12, 3) : zero,
      totCapital:    ready ? d(14, 3) : zero,
      totPaid:       ready ? d(15, 3) : zero,
      totInterest:   ready ? d(16, 3) : zero,
      rate100:       ready ? bikeFmt_(n(12, 3) / (n(7, 3) / 100000)) : zero,
      chargesTotal:  d(18, 3),
      cribCharge:    d(19, 3),
      rmvCharge:     d(20, 3),
      valCharge:     d(21, 3),
      svcCharge:     d(22, 3),
      vat:           d(23, 3)
    }
  };
}


/* ---------- public actions (wired in Api.gs -> dispatch_) ---------- */

function getBike() {
  return bikeRead_(bikeSheet_());
}

function setBike(cell, value) {
  if (BIKE_IN_CELLS.indexOf(cell) === -1) throw new Error("Invalid BIKE cell: " + cell);
  if (BIKE_READONLY.indexOf(cell) !== -1) throw new Error(cell + " is read-only.");
  const s = bikeSheet_();
  bikeCheckLayout_(s);

  const clean = bikeValidate_(s, cell, value);
  const before = String(s.getRange(cell).getDisplayValue());
  s.getRange(cell).setValue(clean);

  /* dependent dropdowns: a new MAKE invalidates MODEL + YEAR; a new MODEL invalidates YEAR */
  if (String(clean) !== before) {
    if (cell === "B2") s.getRange("B3:B4").clearContent();
    else if (cell === "B3") s.getRange("B4").clearContent();
  }
  SpreadsheetApp.flush();
  return bikeRead_(s);
}


/* Opening the BIKE tab starts a fresh calculation: clear the Rental Calculation inputs. */
function resetBike() {
  const s = bikeSheet_();
  bikeCheckLayout_(s);
  s.getRange("B7:B11").clearContent();
  SpreadsheetApp.flush();
  return bikeRead_(s);
}


/* ---------- admin check (sheet menu) ---------- */

function menuCheckBikeSheet_() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const problems = [], info = [];

  const s = ss.getSheetByName(BIKE_SHEET);
  if (!s) { ui.alert("BIKE check", "❌ No '" + BIKE_SHEET + "' tab in this spreadsheet.", ui.ButtonSet.OK); return; }

  try { bikeCheckLayout_(s); info.push("Layout (labels in column A) is as the app expects."); }
  catch (e) { problems.push(e.message); }

  const out = s.getRange(1, 3, 23, 1).getDisplayValues();
  const errs = [];
  for (var i = 0; i < out.length; i++) {
    if (/^#(N\/A|REF!|VALUE!|NUM!|NAME\?|NULL!|ERROR!)/i.test(String(out[i][0]))) errs.push("C" + (i + 1));
  }
  if (errs.length) problems.push("Result cells with errors: " + errs.join(", "));

  BIKE_SELECT_CELLS.forEach(function (c) {
    const o = bikeOptions_(s.getRange(c));
    if (!o.length) {
      if (c === "B3" || c === "B4") info.push(c + " has no options until the parent dropdown is chosen (normal when empty).");
      else problems.push(c + " has no dropdown options.");
    } else info.push(c + ": " + o.length + " option(s).");
  });

  const need = [["Charges", "C20"], ["PRODUCT PROFILE", "O6"], ["CALCULATOR_TEMPLATE", "AR1"], ["KEY", "Y1"]];
  need.forEach(function (p) {
    const sh = ss.getSheetByName(p[0]);
    if (!sh) problems.push("Tab '" + p[0] + "' (used by BIKE) is missing.");
  });

  const text = (problems.length ? "❌ PROBLEMS\n • " + problems.join("\n • ") + "\n\n" : "✅ No problems found.\n\n") +
               "ℹ️ INFO\n • " + info.join("\n • ");
  Logger.log(text);
  ui.alert("BIKE check", text, ui.ButtonSet.OK);
}
