/* MasterCAL Pro — standalone "local backend".
 *
 * A browser-side port of BackEND/Code.gs + BackEND/Bike.gs (+ the dispatch table of Api.gs).
 * Instead of reading/writing a Google Sheet it reads/writes the formula model through the
 * MasterEngine. Every action returns exactly what the Apps Script returned, so FrontEND/app.js
 * runs unchanged (see build_standalone.js: it routes the app's fetch() calls here).
 *
 * KEEP IN STEP with Code.gs / Bike.gs when those change.
 */
(function (root) {
  "use strict";
  const M = root.MasterEngine;
  const { Engine, formatText, isErr, numToCol, colToNum, parseAddr } = M;

  const SHEET_NAME = "CALCULATOR_TEMPLATE";
  const CFG = {
    IN_PRODUCT_TYPE: "D1", IN_MAIN: "D5:D10", IN_SCHEDULE_TYPE: "F1",
    SCHED_FROM: "F3:F14", SCHED_AMOUNT: "H3:H14"
  };
  const BOUND = 1100;                      /* rows read for whole-column dropdown lists */

  function create(model, opts) {
    const eng = new Engine(model, opts);
    const fmts = model.fmts || [];

    /* ------------------------------------------------------------ cells: display + write */
    function fmtOf(sheet, a1) {
      const s = model.sheets[sheet]; if (!s || !s.n) return null;
      const i = s.n[a1]; return i === undefined ? null : fmts[i];
    }
    function normFmt(f) {
      return f.replace(/\[\$([^\]-]*)[^\]]*\]/g, "$1").replace(/\[[A-Za-z]+\d*\]/g, "")
              .replace(/_(.)/g, "").replace(/\*(.)/g, "");
    }
    function general(n) {
      if (Number.isInteger(n)) return String(n);
      return String(parseFloat(n.toPrecision(10)));
    }
    function textFmt(str, fmt) {
      const secs = fmt.split(";"); const sec = secs.length >= 4 ? secs[3] : secs[0];
      let out = "";
      for (let i = 0; i < sec.length; i++) {
        const ch = sec[i];
        if (ch === '"') { const j = sec.indexOf('"', i + 1); out += sec.slice(i + 1, j < 0 ? sec.length : j); i = j < 0 ? sec.length : j; }
        else if (ch === "\\") { out += sec[i + 1] || ""; i++; }
        else if (ch === "@") out += str;
      }
      return out;
    }
    function display(v, fmt) {
      if (v === null || v === undefined) return "";
      if (isErr(v)) return v.code;
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      if (typeof v === "string") return fmt && fmt.indexOf("@") >= 0 ? textFmt(v, normFmt(fmt)) : v;
      if (typeof v === "number") {
        if (!fmt || fmt === "@") return general(v);
        try { return formatText(v, normFmt(fmt)).trim(); } catch (e) { return general(v); }
      }
      return String(v);
    }
    function dispCell(sheet, r, c) {
      const a1 = numToCol(c) + r;
      return display(eng.get(sheet, a1), fmtOf(sheet, a1));
    }
    function colLetters(c) { return numToCol(c); }
    /* like Range.getDisplayValues(): 2-D array of strings; (r1,c1) .. (r2,c2) 1-based */
    function block(sheet, r1, c1, r2, c2) {
      const vals = eng.range(sheet, colLetters(c1) + r1 + ":" + colLetters(c2) + r2), out = [];
      for (let i = 0; i < vals.length; i++) { const row = []; for (let j = 0; j < vals[i].length; j++) { const a1 = colLetters(c1 + j) + (r1 + i); row.push(display(vals[i][j], fmtOf(sheet, a1))); } out.push(row); }
      return out;
    }
    function a1Block(sheet, a1) {
      const [x, y] = a1.split(":"); const p = parseAddr(x), q = parseAddr(y || x);
      return block(sheet, p.r, p.c, q.r, q.c);
    }
    /* Sheets turns typed text into numbers; do the same */
    const NUMRE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
    function coerce(v) {
      if (typeof v === "string") {
        const t = v.trim();
        if (NUMRE.test(t)) return Number(t);
        if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ""));
        return v;
      }
      return v;
    }
    function setValue(sheet, a1, v) { eng.setInput(sheet, a1, v === "" || v == null ? null : coerce(v)); }
    function clear(sheet, a1) {
      const [x, y] = a1.split(":"); const p = parseAddr(x), q = parseAddr(y || x);
      for (let r = p.r; r <= q.r; r++) for (let c = p.c; c <= q.c; c++) eng.setInput(sheet, numToCol(c) + r, null);
    }
    function clearList(sheet, list) { list.forEach(a => clear(sheet, a)); }

    /* ------------------------------------------------------------ dropdown lists (data validation) */
    function inRanges(ranges, a1) {
      const p = parseAddr(a1);
      return ranges.some(rg => {
        const [x, y] = rg.split(":"); const s = parseAddr(x), e = parseAddr(y || x);
        return p.r >= s.r && p.r <= e.r && p.c >= s.c && p.c <= e.c;
      });
    }
    function dvOptions(sheet, a1) {
      const list = (model.sheets[sheet] || {}).dv || [];
      const dv = list.find(d => inRanges(d.r, a1)); if (!dv) return null;
      let f = dv.f.trim();
      if (f.charAt(0) === '"') return f.replace(/^"|"$/g, "").split(",").map(s => s.trim()).filter(s => s !== "");
      let sh = sheet, part = f; const m = /^(?:'((?:[^']|'')+)'|([^!']+))!(.+)$/.exec(f);
      if (m) { sh = (m[1] || m[2]).replace(/''/g, "'"); part = m[3]; }
      part = part.replace(/\$/g, "");
      let r1, c1, r2, c2, mm;
      if ((mm = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(part))) { c1 = colToNum(mm[1].toUpperCase()); r1 = +mm[2]; c2 = colToNum(mm[3].toUpperCase()); r2 = +mm[4]; }
      else if ((mm = /^([A-Z]+):([A-Z]+)$/i.exec(part))) { c1 = colToNum(mm[1].toUpperCase()); r1 = 1; c2 = colToNum(mm[2].toUpperCase()); r2 = BOUND; }
      else if ((mm = /^([A-Z]+)(\d+)$/i.exec(part))) { c1 = c2 = colToNum(mm[1].toUpperCase()); r1 = r2 = +mm[2]; }
      else return null;
      r2 = Math.min(r2, BOUND);
      const flat = []; block(sh, r1, c1, r2, c2).forEach(row => row.forEach(v => flat.push(v)));
      return flat;
    }

    /* ============================================================ 4W  (Code.gs) */
    const sh = SHEET_NAME;
    const BLOCK = "A1:Q28";
    function readBlock(withRs) { return a1Block(sh, withRs ? "A1:Q112" : BLOCK); }
    function fieldOn(v) { return String(v == null ? "" : v).trim().toUpperCase() !== "NO"; }
    function isExpress(v) { return String(v == null ? "" : v).trim().toUpperCase() === "EXPRESS"; }

    function enforceDisabled(b, withRs) {
      let dirty = false;
      const stale = [];
      [[5, "D6"], [6, "D7"], [7, "D8"]].forEach(function (f) {
        const switchOn = fieldOn(b[f[0]][16]);
        const hasValue = String(b[f[0]][3] == null ? "" : b[f[0]][3]).trim() !== "";
        if (!switchOn && hasValue) stale.push(f[1]);
      });
      if (stale.length) { clearList(sh, stale); dirty = true; }
      if (isExpress(b[0][13])) {
        let per = parseFloat(String(b[9][4] == null ? "" : b[9][4]).replace(/,/g, ""));
        if (!(per > 0)) per = 12;
        if (String(b[9][3] == null ? "" : b[9][3]).trim() !== String(per)) { setValue(sh, "D10", per); dirty = true; }
      }
      if (!dirty) return b;
      return readBlock(withRs);
    }

    function outputsLiteFrom(b) {
      return {
        monthlyRental: b[10][4], totalInterest: b[12][4], totalPaid: b[13][4], lastMonthRental: b[14][4],
        lastMonthInterest: b[16][4], lastMonthTotalPaid: b[17][4], bulkAmount: b[15][3], rate100: b[13][12],
        capitalRecoverFirstRental: b[27][5],
        capAmounts: [b[5][4], b[6][4], b[7][4]],
        express: isExpress(b[0][13]),
        enabled: { bic: fieldOn(b[5][16]), insurance: fieldOn(b[6][16]), stampDuty: fieldOn(b[7][16]) },
        charges: b.slice(0, 14).map(r => [r[9], r[10], r[11]])
      };
    }
    function outputsFrom(b) { const o = outputsLiteFrom(b); o.labels = b.slice(4, 10).map(r => r[0]); return o; }
    function scheduleFrom(b) { const rows = []; for (let i = 0; i < 12; i++) rows.push({ from: b[2 + i][5], to: b[2 + i][6], amount: b[2 + i][7] }); return rows; }
    function toColumnFrom(b) { return b.slice(2, 14).map(r => r[6]); }
    function stampDutyFrom(b) { return b.slice(0, 3).map(r => r[15]).filter(String); }
    function rentalScheduleFrom(b) { return b.slice(26, 112).map(r => r.slice(0, 6)); }

    function getRmvTypes() {
      const data = a1Block("Charges", "A2:B30"), out = [];
      for (let i = 0; i < data.length; i++) if (String(data[i][0]).trim().toUpperCase() === "RMV CHARGES" && String(data[i][1]).trim() !== "") out.push(data[i][1]);
      return out;
    }
    function productTypes() {
      return a1Block(sh, "AY3:AY" + BOUND).map(r => r[0]).filter(String);
    }
    function addlChargeCell() {
      const j = a1Block(sh, "J1:J14");
      for (let i = 0; i < j.length; i++) if (/ADDITIONAL\s+SERVICE\s+CHARGE/i.test(String(j[i][0]))) return "L" + (i + 1);
      return "";
    }

    const CELL_NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
    function cellValue(v) {
      if (v == null) return "";
      const s = String(v);
      if (s.length > 200) throw new Error("Value is too long.");
      const t = s.trim();
      if (/^[=+\-@]/.test(t) && t !== "-" && !CELL_NUM_RE.test(t)) throw new Error("Invalid value.");
      return s;
    }

    const A = {};   /* actions */

    A.init = function () {
      clearList(sh, [CFG.IN_PRODUCT_TYPE, CFG.IN_MAIN, CFG.IN_SCHEDULE_TYPE, CFG.SCHED_FROM, CFG.SCHED_AMOUNT].concat(addlChargeCell() || []));
      const b = readBlock(false), stamp = stampDutyFrom(b);
      return { success: true, dropdowns: { productTypes: productTypes(), stampDuty: stamp, rmvTypes: getRmvTypes() },
               stampDuty: stamp, outputs: outputsFrom(b), schedule: scheduleFrom(b) };
    };
    A.getRentalSchedule = function () { return { success: true, rows: a1Block(sh, "A27:F112") }; };
    A.saveProductType = function (pt) {
      setValue(sh, CFG.IN_PRODUCT_TYPE, cellValue(pt));
      clearList(sh, [CFG.SCHED_FROM, CFG.SCHED_AMOUNT]);
      const b = enforceDisabled(readBlock(false), false);
      return { success: true, stampDuty: stampDutyFrom(b), outputs: outputsFrom(b), schedule: scheduleFrom(b) };
    };
    A.calcInputs = function (data) {
      data = data || {};
      const same = {}; (Array.isArray(data.same) ? data.same : []).forEach(k => { same[k] = true; });
      const main = [data.facilityAmount, data.bic, data.insurance, data.stampDuty, data.irr, data.period].map(cellValue);
      if (!same.productType) setValue(sh, CFG.IN_PRODUCT_TYPE, cellValue(data.productType));
      main.forEach((v, i) => setValue(sh, "D" + (5 + i), v));
      if (!same.scheduleType) setValue(sh, CFG.IN_SCHEDULE_TYPE, cellValue(data.scheduleType));
      const withRs = data.withSchedule === true;
      const b = enforceDisabled(readBlock(withRs), withRs);
      const res = { success: true, outputs: outputsFrom(b) };
      if (withRs) res.rentalSchedule = rentalScheduleFrom(b);
      return res;
    };
    A.saveScheduleType = function (st) {
      setValue(sh, CFG.IN_SCHEDULE_TYPE, cellValue(st));
      clearList(sh, [CFG.SCHED_FROM, CFG.SCHED_AMOUNT]);
      const b = readBlock(false);
      return { success: true, outputs: outputsFrom(b), schedule: scheduleFrom(b) };
    };
    function validIndex(index) { const i = Number(index); if (isNaN(i) || i < 0 || i > 11) throw new Error("Invalid schedule row: " + index); return i; }
    function assertNotExpress() { if (isExpress(dispCell(sh, 1, 14))) throw new Error("Bullet payments are not available for Express facilities."); }
    function scheduleReply(b, extra) {
      const out = outputsFrom(b), res = { success: true };
      Object.keys(extra || {}).forEach(k => { res[k] = extra[k]; });
      res.to = toColumnFrom(b); res.monthlyRental = out.monthlyRental; res.outputs = out; res.schedule = scheduleFrom(b);
      return res;
    }
    A.addScheduleRow = function (index, from, amount) {
      const i = validIndex(index); assertNotExpress();
      setValue(sh, "F" + (3 + i), cellValue(from)); setValue(sh, "H" + (3 + i), cellValue(amount));
      const b = readBlock(false);
      return scheduleReply(b, { index: i, from: b[2 + i][5], amount: b[2 + i][7] });
    };
    A.updateScheduleFrom = function (index, value) {
      const i = validIndex(index); assertNotExpress();
      setValue(sh, "F" + (3 + i), cellValue(value));
      const b = readBlock(false);
      return scheduleReply(b, { row: 3 + i, value: b[2 + i][5] });
    };
    A.updateScheduleAmount = function (index, value) {
      const i = validIndex(index); assertNotExpress();
      setValue(sh, "H" + (3 + i), cellValue(value));
      const b = readBlock(false);
      return scheduleReply(b, { row: 3 + i, value: b[2 + i][7] });
    };
    A.deleteScheduleRow = function (index) {
      const i = validIndex(index);
      clear(sh, "F" + (3 + i)); clear(sh, "H" + (3 + i));
      return scheduleReply(readBlock(false), { row: 3 + i });
    };
    A.clearSchedule = function () { clearList(sh, [CFG.SCHED_FROM, CFG.SCHED_AMOUNT]); return scheduleReply(readBlock(false)); };
    A.setRmvType = function (value, cell) {
      const target = (cell === "J13" || cell === "J14") ? cell : "J14";
      setValue(sh, target, cellValue(value));
      return { success: true, outputs: outputsFrom(readBlock(false)) };
    };
    A.setAdditionalCharge = function (value) {
      const cell = addlChargeCell();
      if (!cell) throw new Error("ADDITIONAL SERVICE CHARGES row not found in the sheet.");
      const v = String(value == null ? "" : value).replace(/,/g, "").trim();
      if (v !== "" && !(Number(v) >= 0)) throw new Error("Please enter a valid amount.");
      if (v === "") clear(sh, cell); else setValue(sh, cell, Number(v));
      return { success: true, outputs: outputsFrom(readBlock(false)) };
    };

    /* ============================================================ 3W  (Code.gs) */
    const S3 = "3W";
    const IN_CELLS_3W = ["B2", "B3", "B4", "B5", "B10", "B11", "B12", "B13", "B14", "B15", "B22", "B23"];
    const rmv3WOff = v => String(v == null ? "" : v).trim().toUpperCase() === "YES";
    const snap3W = () => a1Block(S3, "A1:F34");
    function colOptions3W(col) {
      const c = colToNum(col), disp = block(S3, 1, c, BOUND, c), out = [];
      const isE = /^#(N\/A|REF!|DIV\/0!|VALUE!|NUM!|NAME\?|NULL!|ERROR!|CYCLE!)/i;
      for (let i = 0; i < disp.length; i++) { const v = String(disp[i][0]).trim(); if (v !== "" && !isE.test(v) && out.indexOf(v) === -1) out.push(v); }
      return out;
    }
    function dropdown3W(cell) {
      const raw = dvOptions(S3, cell); if (!raw) return null;
      const out = []; raw.forEach(v => { v = String(v).trim(); if (v !== "" && out.indexOf(v) === -1) out.push(v); });
      return out;
    }
    function get3WData(snap, includeOptions) {
      const inputs = {};
      IN_CELLS_3W.forEach(function (c) {
        const row = parseInt(c.slice(1), 10), info = { value: snap[row - 1][1] };
        if (includeOptions) info.options = (c === "B3") ? colOptions3W("D") : dropdown3W(c);
        inputs[c] = info;
      });
      const g = row => snap[row - 1][2] == null ? "" : snap[row - 1][2];
      return {
        inputs, labelFacility: snap[9][0], totalCapPct: snap[5][1], rmvDisabled: rmv3WOff(snap[12][5]),
        out: { cfValuation: g(3), maxFacility: g(5), totCapVal: g(6), facilityAmt: g(10), bic: g(11), insurance: g(12), rmv: g(13),
               monthlyRental: g(15), chargesTotal: g(21), cribCharge: g(22), rmvCharge: g(23), insCharge: g(24), valCharge: g(25),
               svcCharge: g(26), vat: g(27), totCapital: g(30), totPaid: g(31), totInterest: g(32), rate100: g(33), flatRate: g(34) }
      };
    }
    A.get3W = function () { return get3WData(snap3W(), true); };
    A.set3W = function (cell, value) {
      if (IN_CELLS_3W.indexOf(cell) === -1) throw new Error("Invalid 3W cell: " + cell);
      let snap = snap3W();
      const row = parseInt(cell.slice(1), 10), before = String(snap[row - 1][1] == null ? "" : snap[row - 1][1]);
      let changed = false;
      if (cell === "B23" && rmv3WOff(snap[12][5])) {
        if (before.trim() !== "") { clear(S3, "B23"); changed = true; }
      } else {
        const clean = cellValue(value);
        if (before !== clean) { setValue(S3, cell, clean); changed = true; }
      }
      if (changed) {
        snap = snap3W();
        if (rmv3WOff(snap[12][5]) && String(snap[22][1]).trim() !== "") { clear(S3, "B23"); snap = snap3W(); }
      }
      return get3WData(snap, false);
    };
    A.reset3W = function () {
      clearList(S3, ["B10", "B11", "B12", "B13", "B14", "B15"]);
      let snap = snap3W();
      if (rmv3WOff(snap[12][5]) && String(snap[22][1]).trim() !== "") { clear(S3, "B23"); snap = snap3W(); }
      return get3WData(snap, true);
    };

    /* ============================================================ BIKE  (Bike.gs) */
    const SB = "BIKE";
    const BIKE_IN_CELLS = ["B2", "B3", "B4", "B5", "B7", "B8", "B9", "B10", "B11", "B12", "B20", "B21"];
    const BIKE_READONLY = ["B5"];
    const BIKE_SELECT_CELLS = ["B2", "B3", "B4", "B8", "B10", "B21"];
    const BIKE_LABELS = { 2: "MAKE", 3: "MODEL", 4: "YEAR", 5: "EXPOSURE", 7: "FACILITY AMOUNT", 8: "BIC", 9: "INSURANCE", 10: "RMV CHARGES",
      11: "PERIOD", 12: "IRR", 13: "MONTHLY RENTAL", 15: "TOTAL CAPITALIZED", 16: "TOTAL PAID", 17: "TOTAL INTEREST",
      20: "CRIB CHARGES", 21: "RMV CHARGES", 22: "VALUATION CHARGES", 23: "SERVICE CHARGES", 24: "VAT" };
    const bikeSnap = () => ({ D: a1Block(SB, "A1:D24") });
    function bikeCheckLabels(a) {
      Object.keys(BIKE_LABELS).forEach(function (row) {
        const want = BIKE_LABELS[row], got = String(a[row - 1][0]).trim().toUpperCase();
        if (got.charAt(0) === "#") return;
        if (got.indexOf(want) !== 0) throw new Error("The BIKE sheet layout changed: A" + row + " should start with '" + want + "' but is '" + String(a[row - 1][0]).trim() + "'. Please contact the admin.");
      });
    }
    function bikeNum(v) {
      if (typeof v === "number") return isFinite(v) ? v : 0;
      const n = parseFloat(String(v == null ? "" : v).replace(/[,\s%]/g, "")); return isFinite(n) ? n : 0;
    }
    function bikeFmt(n) {
      if (!isFinite(n)) n = 0;
      const parts = Math.abs(n).toFixed(2).split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return (n < 0 ? "-" : "") + parts.join(".");
    }
    function bikeOptions(cell) {
      const raw = dvOptions(SB, cell) || [], skip = { MAKE: 1, MODEL: 1, YEAR: 1 }, out = [];
      raw.forEach(function (v) {
        v = String(v).trim();
        if (v === "" || v.charAt(0) === "#" || skip[v.toUpperCase()] || /^NOTE\s*:/i.test(v)) return;
        if (out.indexOf(v) === -1) out.push(v);
      });
      return out;
    }
    function bikeOptionsFor(cell, snap) {
      const make = String(snap.D[1][1]).trim(), model_ = String(snap.D[2][1]).trim();
      if (cell === "B3" && !make) return [];
      if (cell === "B4" && (!make || !model_)) return [];
      return bikeOptions(cell);
    }
    function bikePickOption(options, raw) {
      for (let i = 0; i < options.length; i++) {
        const o = options[i];
        if (o === raw || (/^\d+(\.\d+)?$/.test(o) && /^\d+(\.\d+)?$/.test(raw) && Number(o) === Number(raw))) return /^\d+(\.\d+)?$/.test(o) ? Number(o) : o;
      }
      return undefined;
    }
    function bikeValidate(cell, value, snap) {
      const raw = (value == null ? "" : String(value)).trim();
      if (raw.length > 100) throw new Error("Value is too long.");
      if (raw === "") return "";
      if (BIKE_SELECT_CELLS.indexOf(cell) !== -1) {
        const picked = bikePickOption(bikeOptionsFor(cell, snap), raw);
        if (picked === undefined) throw new Error("'" + raw + "' is not an allowed value for " + cell + ".");
        return picked;
      }
      if (/^[=+@]/.test(raw) || raw.charAt(0) === "-") throw new Error("Invalid value.");
      const num = Number(raw.replace(/[,\s]/g, "").replace(/%$/, ""));
      if (!isFinite(num) || !/^[\d.,\s]+%?$/.test(raw)) throw new Error("Enter a number.");
      switch (cell) {
        case "B7": case "B9": if (num > 1e10) throw new Error("Amount is too large."); return num;
        case "B11": if (num !== Math.floor(num) || num < 1 || num > 120) throw new Error("Period must be a whole number of months (1–120)."); return num;
        case "B12": if (num < 0 || num > 100) throw new Error("IRR must be between 0 and 100."); return num;
        case "B20": if (num !== Math.floor(num) || num < 0 || num > 50) throw new Error("Crib charges: a whole number (0–50)."); return num;
        default: throw new Error("Invalid BIKE cell: " + cell);
      }
    }
    const bikeRmvOff = snap => String(snap.D[20][3] || "").trim().toUpperCase() === "YES";
    function bikeEnforceRmv(snap) {
      if (bikeRmvOff(snap) && String(snap.D[20][1]).trim() !== "") { clear(SB, "B21"); return bikeSnap(); }
      return snap;
    }
    function bikeRead(snap, optCells) {
      const D = snap.D;
      const d = (row, col) => String(D[row - 1][col - 1] == null ? "" : D[row - 1][col - 1]);
      const n = (row, col) => bikeNum(d(row, col));
      const inputs = {};
      BIKE_IN_CELLS.forEach(function (c) {
        const info = { value: d(parseInt(c.slice(1), 10), 2) };
        if (BIKE_SELECT_CELLS.indexOf(c) === -1) info.options = null;
        else if (!optCells || optCells.indexOf(c) !== -1) info.options = bikeOptionsFor(c, snap);
        inputs[c] = info;
      });
      const ready = n(7, 3) > 0 && n(11, 3) > 0 && n(12, 3) > 0, zero = "0.00", cf = n(3, 3), a7 = d(7, 1);
      return {
        inputs, ready, rmvDisabled: bikeRmvOff(snap),
        labelFacility: (a7 && a7.charAt(0) !== "#") ? a7 : "FACILITY AMOUNT",
        vatLabel: d(24, 1) || "VAT",
        exposurePct: cf > 0 ? bikeFmt(n(7, 3) / cf * 100) + "%" : "",
        ms: null,
        out: {
          cfValuation: d(3, 3), maxFacility: d(5, 3), facilityAmt: d(7, 3), bic: d(8, 3), insurance: d(9, 3), capitalizedRmv: d(10, 3),
          monthlyRental: ready ? d(13, 3) : zero, totCapital: ready ? d(15, 3) : zero, totPaid: ready ? d(16, 3) : zero,
          totInterest: ready ? d(17, 3) : zero, rate100: ready ? bikeFmt(n(13, 3) / (n(7, 3) / 100000)) : zero,
          chargesTotal: d(19, 3), cribCharge: d(20, 3), rmvCharge: d(21, 3), valCharge: d(22, 3), svcCharge: d(23, 3), vat: d(24, 3)
        }
      };
    }
    A.getBike = function () {
      let snap = bikeSnap(); bikeCheckLabels(snap.D); snap = bikeEnforceRmv(snap); return bikeRead(snap, null);
    };
    A.setBike = function (cell, value) {
      if (BIKE_IN_CELLS.indexOf(cell) === -1) throw new Error("Invalid BIKE cell: " + cell);
      if (BIKE_READONLY.indexOf(cell) !== -1) throw new Error(cell + " is read-only.");
      let snap = bikeSnap(); bikeCheckLabels(snap.D);
      const row = parseInt(cell.slice(1), 10); let changed = true;
      if (cell === "B21" && bikeRmvOff(snap)) {
        if (String(snap.D[row - 1][1]).trim() === "") changed = false; else clear(SB, "B21");
      } else {
        const clean = bikeValidate(cell, value, snap), before = String(snap.D[row - 1][1]);
        const same = clean === "" ? before.trim() === ""
          : BIKE_SELECT_CELLS.indexOf(cell) !== -1 ? before === String(clean)
          : before.trim() !== "" && bikeNum(before) === bikeNum(clean);
        if (same || String(clean) === before) changed = false;
        else {
          setValue(SB, cell, clean);
          if (cell === "B2" && (String(snap.D[2][1]).trim() || String(snap.D[3][1]).trim())) clear(SB, "B3:B4");
          else if (cell === "B3" && String(snap.D[3][1]).trim()) clear(SB, "B4");
        }
      }
      if (changed) snap = bikeEnforceRmv(bikeSnap());
      const optCells = !changed ? [] : cell === "B2" ? ["B3", "B4"] : cell === "B3" ? ["B4"] : [];
      return bikeRead(snap, optCells);
    };
    A.resetBike = function () {
      let snap0 = bikeSnap(); bikeCheckLabels(snap0.D);
      clear(SB, "B7:B12");
      return bikeRead(bikeEnforceRmv(bikeSnap()), null);
    };

    /* ============================================================ dispatch */
    const UNAVAILABLE = { checkVehicle: 1, vcIkman: 1, vcGradeYears: 1, sendQuote: 1, syncCopy: 1, login: 1, register: 1 };
    function dispatch(action, args) {
      args = args || [];
      if (UNAVAILABLE[action]) throw new Error("This function is not available in the standalone version.");
      const fn = A[action]; if (!fn) throw new Error("Unknown action: " + action);
      return fn.apply(null, args);
    }
    return { engine: eng, dispatch, display, dispCell, block, a1Block, dvOptions, setValue, clear };
  }

  root.MasterLocal = { create };
})(typeof globalThis !== "undefined" ? globalThis : this);
