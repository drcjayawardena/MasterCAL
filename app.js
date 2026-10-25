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
  "https://script.google.com/macros/s/AKfycbx8m_v6iMUy8tTSGzxSfxi79ZyTfJgpy89WjVkqRMO3dvnm734znkdTvjpW92DhO-xN/exec";


/* =========================================================
   API HELPER
   Uses text/plain body to stay a "simple" CORS request
   (no preflight) so Apps Script can respond.
========================================================= */

/* localStorage with in-memory fallback (iOS private mode throws). */
var _mem = {};
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return (k in _mem) ? _mem[k] : null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { _mem[k] = v; } }

/* Login session. One username + password for MasterCAL and VehicleHUB:
   the server returns a signed token (backend/Login.gs) that is sent with
   every request. It lives in localStorage "mastercal_token", which the
   VehicleHUB pages on this same origin read to log the user in too. */
const TOKEN_KEY = "mastercal_token";
function getToken() { return lsGet(TOKEN_KEY) || ""; }
function setToken(t) { if (t) lsSet(TOKEN_KEY, t); else { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} delete _mem[TOKEN_KEY]; } }
function getUsername() { return lsGet("mastercal_username") || ""; }


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


/* actions that change the Vehicle Lease sheet besides calcInputs */
const VEHICLE_WRITE_ACTIONS = { init:1, saveProductType:1, saveScheduleType:1, addScheduleRow:1,
  updateScheduleFrom:1, updateScheduleAmount:1, deleteScheduleRow:1, saveSchedule:1, clearSchedule:1, setRmvType:1,
  setAdditionalCharge:1 };

async function api(action, args) {

  const isCalc = (action !== "init" && action !== "checkVehicle" && action !== "whoami");   /* show the calculating spinner for calc actions */
  if (VEHICLE_WRITE_ACTIONS[action]) calcLastKey = "";   /* server state changes -> next calcInputs must really run */
  if (isCalc) calcStart();

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: action, args: args || [], token: getToken()
      }),
      redirect: "follow"
    });

    if (!res.ok) {
      throw new Error("Network error " + res.status);
    }

    const json = await res.json();

    if (!json || json.ok !== true) {
      const e = new Error((json && json.error) || "API error");
      if (json && json.access) e.access = json.access;   /* LOGIN / PENDING / BLOCKED */
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
  setupTwScheduleToggle();
  setupBkScheduleToggle();
  setupTabs();
  setupWhatsAppQuotes();

  /* Gate: log in before doing anything. */
  if (!getToken()) { showLogin(); return; }

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
        RMV_TYPES = normalizeRmv(result.dropdowns.rmvTypes);
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
   ACCESS GATE  (login / register / pending / blocked)
========================================================= */

function gateEl() { return document.getElementById("gate"); }
function gateBody() { return document.getElementById("gateBody"); }

function hideGate() { const g = gateEl(); if (g) g.style.display = "none"; }

function gateShow(html) {
  const g = gateEl(); if (!g) return;
  g.style.display = "flex";
  gateBody().innerHTML = html;
}

/* Enter in any field of the gate presses its main button. */
function gateEnter(fn) {
  gateBody().querySelectorAll("input").forEach(function (el) {
    el.addEventListener("keydown", function (ev) { if (ev.key === "Enter") fn(); });
  });
}

/* "Show password" tick: lets the user see what was typed (or what the phone autofilled). */
function showPassBox() {
  return '<label class="gateShowPass"><input type="checkbox" id="gateShowPass"> Show password</label>';
}
function wireShowPass() {
  const box = document.getElementById("gateShowPass");
  if (!box) return;
  box.addEventListener("change", function () {
    ["gatePass", "gatePass2"].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.type = box.checked ? "text" : "password";
    });
  });
}

/* -------- Login: username + password (the same login opens VehicleHUB) -------- */
function showLogin(msg) {
  gateShow(
    '<h2>Login</h2>' +
    '<p>Sign in with your WhatsApp number and password. Previously created usernames still work. The same account also gives you access to VehicleHUB.</p>' +
    '<input id="gateUser" type="text" autocomplete="username" autocapitalize="none" placeholder="WhatsApp number (or previous username)" value="' + escapeHtml(getUsername()) + '">' +
    '<input id="gatePass" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Password">' +
    showPassBox() +
    '<button id="gateSend" class="gateBtn">Login</button>' +
    '<div id="gateErr" class="gateErr">' + escapeHtml(msg || "") + '</div>' +
    '<button id="gateReg" class="gateBtnLink">Don&#39;t have an account? Register</button>');
  document.getElementById("gateSend").addEventListener("click", submitLogin);
  wireShowPass();
  document.getElementById("gateReg").addEventListener("click", showRegister);
  gateEnter(submitLogin);
  document.getElementById(getUsername() ? "gatePass" : "gateUser").focus();
}

function submitLogin() {
  const user = (document.getElementById("gateUser").value || "").trim().toLowerCase();
  const pass = document.getElementById("gatePass").value || "";
  const err  = document.getElementById("gateErr");
  const btn  = document.getElementById("gateSend");
  if (!user || !pass) { err.textContent = "Please enter your username and password."; return; }

  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Logging in…";
  lsSet("mastercal_username", user);

  api("login", [user, pass])
    .then(function (data) {
      if (data && data.token) { setToken(data.token); lsSet("mastercal_name", data.name || ""); lsSet("mastercal_phone", data.phone || ""); loadApp(); return; }
      showGate((data && data.status) || "PENDING");
    })
    .catch(function (e) {
      btn.disabled = false;
      btn.textContent = "Login";
      if (e.access === "BLOCKED") { showGate("BLOCKED"); return; }
      err.textContent = e.message || "Unable to sign in. Please try again.";
    });
}

/* -------- Registration: name + WhatsApp + e-mail + password --------
   The request waits for the admin's approval. Users from before passwords
   register here once with their same WhatsApp number. */
function showRegister() {
  gateShow(
    '<h2>Register</h2>' +
    '<p>Your WhatsApp number will be your username. Choose a password. ' +
    'Once an administrator approves your request, you can use this account for both MasterCAL and VehicleHUB.</p>' +
    '<input id="gateName" type="text" autocomplete="name" placeholder="Your name">' +
    '<input id="gatePhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="WhatsApp number (e.g. 0771234567)">' +
    '<input id="gateEmail" type="email" inputmode="email" autocomplete="email" placeholder="Your email address">' +
    '<input id="gatePass" type="password" autocomplete="new-password" placeholder="Password (minimum 6 characters)">' +
    '<input id="gatePass2" type="password" autocomplete="new-password" placeholder="Password again">' +
    showPassBox() +
    '<button id="gateSend" class="gateBtn">Register</button>' +
    '<div id="gateErr" class="gateErr"></div>' +
    '<button id="gateBack" class="gateBtnLink">Back to login</button>');
  document.getElementById("gateSend").addEventListener("click", submitRegister);
  wireShowPass();
  document.getElementById("gateBack").addEventListener("click", function () { showLogin(); });
  gateEnter(submitRegister);
}

function submitRegister() {
  const name  = (document.getElementById("gateName").value || "").trim();
  const phone = (document.getElementById("gatePhone").value || "").trim();
  const email = (document.getElementById("gateEmail").value || "").trim();
  const pass  = document.getElementById("gatePass").value || "";
  const pass2 = document.getElementById("gatePass2").value || "";
  const err   = document.getElementById("gateErr");
  const btn   = document.getElementById("gateSend");

  if (!name)  { err.textContent = "Please enter your name."; return; }
  if (phone.replace(/[^\d]/g, "").length < 9) { err.textContent = "Please enter a valid WhatsApp number."; return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = "Please enter a valid email address."; return; }
  if (pass.length < 6) { err.textContent = "Password must be at least 6 characters."; return; }
  if (pass !== pass2) { err.textContent = "The passwords do not match."; return; }

  err.textContent = "";
  btn.disabled = true;
  btn.textContent = "Sending…";

  api("register", [phone, name, email, phone, pass])
    .then(function (data) {
      lsSet("mastercal_username", data && data.username || phone);
      showGate("PENDING");
    })
    .catch(function (e) {
      btn.disabled = false;
      btn.textContent = "Register";
      if (e.access === "BLOCKED") { showGate("BLOCKED"); return; }
      err.textContent = e.message || "Unable to send your request. Please try again.";
    });
}

function showGate(status) {
  if (status === "LOGIN") { setToken(""); showLogin("Your session has ended. Please sign in again."); return; }

  if (status === "BLOCKED") {
    setToken("");
    gateShow(
      '<h2>Access Denied</h2>' +
      '<p>Your access has been blocked. Please contact the administrator.</p>' +
      '<div class="gateMuted">' + escapeHtml(getUsername()) + '</div>' +
      '<button id="gateBack" class="gateBtnLink">Back to login</button>');
    document.getElementById("gateBack").addEventListener("click", function () { showLogin(); });
    return;
  }

  /* PENDING (default) */
  setToken("");
  gateShow(
    '<h2>Approval Pending ⏳</h2>' +
    '<p>Your request has been sent to the administrator for approval.<br>' +
    'You can sign in once it is approved.</p>' +
    '<div class="gateMuted">' + escapeHtml(getUsername()) + '</div>' +
    '<button id="gateRetry" class="gateBtn">Login</button>');
  document.getElementById("gateRetry").addEventListener("click", function () { showLogin(); });
}


/* =========================================================
   BULLET PAYMENT OPTION BUTTON
========================================================= */

function setupBulletPaymentButton() {

  /* The button now lives at the bottom of the Charges card (in index.html). */
  const button = document.getElementById("addBulletPaymentButton");
  if (!button) return;

  /* Clone to drop any old listeners, then bind fresh. */
  const nb = button.cloneNode(true);
  button.parentNode.replaceChild(nb, button);

  nb.addEventListener("click", function () {
    const card = document.getElementById("scheduleCard");
    if (!card) return;
    const hidden = window.getComputedStyle(card).display === "none";
    if (hidden) showScheduleCard();
    else hideScheduleCard();
    /* Clear the bullet schedule (FROM & AMOUNT) on every manual toggle. */
    clearScheduleUI();
  });

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
      saveTimer = setTimeout(saveInputs, 400);
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

/* SPEED: live calculation rules
   - only ONE calcInputs request runs at a time; edits made meanwhile are
     sent afterwards as a single request with the newest values
   - an identical request (same inputs, same schedule state) is never repeated
     (typing pause + blur/Enter used to send the same values twice)
   - when the rental schedule is open, it comes back in the SAME response */
var calcInFlight = false;
var calcDirty    = false;
var calcLastKey  = "";

function saveInputs() {

  const data = collectInputData();
  const withSchedule = isRentalScheduleVisible();
  const key = JSON.stringify(data) + "|" + withSchedule;

  if (calcInFlight) { calcDirty = true; return; }
  if (key === calcLastKey) return;

  calcInFlight = true;
  calcLastKey = key;
  data.withSchedule = withSchedule;

  /* calcInputs = lighter/faster (returns only outputs). */
  api("calcInputs", [data])
    .then(function (result) {
      if (!result) return;
      if (result.outputs) showOutputs(result.outputs);
      if (withSchedule && isRentalScheduleVisible()) {
        if (result.rentalSchedule) renderRentalSchedule(result.rentalSchedule, Number(value("period")) || 0);
        else loadRentalSchedule();            /* older backend: separate request */
      }
    })
    .catch(function (error) {
      calcLastKey = "";                       /* allow a retry with the same values */
      console.error("SAVE INPUTS ERROR:", error);
    })
    .then(function () {
      calcInFlight = false;
      if (calcDirty) { calcDirty = false; saveInputs(); }
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
      /* options first, results second: showOutputs() disables + blanks the boxes whose
         switch is NO, which must happen AFTER the stamp-duty list is rebuilt */
      if (result.stampDuty) fillSelect("stampDuty", result.stampDuty);
      if (result.outputs) showOutputs(result.outputs);
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

  applyScheduleMode();       /* instant show/hide of the TO column */
  clearTimeout(saveTimer);   /* cancel any pending input save */

  /* The existing saveScheduleType action sets the type AND clears the
     bullet schedule (FROM & AMOUNT) in one call — no backend redeploy
     needed. Facility inputs are already saved from their own edits. */
  api("saveScheduleType", [scheduleType])
    .then(function (result) {
      if (result) {
        if (result.outputs) showOutputs(result.outputs);
        drawSchedule(result.schedule || []);
      }
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
  if (result.capAmounts) applyCapAmounts(result.capAmounts);
  if (result.charges) renderCharges(result.charges);
  if (result.enabled) applyEnabled(result.enabled);
  applyExpress(result.express);
}


/* Facility Details labels:   <sheet label>  +  <capitalized amount>
     BIC          ->  A6  +  E6      e.g. "ONLY CAPITALIZED 1% AS BIC  +  35,000"
     INSURANCE    ->  A7  +  E7      e.g. "INSURANCE CAN NOT CAPITALIZED  +  0"
     STAMP DUTY   ->  A8  +  E8      e.g. "STAMP DUTY CAN NOT CAPITALIZED  +  0"
   amounts = [E6, E7, E8] as the sheet displays them.
   IDEMPOTENT: always rebuilt from the clean label text (never stacks "+ …").
   CAP_SHOW_ZERO = true  -> the "+ value" is shown even when the sheet gives 0
                   false -> it is hidden while the amount is 0 */
var CAP_SHOW_ZERO = true;

var lastCapAmounts = null;   /* [BIC, insurance, stamp duty] capitalized amounts, for the quotation */

function applyCapAmounts(amounts) {
  if (!amounts) return;
  lastCapAmounts = amounts;
  var map = { lblBic: amounts[0], lblInsurance: amounts[1], lblStampDuty: amounts[2] };
  Object.keys(map).forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;

    /* Clean base label: the one stored by applyLabels; otherwise strip any
       "  +  <number>" / "  -  <number>" suffixes that were appended before. */
    var base = el.dataset.baseLabel;
    if (base == null) {
      base = el.textContent.replace(/(\s+[-+]\s+[\d.,]+)+\s*$/, "");
      el.dataset.baseLabel = base;
    }
    base = String(base).trim();

    var v = map[id];
    var show = isAmount(v) && (CAP_SHOW_ZERO || nonZeroAmt(v));
    el.textContent = show ? (base + "  +  " + String(v).trim()) : base;
  });
}

/* True when a display string is a number (zero included, sheet errors excluded). */
function isAmount(v) {
  if (v == null) return false;
  var s = String(v).trim();
  if (s === "" || isSheetError(s)) return false;
  return !isNaN(parseFloat(s.replace(/,/g, "")));
}

/* True when a display string is a number other than zero (ignores commas). */
function nonZeroAmt(v) {
  if (!isAmount(v)) return false;
  return parseFloat(String(v).trim().replace(/,/g, "")) !== 0;
}


/* Enable/disable BIC, INSURANCE, STAMP DUTY inputs based on the
   sheet flags Q6:Q8 (backend returns { bic, insurance, stampDuty }).
   A "NO" flag disables the field; anything else keeps it editable.
   A disabled field must show BLANK (its value is cleared).
   FACILITY AMOUNT, IRR and PERIOD are never affected here. */
function applyEnabled(flags) {
  if (!flags) return;
  var map = { bic: flags.bic, insurance: flags.insurance, stampDuty: flags.stampDuty };
  Object.keys(map).forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var on = (map[id] !== false);   /* default enabled */
    el.disabled = !on;
    el.classList.toggle("is-disabled", !on);
    if (!on) el.value = "";         /* disabled -> value must be blank */
  });
}


/* Express rule: when the sheet's N1 = "Express", PERIOD is locked at 12.
   Otherwise PERIOD is a normal editable field. */
function applyExpress(express) {
  var p = document.getElementById("period");
  if (p) {
    if (express) {
      p.value = "12";
      p.disabled = true;
      p.classList.add("is-disabled");
    } else {
      p.disabled = false;
      p.classList.remove("is-disabled");
    }
  }

  /* Express facilities cannot have bullet payments: the ADD BULLET PAYMENT button is
     disabled and an open bullet-payment card is closed (the server already cleared its rows
     when the product changed, and refuses any bullet edit for Express). */
  var b = document.getElementById("addBulletPaymentButton");
  if (b) {
    b.disabled = !!express;
    b.classList.toggle("is-disabled", !!express);
    if (express) b.title = "Bullet payments are not available for Express facilities";
    else b.removeAttribute("title");
  }
  if (express) hideScheduleCard();
}


/* Charges breakdown from J1:L14 (rows: [J label, K sub, L amount]). */
/* Two RMV option lists: normal (J13 <- B2:B6), other (J14 <- E:E). */
var RMV_TYPES = { normal: [], other: [] };

/* Accept either the NEW backend shape { normal:[], other:[] } or the OLD
   single array (in case the backend hasn't been redeployed yet) — an array
   is used for BOTH dropdowns so they never silently disappear. */
function normalizeRmv(rmv) {
  if (!rmv) return { normal: [], other: [] };
  if (Array.isArray(rmv)) return { normal: rmv, other: rmv };
  return { normal: rmv.normal || [], other: rmv.other || [] };
}
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
    if (ADDL_RE.test(norm)) td2.appendChild(addlChargeInput(amount));   /* typed by the user */
    else td2.textContent = amount;

    /* J13 uses the "normal" list (B2:B6); J14 uses the "other" list (E:E). */
    var rmvList = RMV_CELLS[i]
      ? (i === 12 ? (RMV_TYPES.normal || []) : (RMV_TYPES.other || []))
      : null;

    if (rmvList && rmvList.length) {
      /* RMV type = editable dropdown (J13 / J14). */
      const cell = RMV_CELLS[i];
      const sel = document.createElement("select");
      sel.className = "chargesSelect";
      rmvList.forEach(function (opt) {
        const o = document.createElement("option");
        o.value = opt; o.textContent = opt;
        sel.appendChild(o);
      });
      /* keep the current sheet value selectable even if it's not in the list */
      const cur = String(row[0] || "");
      if (cur !== "" && rmvList.indexOf(cur) === -1) {
        const o0 = document.createElement("option");
        o0.value = cur; o0.textContent = cur;
        sel.insertBefore(o0, sel.firstChild);
      }
      sel.value = cur;
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

/* ADDITIONAL SERVICE CHARGES: the user types the amount. One input is reused
   across re-renders so typing / focus is never lost. Empty until a value is typed. */
const ADDL_RE = /ADDITIONAL SERVICE CHARGE/;
var addlInput = null;

function addlChargeInput(amount) {
  if (!addlInput) {
    addlInput = document.createElement("input");
    addlInput.type = "text";
    addlInput.inputMode = "decimal";
    addlInput.className = "chargesInput";
    addlInput.placeholder = "Amount";
    addlInput.setAttribute("aria-label", "Additional service charges");
    addlInput.addEventListener("change", function () { setAdditionalChargeUI(this.value); });
    addlInput.addEventListener("keydown", function (ev) { if (ev.key === "Enter") this.blur(); });
  }
  if (document.activeElement !== addlInput) {
    const n = Number(String(amount).replace(/,/g, ""));
    addlInput.value = (amount === "" || !n) ? "" : amount;
  }
  return addlInput;
}

function setAdditionalChargeUI(value) {
  const v = String(value).replace(/,/g, "").trim();
  if (v !== "" && !(Number(v) >= 0)) { alert("Please enter a valid amount."); return; }
  api("setAdditionalCharge", [v])
    .then(function (r) { if (r && r.outputs) showOutputs(r.outputs); })
    .catch(function (e) {
      console.error("ADDITIONAL CHARGE ERROR:", e);
      alert("Additional service charges could not be saved.\n\n" + e.message);
    });
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
      el.textContent = String(val).trim();
      el.dataset.baseLabel = String(val).trim();   /* clean base for applyCapAmounts */
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
  refreshMonthlyTitle();
}


/* Heading swaps to "MONTHLY RENTAL WITH BULLET" whenever any bullet-payment
   row has a value (FROM or AMOUNT); otherwise it stays "Monthly Rental".
   CSS uppercases it. Call this after any schedule change. */
function refreshMonthlyTitle() {
  var title = document.getElementById("monthlyRentalTitle");
  if (!title) return;
  var filled = false;
  var inputs = document.querySelectorAll(
    '#scheduleBody input[data-type="from"], #scheduleBody input[data-type="amount"]');
  inputs.forEach(function (el) {
    if (String(el.value == null ? "" : el.value).trim() !== "") filled = true;
  });
  title.textContent = filled ? "Monthly Rental with Bullet" : "Monthly Rental";
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
      refreshMonthlyTitle();
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
      refreshMonthlyTitle();
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
      refreshMonthlyTitle();
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
      refreshMonthlyTitle();
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


/* =========================================================
   THREE-WHEEL (3W) TAB
   Reads the separate 3W sheet in the user's copy. Inputs are
   column B (dropdown options come from the sheet); outputs are
   column C. Changing an input recomputes on the sheet and
   re-renders (so dependent dropdowns refresh too).
========================================================= */

var tw_built = false;
var tw_loaded = false;

const TW_INPUT_LABELS = {
  B2: "MAKE", B3: "VEHICLE NO", B5: "Maximum Exposure",
  B10: "FACILITY AMOUNT", B11: "BIC ( % )", B12: "INSURANCE", B13: "RMV CHARGES",
  B14: "PERIOD", B15: "IRR", B22: "CRIB CHARGES", B23: "RMV CHARGES"
};

/* Dropdowns (GRADE B4 removed from the UI). B5 = read-only display. */
const TW_DROPDOWN_CELLS = ["B2", "B3", "B12", "B13", "B23"];
const TW_READONLY_CELLS = ["B5"];

function setupTabs() {
  /* tab key (data-tab)  ->  panel element id */
  const PANELS = { vehicle: "vehiclePanel", threewheel: "threewheelPanel", bike: "bikePanel",
                   vcheck: "vcheckPanel", hubVehicles: "hubPanel", hubBuyers: "hubPanel", hubMatches: "hubPanel" };
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      const which = this.dataset.tab;
      const wasActive = this.classList.contains("active");
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
      this.classList.add("active");
      const selectedPanel = PANELS[which];
      Array.from(new Set(Object.values(PANELS))).forEach(function (panelId) {
        const p = document.getElementById(panelId);
        if (p) p.hidden = (panelId !== selectedPanel);
      });
      /* Opening the 3W / BIKE tab starts a fresh calculation: the Rental
         Calculation inputs are cleared (re-clicking the open tab does nothing). */
      if (which === "threewheel" && !wasActive) load3W(true);
      if (which === "bike" && !wasActive) loadBike(true);
      if (HUB_TABS[which]) openHub(which);
      if (which === "vcheck") setupVehicleCheck();
    });
  });
}

function load3W(reset) {
  const l = document.getElementById("twLoading");
  if (l) { l.style.display = "block"; l.textContent = "Loading three-wheel calculator…"; }
  api(reset ? "reset3W" : "get3W")
    .then(function (data) {
      if (l) l.style.display = "none";
      tw_loaded = true;
      if (!tw_built) { build3W(data); tw_built = true; }
      render3W(data);
    })
    .catch(function (e) {
      if (l) l.textContent = "Could not load three-wheel calculator: " + e.message;
      console.error("3W load error:", e);
    });
}

function twField(cell, data) {
  const info = data.inputs[cell] || {};
  const wrap = document.createElement("div");
  wrap.className = "field";

  const lab = document.createElement("label");
  lab.id = "twlbl_" + cell;
  lab.textContent = TW_INPUT_LABELS[cell] || cell;
  wrap.appendChild(lab);

  let el;
  const forceSelect = TW_DROPDOWN_CELLS.indexOf(cell) !== -1;
  const readOnly = TW_READONLY_CELLS.indexOf(cell) !== -1;
  if (readOnly) {
    /* Display-only value (e.g. Maximum Exposure) — cannot be edited. */
    el = document.createElement("input");
    el.type = "text";
    el.readOnly = true;
    el.className = "tw-readonly";
  } else if (forceSelect || (info.options && info.options.length)) {
    el = document.createElement("select");
    el.addEventListener("change", function () { set3WValue(cell, this.value); });
  } else {
    el = document.createElement("input");
    el.type = "text";
    el.setAttribute("inputmode", "decimal");
    el.addEventListener("blur", function () { set3WValue(cell, this.value); });
    el.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); this.blur(); }
    });
  }
  el.id = "tw_" + cell;
  wrap.appendChild(el);
  return wrap;
}

function twOutRow(label, id) {
  return '<tr><td>' + label + '</td><td id="' + id + '"></td></tr>';
}

/* A big result value with a label tile beside it (MONTHLY RENTAL | 0.00). */
function twBigRow(label, id) {
  return '<div class="tw-bigrow">' +
    '<div class="tw-biglabel">' + label + '</div>' +
    '<div class="bigValue red"><span id="' + id + '">0.00</span></div>' +
    '</div>';
}

function build3W(data) {
  const grid = document.getElementById("twGrid");
  if (!grid) return;
  grid.innerHTML = "";

  /* Two cards, as in the owner's layout:
     left  = Valuation & Exposure, then Initial Charges;
     right = Rental Calculation inputs, then Payment Detail. */
  grid.classList.add("tw-grid2");

  const c1 = document.createElement("div");
  c1.className = "tw-card";
  c1.innerHTML = '<div class="cardTitle">Valuation &amp; Exposure</div>';
  ["B2", "B3"].forEach(function (cell) { c1.appendChild(twField(cell, data)); });
  c1.insertAdjacentHTML("beforeend",
    '<table class="summaryTable">' +
    twOutRow("Maximum Exposure", "tw_maxExposure") +
    twOutRow("CF Valuation", "tw_cfValuation") +
    twOutRow("Max Facility Value", "tw_maxFacility") +
    '</table>' +
    '<div class="cardTitle tw-subtitle">Initial Charges</div>' +
    twBigRow("TOTAL CHARGES", "tw_chargesTotal") +
    '<table class="summaryTable">' +
    twOutRow("Crib Charges", "tw_cribCharge") +
    twOutRow("Insurance", "tw_insCharge") +
    twOutRow("Valuation Charges", "tw_valCharge") +
    twOutRow("Service Charges", "tw_svcCharge") +
    twOutRow("VAT 18.00%", "tw_vat") +
    '</table>');
  /* Only the RMV CHARGES (B23) input sits below the charges (CRIB B22 stays hidden). */
  const c1inputs = document.createElement("div");
  c1inputs.className = "tw-card-inputs";
  c1inputs.appendChild(twField("B23", data));
  c1.appendChild(c1inputs);
  grid.appendChild(c1);

  const c2 = document.createElement("div");
  c2.className = "tw-card";
  c2.innerHTML = '<div class="cardTitle">Rental Calculation</div>';
  ["B10", "B11", "B12", "B13", "B14", "B15"].forEach(function (cell) { c2.appendChild(twField(cell, data)); });
  /* No Payment Detail heading here (six inputs leave no room); alignPayTiles
     lines MONTHLY RENTAL up with TOTAL CHARGES on the left. */
  c2.insertAdjacentHTML("beforeend",
    '<div class="tw-paywrap">' +
    twBigRow("MONTHLY RENTAL", "tw_monthlyRental") +
    '<table class="summaryTable">' +
    twOutRow("Exposure", "tw_exposurePct") +
    twOutRow("Total Paid", "tw_totPaid") +
    twOutRow("Total Interest", "tw_totInterest") +
    twOutRow("Rate / 100,000", "tw_rate100") +
    '</table></div>');
  grid.appendChild(c2);
}

var tw_lastData = null;   /* keep the latest 3W payload for the schedule */

function render3W(data) {
  if (!data) return;
  tw_lastData = data;

  const lb10 = document.getElementById("twlbl_B10");
  if (lb10 && data.labelFacility) lb10.textContent = data.labelFacility;

  const inputs = data.inputs || {};
  Object.keys(inputs).forEach(function (cell) {
    const info = inputs[cell];
    const el = document.getElementById("tw_" + cell);
    if (!el) return;
    if (el.tagName === "SELECT") {
      const cur = String(info.value == null ? "" : info.value);
      const opts = info.options || [];
      el.innerHTML = "";
      /* keep the current value selectable even if it's not in the list */
      if (cur !== "" && opts.indexOf(cur) === -1) {
        const o0 = document.createElement("option");
        o0.value = cur; o0.textContent = cur;
        el.appendChild(o0);
      }
      opts.forEach(function (opt) {
        const o = document.createElement("option");
        o.value = opt; o.textContent = opt;
        el.appendChild(o);
      });
      el.value = cur;
    } else if (document.activeElement !== el) {
      el.value = info.value;
    }
  });

  const o = data.out || {};
  const set = function (id, v) {
    const e = document.getElementById(id);
    if (e) e.textContent = (v == null ? "" : v);
  };
  set("tw_maxExposure", (inputs.B5 && inputs.B5.value) || "");  /* B5 as read-only row */
  set("tw_cfValuation", o.cfValuation);
  set("tw_maxFacility", o.maxFacility);
  set("tw_exposurePct", data.totalCapPct); /* exposure %          */
  set("tw_monthlyRental", o.monthlyRental);

  /* Labelize BIC & INSURANCE with their computed (capitalized) amounts.
     BIC uses o.bic (C11); INSURANCE uses o.insurance (C12) — the insurance
     AMOUNT, not o.insCharge (the initial-charge row, which is 0 when the
     insurance is CAPITALIZED). */
  const bicLbl = document.getElementById("twlbl_B11");
  if (bicLbl) bicLbl.textContent = "BIC ( % )" + (o.bic ? "  -  " + o.bic : "");
  const insLbl = document.getElementById("twlbl_B12");
  if (insLbl) insLbl.textContent = "INSURANCE" + (o.insurance ? "  -  " + o.insurance : "");
  set("tw_chargesTotal", o.chargesTotal);
  set("tw_cribCharge", o.cribCharge);
  set("tw_rmvCharge", o.rmvCharge);
  set("tw_insCharge", o.insCharge);
  set("tw_valCharge", o.valCharge);
  set("tw_svcCharge", o.svcCharge);
  set("tw_vat", o.vat);
  set("tw_totPaid", o.totPaid);
  set("tw_totInterest", o.totInterest);
  set("tw_rate100", o.rate100);

  /* When the sheet's F13 == "YES", disable the RMV CHARGES input in the
     charges card (B23). */
  const rmvEl = document.getElementById("tw_B23");
  if (rmvEl) {
    const dis = !!data.rmvDisabled;
    rmvEl.disabled = dis;
    rmvEl.classList.toggle("is-disabled", dis);
    if (dis) rmvEl.value = "";               /* F13 = YES -> no RMV charge */
  }

  /* keep the rental schedule in sync when it's open */
  if (isTwScheduleVisible()) renderTwSchedule();
  alignPayTiles();
}


/* =========================================================
   3W RENTAL SCHEDULE  (computed client-side)
   No schedule table exists on the 3W sheet, so we build a
   month-by-month amortization from the results:
     financed principal P = Total Paid − Total Interest
     monthly rental R     = Monthly Rental
     term n               = PERIOD (B14)
   The monthly rate is solved so the annuity amortizes to 0,
   which makes the totals match the sheet exactly.
========================================================= */

function twNum(v) {
  return parseFloat(String(v == null ? "" : v).replace(/,/g, "")) || 0;
}
function twFmt(n) {
  if (!isFinite(n)) n = 0;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Solve monthly rate i for R = P·i / (1 − (1+i)^−n) via bisection. */
function twSolveRate(P, R, n) {
  if (P <= 0 || R <= 0 || n <= 0) return 0;
  if (R * n <= P + 0.01) return 0;             /* no interest */
  const f = function (i) { return P * i / (1 - Math.pow(1 + i, -n)) - R; };
  let lo = 1e-9, hi = 1.0;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (f(lo) * fm <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

function setupTwScheduleToggle() {
  const btn = document.getElementById("twScheduleToggle");
  if (!btn) return;
  const nb = btn.cloneNode(true);
  btn.parentNode.replaceChild(nb, btn);
  nb.addEventListener("click", function () {
    if (isTwScheduleVisible()) hideTwSchedule();
    else showTwSchedule();
  });
  hideTwSchedule();
}

function isTwScheduleVisible() {
  const s = document.getElementById("twScheduleSection");
  return s && window.getComputedStyle(s).display !== "none";
}

function showTwSchedule() {
  const s = document.getElementById("twScheduleSection");
  const b = document.getElementById("twScheduleToggle");
  if (s) s.style.display = "block";
  if (b) b.textContent = "HIDE RENTAL SCHEDULE";
  renderTwSchedule();
}

function hideTwSchedule() {
  const s = document.getElementById("twScheduleSection");
  const b = document.getElementById("twScheduleToggle");
  if (s) s.style.display = "none";
  if (b) b.textContent = "SHOW RENTAL SCHEDULE";
}

function renderTwSchedule() {
  const body = document.getElementById("twScheduleBody");
  if (!body) return;
  body.innerHTML = "";
  if (!tw_lastData) return;

  const o = tw_lastData.out || {};
  const inp = tw_lastData.inputs || {};
  const n = Math.round(twNum(inp.B14 && inp.B14.value));
  const R = twNum(o.monthlyRental);
  const P = twNum(o.totPaid) - twNum(o.totInterest);   /* financed principal */

  if (n <= 0 || R <= 0 || P <= 0) {
    body.insertAdjacentHTML("beforeend",
      '<tr><td style="text-align:center;padding:14px">No schedule to show yet.</td></tr>');
    return;
  }

  const i = twSolveRate(P, R, n);

  /* header row */
  const head = document.createElement("tr");
  ["No", "Rental", "Interest", "Capital", "Balance"].forEach(function (h) {
    const td = document.createElement("td"); td.textContent = h; head.appendChild(td);
  });
  body.appendChild(head);

  let bal = P;
  for (let m = 1; m <= n; m++) {
    let interest = bal * i;
    let capital = R - interest;
    if (m === n) { capital = bal; interest = R - capital; if (interest < 0) interest = 0; }
    bal -= capital;
    if (bal < 0) bal = 0;
    const tr = document.createElement("tr");
    [String(m), twFmt(R), twFmt(interest), twFmt(capital), twFmt(bal)].forEach(function (v) {
      const td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
    });
    body.appendChild(tr);
  }
}

/* Show / hide the 3W calculating spinner over the grid. */
function tw_setBusy(on) {
  const grid = document.getElementById("twGrid");
  if (grid) grid.classList.toggle("tw-busy", !!on);
}

function set3WValue(cell, value) {
  tw_setBusy(true);
  api("set3W", [cell, value])
    .then(function (data) { render3W(data); })
    .catch(function (e) {
      console.error("3W set error:", e);
      alert("Could not update the three-wheel value.\n\n" + e.message);
    })
    .then(function () { tw_setBusy(false); });   /* always clear the spinner */
}


/* =========================================================
   BIKE LEASING TAB
   Same look as the three-wheel tab (same cards / classes), but a
   SEPARATE calculator: it reads the "BIKE" sheet (MAKE -> MODEL ->
   YEAR, exposure %, manual insurance ...). Dropdown lists come from
   the sheet; every change is validated by the server and the page is
   re-rendered from the sheet's answer.
========================================================= */

var bk_built = false;
var bk_loaded = false;
var bk_lastData = null;   /* latest payload, used by the schedule */

const BK_LABELS = {
  B2: "MAKE", B3: "MODEL", B4: "YEAR", B5: "Maximum Exposure",
  B7: "FACILITY AMOUNT", B8: "BIC ( % )", B9: "INSURANCE",
  B10: "RMV CHARGES ( CAPITALISED )", B11: "PERIOD", B12: "IRR ( % )",
  B20: "CRIB CHARGES", B21: "INITIAL RMV CHARGES"
};
const BK_SELECT_CELLS = ["B2", "B3", "B4", "B8", "B10", "B21"];

function loadBike(reset) {
  const l = document.getElementById("bkLoading");
  if (l) { l.style.display = "block"; l.textContent = "Loading bike calculator…"; }
  api(reset ? "resetBike" : "getBike")
    .then(function (data) {
      if (l) l.style.display = "none";
      bk_loaded = true;
      if (!bk_built) { buildBike(data); bk_built = true; }
      renderBike(data);
    })
    .catch(function (e) {
      if (l) l.textContent = "Could not load bike calculator: " + e.message;
      console.error("Bike load error:", e);
    });
}

const BK_READONLY_CELLS = ["B5"];

function bkField(cell) {
  const wrap = document.createElement("div");
  wrap.className = "field";

  const lab = document.createElement("label");
  lab.id = "bklbl_" + cell;
  lab.textContent = BK_LABELS[cell] || cell;
  wrap.appendChild(lab);

  let el;
  if (BK_READONLY_CELLS.indexOf(cell) !== -1) {
    el = document.createElement("input");           /* display only, like 3W */
    el.type = "text"; el.readOnly = true; el.className = "tw-readonly";
  } else if (BK_SELECT_CELLS.indexOf(cell) !== -1) {
    el = document.createElement("select");
    el.addEventListener("change", function () { setBikeValue(cell, this.value); });
  } else {
    el = document.createElement("input");
    el.type = "text";
    el.setAttribute("inputmode", "decimal");
    el.addEventListener("blur", function () { setBikeValue(cell, this.value); });
    el.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); this.blur(); }
    });
  }
  el.id = "bk_" + cell;
  wrap.appendChild(el);
  return wrap;
}

function bkOutRow(label, id) {
  return '<tr><td>' + label + '</td><td id="' + id + '"></td></tr>';
}

function bkBigRow(label, id) {
  return '<div class="tw-bigrow">' +
    '<div class="tw-biglabel">' + label + '</div>' +
    '<div class="bigValue red"><span id="' + id + '">0.00</span></div>' +
    '</div>';
}

function buildBike() {
  const grid = document.getElementById("bkGrid");
  if (!grid) return;
  grid.innerHTML = "";

  /* Same two-card layout as the three-wheel tab. */
  grid.classList.add("tw-grid2");

  const c1 = document.createElement("div");
  c1.className = "tw-card";
  c1.innerHTML = '<div class="cardTitle">Valuation &amp; Exposure</div>';
  ["B2", "B3", "B4"].forEach(function (cell) { c1.appendChild(bkField(cell)); });
  c1.insertAdjacentHTML("beforeend",
    '<table class="summaryTable">' +
    bkOutRow("Maximum Exposure", "bk_maxExposure") +
    bkOutRow("CF Valuation", "bk_cfValuation") +
    bkOutRow("Max Facility Value", "bk_maxFacility") +
    '</table>' +
    '<div class="cardTitle tw-subtitle">Initial Charges</div>' +
    bkBigRow("TOTAL CHARGES", "bk_chargesTotal") +
    '<table class="summaryTable">' +
    bkOutRow("Crib Charges", "bk_cribCharge") +
    bkOutRow("Valuation Charges", "bk_valCharge") +
    bkOutRow("Service Charges", "bk_svcCharge") +
    bkOutRow('<span id="bk_vatLabel">VAT</span>', "bk_vat") +
    '</table>');
  /* CRIB input B20 is not shown, like the 3W layout. */
  const c1inputs = document.createElement("div");
  c1inputs.className = "tw-card-inputs";
  c1inputs.appendChild(bkField("B21"));
  c1.appendChild(c1inputs);
  grid.appendChild(c1);

  const c2 = document.createElement("div");
  c2.className = "tw-card";
  c2.innerHTML = '<div class="cardTitle">Rental Calculation</div>';
  ["B7", "B8", "B9", "B10", "B11", "B12"].forEach(function (cell) { c2.appendChild(bkField(cell)); });
  c2.insertAdjacentHTML("beforeend",
    '<div class="tw-paywrap">' +
    '<div class="cardTitle tw-subtitle">Payment Detail</div>' +
    bkBigRow("MONTHLY RENTAL", "bk_monthlyRental") +
    '<table class="summaryTable">' +
    bkOutRow("Exposure", "bk_exposurePct") +
    bkOutRow("Total Paid", "bk_totPaid") +
    bkOutRow("Total Interest", "bk_totInterest") +
    bkOutRow("Rate / 100,000", "bk_rate100") +
    '</table></div>');
  grid.appendChild(c2);
}

/* Two-card tabs: push the right card's MONTHLY RENTAL block down so its tile
   lines up with TOTAL CHARGES on the left (side-by-side layout only). */
function alignPayTiles() {
  ["twGrid", "bkGrid"].forEach(function (id) {
    const grid = document.getElementById(id);
    if (!grid || !grid.offsetParent) return;
    const cards = grid.querySelectorAll(".tw-card");
    const wrap = grid.querySelector(".tw-paywrap");
    if (cards.length < 2 || !wrap) return;
    wrap.style.marginTop = "";
    const left = cards[0].querySelector(".tw-bigrow");
    const right = wrap.querySelector(".tw-bigrow");
    if (!left || !right) return;
    const sideBySide = cards[0].getBoundingClientRect().top === cards[1].getBoundingClientRect().top;
    const diff = left.getBoundingClientRect().top - right.getBoundingClientRect().top;
    if (sideBySide && diff > 0) wrap.style.marginTop = diff + "px";
  });
}
window.addEventListener("resize", alignPayTiles);

function renderBike(data) {
  if (!data) return;
  bk_lastData = data;
  const inputs = data.inputs || {};
  const o = data.out || {};

  /* inputs */
  Object.keys(inputs).forEach(function (cell) {
    const info = inputs[cell];
    const el = document.getElementById("bk_" + cell);
    if (!el) return;
    if (el.tagName === "SELECT") {
      const cur = String(info.value == null ? "" : info.value);
      const opts = info.options || [];
      el.innerHTML = "";
      const blank = document.createElement("option");
      blank.value = ""; blank.textContent = "— select —";
      el.appendChild(blank);
      if (cur !== "" && opts.indexOf(cur) === -1) {          /* keep a value the list no longer has */
        const o0 = document.createElement("option");
        o0.value = cur; o0.textContent = cur;
        el.appendChild(o0);
      }
      opts.forEach(function (opt) {
        const op = document.createElement("option");
        op.value = opt; op.textContent = opt;
        el.appendChild(op);
      });
      el.value = cur;
    } else if (document.activeElement !== el) {
      el.value = info.value;
    }
  });

  /* MODEL needs a MAKE, YEAR needs a MODEL */
  const dep = function (cell, enabled) {
    const el = document.getElementById("bk_" + cell);
    if (!el) return;
    el.disabled = !enabled;
    el.classList.toggle("is-disabled", !enabled);
  };
  dep("B3", !!(inputs.B2 && inputs.B2.value));
  dep("B4", !!(inputs.B3 && inputs.B3.value));

  /* labels that carry a computed amount */
  const lb7 = document.getElementById("bklbl_B7");
  if (lb7 && data.labelFacility) lb7.textContent = data.labelFacility;
  const bicLbl = document.getElementById("bklbl_B8");
  if (bicLbl) bicLbl.textContent = "BIC ( % )" + (o.bic && bkNum(o.bic) > 0 ? "  -  " + o.bic : "");
  const rmvCapLbl = document.getElementById("bklbl_B10");
  if (rmvCapLbl) rmvCapLbl.textContent = BK_LABELS.B10 + (o.capitalizedRmv && bkNum(o.capitalizedRmv) > 0 ? "  -  " + o.capitalizedRmv : "");
  const vatLbl = document.getElementById("bk_vatLabel");
  if (vatLbl) vatLbl.textContent = data.vatLabel || "VAT";

  /* BIKE!D21 = YES -> initial RMV charges are covered: disable B21 (same as 3W). */
  const rmvEl = document.getElementById("bk_B21");
  if (rmvEl) {
    const off = !!data.rmvDisabled;
    rmvEl.disabled = off;
    rmvEl.classList.toggle("is-disabled", off);
    if (off) rmvEl.value = "";
  }

  /* results */
  const set = function (id, v) {
    const e = document.getElementById(id);
    if (e) e.textContent = (v == null ? "" : v);
  };
  set("bk_maxExposure", (inputs.B5 && inputs.B5.value) || "");
  set("bk_cfValuation", o.cfValuation);
  set("bk_maxFacility", o.maxFacility);
  set("bk_exposurePct", data.exposurePct);
  set("bk_totPaid", o.totPaid);
  set("bk_totInterest", o.totInterest);
  set("bk_rate100", o.rate100);
  set("bk_monthlyRental", o.monthlyRental);
  set("bk_chargesTotal", o.chargesTotal);
  set("bk_cribCharge", o.cribCharge);
  set("bk_rmvCharge", o.rmvCharge);
  set("bk_valCharge", o.valCharge);
  set("bk_svcCharge", o.svcCharge);
  set("bk_vat", o.vat);

  if (isBkScheduleVisible()) renderBkSchedule();
  alignPayTiles();
}


/* =========================================================
   BIKE RENTAL SCHEDULE  (computed client-side, same method as 3W)
     financed principal P = Total Paid − Total Interest
     monthly rental R     = Monthly Rental
     term n               = PERIOD (B11)
   The monthly rate is solved so the annuity amortizes to 0, so the
   schedule's totals match the sheet exactly.
========================================================= */

function bkNum(v) {
  return parseFloat(String(v == null ? "" : v).replace(/,/g, "")) || 0;
}
function bkFmt(n) {
  if (!isFinite(n)) n = 0;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Solve monthly rate i for R = P·i / (1 − (1+i)^−n) via bisection. */
function bkSolveRate(P, R, n) {
  if (P <= 0 || R <= 0 || n <= 0) return 0;
  if (R * n <= P + 0.01) return 0;
  const f = function (i) { return P * i / (1 - Math.pow(1 + i, -n)) - R; };
  let lo = 1e-9, hi = 1.0;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (f(lo) * fm <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

function setupBkScheduleToggle() {
  const btn = document.getElementById("bkScheduleToggle");
  if (!btn) return;
  const nb = btn.cloneNode(true);
  btn.parentNode.replaceChild(nb, btn);
  nb.addEventListener("click", function () {
    if (isBkScheduleVisible()) hideBkSchedule();
    else showBkSchedule();
  });
  hideBkSchedule();
}

function isBkScheduleVisible() {
  const s = document.getElementById("bkScheduleSection");
  return s && window.getComputedStyle(s).display !== "none";
}

function showBkSchedule() {
  const s = document.getElementById("bkScheduleSection");
  const b = document.getElementById("bkScheduleToggle");
  if (s) s.style.display = "block";
  if (b) b.textContent = "HIDE RENTAL SCHEDULE";
  renderBkSchedule();
}

function hideBkSchedule() {
  const s = document.getElementById("bkScheduleSection");
  const b = document.getElementById("bkScheduleToggle");
  if (s) s.style.display = "none";
  if (b) b.textContent = "SHOW RENTAL SCHEDULE";
}

function renderBkSchedule() {
  const body = document.getElementById("bkScheduleBody");
  if (!body) return;
  body.innerHTML = "";
  if (!bk_lastData) return;

  const o = bk_lastData.out || {};
  const inp = bk_lastData.inputs || {};
  const n = Math.round(bkNum(inp.B11 && inp.B11.value));   /* PERIOD is B11 in the new layout */
  const R = bkNum(o.monthlyRental);
  const P = bkNum(o.totPaid) - bkNum(o.totInterest);

  if (!bk_lastData.ready || n <= 0 || R <= 0 || P <= 0) {
    body.insertAdjacentHTML("beforeend",
      '<tr><td style="text-align:center;padding:14px">No schedule to show yet.</td></tr>');
    return;
  }

  const i = bkSolveRate(P, R, n);

  const head = document.createElement("tr");
  ["No", "Rental", "Interest", "Capital", "Balance"].forEach(function (h) {
    const td = document.createElement("td"); td.textContent = h; head.appendChild(td);
  });
  body.appendChild(head);

  let bal = P;
  for (let m = 1; m <= n; m++) {
    let interest = bal * i;
    let capital = R - interest;
    if (m === n) { capital = bal; interest = R - capital; if (interest < 0) interest = 0; }
    bal -= capital;
    if (bal < 0) bal = 0;
    const tr = document.createElement("tr");
    [String(m), bkFmt(R), bkFmt(interest), bkFmt(capital), bkFmt(bal)].forEach(function (v) {
      const td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
    });
    body.appendChild(tr);
  }
}

/* Show / hide the Bike calculating spinner over the grid. */
function bk_setBusy(on) {
  const grid = document.getElementById("bkGrid");
  if (grid) grid.classList.toggle("tw-busy", !!on);
}

function setBikeValue(cell, value) {
  bk_setBusy(true);
  api("setBike", [cell, value])
    .then(function (data) { renderBike(data); })
    .catch(function (e) {
      console.error("Bike set error:", e);
      alert("Could not update the bike value.\n\n" + e.message);
      loadBike();                       /* put the fields back to what the sheet really holds */
    })
    .then(function () { bk_setBusy(false); });
}


/* =========================================================
   VEHICLEHUB SECTIONS
   One same-origin iframe is reused for Vehicles, Buyers and Matches.
   The embedded VehicleHUB hides its standalone sidebar and switches views
   through a validated postMessage, preserving its existing SSO session.
========================================================= */

const VEHICLEHUB_URL = "https://drcjayawardena.github.io/VehicleHUB/";
const VEHICLEHUB_ORIGIN = new URL(VEHICLEHUB_URL).origin;
const HUB_TABS = {
  hubVehicles: { view: "vehicles" },
  hubBuyers: { view: "buyers" },
  hubMatches: { view: "matches" }
};
let HUB_ACTIVE_TAB = "";
let HUB_FRAME_READY = false;

window.addEventListener("message", function (event) {
  const frame = document.getElementById("hubFrame");
  if (!frame || event.origin !== VEHICLEHUB_ORIGIN || event.source !== frame.contentWindow) return;
  if (event.data && event.data.type === "vehiclehub:ready") {
    HUB_FRAME_READY = true;
    if (HUB_ACTIVE_TAB) openHub(HUB_ACTIVE_TAB);
  }
});

function openHub(tab) {
  const t = HUB_TABS[tab]; if (!t) return;
  const f = document.getElementById("hubFrame");
  if (!f) return;
  HUB_ACTIVE_TAB = tab;
  f.dataset.view = t.view;
  if (!f.getAttribute("src")) {
    f.src = VEHICLEHUB_URL + "?embed=mastercal&view=" + encodeURIComponent(t.view);
    return;
  }
  if (HUB_FRAME_READY) {
    f.contentWindow.postMessage({ type: "mastercal:show-view", view: t.view }, VEHICLEHUB_ORIGIN);
  }
}


/* =========================================================
   VEHICLE CHECKING TAB
   Make + model + year -> the server (backend/VehicleCheck.gs) reads the
   matching ads on ikman.lk and riyasewana.com and returns a price summary
   and the ads. riyasewana.com may refuse the server; then only a link to
   the same search is shown.
========================================================= */

var vc_ready = false;

/* Makes and models most often bought and sold in Sri Lanka (Make -> Model -> Year; see VC_YEARS).
   "Other" opens a text box for anything not listed. */
const VC_MODELS = {
  "Toyota": ["Aqua", "Allion", "Axio", "Belta", "Camry", "C-HR", "Corolla", "Corona", "Fortuner", "Hiace", "Hilux", "KDH",
             "Land Cruiser", "Land Cruiser Prado", "Noah", "Passo", "Premio", "Prius", "Raize", "Roomy", "Rush", "Shell", "Starlet", "TownAce", "Vios", "Vitz", "Yaris"],
  "Suzuki": ["A-Star", "Alto", "Celerio", "Dzire", "Ertiga", "Every", "Estilo", "Hustler", "Jimny", "Spacia",
             "Swift", "Vitara", "Wagon R", "Wagon R FX", "Wagon R Stingray", "GN125"],
  "Honda": ["Accord", "City", "Civic", "CR-V", "Fit", "Fit Shuttle", "Freed", "Grace", "Insight", "N Box", "Odyssey", "PCX", "Shuttle", "Vezel", "WR-V",
            "CB Shine", "CD 125", "Dio", "Hornet", "X-Blade"],
  "Nissan": ["Caravan", "Cefiro", "Clipper", "Dayz", "Leaf", "March", "Navara", "Note", "Roox", "Sunny", "Tiida", "Vanette", "X-Trail"],
  "Mitsubishi": ["Lancer", "L300", "Montero", "Outlander", "Pajero", "L200", "Eclipse Cross", "Mirage", "eK Wagon"],
  "Mazda": ["Axela", "Bongo", "BT-50", "CX-3", "CX-5", "Demio", "Familia"],
  "Micro": ["Panda", "Trend", "MX7", "Actyon", "Kyron", "Rexton"],
  "Hyundai": ["Accent", "Creta", "Elantra", "Grand i10", "i20", "Santa Fe", "Tucson", "Venue"],
  "Kia": ["Cerato", "Picanto", "Rio", "Sorento", "Sportage", "Sonet", "Stonic"],
  "Daihatsu": ["Boon", "Hijet", "Mira", "Move", "Rocky", "Tanto", "Terios"],
  "Perodua": ["Axia", "Bezza", "Kelisa", "Myvi", "Viva"],
  "Tata": ["Ace", "Indica", "Nano", "Super Ace", "Xenon"],
  "Mahindra": ["Bolero", "KUV100", "Maxximo", "Scorpio", "XUV500"],
  "Bajaj": ["RE Three Wheeler", "Catak", "Discover", "Platina", "Pulsar", "CT 100"],
  "TVS": ["King Three Wheeler", "Apache", "Metro", "Ntorq", "Scooty Pep"],
  "Hero": ["Dash", "Destini", "Hunk", "Maestro", "Pleasure", "Splendor"],
  "Yamaha": ["FZ", "Fascino", "Ray ZR", "R15"],
  "Audi": ["A3", "A4", "A5", "A6", "Q3", "Q5", "Q7"],
  "BMW": ["1 Series", "3 Series", "5 Series", "7 Series", "X1", "X3", "X5", "520D"],
  "BYD": ["Atto 3", "Dolphin", "Seal"],
  "Changan": ["Alsvin", "CS35 Plus", "CS55 Plus", "Hunter"],
  "Chevrolet": ["Cruze", "Spark", "Trailblazer"],
  "Chery": ["QQ", "Tiggo 4", "Tiggo 7"],
  "DFSK": ["Glory 330", "Glory 560", "K01", "K07"],
  "Ford": ["Everest", "Ranger", "Territory"],
  "Geely": ["Coolray", "Emgrand", "GX3 Pro"],
  "Haval": ["H6", "Jolion"],
  "Isuzu": ["D-Max", "Fargo", "NPR"],
  "JAC": ["J7", "JS4", "T8"],
  "Jeep": ["Cherokee", "Compass", "Wrangler"],
  "Land Rover": ["Defender", "Discovery", "Range Rover", "Range Rover Evoque"],
  "Lexus": ["ES", "LX", "NX", "RX"],
  "Mercedes-Benz": ["C-Class", "E-Class", "S-Class", "GLE", "GLC", "Sprinter"],
  "MG": ["3", "4", "5", "6", "ZS", "HS"],
  "Opel": ["Astra", "Corsa", "Crossland"],
  "Peugeot": ["2008", "3008", "406", "408"],
  "Proton": ["Gen-2", "Saga", "Wira"],
  "Renault": ["Kwid", "Triber", "Kangoo"],
  "Skoda": ["Octavia", "Kodiaq", "Superb"],
  "SsangYong": ["Actyon", "Korando", "Rexton"],
  "Subaru": ["Forester", "Impreza", "Legacy"],
  "Volkswagen": ["Golf", "Polo", "Tiguan", "Transporter"],
  "Volvo": ["S60", "XC40", "XC60", "XC90"]
};
const VC_VEHICLE_TYPES = ["Car", "SUV / Jeep", "Van / MPV", "Cab / Pickup", "Three Wheeler", "Motorcycle"];
/* Models not listed here are treated as Cars. */
const VC_MODEL_TYPES = {
  "Toyota": { "C-HR": "SUV / Jeep", "Fortuner": "SUV / Jeep", "Land Cruiser": "SUV / Jeep", "Land Cruiser Prado": "SUV / Jeep", "Raize": "SUV / Jeep", "Rush": "SUV / Jeep", "Hiace": "Van / MPV", "KDH": "Van / MPV", "Noah": "Van / MPV", "TownAce": "Van / MPV", "Shell": "Van / MPV", "Hilux": "Cab / Pickup" },
  "Suzuki": { "Ertiga": "Van / MPV", "Every": "Van / MPV", "Spacia": "Van / MPV", "Hustler": "SUV / Jeep", "Jimny": "SUV / Jeep", "Vitara": "SUV / Jeep", "GN125": "Motorcycle" },
  "Honda": { "CR-V": "SUV / Jeep", "Vezel": "SUV / Jeep", "WR-V": "SUV / Jeep", "Freed": "Van / MPV", "Fit Shuttle": "Van / MPV", "Odyssey": "Van / MPV", "PCX": "Motorcycle", "CB Shine": "Motorcycle", "CD 125": "Motorcycle", "Dio": "Motorcycle", "Hornet": "Motorcycle", "X-Blade": "Motorcycle" },
  "Nissan": { "Caravan": "Van / MPV", "Clipper": "Van / MPV", "Roox": "Van / MPV", "Vanette": "Van / MPV", "Navara": "Cab / Pickup", "X-Trail": "SUV / Jeep" },
  "Mitsubishi": { "Montero": "SUV / Jeep", "Outlander": "SUV / Jeep", "Pajero": "SUV / Jeep", "Eclipse Cross": "SUV / Jeep", "L200": "Cab / Pickup", "L300": "Van / MPV" },
  "Mazda": { "BT-50": "Cab / Pickup", "CX-3": "SUV / Jeep", "CX-5": "SUV / Jeep", "Bongo": "Van / MPV" },
  "Micro": { "Actyon": "SUV / Jeep", "Kyron": "SUV / Jeep", "Rexton": "SUV / Jeep" },
  "Hyundai": { "Creta": "SUV / Jeep", "Santa Fe": "SUV / Jeep", "Tucson": "SUV / Jeep", "Venue": "SUV / Jeep" },
  "Kia": { "Sorento": "SUV / Jeep", "Sportage": "SUV / Jeep", "Sonet": "SUV / Jeep", "Stonic": "SUV / Jeep" },
  "Audi": { "Q3": "SUV / Jeep", "Q5": "SUV / Jeep", "Q7": "SUV / Jeep" },
  "BMW": { "X1": "SUV / Jeep", "X3": "SUV / Jeep", "X5": "SUV / Jeep" },
  "BYD": { "Atto 3": "SUV / Jeep", "Dolphin": "Car", "Seal": "Car" },
  "Ford": { "Everest": "SUV / Jeep", "Ranger": "Cab / Pickup" },
  "Haval": { "H6": "SUV / Jeep", "Jolion": "SUV / Jeep" },
  "Isuzu": { "D-Max": "Cab / Pickup", "Fargo": "Van / MPV" },
  "JAC": { "T8": "Cab / Pickup" },
  "Jeep": { "Cherokee": "SUV / Jeep", "Compass": "SUV / Jeep", "Wrangler": "SUV / Jeep" },
  "Land Rover": { "Defender": "SUV / Jeep", "Discovery": "SUV / Jeep", "Range Rover": "SUV / Jeep", "Range Rover Evoque": "SUV / Jeep" },
  "Lexus": { "LX": "SUV / Jeep", "NX": "SUV / Jeep", "RX": "SUV / Jeep" },
  "Mercedes-Benz": { "GLE": "SUV / Jeep", "GLC": "SUV / Jeep", "Sprinter": "Van / MPV" },
  "MG": { "ZS": "SUV / Jeep", "HS": "SUV / Jeep" },
  "Renault": { "Kangoo": "Van / MPV" },
  "SsangYong": { "Actyon": "SUV / Jeep", "Korando": "SUV / Jeep", "Rexton": "SUV / Jeep" },
  "Subaru": { "Forester": "SUV / Jeep" },
  "Volkswagen": { "Tiguan": "SUV / Jeep", "Transporter": "Van / MPV" },
  "Volvo": { "XC40": "SUV / Jeep", "XC60": "SUV / Jeep", "XC90": "SUV / Jeep" },
  "Daihatsu": { "Hijet": "Van / MPV", "Rocky": "SUV / Jeep", "Terios": "SUV / Jeep" },
  "Tata": { "Ace": "Cab / Pickup", "Super Ace": "Cab / Pickup", "Xenon": "Cab / Pickup" },
  "Mahindra": { "Bolero": "SUV / Jeep", "KUV100": "SUV / Jeep", "Maxximo": "Cab / Pickup", "Scorpio": "SUV / Jeep", "XUV500": "SUV / Jeep" },
  "Bajaj": { "RE Three Wheeler": "Three Wheeler", "Catak": "Motorcycle", "Discover": "Motorcycle", "Platina": "Motorcycle", "Pulsar": "Motorcycle", "CT 100": "Motorcycle" },
  "TVS": { "King Three Wheeler": "Three Wheeler", "Apache": "Motorcycle", "Metro": "Motorcycle", "Ntorq": "Motorcycle", "Scooty Pep": "Motorcycle" },
  "Hero": { "Dash": "Motorcycle", "Destini": "Motorcycle", "Hunk": "Motorcycle", "Maestro": "Motorcycle", "Pleasure": "Motorcycle", "Splendor": "Motorcycle" },
  "Yamaha": { "FZ": "Motorcycle", "Fascino": "Motorcycle", "Ray ZR": "Motorcycle", "R15": "Motorcycle" }
};
function vcTypeFor(make, model) { return ((VC_MODEL_TYPES[make] || {})[model]) || "Car"; }
/* Years each model was made: [first, last] (0 = still made). Approximate; a
   model not listed here (or "Other") shows every year from VC_FIRST_YEAR. */
const VC_YEARS = {
  "Toyota": { "Aqua": [2011, 0], "Allion": [2001, 2021], "Axio": [2006, 0], "Belta": [2005, 0], "Camry": [1990, 0],
    "C-HR": [2016, 0], "Corolla": [1990, 0], "Fortuner": [2005, 0], "Hiace": [1990, 0], "Hilux": [1990, 0], "KDH": [2004, 0],
    "Land Cruiser": [1990, 0], "Land Cruiser Prado": [1990, 0], "Passo": [2004, 0], "Premio": [2001, 2021], "Prius": [1997, 0],
    "Raize": [2019, 0], "Roomy": [2016, 0], "Rush": [2006, 0], "Vitz": [1999, 2019], "Yaris": [2005, 0] },
  "Suzuki": { "A-Star": [2008, 2015], "Alto": [1990, 0], "Celerio": [2008, 0], "Dzire": [2008, 0], "Ertiga": [2012, 0],
    "Every": [1990, 0], "Estilo": [2006, 2014], "Hustler": [2014, 0], "Jimny": [1990, 0], "Spacia": [2013, 0],
    "Swift": [2000, 0], "Vitara": [1990, 0], "Wagon R": [1993, 0], "Wagon R FX": [2003, 2017], "Wagon R Stingray": [2007, 0] },
  "Honda": { "Civic": [1990, 0], "CR-V": [1995, 0], "Fit": [2001, 0], "Fit Shuttle": [2011, 2015], "Freed": [2008, 0],
    "Grace": [2014, 2020], "Insight": [1999, 2022], "Vezel": [2013, 0], "WR-V": [2017, 0],
    "CB Shine": [2006, 0], "CD 125": [1990, 0], "Dio": [1990, 0], "Hornet": [2015, 0], "X-Blade": [2018, 0] },
  "Nissan": { "Caravan": [1990, 0], "Dayz": [2013, 0], "Leaf": [2010, 0], "March": [1990, 0], "Navara": [1997, 0],
    "Note": [2004, 0], "Sunny": [1990, 0], "Tiida": [2004, 2016], "X-Trail": [2000, 0] },
  "Mitsubishi": { "Lancer": [1990, 2017], "Montero": [1990, 2021], "Outlander": [2001, 0], "Pajero": [1990, 2021],
    "L200": [1990, 0], "Eclipse Cross": [2017, 0], "Mirage": [1990, 0], "eK Wagon": [2001, 0] },
  "Mazda": { "Axela": [2003, 2019], "BT-50": [2006, 0], "CX-3": [2015, 0], "CX-5": [2012, 0], "Demio": [1996, 2019],
    "Familia": [1990, 2004] },
  "Micro": { "Panda": [2008, 2014], "Trend": [2010, 2015], "MX7": [2011, 2015], "Actyon": [2006, 2015],
    "Kyron": [2005, 2014], "Rexton": [2001, 2015] },
  "Hyundai": { "Accent": [1994, 0], "Creta": [2014, 0], "Elantra": [1990, 0], "Grand i10": [2013, 0], "i20": [2008, 0],
    "Santa Fe": [2000, 0], "Tucson": [2004, 0], "Venue": [2019, 0] },
  "Kia": { "Picanto": [2004, 0], "Rio": [1999, 0], "Sorento": [2002, 0], "Sportage": [1993, 0], "Sonet": [2020, 0],
    "Stonic": [2017, 0] },
  "Daihatsu": { "Boon": [2004, 0], "Hijet": [1990, 0], "Mira": [1990, 0], "Move": [1995, 0], "Rocky": [2019, 0],
    "Tanto": [2003, 0], "Terios": [1997, 0] },
  "Perodua": { "Axia": [2014, 0], "Bezza": [2016, 0], "Kelisa": [2001, 2007], "Myvi": [2005, 0], "Viva": [2007, 2014] },
  "Tata": { "Ace": [2005, 0], "Indica": [1998, 2018], "Nano": [2008, 2019], "Super Ace": [2008, 0], "Xenon": [2007, 0] },
  "Mahindra": { "Bolero": [2000, 0], "KUV100": [2016, 0], "Maxximo": [2010, 0], "Scorpio": [2002, 0], "XUV500": [2011, 2021] },
  "Bajaj": { "RE Three Wheeler": [1990, 0], "Discover": [2004, 0], "Platina": [2006, 0], "Pulsar": [2001, 0], "CT 100": [2004, 0] },
  "TVS": { "King Three Wheeler": [2008, 0], "Apache": [2005, 0], "Metro": [2009, 0], "Ntorq": [2018, 0], "Scooty Pep": [2005, 0] },
  "Hero": { "Dash": [2014, 0], "Destini": [2018, 0], "Hunk": [2007, 0], "Maestro": [2012, 0], "Pleasure": [2006, 0],
    "Splendor": [1994, 0] },
  "Yamaha": { "FZ": [2008, 0], "Fascino": [2015, 0], "Ray ZR": [2016, 0], "R15": [2008, 0] },
  "BYD": { "Atto 3": [2022, 0], "Dolphin": [2021, 0], "Seal": [2022, 0] }
};
/* Common grades as sellers write them in ad titles. Models not listed have no
   Grade choice (the Grade dropdown stays on "any grade"). */
const VC_GRADES = {
  "Toyota": { "Aqua": ["S", "G", "L", "X-Urban", "Crossover", "Z"], "Axio": ["X", "G", "Luxel", "Hybrid"],
    "Allion": ["A15", "A18", "G"], "Premio": ["F", "G", "X", "EX"], "Prius": ["S", "G", "L", "A", "Touring"],
    "Vitz": ["F", "U", "RS", "Jewela", "Safety"], "Yaris": ["X", "G", "Z", "Hybrid"], "C-HR": ["S", "G", "GT"],
    "Corolla": ["Hybrid", "G", "X"], "Passo": ["X", "Moda"], "Raize": ["X", "G", "Z"], "Roomy": ["X", "G", "Custom"],
    "Land Cruiser Prado": ["TX", "TZ"], "KDH": ["GL", "DX", "Super GL"] },
  "Suzuki": { "Wagon R": ["FX", "FZ", "Hybrid"], "Alto": ["L", "S", "X", "800", "K10"], "Swift": ["RS", "XG", "XL", "Hybrid"],
    "Spacia": ["Hybrid X", "Custom"], "Hustler": ["G", "X", "Turbo"], "Every": ["PA", "PC", "Join"] },
  "Honda": { "Vezel": ["Hybrid", "Hybrid Z", "RS", "X", "Z", "e:HEV"], "Fit": ["13G", "15X", "Hybrid", "RS", "L", "Home"],
    "Grace": ["Hybrid DX", "Hybrid LX", "Hybrid EX"], "Civic": ["EX", "LX", "Type R"], "Insight": ["G", "L", "EX"],
    "Freed": ["G", "Hybrid", "Spike"], "Fit Shuttle": ["Hybrid", "Hybrid C"] },
  "Nissan": { "Leaf": ["S", "X", "G", "e+"], "Note": ["e-Power", "X", "Medalist"], "Dayz": ["X", "S", "Highway Star"],
    "X-Trail": ["20X", "Hybrid", "Mode Premier"], "March": ["S", "X", "Bolero"] },
  "Mitsubishi": { "Outlander": ["PHEV", "G", "24G"], "Montero": ["Sport", "GLS"], "eK Wagon": ["E", "M", "G"] },
  "Mazda": { "Axela": ["15S", "Hybrid", "20S"], "Demio": ["13C", "XD", "13S"] },
  "Daihatsu": { "Mira": ["e:S", "X", "G"], "Move": ["X", "Custom"], "Tanto": ["X", "Custom"] },
  "Perodua": { "Axia": ["E", "G", "SE", "AV"], "Bezza": ["G", "X", "AV"], "Myvi": ["G", "X", "H", "AV"] }
};
/* Approximate year availability for grades whose production periods differ
   materially. Each entry is [first year, last year]; 0 means still current.
   Unlisted grades retain the model's full year range rather than guessing. */
const VC_GRADE_YEARS = {
  "Toyota": {
    "Aqua": { "S": [2011, 0], "G": [2011, 0], "L": [2011, 2017], "X-Urban": [2014, 2017], "Crossover": [2017, 2021], "Z": [2021, 0] },
    "Axio": { "X": [2006, 0], "G": [2006, 2023], "Luxel": [2006, 2012], "Hybrid": [2013, 2023] },
    "Vitz": { "F": [1999, 2019], "U": [1999, 2019], "RS": [2001, 2019], "Jewela": [2010, 2019], "Safety": [2017, 2019] },
    "Prius": { "S": [1997, 0], "G": [1997, 0], "L": [2009, 2015], "A": [2015, 0], "Touring": [2009, 0] }
  },
  "Suzuki": {
    "Wagon R": { "FX": [1993, 0], "FZ": [2012, 0], "Hybrid": [2017, 0] },
    "Alto": { "L": [1990, 0], "S": [1990, 0], "X": [1990, 0], "800": [2012, 2019], "K10": [2000, 0] },
    "Swift": { "RS": [2004, 0], "XG": [2004, 0], "XL": [2004, 0], "Hybrid": [2017, 0] }
  },
  "Honda": {
    "Vezel": { "Hybrid": [2013, 0], "Hybrid Z": [2013, 2021], "RS": [2016, 0], "X": [2013, 0], "Z": [2013, 2021], "e:HEV": [2021, 0] },
    "Fit": { "13G": [2013, 2020], "15X": [2007, 2013], "Hybrid": [2010, 2020], "RS": [2007, 2020], "L": [2013, 0], "Home": [2020, 0] },
    "Grace": { "Hybrid DX": [2014, 2020], "Hybrid LX": [2014, 2020], "Hybrid EX": [2014, 2020] }
  },
  "Nissan": {
    "Leaf": { "S": [2010, 0], "X": [2010, 0], "G": [2010, 0], "e+": [2019, 0] },
    "Note": { "e-Power": [2016, 0], "X": [2004, 0], "Medalist": [2012, 2020] },
    "Dayz": { "X": [2013, 0], "S": [2013, 0], "Highway Star": [2013, 0] },
    "X-Trail": { "20X": [2000, 2022], "Hybrid": [2015, 2022], "Mode Premier": [2015, 2022] }
  }
};
const VC_OTHER = "__other";
const VC_FIRST_YEAR = 1990;

/* Year list for the chosen make + model + grade: newest first. */
function vcYearsFor(make, model, grade) {
  const now = new Date().getFullYear();
  const modelRange = (VC_YEARS[make] || {})[model] || [VC_FIRST_YEAR, 0];
  const gradeRange = (((VC_GRADE_YEARS[make] || {})[model] || {})[grade]) || modelRange;
  const first = Math.max(modelRange[0], gradeRange[0], VC_FIRST_YEAR);
  const modelLast = modelRange[1] || now, gradeLast = gradeRange[1] || now;
  const last = Math.min(modelLast, gradeLast);
  const out = [];
  for (let y = last; y >= first; y--) out.push(vcPair(String(y)));
  return out;
}

function vcFill(sel, items, first) {
  sel.innerHTML = "";
  [first].concat(items).forEach(function (it) {
    const o = document.createElement("option");
    o.value = it[0]; o.textContent = it[1];
    sel.appendChild(o);
  });
}

function vcPair(v) { return [v, v]; }

/* show / hide the "Other" text box next to a dropdown */
function vcOtherToggle(sel, box) {
  box.hidden = sel.value !== VC_OTHER;
  box.required = !box.hidden;
  if (!box.hidden) box.focus();
}

function setupVehicleCheck() {
  if (vc_ready) return;
  vc_ready = true;
  const typeSel = document.getElementById("vcType");
  const makeSel = document.getElementById("vcMake"), modelSel = document.getElementById("vcModel");
  const yearSel = document.getElementById("vcYear");
  const makeOther = document.getElementById("vcMakeOther"), modelOther = document.getElementById("vcModelOther");

  vcFill(typeSel, VC_VEHICLE_TYPES.map(vcPair), ["", "Select vehicle type"]);
  vcFill(makeSel, [], ["", "Select a vehicle type first"]);
  makeSel.disabled = true;
  vcFill(modelSel, [], ["", "Select a make first"]);
  modelSel.disabled = true;
  /* Grade depends on the model; disabled when we list no grades for it */
  const gradeSel = document.getElementById("vcGrade");
  const fillGrades = function () {
    const g = (VC_GRADES[makeSel.value] || {})[modelSel.value] || [];
    vcFill(gradeSel, g.map(vcPair), ["", g.length ? "Any grade" : "No grades"]);
    gradeSel.disabled = !g.length;
  };
  fillGrades();

  /* Year depends on model and, when available, the selected grade's production years. */
  const fillYears = function () {
    if (!modelSel.value) {
      vcFill(yearSel, [], ["", "Select a model first"]);
      yearSel.disabled = true;
      return;
    }
    const keep = yearSel.value;
    vcFill(yearSel, vcYearsFor(makeSel.value, modelSel.value, gradeSel.value), ["", "Any year"]);
    yearSel.disabled = false;
    if (keep && yearSel.querySelector('option[value="' + keep + '"]')) yearSel.value = keep;
  };
  fillYears();

  typeSel.addEventListener("change", function () {
    const type = typeSel.value;
    const makes = Object.keys(VC_MODELS).filter(function (make) {
      return VC_MODELS[make].some(function (model) { return vcTypeFor(make, model) === type; });
    });
    vcFill(makeSel, makes.map(vcPair).concat([[VC_OTHER, "Other…"]]), ["", type ? "Select make" : "Select a vehicle type first"]);
    makeSel.disabled = !type;
    vcFill(modelSel, [], ["", "Select a make first"]);
    modelSel.disabled = true;
    fillGrades();
    fillYears();
  });

  makeSel.addEventListener("change", function () {
    const m = makeSel.value;
    vcOtherToggle(makeSel, makeOther);
    if (!m) {
      vcFill(modelSel, [], ["", "Select a make first"]);
      modelSel.disabled = true;
    } else {
      const models = (VC_MODELS[m] || []).filter(function (model) { return vcTypeFor(m, model) === typeSel.value; });
      vcFill(modelSel, models.map(vcPair).concat([[VC_OTHER, "Other…"]]), ["", "Select model"]);
      modelSel.disabled = false;
      if (m === VC_OTHER) modelSel.value = VC_OTHER;   /* unlisted make -> type the model too */
    }
    vcOtherToggle(modelSel, modelOther);
    fillGrades();
    fillYears();
    if (m === VC_OTHER) makeOther.focus();
  });
  modelSel.addEventListener("change", function () { vcOtherToggle(modelSel, modelOther); fillGrades(); fillYears(); });
  gradeSel.addEventListener("change", fillYears);
  document.getElementById("vcForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    runVehicleCheck();
  });
}

function vcRs(n) { return n ? "Rs " + Number(n).toLocaleString("en-US") : "-"; }

function runVehicleCheck() {
  const pick = function (id) {
    const v = document.getElementById(id).value;
    return (v === VC_OTHER ? document.getElementById(id + "Other").value : v).trim();
  };
  const make  = pick("vcMake");
  const model = pick("vcModel");
  const year  = document.getElementById("vcYear").value.trim();
  const grade = document.getElementById("vcGrade").value.trim();
  const out = document.getElementById("vcOut");
  const btn = document.getElementById("vcGo");
  if (!make || !model) { out.innerHTML = '<p class="vcErr">Please select a make and model.</p>'; return; }

  btn.disabled = true;
  btn.textContent = "Checking…";
  out.innerHTML = '<p class="vcHint">Checking ikman.lk and riyasewana.com…</p>';

  api("checkVehicle", [make, model, year, grade])
    .then(function (r) {
      out.innerHTML = vcSiteHtml(r.riyasewana, "riyasewana.com") + vcSiteHtml(r.ikman, "ikman.lk");
    })
    .catch(function (e) {
      if (e.access) { showGate(e.access); return; }
      out.innerHTML = '<p class="vcErr">' + escapeHtml(e.message || "Unable to check prices. Please try again.") + '</p>';
    })
    .then(function () { btn.disabled = false; btn.textContent = "Check"; });
}

function vcSiteHtml(r, name) {
  r = r || { ads: [] };
  const link = r.searchUrl
    ? ' <a href="' + escapeHtml(r.searchUrl) + '" target="_blank" rel="noopener">View on ' + escapeHtml(name) + ' ↗</a>' : "";
  let h = '<section class="vcSite"><div class="vcSiteHead"><h3>' + escapeHtml(name) + '</h3>' + link + '</div>';

  if (r.blocked) {
    return h + '<p class="vcHint">' + escapeHtml(name) + ' does not share its data with our server. Use the link above to open the same search.</p></section>';
  }
  if (r.error) return h + '<p class="vcErr">' + escapeHtml(r.error) + '</p></section>';
  if (!r.ads.length) return h + '<p class="vcHint">No matching ads were found.</p></section>';

  const s = r.summary || {};
  h += '<div class="vcStats">' +
    '<div><b>' + s.count + '</b><span>Ads</span></div>' +
    '<div><b>' + vcRs(s.min) + '</b><span>Lowest price</span></div>' +
    '<div><b>' + vcRs(s.median) + '</b><span>Median price</span></div>' +
    '<div><b>' + vcRs(s.max) + '</b><span>Highest price</span></div></div>';
  h += '<ul class="vcAds">' + r.ads.map(function (a) {
    return '<li><a href="' + escapeHtml(a.url) + '" target="_blank" rel="noopener">' + escapeHtml(a.title) + '</a>' +
      '<span class="vcPrice">' + escapeHtml(a.price || "-") + '</span>' +
      '<span class="vcMeta">' + escapeHtml([a.details, a.location, a.when].filter(Boolean).join(" · ")) + '</span></li>';
  }).join("") + '</ul></section>';
  return h;
}


/* =========================================================
   SEND QUOTATION ON WHATSAPP
   Each calculator (Vehicle Lease, Three-Wheel, Bike) gets a bar with the
   customer's WhatsApp number and a button. The button opens WhatsApp
   (wa.me) with the quotation typed in; the officer just presses Send.
   No number -> WhatsApp asks which chat to send it to.
========================================================= */

const WA_QUOTES = [
  { after: "chargesSection", kind: "vehicle", title: "Vehicle Lease" },
  { after: "twGrid",         kind: "tw",      title: "Three-Wheel Lease" },
  { after: "bkGrid",         kind: "bk",      title: "Bike Lease" }
];

/* Quotations are sent from a phone only (WhatsApp opens in the phone's app). */
function isPhone() {
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPod|Mobile|Windows Phone/i.test(ua) ||
         (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1 && window.matchMedia("(pointer: coarse)").matches);
}

/* Officer's mobile for the quotation: saved at login; older sessions ask the server once. */
function loadOfficerInfo() {
  if (lsGet("mastercal_phone")) return;
  const tok = getToken();
  if (!tok) return;
  api("whoami", [tok]).then(function (d) {
    if (!d) return;
    lsSet("mastercal_name", d.name || "");
    lsSet("mastercal_phone", d.phone || "");
  }).catch(function () {});
}

/* +94771234567 -> 077 123 4567 */
function localPhone(p) {
  let d = String(p || "").replace(/[^\d]/g, "");
  if (d.indexOf("94") === 0 && d.length === 11) d = "0" + d.slice(2);
  return d.length === 10 ? d.slice(0, 3) + " " + d.slice(3, 6) + " " + d.slice(6) : String(p || "");
}

function setupWhatsAppQuotes() {
  if (!isPhone()) return;
  loadOfficerInfo();
  WA_QUOTES.forEach(function (q) {
    const anchor = document.getElementById(q.after);
    if (!anchor || document.getElementById("waq_" + q.kind)) return;
    const bar = document.createElement("div");
    bar.className = "waQuote";
    bar.innerHTML =
      '<div class="waQuoteTitle">Send quotation via WhatsApp</div>' +
      '<div class="waQuoteRow">' +
      '<input id="waq_' + q.kind + '" type="tel" inputmode="tel" placeholder="Customer WhatsApp (07XXXXXXXX)">' +
      (canPickContact() ? '<button type="button" class="waQuotePick" aria-label="Contacts">📇 Contacts</button>' : '') +
      '<button type="button" class="waQuoteBtn">Send via WhatsApp</button></div>' +
      (canPickContact() ? '' : '<div class="waQuoteHint">Leave the number blank and tap Send to choose the customer from your WhatsApp contacts.</div>');
    bar.querySelector(".waQuoteBtn").addEventListener("click", function () { sendQuoteWhatsApp(q); });
    const pick = bar.querySelector(".waQuotePick");
    if (pick) pick.addEventListener("click", function () { pickContactInto(document.getElementById("waq_" + q.kind)); });
    anchor.parentNode.insertBefore(bar, anchor.nextSibling);
  });
}

/* Phone contacts picker (Android Chrome). iPhone has none: there WhatsApp's own chat list is used. */
function canPickContact() {
  return !!(navigator.contacts && navigator.contacts.select && window.ContactsManager);
}
function pickContactInto(box) {
  navigator.contacts.select(["name", "tel"], { multiple: false }).then(function (list) {
    const tels = (list && list[0] && list[0].tel) || [];
    if (!tels.length) return;
    /* prefer a Sri Lankan mobile (07…, +947…) when the contact has several numbers */
    const mob = tels.filter(function (t) { return /^(\+?94|0)?7\d{8}$/.test(String(t).replace(/[^\d+]/g, "")); });
    box.value = String(mob[0] || tels[0]).trim();
  }).catch(function () {});
}

/* 0771234567 / +94 77 123 4567 -> 94771234567 ("" when blank or too short) */
function waNumber(raw) {
  let d = String(raw || "").replace(/[^\d]/g, "");
  if (d.indexOf("00") === 0) d = d.slice(2);
  if (d.length === 10 && d.charAt(0) === "0") d = "94" + d.slice(1);
  if (d.length === 9) d = "94" + d;
  return d.length >= 11 ? d : "";
}

/* the shown value of an input / select / text cell */
function qVal(el) {
  if (!el) return "";
  if (el.tagName === "SELECT") return el.selectedIndex >= 0 ? el.options[el.selectedIndex].text.trim() : "";
  if (el.tagName === "INPUT") return String(el.value || "").trim();
  return String(el.textContent || "").trim();
}

function qNum(v) { return Number(String(v).replace(/[^\d.\-]/g, "")) || 0; }
function qMoney(v) { return qNum(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }



/* The quotation, in the layout the owner gave:
     Facility Amount, Capitalized Insurance, Capitalized StampDuty, Period,
     *Monthly Rental*, *Upfront Charges* (total only), then the officer's number.
   BIC is never shown. */
function quoteLines(kind) {
  const L = [];
  let rental, total, bullets = [];
  if (kind === "vehicle") {
    const fa = qVal(document.getElementById("facilityAmount"));
    if (qNum(fa)) L.push(["Facility Amount", qMoney(fa)]);
    const cap = lastCapAmounts || [];
    if (nonZeroAmt(cap[1])) L.push(["Capitalized Insurance", qMoney(cap[1])]);
    if (nonZeroAmt(cap[2])) L.push(["Capitalized StampDuty", qMoney(cap[2])]);
    const per = qVal(document.getElementById("period"));
    if (per) L.push(["Period (months)", per]);
    rental = qVal(document.getElementById("monthlyRental"));
    total = qVal(document.getElementById("chargesTotal"));
    bullets = quoteBullets();
  } else {
    const grid = document.getElementById(kind === "tw" ? "twGrid" : "bkGrid");
    if (!grid || !grid.querySelector(".tw-card")) return null;
    grid.querySelectorAll(".field").forEach(function (f) {
      const lab = f.querySelector("label");
      const label = lab ? lab.textContent.replace(/\s+/g, " ").trim() : "";
      const val = qVal(f.querySelector("select, input"));
      if (/FACILITY/i.test(label) && qNum(val)) L.push(["Facility Amount", qMoney(val)]);
      if (/^PERIOD/i.test(label) && val) L.push(["Period (months)", val]);
    });
    rental = qVal(document.getElementById(kind + "_monthlyRental"));
    total = qVal(document.getElementById(kind + "_chargesTotal"));
  }
  return { main: L, rental: rental, total: total, bullets: bullets };
}

/* Bullet payment rows with a FROM month and an AMOUNT: "Month 12" (manual) or "Month 1–12" (slabbed). */
function quoteBullets() {
  const out = [];
  const slab = String(value("scheduleType") || "").toUpperCase() === "SLABBED SCHEDULE";
  document.querySelectorAll("#scheduleBody tr[data-index]").forEach(function (tr) {
    const ins = tr.querySelectorAll("input");
    const from = qVal(ins[0]), to = qVal(ins[1]), amt = qVal(ins[2]);
    if (!from || !qNum(amt)) return;
    out.push(["Month " + from + (slab && to && to !== from ? "–" + to : ""), qMoney(amt)]);
  });
  return out;
}

/* Link for the customer to ask for a vehicle, or (sell) to sell theirs (VehicleHUB public request page, no login).
   ref = this officer, so the request comes straight to them. */
function quoteRequestLink(q, num, sell) {
  const ref = lsGet("vehiclehub_username") || getUsername();
  const v = { vehicle: "car", tw: "tw", bk: "bike" }[q.kind] || "";
  let u = VEHICLEHUB_URL + "request.html?q=1" + (sell ? "&type=seller" : "") + (v ? "&v=" + v : "");
  if (ref) u += "&ref=" + encodeURIComponent(ref);
  if (num) u += "&p=" + num;
  return u;
}

function quoteText(q, num) {
  const d = quoteLines(q.kind);
  if (!d) return "";
  const t = ["Dear Customer,", "Please find below your requested *" + q.title + "* quotation:", ""];
  d.main.forEach(function (r) {
    if (r[0] === "Facility Amount") t.push("Facility Amount  : " + r[1]);
    else if (r[0] === "Period (months)") t.push("Period (months) : " + qMoney(r[1]));   /* 24 -> 24.00 */
    else t.push(r[0] + " : " + r[1]);
  });
  const hasBullet = d.bullets && d.bullets.length;
  t.push("", "*Monthly Rental" + (hasBullet ? " (with Bullet)" : "") + "  : " + d.rental + "*");
  if (hasBullet) {
    t.push("", "*Bullet Payments:*");
    d.bullets.forEach(function (r) { t.push(r[0] + ": " + r[1]); });
  }
  if (qNum(d.total)) t.push("", "*Initial Charges    : " + d.total + "*");
  const tel = lsGet("mastercal_phone");   /* the officer's WhatsApp number */
  t.push("", "This quotation is an estimate only. For further details, please contact us" + (tel ? " on " + localPhone(tel) : "") + ".");
  t.push("", "🚗 ඔබට වාහනයක් අවශ්‍යද? ඔබට අවශ්‍ය දේ අපට කියන්න, අපි ඔබ වෙනුවෙන් එය සොයා දෙන්නෙමු:", quoteRequestLink(q, num));
  t.push("", "💰 ඔබේ වාහනය විකුණන්නද? විස්තර අප සමඟ බෙදාගන්න, අපි ඔබට ගැනුම්කරුවෙකු සොයා දෙන්නෙමු:", quoteRequestLink(q, num, true));
  return t.join("\n");
}

function sendQuoteWhatsApp(q) {
  const d = quoteLines(q.kind);
  if (!d || !qNum(d.rental)) { alert("Please complete the calculation first (the monthly rental is zero)."); return; }
  const box = document.getElementById("waq_" + q.kind);
  const raw = box ? box.value : "";
  const num = waNumber(raw);
  if (String(raw).trim() && !num) { alert("Please enter a valid WhatsApp number (e.g. 0771234567)."); return; }
  window.open("https://wa.me/" + num + "?text=" + encodeURIComponent(quoteText(q, num)), "_blank", "noopener");
}
