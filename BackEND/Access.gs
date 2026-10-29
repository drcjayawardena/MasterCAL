/******************************************************
 * MasterCAL Pro
 * Access.gs — user approval / allowlist
 *
 * A "USERS" tab in the MASTER sheet holds:
 *   User (wa:<number>) | Name | Status | Requested | Approved | Phone | Verified | Email | Username | Password | VehicleHUB
 * (Password holds a salted hash only — see Login.gs.)
 * Status is one of: PENDING / APPROVED / BLOCKED
 * VehicleHUB (column K) is chosen when approving: YES = the user also gets the VehicleHUB
 * part, NO = MasterCAL only. Empty means YES, so users approved before this column keep it.
 *
 * New users register with their name + WhatsApp number (Register.gs).
 * You approve them (menu, or edit the Status cell).
 ******************************************************/

const USERS_SHEET = "USERS";

/* ---- IDENTITY = WHATSAPP NUMBER ----
   Nobody registers with an e-mail any more. A user is identified by the WhatsApp number they
   typed when registering (not verified — the owner's approval is the check). Column A of USERS holds that key as "wa:<digits>", e.g.
   "wa:94771234567" (the "wa:" prefix keeps Sheets from turning it into a number).
   Old e-mail rows stay in the sheet but can no longer sign in. */

/* USERS key for a phone number: "wa:94771234567" ("" when the number is not valid). */
function phoneKey_(p) {
  const s = String(p == null ? "" : p).trim();
  const d = normPhone_(/^wa:/i.test(s) ? s.slice(3) : s);   /* normPhone_ lives in Register.gs */
  return (d.length >= 10 && d.length <= 15) ? "wa:" + d : "";
}

/* "wa:94771234567" -> "+94771234567" for display. */
function keyToPhone_(key) {
  const s = String(key || "");
  return /^wa:/i.test(s) ? "+" + s.slice(3) : s;
}

function escapeHtml_(t) {
  return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* >>> SET THIS <<< your email for new-request notifications.
   Leave "" to auto-use the script owner's email. */
const ADMIN_EMAIL = "";

function master_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function adminEmail_() {
  if (ADMIN_EMAIL) return ADMIN_EMAIL;
  try { return Session.getEffectiveUser().getEmail() || ""; } catch (e) { return ""; }
}

function normEmail_(e) { return String(e || "").trim().toLowerCase(); }

function getUsersSheet_() {
  const ss = master_();
  let s = ss.getSheetByName(USERS_SHEET);
  if (!s) {
    s = ss.insertSheet(USERS_SHEET);
    s.appendRow(["User (wa:number)", "Name", "Status", "Requested", "Approved", "Phone", "Verified", "Email", "Username", "Password"]);
    s.setFrozenRows(1);
    s.getRange("A1:J1").setFontWeight("bold");
  }
  return s;
}

const VH_COL = 11;   /* USERS column K: VehicleHUB YES / NO */

/* Does this user (USERS key) have the VehicleHUB part? Empty / unknown -> yes. */
function vhAllowed_(key) {
  key = normEmail_(key);
  const s = getUsersSheet_();
  const last = s.getLastRow();
  if (last < 2 || s.getLastColumn() < VH_COL) return true;
  const keys = s.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (normEmail_(keys[i][0]) === key) {
      return !/^(no|false|n|0)$/i.test(String(s.getRange(i + 2, VH_COL).getValue()).trim());
    }
  }
  return true;
}

/* Write YES / NO to column K of a USERS row (1-based sheet row); adds the header once. */
function vhSet_(s, row, allowed) {
  if (!String(s.getRange(1, VH_COL).getValue())) {
    s.getRange(1, VH_COL).setValue("VehicleHUB").setFontWeight("bold");
  }
  s.getRange(row, VH_COL).setValue(allowed ? "YES" : "NO");
}

function usersData_(s) {
  const last = Math.max(s.getLastRow(), 1);
  return s.getRange(1, 1, last, 5).getValues();
}

/* Returns { status: "APPROVED" | "PENDING" | "BLOCKED" | "NO_PHONE" }
   `email` is the USERS key ("wa:<digits>"); the name is kept for the old call sites. */
function checkAccess_(email, name) {
  email = normEmail_(email);
  if (!email) return { status: "NO_PHONE" };

  const s = getUsersSheet_();
  let data = usersData_(s);
  for (let i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === email) {
      return { status: String(data[i][2] || "PENDING").trim().toUpperCase() };
    }
  }

  /* Not in USERS: send the app to the register screen. Only the "register" action
     (Register.gs) writes a row and e-mails the owner. */
  return { status: "NO_PHONE" };
}

/* SPEED: an APPROVED answer is remembered for 5 minutes (CacheService), so
   most requests skip reading the USERS sheet. Only APPROVED is cached.
   If you BLOCK someone from the menu / e-mail link the cache is cleared at
   once; if you change Status by hand in the USERS sheet it takes up to
   ACCESS_CACHE_SECONDS to apply. */
const ACCESS_CACHE_SECONDS = 300;

function checkAccessFast_(email, name) {
  const e = normEmail_(email);
  if (!e) return { status: "NO_PHONE" };
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (err) {}
  const key = "acc_" + e;
  if (cache) { try { if (cache.get(key) === "APPROVED") return { status: "APPROVED" }; } catch (err) {} }
  const r = checkAccess_(email, name);
  if (cache && r.status === "APPROVED") { try { cache.put(key, "APPROVED", ACCESS_CACHE_SECONDS); } catch (err) {} }
  return r;
}

function accessCacheClear_(email) {
  try { CacheService.getScriptCache().remove("acc_" + normEmail_(email)); } catch (err) {}
}

/* One secret per project — used to sign approve/reject links. */
function getApprovalSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty("APPROVAL_SECRET");
  if (!s) { s = Utilities.getUuid(); props.setProperty("APPROVAL_SECRET", s); }
  return s;
}

/* A short token that only someone with the secret can produce. */
function approvalToken_(email) {
  const raw = getApprovalSecret_() + "|" + normEmail_(email);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += ("0" + (bytes[i] & 0xff).toString(16)).slice(-2);
  return hex.slice(0, 24);
}

/* Email the owner when a new user requests access — with one-click
   APPROVE / REJECT buttons (secured by a per-email token). */
function notifyOwner_(email, name, phone, how, contactEmail) {
  try {
    const to = adminEmail_();
    if (!to) return;

    let base = "";
    try { base = ScriptApp.getService().getUrl() || ""; } catch (e) { base = ""; }
    const tok = approvalToken_(email);
    const approveUrl = base + "?action=approveUser&email=" + encodeURIComponent(email) + "&token=" + tok;
    const approveVhUrl = approveUrl + "&vh=1";   /* MasterCAL + VehicleHUB */
    const approveMcUrl = approveUrl + "&vh=0";   /* MasterCAL only */
    const rejectUrl  = base + "?action=blockUser&email="  + encodeURIComponent(email) + "&token=" + tok;

    const btn = function (url, bg, label) {
      return '<a href="' + url + '" style="display:inline-block;background:' + bg +
        ';color:#fff;padding:11px 26px;border-radius:6px;text-decoration:none;' +
        'font-weight:bold;font-family:Arial,sans-serif;margin-right:10px">' + label + '</a>';
    };

    /* what was verified: the e-mail (code sent to the @cf.lk mailbox) or the WhatsApp number */
    const waLine = escapeHtml_(phone || keyToPhone_(email)) +
      ' &nbsp;<span style="color:#8797a0;font-size:12px">(not verified — check before approving)</span>';

    const html =
      '<div style="font-family:Arial,sans-serif;font-size:14px;color:#20323a;max-width:520px">' +
      '<h2 style="color:#1c5e3a;margin:0 0 12px">MasterCAL Pro — new access request</h2>' +
      '<p style="line-height:1.6"><b>WhatsApp:</b> ' + waLine +
      '<br><b>Name:</b> ' + (name ? escapeHtml_(name) : "(not given)") +
      '<br><b>Email:</b> ' + (contactEmail ? escapeHtml_(contactEmail) : "(not given)") + '</p>' +
      (base
        ? ('<p style="margin:22px 0 8px">' + btn(approveVhUrl, "#1c5e3a", "✓ APPROVE + VehicleHUB") + '</p>' +
           '<p style="margin:8px 0">' + btn(approveMcUrl, "#2f7d9b", "✓ APPROVE — MasterCAL only") + '</p>' +
           '<p style="margin:8px 0 22px">' + btn(rejectUrl, "#d8261c", "✕ REJECT") + '</p>' +
           '<p style="color:#8797a0;font-size:12px">Click a button above — it opens a confirmation page.</p>')
        : '<p style="color:#d8261c">Deploy the web app so approve/reject links can be generated.</p>') +
      '<p style="color:#8797a0;font-size:12px">Or: master sheet → ⚙️ MasterCAL Admin → ✅ Approve a user (type the WhatsApp number).</p>' +
      '</div>';

    MailApp.sendEmail({
      to: to,
      subject: "MasterCAL Pro — new access request: " + (phone || keyToPhone_(email)),
      htmlBody: html,
      body: "New request: " + (phone || keyToPhone_(email)) + " (" + (name || "") + ")\n" +
            (contactEmail ? "Email: " + contactEmail + "\n" : "") +
            "The number is not verified — check it before approving.\n" +
            "Approve + VehicleHUB: " + approveVhUrl + "\nApprove (MasterCAL only): " + approveMcUrl +
            "\nReject: " + rejectUrl
    });
  } catch (e) {
    /* mail quota / not authorised: the app keeps working, but say so in Executions → Logs */
    try { Logger.log("notifyOwner_ FAILED for " + email + ": " + (e && e.message ? e.message : e)); } catch (e2) {}
  }
}

/* Handle an APPROVE / REJECT link click from the email (token-checked).
   vh: "1" = also VehicleHUB, "0" = MasterCAL only; links from older e-mails have none (-> VehicleHUB).
   Returns an HTML confirmation page. */
function handleEmailApproval_(action, email, token, vh) {
  email = normEmail_(email);
  if (!email) return approvalPage_("Missing user.", false);
  if (String(token) !== approvalToken_(email)) {
    return approvalPage_("Invalid or expired link.", false);
  }
  const status = (action === "approveUser") ? "APPROVED" : "BLOCKED";
  const withVh = String(vh) !== "0";
  const note = status === "APPROVED" ? (withVh ? " (MasterCAL + VehicleHUB)" : " (MasterCAL only)") : "";
  const s = getUsersSheet_();
  const data = usersData_(s);
  for (let i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === email) {
      const was = String(data[i][2] || "").trim().toUpperCase();
      s.getRange(i + 1, 3).setValue(status);
      if (status === "APPROVED") { s.getRange(i + 1, 5).setValue(new Date()); vhSet_(s, i + 1, withVh); }
      accessCacheClear_(email);       /* after the sheet change, so nothing stale can be re-cached */
      if (status === "APPROVED" && was !== "APPROVED") {
        const row = s.getRange(i + 1, 1, 1, 8).getValues()[0];
        if (withVh) sendManualToRow_(row);   /* Manual.gs — the VehicleHUB user manual */
        sendApprovedWhatsApp_(row);   /* WhatsApp.gs */
      }
      return approvalPage_(escapeHtml_(keyToPhone_(email)) + " → " + status + note, status === "APPROVED");
    }
  }
  s.appendRow([email, "", status, new Date(), status === "APPROVED" ? new Date() : ""]);
  if (status === "APPROVED") vhSet_(s, s.getLastRow(), withVh);
  accessCacheClear_(email);
  return approvalPage_(escapeHtml_(keyToPhone_(email)) + " → " + status + note, status === "APPROVED");
}

function approvalPage_(msg, ok) {
  const color = ok ? "#1c5e3a" : "#d8261c";
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font-family:Arial,sans-serif;text-align:center;padding:60px 24px;color:#20323a">' +
    '<div style="font-size:46px;margin-bottom:10px">' + (ok ? "✅" : "⚠️") + '</div>' +
    '<h2 style="color:' + color + ';margin:0 0 8px">MasterCAL Pro</h2>' +
    '<p style="font-size:17px">' + msg + '</p>' +
    '<p style="color:#8797a0;font-size:13px;margin-top:18px">You can close this tab.</p>' +
    '</div>'
  ).setTitle("MasterCAL Pro");
}

/* Menu: send a test notification to confirm email works. */
function menuTestEmail_() {
  const ui = SpreadsheetApp.getUi();
  const to = adminEmail_();
  if (!to) { ui.alert("No admin email found. Set ADMIN_EMAIL in Access.gs."); return; }
  try {
    MailApp.sendEmail(to, "MasterCAL Pro — test notification",
      "✅ This is a test. New-user notifications will arrive at: " + to);
    ui.alert("Sent ✅", "Test email sent to " + to + ".\nCheck your inbox (and Spam).", ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("Failed", "Could not send: " + e.message +
      "\n\nMake sure you re-authorized the script (Run initApp once).", ui.ButtonSet.OK);
  }
}


/*====================================================
  ADMIN HELPERS (called from the sheet menu)
====================================================*/

function menuApproveUser_() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt("Approve user",
    "Enter the WhatsApp number of the user to approve (e.g. 0771234567):", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;

  const email = phoneKey_(r.getResponseText());
  if (!email) { ui.alert("Please enter a valid WhatsApp number."); return; }

  const q = ui.alert("VehicleHUB",
    "Give " + keyToPhone_(email) + " the VehicleHUB part too?\n\nYes = MasterCAL + VehicleHUB\nNo = MasterCAL only",
    ui.ButtonSet.YES_NO_CANCEL);
  if (q === ui.Button.CANCEL || q === ui.Button.CLOSE) return;
  const withVh = q === ui.Button.YES;
  const note = withVh ? " (MasterCAL + VehicleHUB)" : " (MasterCAL only)";

  const s = getUsersSheet_();
  const data = usersData_(s);
  for (let i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === email) {
      const was = String(data[i][2] || "").trim().toUpperCase();
      s.getRange(i + 1, 3).setValue("APPROVED");
      s.getRange(i + 1, 5).setValue(new Date());
      vhSet_(s, i + 1, withVh);
      accessCacheClear_(email);
      const row = s.getRange(i + 1, 1, 1, 8).getValues()[0];
      const sent = was !== "APPROVED" && withVh && sendManualToRow_(row);   /* Manual.gs */
      const wa = was !== "APPROVED" && sendApprovedWhatsApp_(row);          /* WhatsApp.gs */
      ui.alert("Approved ✅", keyToPhone_(email) + " approved" + note + "." +
        (sent ? "\nVehicleHUB user manual e-mailed." : "") +
        (wa ? "\nWhatsApp message sent." : ""), ui.ButtonSet.OK);
      return;
    }
  }
  s.appendRow([email, "", "APPROVED", new Date(), new Date(), email.slice(3), ""]);
  vhSet_(s, s.getLastRow(), withVh);
  ui.alert("Approved ✅", keyToPhone_(email) + " added & approved" + note + ".", ui.ButtonSet.OK);
}

function menuBlockUser_() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt("Block user",
    "Enter the WhatsApp number of the user to block:", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const email = phoneKey_(r.getResponseText());
  if (!email) { ui.alert("Please enter a valid WhatsApp number."); return; }
  const s = getUsersSheet_();
  const data = usersData_(s);
  for (let i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === email) {
      s.getRange(i + 1, 3).setValue("BLOCKED");
      accessCacheClear_(email);
      ui.alert("Blocked", keyToPhone_(email) + " blocked.", ui.ButtonSet.OK);
      return;
    }
  }
  ui.alert("Not found", keyToPhone_(email) + " was not found in the user list.", ui.ButtonSet.OK);
}

/* Build an APPROVED_USERS sheet listing everyone approved. */
function menuApprovedList_() {
  const ui = SpreadsheetApp.getUi();
  const s = getUsersSheet_();
  const data = usersData_(s);

  const out = [["WhatsApp", "Name", "Approved On"]];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim().toUpperCase() === "APPROVED") {
      out.push([ keyToPhone_(data[i][0]), data[i][1], data[i][4] ]);
    }
  }

  const ss = master_();
  let list = ss.getSheetByName("APPROVED_USERS");
  if (list) ss.deleteSheet(list);
  list = ss.insertSheet("APPROVED_USERS");
  list.getRange(1, 1, out.length, 3).setValues(out);
  list.setFrozenRows(1);
  list.getRange("A1:C1").setFontWeight("bold");
  list.autoResizeColumns(1, 3);
  ss.setActiveSheet(list);

  ui.alert("Approved users",
    (out.length - 1) + " approved user(s).\nList generated in the APPROVED_USERS tab.",
    ui.ButtonSet.OK);
}

function menuPendingCount_() {
  const ui = SpreadsheetApp.getUi();
  const s = getUsersSheet_();
  const data = usersData_(s);
  let p = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim().toUpperCase() === "PENDING") p++;
  }
  ui.alert("Pending users",
    p + " user(s) waiting.\nSet their Status to APPROVED in the USERS sheet, " +
    "or use Approve a user in the menu.", ui.ButtonSet.OK);
}

/* Menu: old e-mail rows in USERS (from before WhatsApp sign-in). They can no longer sign in;
   nothing is changed here. (Kept under the old function name so the existing menu still works.) */
function menuNonCfUsers_() {
  const ui = SpreadsheetApp.getUi();
  const data = usersData_(getUsersSheet_());
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const k = normEmail_(data[i][0]);
    if (k && k.indexOf("wa:") !== 0) out.push(k + "  —  " + String(data[i][2] || "PENDING").trim().toUpperCase());
  }
  ui.alert("Old e-mail users",
    out.length
      ? out.length + " old e-mail row(s):\n\n" + out.slice(0, 25).join("\n") + (out.length > 25 ? "\n…" : "") +
        "\n\nThese people must register again with their WhatsApp number."
      : "Every user in the USERS sheet signs in with WhatsApp.",
    ui.ButtonSet.OK);
}
