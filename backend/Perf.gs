/******************************************************
 * MasterCAL Pro
 * Perf.gs — "⏱ Measure calculation time"  (MASTER sheet menu)
 *
 * Shows WHERE the time of one Vehicle Lease calculation goes, on your
 * real sheet. It makes a TEMPORARY copy of the master (like a new user
 * gets), times each step, then moves the copy to the Drive bin.
 * Nothing in the master or in any user copy is changed.
 *
 * How to read the result
 *   "recalculation (flush)" large  -> the SHEET'S OWN formulas are the
 *       bottleneck (OFFSET / TODAY / the two schedule blocks). Code
 *       cannot make that faster; the sheet has to be lightened.
 *   "open user spreadsheet" large  -> Google's openById is slow (normal
 *       0.3–1 s); nothing to tune in code.
 *   "access check (no cache)" vs "(cached)" -> the saving of the cache.
 *
 * Takes ~1 minute (most of it is making the temporary copy).
 ******************************************************/

function menuTimeCalc_() {
  const ui = SpreadsheetApp.getUi();
  const t = [];
  const lap = function (label, fn) { const t0 = Date.now(); const r = fn(); t.push([label, Date.now() - t0]); return r; };
  var copy = null, saved = CURRENT_SS;

  try {
    const email = adminEmail_();
    if (email) {
      accessCacheClear_(email);
      lap("access check (USERS sheet, no cache)", function () { return checkAccessFast_(email, ""); });
      lap("access check (cached)",                 function () { return checkAccessFast_(email, ""); });
    }

    copy = lap("make temporary copy (one-time per new user)", function () {
      return DriveApp.getFileById(MASTER_ID).makeCopy("MasterCAL TIMING TEST — safe to delete");
    });
    const ss = lap("open user spreadsheet (openById)", function () { return SpreadsheetApp.openById(copy.getId()); });
    CURRENT_SS = ss;

    const sheet = ss.getSheetByName(SHEET_NAME);
    const product = String(sheet.getRange("AY3").getDisplayValue());

    /* the three steps inside one calculation, timed one by one */
    lap("write the inputs", function () {
      sheet.getRange(CFG.IN_PRODUCT_TYPE).setValue(product);
      sheet.getRange(CFG.IN_MAIN).setValues([["1000000"], [""], [""], [""], ["28"], ["48"]]);
      sheet.getRange(CFG.IN_SCHEDULE_TYPE).setValue("");
    });
    lap("recalculation (flush)",   function () { SpreadsheetApp.flush(); });
    lap("read the results (1 call)", function () { return readBlock_(false, sheet); });

    /* whole request, as the web app runs it */
    const data = { productType: product, facilityAmount: "1500000", bic: "", insurance: "", stampDuty: "", irr: "27", period: "36", scheduleType: "" };
    lap("calcInputs() end to end — 1st", function () { return calcInputs(data); });
    data.facilityAmount = "1600000";
    lap("calcInputs() end to end — 2nd", function () { return calcInputs(data); });
    data.withSchedule = true;
    lap("calcInputs() + rental schedule", function () { return calcInputs(data); });
  } catch (e) {
    t.push(["ERROR: " + (e && e.message ? e.message : e), 0]);
  } finally {
    CURRENT_SS = saved;
    try { if (copy) copy.setTrashed(true); } catch (e2) {}
  }

  const lines = t.map(function (r) { return (r[1] / 1000).toFixed(2) + " s   " + r[0]; });
  Logger.log(lines.join("\n"));
  ui.alert("⏱ Calculation time", lines.join("\n") + "\n\n(temporary copy moved to the Drive bin)", ui.ButtonSet.OK);
}
