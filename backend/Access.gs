/******************************************************
 * MasterCAL Pro
 * Access.gs — user approval / allowlist
 *
 * A "USERS" tab in the MASTER sheet holds:
 *   User (wa:<number>) | Name | Status | Requested | Approved | Phone | Verified | Email | Username | Password
 * (Password holds a salted hash only — see Login.gs.)
 * Status is one of: PENDING / APPROVED / BLOCKED
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

/* Read-only look at someone's status. Never writes a row and never e-mails the owner.
   Returns NO_PHONE / PENDING / APPROVED / BLOCKED, or NEW (not in the sheet yet). */
function peekAccess_(email) {
  email = normEmail_(email);
  if (!email) return { status: "NO_PHONE" };
  const data = usersData_(getUsersSheet_());
  for (let i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === email) return { status: String(data[i][2] || "PENDING").trim().toUpperCase() };
  }
  return { status: "NEW" };
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
        ? ('<p style="margin:22px 0">' + btn(approveUrl, "#1c5e3a", "✓ APPROVE") +
           btn(rejectUrl, "#d8261c", "✕ REJECT") + '</p>' +
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
            "Approve: " + approveUrl + "\nReject: " + rejectUrl
    });
  } catch (e) {
    /* mail quota / not authorised: the app keeps working, but say so in Executions → Logs */
    try { Logger.log("notifyOwner_ FAILED for " + email + ": " + (e && e.message ? e.message : e)); } catch (e2) {}
  }
}

/* Handle an APPROVE / REJECT link click from the email (token-checked).
   Returns an HTML confirmation page. */
function handleEmailApproval_(action, email, token) {
  email = normEmail_(email);
  if (!email) return approvalPage_("Missing user.", false);
  if (String(token) !== approvalToken_(email)) {
    return approvalPage_("Invalid or expired link.", false);
  }
  const status = (action === "approveUser") ? "APPROVED" : "BLOCKED";
  const s = getUsersSheet_();
  const data = usersData_(s);
  for (let i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === email) {
      s.getRange(i + 1, 3).setValue(status);
      if (status === "APPROVED") s.getRange(i + 1, 5).setValue(new Date());
      accessCacheClear_(email);       /* after the sheet change, so nothing stale can be re-cached */
      return approvalPage_(escapeHtml_(keyToPhone_(email)) + " → " + status, status === "APPROVED");
    }
  }
  s.appendRow([email, "", status, new Date(), status === "APPROVED" ? new Date() : ""]);
  accessCacheClear_(email);
  return approvalPage_(escapeHtml_(keyToPhone_(email)) + " → " + status, status === "APPROVED");
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
    "Approve කරන්න ඕන WhatsApp number එක type කරන්න (e.g. 0771234567):", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;

  const email = phoneKey_(r.getResponseText());
  if (!email) { ui.alert("හරි WhatsApp number එකක් දාන්න."); return; }

  const s = getUsersSheet_();
  const data = usersData_(s);
  for (let i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === email) {
      s.getRange(i + 1, 3).setValue("APPROVED");
      s.getRange(i + 1, 5).setValue(new Date());
      accessCacheClear_(email);
      ui.alert("Approved ✅", keyToPhone_(email) + " approved.", ui.ButtonSet.OK);
      return;
    }
  }
  s.appendRow([email, "", "APPROVED", new Date(), new Date(), email.slice(3), ""]);
  ui.alert("Approved ✅", keyToPhone_(email) + " added & approved.", ui.ButtonSet.OK);
}

function menuBlockUser_() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt("Block user",
    "Block කරන්න ඕන WhatsApp number එක type කරන්න:", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const email = phoneKey_(r.getResponseText());
  if (!email) { ui.alert("හරි WhatsApp number එකක් දාන්න."); return; }
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
  ui.alert("Not found", keyToPhone_(email) + " list එකේ නෑ.", ui.ButtonSet.OK);
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
    p + " user(s) waiting.\nUSERS sheet එකේ Status එක APPROVED කරන්න, " +
    "නැත්නම් menu එකෙන් Approve කරන්න.", ui.ButtonSet.OK);
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
