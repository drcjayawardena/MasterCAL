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
  "https://script.google.com/macros/s/AKfycbxhavjw3sHtplSyxuSy2kCnfclb2-1JnQAlr0jxgHwSO62y93rmWRLv0DJWMkpZP3E4oQ/exec";


/* =========================================================
   API HELPER
   Uses text/plain body to stay a "simple" CORS request
   (no preflight) so Apps Script can respond.
========================================================= */

/* Per-user identity — each user gets their own isolated Sheet copy. */
function getUserId() {
  let id = null;
  try { id = localStorage.getItem("mastercal_uid"); } catch (e) {}
  if (!id) {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "u" + Date.now() + Math.random().toString(36).slice(2);
    try { localStorage.setItem("mastercal_uid", id); } catch (e) {}
  }
  return id;
}

function getEmail() { try { return localStorage.getItem("mastercal_email") || ""; } catch (e) { return ""; } }
function getName()  { try { return localStorage.getItem("mastercal_name")  || ""; } catch (e) { return ""; } }
function setIdentity(email, name) {
  try {
    localStorage.setItem("mastercal_email", email);
    localStorage.setItem("mastercal_name", name || "");
  } catch (e) {}
}

async function api(action, args) {

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

  /* One round trip: clear + dropdowns + outputs + schedule. */
  api("init")
    .then(function (result) {

      if (!result) return;

      if (result.dropdowns) {
        fillSelect("productType", result.dropdowns.productTypes || []);
        fillSelect("stampDuty",
          (result.stampDuty || result.dropdowns.stampDuty) || []);
      }

      if (result.outputs) showOutputs(result.outputs);

      drawSchedule(result.schedule || []);
      hideRentalSchedule();
    })
    .catch(function (error) {
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
      saveTimer = setTimeout(saveInputs, 300);
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

  api("saveInputs", [data])
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
