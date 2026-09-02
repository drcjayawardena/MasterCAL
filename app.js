/* =========================================================
   MasterCAL Pro — app.js (PWA front end)
   Calls the Apps Script JSON API via fetch().
   The Google Sheet still performs all calculations.
========================================================= */


/* =========================================================
   >>> SET THIS <<<
   Paste your Apps Script Web App URL (ends with /exec).
   It must be deployed as: Execute as = Me,
   Who has access = Anyone.
========================================================= */

const API_URL =
  "https://script.google.com/macros/s/AKfycbzgi6Deu62PbH8oD8KI_5Elf7GIma7BwqOmJtPIb62Dp4f-7hTJ0teUx1La1T8uiD0X/exec";


/* =========================================================
   API HELPER
   Uses text/plain body to stay a "simple" CORS request
   (no preflight) so Apps Script can respond.
========================================================= */

/* localStorage with in-memory fallback (iOS private mode throws). */
var _mem = {};
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return (k in _mem) ? _mem[k] : null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { _mem[k] = v; } }

/* Per-user identity — each user gets their own isolated Sheet copy. */
function getUserId() {
  let id = lsGet("mastercal_uid");
  if (!id) {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "u" + Date.now() + Math.random().toString(36).slice(2);
    lsSet("mastercal_uid", id);
  }
  return id;
}

function getEmail() { return lsGet("mastercal_email") || ""; }
function getName()  { return lsGet("mastercal_name")  || ""; }
function setIdentity(email, name) {
  lsSet("mastercal_email", email);
  lsSet("mastercal_name", name || "");
}


/* =========================================================
   BUSY INDICATORS
========================================================= */

function showLoading(msg) {
  const el = document.getElementById("loading");
  const t = document.getElementById("loadingText");
  if (t && msg) t.textContent = msg;
  if (el) el.style.display = "flex";
}
function hideLoading() {
  const el = document.getElementById("loading");
  if (el) el.style.display = "none";
}

let calcBusy = 0;
function calcStart() { calcBusy++; updateCalcUI(); }
function calcEnd()   { calcBusy = Math.max(0, calcBusy - 1); updateCalcUI(); }
function updateCalcUI() {
  const box = document.querySelector(".summary .bigValue");
  if (!box) return;
  if (calcBusy > 0) box.classList.add("calculating");
  else box.classList.remove("calculating");
}


async function api(action, args) {

  const isCalc = (action !== "init");   /* show the calculating spinner for calc actions */
  if (isCalc) calcStart();

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: action, args: args || [],
        userId: getUserId(), email: getEmail(), name: getName()
      }),
      redirect: "follow"
    });

    if (!res.ok) {
      throw new Error("Network error " + res.status);
    }

    const json = await res.json();

    if (!json || json.ok !== true) {
      const e = new Error((json && json.error) || "API error");
      if (json && json.access) e.access = json.access;   /* PENDING / BLOCKED / NO_EMAIL */
      throw e;
    }

    return json.data;

  } finally {
    if (isCalc) calcEnd();
  }
}


/* =========================================================
   OFFLINE INDICATOR
========================================================= */

function updateOnlineStatus() {
  const bar = document.getElementById("offlineBar");
  if (!bar) return;
  if (navigator.onLine) bar.classList.remove("show");
  else bar.classList.add("show");
}

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);


/* =========================================================
   STATE
========================================================= */

let saveTimer = null;
let scheduleBusy = false;


/* =========================================================
   INIT
========================================================= */

document.addEventListener("DOMContentLoaded", init);

function init() {

  updateOnlineStatus();

  bindInputs();
  setupBulletPaymentButton();
  setupRentalScheduleToggle();

  /* Gate: need an email before doing anything. */
  if (!getEmail()) { showRegister(); return; }

  loadApp();
}

function loadApp() {

  hideGate();
  showLoading("Loading…");

  /* One round trip: clear + dropdowns + outputs + schedule. */
  api("init")
    .then(function (result) {

      hideLoading();

      if (!result) return;

      if (result.dropdowns) {
        fillSelect("productType", result.dropdowns.productTypes || []);
        fillSelect("stampDuty",
          (result.stampDuty || result.dropdowns.stampDuty) || []);
        RMV_TYPES = result.dropdowns.rmvTypes || RMV_TYPES;
      }

      if (result.outputs) showOutputs(result.outputs);

      drawSchedule(result.schedule || []);
      hideRentalSchedule();
    })
    .catch(function (error) {
      hideLoading();
      if (error.access) { showGate(error.access); return; }
      console.error("OPEN ERROR:", error);
      hideRentalSchedule();
      alert("Could not load the calculator.\n\n" + error.message);
    });
}


/* =========================================================
   ACCESS GATE  (register / pending / blocked)
========================================================= */

function gateEl() { return document.getElementById("gate"); }
function gateBody() { return document.getElementById("gateBody"); }

function hideGate() { const g = gateEl(); if (g) g.style.display = "none"; }

function showRegister() {
  const g = gateEl(); if (!g) return;
  g.style.display = "flex";
  gateBody().innerHTML =
    '<h2>Request Access</h2>' +
    '<p>App එක පාවිච්චි කරන්න, ඔයාගේ email එක දාලා access request කරන්න. ' +
    'Admin approve කරාට පස්සේ පාවිච්චි කරන්න පුළුවන්.</p>' +
    '<input id="gateName" type="text" placeholder="Your name">' +
    '<input id="gateEmail" type="email" placeholder="Your email">' +
    '<button id="gateSubmit" class="gateBtn">Request Access</button>' +
    '<div id="gateErr" class="gateErr"></div>';
  document.getElementById("gateSubmit").addEventListener("click", submitRegister);
}

function submitRegister() {
  const email = (document.getElementById("gateEmail").value || "").trim();
  const name  = (document.getElementById("gateName").value || "").trim();
  const err   = document.getElementById("gateErr");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    err.textContent = "හරි email එකක් දාන්න.";
    return;
  }
  setIdentity(email.toLowerCase(), name);
  err.textContent = "";
  loadApp();   /* backend registers as PENDING and returns the status */
}

function showGate(status) {
  const g = gateEl(); if (!g) return;
  g.style.display = "flex";

  if (status === "NO_EMAIL") { showRegister(); return; }

  if (status === "BLOCKED") {
    gateBody().innerHTML =
      '<h2>Access Denied</h2>' +
      '<p>ඔයාගේ access එක block කරලා. Admin එක්ක කතා කරන්න.</p>' +
      '<div class="gateMuted">' + escapeHtml(getEmail()) + '</div>';
    return;
  }

  /* PENDING (default) */
  gateBody().innerHTML =
    '<h2>Approval Pending ⏳</h2>' +
    '<p>ඔයාගේ request එක admin approval එකට යවලා.<br>' +
    'Approve වුණාට පස්සේ පහළ button එක click කරන්න.</p>' +
    '<div class="gateMuted">' + escapeHtml(getEmail()) + '</div>' +
    '<button id="gateRetry" class="gateBtn">Check again</button>' +
    '<button id="gateSwitch" class="gateBtnLink">Use a different email</button>';
  document.getElementById("gateRetry").addEventListener("click", loadApp);
  document.getElementById("gateSwitch").addEventListener("click", function () {
    setIdentity("", "");
    showRegister();
  });
}


/* =========================================================
   BULLET PAYMENT OPTION BUTTON
========================================================= */

function setupBulletPaymentButton() {

  const facility = document.querySelector(".facility");
  if (!facility) return;

  const oldButton = document.getElementById("addBulletPaymentButton");
  if (oldButton) oldButton.remove();

  const oldWrapper = document.querySelector(".facilityBulletButtonWrapper");
  if (oldWrapper) oldWrapper.remove();

  const wrapper = document.createElement("div");
  wrapper.className = "facilityBulletButtonWrapper";

  const button = document.createElement("button");
  button.type = "button";
  button.id = "addBulletPaymentButton";
  button.className = "addBulletPaymentButton";
  button.textContent = "ADD BULLET PAYMENT";

  button.addEventListener("click", function () {
    const card = document.getElementById("scheduleCard");
    if (!card) return;
    const hidden = window.getComputedStyle(card).display === "none";
    if (hidden) showScheduleCard();
    else hideScheduleCard();
  });

  wrapper.appendChild(button);
  facility.appendChild(wrapper);

  hideScheduleCard();
}


function showScheduleCard() {

  const card = document.getElementById("scheduleCard");
  const main = document.querySelector(".main");
  const button = document.getElementById("addBulletPaymentButton");
  if (!card || !main) return;

  card.style.display = "";
  main.classList.remove("schedule-hidden");
  if (button) button.textContent = "HIDE BULLET PAYMENT";

  const body = document.getElementById("scheduleBody");
  if (body && body.children.length === 0) drawSchedule([]);
}


function hideScheduleCard() {

  const card = document.getElementById("scheduleCard");
  const main = document.querySelector(".main");
  const button = document.getElementById("addBulletPaymentButton");
  if (!card || !main) return;

  card.style.display = "none";
  main.classList.add("schedule-hidden");
  if (button) button.textContent = "ADD BULLET PAYMENT";
}


/* =========================================================
   INPUTS
========================================================= */

function bindInputs() {

  const ids = ["facilityAmount", "bic", "insurance", "stampDuty", "irr", "period"];

  ids.forEach(function (id) {
    const element = document.getElementById(id);
    if (!element) return;

    element.addEventListener("input", function () {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveInputs, 550);
    });

    element.addEventListener("change", function () {
      clearTimeout(saveTimer);
      saveInputs();
    });
  });

  const product = document.getElementById("productType");
  if (product) {
    product.addEventListener("change", function () {
      saveProductType(this.value);
    });
  }

  const scheduleType = document.getElementById("scheduleType");
  if (scheduleType) {
    scheduleType.addEventListener("change", function () {
      saveScheduleType(this.value);
    });
  }
}


function collectInputData() {
  return {
    productType:    value("productType"),
    facilityAmount: value("facilityAmount"),
    bic:            value("bic"),
    insurance:      value("insurance"),
    stampDuty:      value("stampDuty"),
    irr:            value("irr"),
    period:         value("period"),
    scheduleType:   value("scheduleType")
  };
}


/* =========================================================
   SAVE NORMAL INPUTS
========================================================= */

function saveInputs() {

  const data = collectInputData();

  /* calcInputs = lighter/faster (returns only outputs). */
  api("calcInputs", [data])
    .then(function (result) {
      if (!result) return;
      if (result.outputs) showOutputs(result.outputs);
      if (isRentalScheduleVisible()) loadRentalSchedule();
    })
    .catch(function (error) {
      console.error("SAVE INPUTS ERROR:", error);
    });
}


/* =========================================================
   PRODUCT TYPE
========================================================= */

function saveProductType(productType) {

  const el = document.getElementById("productType");
  if (el) el.disabled = true;

  api("saveProductType", [String(productType)])
    .then(function (result) {
      if (!result) return;
      if (result.outputs) showOutputs(result.outputs);
      if (result.stampDuty) fillSelect("stampDuty", result.stampDuty);
      drawSchedule(result.schedule || []);
      if (isRentalScheduleVisible()) loadRentalSchedule();
      if (el) el.disabled = false;
    })
    .catch(function (error) {
      console.error("PRODUCT TYPE ERROR:", error);
      alert("Product Type could not be changed.\n\n" + error.message);
      if (el) el.disabled = false;
    });
}


/* =========================================================
   SCHEDULE TYPE
   (Server saves F1 through saveInputs, same as original.)
========================================================= */

function saveScheduleType(scheduleType) {

  const select = document.getElementById("scheduleType");
  if (select) select.disabled = true;

  applyScheduleMode();   /* instant show/hide of the TO column */

  const data = collectInputData();
  data.scheduleType = scheduleType;

  api("saveInputs", [data])
    .then(function (result) {
      if (!result) return;
      if (result.outputs) showOutputs(result.outputs);
      drawSchedule(result.schedule || []);
      if (isRentalScheduleVisible()) loadRentalSchedule();
      if (select) select.disabled = false;
    })
    .catch(function (error) {
      console.error("SCHEDULE TYPE ERROR:", error);
      alert("Schedule Type could not be changed.\n\n" + error.message);
      if (select) select.disabled = false;
    });
}


/* =========================================================
   DROPDOWNS
========================================================= */

function fillSelect(id, list) {

  const select = document.getElementById(id);
  if (!select) return;

  const previous = select.value;

  select.innerHTML = "";

  (list || []).forEach(function (item) {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    select.appendChild(option);
  });

  /* Preserve current selection if still present. */
  if (previous) {
    const match = Array.prototype.slice.call(select.options)
      .some(function (o) { return o.value === previous; });
    if (match) select.value = previous;
  }
}


/* =========================================================
   OUTPUTS
========================================================= */

function showOutputs(result) {

  if (!result) return;

  text("monthlyRental",      result.monthlyRental);
  text("totalInterest",      result.totalInterest);
  text("totalPaid",          result.totalPaid);
  text("lastMonthRental",    result.lastMonthRental);
  text("bulkAmount",         result.bulkAmount);
  text("lastMonthInterest",  result.lastMonthInterest);
  text("lastMonthTotalPaid", result.lastMonthTotalPaid);
  text("rate100",            result.rate100);

  if (result.labels) applyLabels(result.labels);
  if (result.charges) renderCharges(result.charges);
}


/* Charges breakdown from J1:L14 (rows: [J label, K sub, L amount]). */
var RMV_TYPES = [];
/* grid index -> sheet cell for the editable RMV-type dropdowns */
const RMV_CELLS = { 12: "J13", 13: "J14" };   /* J13 + J14 */
const HIDE_ROW_INDEX = 2;   /* grid index 2  = sheet row 3  = J3 (hidden) */

function renderCharges(grid) {
  if (!Array.isArray(grid) || !grid.length) return;

  /* Total = L1 (row 1, col 3). */
  text("chargesTotal", (grid[0] && grid[0][2]) ? grid[0][2] : "0.00");

  const body = document.getElementById("chargesBody");
  if (!body) return;
  body.innerHTML = "";

  /* Line items: rows 3..14 (index 2..13). */
  for (let i = 2; i < grid.length; i++) {
    if (i === HIDE_ROW_INDEX) continue;   /* J3 — hidden per request */
    const row = grid[i] || [];
    let label = String(row[0] == null ? "" : row[0]).trim();
    const sub = String(row[1] == null ? "" : row[1]).trim();
    const amount = String(row[2] == null ? "" : row[2]).trim();

    if (label === "" && amount === "") continue;      /* skip empty rows */

    /* Hide these subtotal/header rows from the card. */
    const norm = label.replace(/\s+/g, " ").toUpperCase();
    if (!RMV_CELLS[i] &&
        (norm === "DOCUMENTATION CHARGES WITH STAMP DUTY" || norm === "RMV CHARGES")) {
      continue;
    }

    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    const td2 = document.createElement("td");
    td2.textContent = amount;

    if (RMV_CELLS[i] && RMV_TYPES.length) {
      /* RMV type = editable dropdown (J13 / J14). */
      const cell = RMV_CELLS[i];
      const sel = document.createElement("select");
      sel.className = "chargesSelect";
      RMV_TYPES.forEach(function (opt) {
        const o = document.createElement("option");
        o.value = opt; o.textContent = opt;
        sel.appendChild(o);
      });
      sel.value = String(row[0] || "");
      sel.addEventListener("change", function () { setRmvTypeUI(this.value, cell); });
      td1.appendChild(sel);
    } else {
      if (sub !== "") label += "  (" + sub + ")";      /* e.g. CRIB SCORE (3.00) */
      td1.textContent = label;
    }

    tr.appendChild(td1);
    tr.appendChild(td2);
    body.appendChild(tr);
  }
}

function setRmvTypeUI(value, cell) {
  api("setRmvType", [value, cell])
    .then(function (r) { if (r && r.outputs) showOutputs(r.outputs); })
    .catch(function (e) {
      console.error("RMV ERROR:", e);
      alert("RMV type could not be saved.\n\n" + e.message);
    });
}


/* Dynamic field labels from the sheet (A5:A10). */
function applyLabels(labels) {
  const ids = [
    "lblFacilityAmount", /* A5 */
    "lblBic",            /* A6 */
    "lblInsurance",      /* A7 */
    "lblStampDuty",      /* A8 */
    "lblIrr",            /* A9 */
    "lblPeriod"          /* A10 */
  ];
  ids.forEach(function (id, i) {
    const el = document.getElementById(id);
    const val = labels[i];
    /* Skip empty or sheet-error values -> keep the default label. */
    if (el && val != null && String(val).trim() !== "" && !isSheetError(val)) {
      el.textContent = val;
    }
  });
}

function isSheetError(s) {
  return /^#(N\/A|REF!|DIV\/0!|VALUE!|NUM!|NAME\?|NULL!|ERROR!|CYCLE!)/i
    .test(String(s).trim());
}


/* =========================================================
   DRAW BULLET SCHEDULE
========================================================= */

function drawSchedule(rows) {

  const body = document.getElementById("scheduleBody");
  if (!body) return;

  body.innerHTML = "";

  const data = rows || [];

  let lastUsed = -1;

  data.forEach(function (row, index) {
    const from = String(row.from || "").trim();
    const amount = String(row.amount || "").trim();
    if (from !== "" || amount !== "") lastUsed = index;
  });

  let displayCount = lastUsed < 0 ? 1 : lastUsed + 2;
  displayCount = Math.min(displayCount, 12);

  for (let i = 0; i < displayCount; i++) {

    const row = data[i] || { from: "", to: "", amount: "" };

    const hasData =
      String(row.from || "").trim() !== "" ||
      String(row.amount || "").trim() !== "";

    body.insertAdjacentHTML("beforeend", createScheduleRow(i, row, hasData));
  }

  body.querySelectorAll("tr[data-index]").forEach(function (row) {
    bindScheduleRowEvents(row);
  });

  applyScheduleMode();
}


/* =========================================================
   SCHEDULE MODE — show the "TO" column only for
   SLABBED SCHEDULE; hide it for MANUAL SCHEDULE.
========================================================= */

function applyScheduleMode() {
  const table = document.getElementById("scheduleTable");
  if (!table) return;
  const type = String(value("scheduleType") || "").toUpperCase();
  const isSlabbed = type.indexOf("SLAB") !== -1;
  table.classList.toggle("hide-to", !isSlabbed);
}


function createScheduleRow(index, row, hasData) {

  const buttonText = hasData ? "DELETE" : "ADD";
  const buttonClass = hasData ? "scheduleAction delete" : "scheduleAction";
  const action = hasData
    ? "deleteScheduleRowUI(" + index + ")"
    : "addScheduleRowUI(" + index + ")";

  return `
    <tr data-index="${index}">
      <td>
        <input type="number" inputmode="numeric"
          id="scheduleFrom_${index}"
          value="${escapeHtml(row.from)}"
          data-index="${index}" data-type="from">
      </td>
      <td>
        <input type="text" value="${escapeHtml(row.to)}" readonly>
      </td>
      <td>
        <div class="scheduleAmountCell">
          <input type="number" inputmode="decimal"
            id="scheduleAmount_${index}"
            value="${escapeHtml(row.amount)}"
            data-index="${index}" data-type="amount">
          <button type="button" class="${buttonClass}" onclick="${action}">
            ${buttonText}
          </button>
        </div>
      </td>
    </tr>
  `;
}


function bindScheduleRowEvents(row) {

  if (!row) return;

  const fromInput = row.querySelector('input[data-type="from"]');
  if (fromInput) {
    fromInput.addEventListener("blur", function () {
      updateFrom(Number(this.dataset.index), this.value);
    });
    fromInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        updateFrom(Number(this.dataset.index), this.value);
      }
    });
  }

  const amountInput = row.querySelector('input[data-type="amount"]');
  if (amountInput) {
    amountInput.addEventListener("blur", function () {
      updateAmount(Number(this.dataset.index), this.value);
    });
    amountInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        updateAmount(Number(this.dataset.index), this.value);
      }
    });
  }
}


/* =========================================================
   ADD BULLET ROW
========================================================= */

function addScheduleRowUI(index) {

  if (scheduleBusy) return;

  const row = document.querySelector('#scheduleBody tr[data-index="' + index + '"]');
  if (!row) return;

  const fromInput = row.querySelector('input[data-type="from"]');
  const amountInput = row.querySelector('input[data-type="amount"]');
  if (!fromInput || !amountInput) return;

  const fromValue = fromInput.value;
  const amountValue = amountInput.value;

  if (fromValue === "" && amountValue === "") {
    fromInput.focus();
    return;
  }

  scheduleBusy = true;

  api("addScheduleRow", [Number(index), fromValue, amountValue])
    .then(function (result) {

      scheduleBusy = false;
      if (!result) return;

      fromInput.value = fromValue;
      amountInput.value = amountValue;

      if (result.to && result.to[index] !== undefined) {
        const toInput = row.querySelector("td:nth-child(2) input");
        if (toInput) toInput.value = result.to[index] || "";
      }

      if (result.monthlyRental !== undefined) {
        text("monthlyRental", result.monthlyRental);
      }
      if (result.outputs) showOutputs(result.outputs);

      const button = row.querySelector(".scheduleAction");
      if (button) {
        button.textContent = "DELETE";
        button.classList.add("delete");
        button.onclick = function () { deleteScheduleRowUI(Number(index)); };
      }

      addNextEmptyScheduleRow(Number(index));
    })
    .catch(function (error) {
      scheduleBusy = false;
      console.error("ADD ERROR:", error);
      alert("Bullet Payment could not be saved.\n\n" + error.message);
    });
}


function addNextEmptyScheduleRow(index) {

  const body = document.getElementById("scheduleBody");
  if (!body) return;

  const nextIndex = Number(index) + 1;
  if (nextIndex >= 12) return;

  const existing = body.querySelector('tr[data-index="' + nextIndex + '"]');
  if (existing) return;

  const tr = document.createElement("tr");
  tr.setAttribute("data-index", String(nextIndex));

  tr.innerHTML = `
    <td>
      <input type="number" inputmode="numeric"
        data-index="${nextIndex}" data-type="from" value="">
    </td>
    <td>
      <input type="text" value="" readonly>
    </td>
    <td>
      <div class="scheduleAmountCell">
        <input type="number" inputmode="decimal"
          data-index="${nextIndex}" data-type="amount" value="">
        <button type="button" class="scheduleAction"
          onclick="addScheduleRowUI(${nextIndex})">ADD</button>
      </div>
    </td>
  `;

  body.appendChild(tr);
  bindScheduleRowEvents(tr);
}


/* =========================================================
   DELETE BULLET ROW
========================================================= */

function deleteScheduleRowUI(index) {

  if (scheduleBusy) return;

  const row = document.querySelector('#scheduleBody tr[data-index="' + index + '"]');
  if (!row) return;

  scheduleBusy = true;

  api("deleteScheduleRow", [Number(index)])
    .then(function (result) {

      scheduleBusy = false;
      if (!result) return;

      row.remove();

      if (result.monthlyRental !== undefined) {
        text("monthlyRental", result.monthlyRental);
      }
      if (result.outputs) showOutputs(result.outputs);
      if (result.to) updateAllToValues(result.to);

      ensureAddRow();
    })
    .catch(function (error) {
      scheduleBusy = false;
      console.error("DELETE ERROR:", error);
      alert("Bullet Payment could not be deleted.\n\n" + error.message);
    });
}


/* =========================================================
   UPDATE FROM / AMOUNT
========================================================= */

function updateFrom(index, newValue) {

  api("updateScheduleFrom", [
    Number(index),
    newValue === null || newValue === undefined ? "" : String(newValue)
  ])
    .then(function (result) {
      if (!result) return;
      if (result.monthlyRental !== undefined) text("monthlyRental", result.monthlyRental);
      if (result.outputs) showOutputs(result.outputs);
      if (result.to) updateAllToValues(result.to);
    })
    .catch(function (error) {
      console.error("FROM ERROR:", error);
      alert("FROM could not be saved.\n\n" + error.message);
    });
}


function updateAmount(index, newValue) {

  api("updateScheduleAmount", [
    Number(index),
    newValue === null || newValue === undefined ? "" : String(newValue)
  ])
    .then(function (result) {
      if (!result) return;
      if (result.monthlyRental !== undefined) text("monthlyRental", result.monthlyRental);
      if (result.outputs) showOutputs(result.outputs);
      if (result.to) updateAllToValues(result.to);
    })
    .catch(function (error) {
      console.error("AMOUNT ERROR:", error);
      alert("Amount could not be saved.\n\n" + error.message);
    });
}


function updateAllToValues(toValues) {

  if (!toValues) return;

  Object.keys(toValues).forEach(function (index) {
    const row = document.querySelector('#scheduleBody tr[data-index="' + index + '"]');
    if (!row) return;
    const toInput = row.querySelector("td:nth-child(2) input");
    if (toInput) toInput.value = toValues[index] || "";
  });
}


function ensureAddRow() {

  const body = document.getElementById("scheduleBody");
  if (!body) return;

  const rows = body.querySelectorAll("tr[data-index]");
  if (!rows.length) { drawSchedule([]); return; }

  let lastIndex = -1;
  rows.forEach(function (row) {
    const index = Number(row.dataset.index);
    if (index > lastIndex) lastIndex = index;
  });

  const lastRow = body.querySelector('tr[data-index="' + lastIndex + '"]');
  if (!lastRow) return;

  const from = lastRow.querySelector('input[data-type="from"]');
  const amount = lastRow.querySelector('input[data-type="amount"]');
  if (!from || !amount) return;

  const hasValue =
    String(from.value || "").trim() !== "" ||
    String(amount.value || "").trim() !== "";

  if (hasValue) addNextEmptyScheduleRow(lastIndex);
}


/* =========================================================
   CLEAR SCHEDULE
========================================================= */

function clearScheduleUI() {

  api("clearSchedule")
    .then(function (result) {
      if (!result) return;
      if (result.outputs) showOutputs(result.outputs);
      drawSchedule(result.schedule || []);
    })
    .catch(function (error) {
      console.error("CLEAR ERROR:", error);
    });
}


/* =========================================================
   RENTAL SCHEDULE — SHOW / HIDE
========================================================= */

function setupRentalScheduleToggle() {

  const button = document.getElementById("rentalScheduleToggle");
  if (!button) return;

  const newButton = button.cloneNode(true);
  button.parentNode.replaceChild(newButton, button);

  newButton.addEventListener("click", function () {
    if (isRentalScheduleVisible()) hideRentalSchedule();
    else showRentalSchedule();
  });

  hideRentalSchedule();
}


function isRentalScheduleVisible() {
  const section = document.getElementById("rentalScheduleSection");
  if (!section) return false;
  return window.getComputedStyle(section).display !== "none";
}


function showRentalSchedule() {
  const section = document.getElementById("rentalScheduleSection");
  const button = document.getElementById("rentalScheduleToggle");
  if (!section) return;
  section.style.display = "block";
  if (button) button.textContent = "HIDE RENTAL SCHEDULE";
  loadRentalSchedule();
}


function hideRentalSchedule() {
  const section = document.getElementById("rentalScheduleSection");
  const button = document.getElementById("rentalScheduleToggle");
  if (!section) return;
  section.style.display = "none";
  if (button) button.textContent = "SHOW RENTAL SCHEDULE";
}


/* =========================================================
   LOAD RENTAL SCHEDULE
========================================================= */

function loadRentalSchedule() {

  const periodElement = document.getElementById("period");
  const period = periodElement ? Number(periodElement.value) : 0;

  api("getRentalSchedule")
    .then(function (result) {
      if (!result) return;
      renderRentalSchedule(result.rows || [], period);
    })
    .catch(function (error) {
      console.error("RENTAL SCHEDULE ERROR:", error);
    });
}


function renderRentalSchedule(rows, period) {

  const body = document.getElementById("rentalScheduleBody");
  if (!body) return;

  body.innerHTML = "";

  if (!Array.isArray(rows) || rows.length === 0) return;

  /* Header row (A27:F27). */
  const header = rows[0] || [];
  const headerTr = document.createElement("tr");
  header.forEach(function (value) {
    const td = document.createElement("td");
    td.textContent = value == null ? "" : value;
    headerTr.appendChild(td);
  });
  body.appendChild(headerTr);

  let numberOfRows = Number(period);
  if (!Number.isFinite(numberOfRows) || numberOfRows <= 0) return;

  numberOfRows = Math.min(numberOfRows, rows.length - 1);

  for (let i = 1; i <= numberOfRows; i++) {
    const row = rows[i];
    if (!row) continue;
    const tr = document.createElement("tr");
    row.forEach(function (value) {
      const td = document.createElement("td");
      td.textContent = value == null ? "" : value;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
}


/* =========================================================
   HELPERS
========================================================= */

function value(id) {
  const element = document.getElementById(id);
  return element ? element.value : "";
}

function text(id, val) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = (val === null || val === undefined) ? "" : val;
}

function escapeHtml(input) {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
