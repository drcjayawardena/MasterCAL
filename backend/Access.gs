/******************************************************
 * MasterCAL Pro
 * Access.gs — user approval / allowlist
 *
 * A "USERS" tab in the MASTER sheet holds:
 *   Email | Name | Status | Requested | Approved
 * Status is one of: PENDING / APPROVED / BLOCKED
 *
 * New users auto-register as PENDING on first request.
 * You approve them (menu, or edit the Status cell).
 ******************************************************/

const USERS_SHEET = "USERS";

/* ---- WHO MAY REGISTER AND BE APPROVED ----
   Only e-mail addresses ending in @cf.lk. Nobody else can register, be approved from the
   menu, be approved from the e-mail link, or be auto-approved by the WhatsApp registration. */
const ALLOWED_EMAIL_DOMAIN = "cf.lk";

/* Addresses OUTSIDE the domain that are allowed anyway (lower-case), e.g. the owner's own
   address:  ["someone@gmail.com"]  */
const EMAIL_DOMAIN_EXCEPTIONS = [];

/* false = people who are ALREADY in the USERS sheet keep their status; the rule applies to new
           registrations and to every approval.
   true  = every request from a non-@cf.lk address is refused, even if already APPROVED. */
const ENFORCE_DOMAIN_ON_EVERY_REQUEST = false;

function isAllowedEmail_(email) {
  const e = normEmail_(email);
  if (!e) return false;
  if (EMAIL_DOMAIN_EXCEPTIONS.map(normEmail_).indexOf(e) !== -1) return true;
  return new RegExp("^[^@\\s]+@" + ALLOWED_EMAIL_DOMAIN.replace(/\./g, "\\.") + "$").test(e);
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
    s.appendRow(["Email", "Name", "Status", "Requested", "Approved", "Phone", "Verified"]);
    s.setFrozenRows(1);
    s.getRange("A1:G1").setFontWeight("bold");
  }
  return s;
}

function usersData_(s) {
  const last = Math.max(s.getLastRow(), 1);
  return s.getRange(1, 1, last, 5).getValues();
}

/* Returns { status: "APPROVED" | "PENDING" | "BLOCKED" | "NO_EMAIL" } */
function checkAccess_(email, name) {
  email = normEmail_(email);
  if (!email) return { status: "NO_EMAIL" };
  if (ENFORCE_DOMAIN_ON_EVERY_REQUEST && !isAllowedEmail_(email)) return { status: "DOMAIN" };

  const s = getUsersSheet_();
  let data = usersData_(s);
  for (let i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === email) {
      return { status: String(data[i][2] || "PENDING").trim().toUpperCase() };
    }
  }

  /* A NEW address outside the domain is refused: no row is written and the owner gets no e-mail. */
  if (!isAllowedEmail_(email)) return { status: "DOMAIN" };

  /* A code screen is ON (e-mail or WhatsApp OTP): a new person may only enter through it. Calling
     the API directly with an unknown e-mail must NOT create a row or e-mail the owner; the app
     sends them to the register screen instead. The owner's approval e-mail is sent only AFTER
     the code has been entered correctly (registerVerifiedUser_ in WhatsApp.gs). */
  try { if (otpRequired_()) return { status: "NO_EMAIL" }; } catch (e) {}

  /* Not found -> register as PENDING (locked to avoid duplicate rows). */
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    data = usersData_(s);
    for (let i = 1; i < data.length; i++) {
      if (normEmail_(data[i][0]) === email) {
        return { status: String(data[i][2] || "PENDING").trim().toUpperCase() };
      }
    }
    s.appendRow([email, String(name || ""), "PENDING", new Date(), ""]);
    notifyOwner_(email, name);   /* email the owner about the new request */
  } finally {
    lock.releaseLock();
  }
  return { status: "PENDING" };
}

/* SPEED: an APPROVED answer is remembered for 5 minutes (CacheService), so
   most requests skip reading the USERS sheet. Only APPROVED is cached.
   If you BLOCK someone from the menu / e-mail link the cache is cleared at
   once; if you change Status by hand in the USERS sheet it takes up to
   ACCESS_CACHE_SECONDS to apply. */
const ACCESS_CACHE_SECONDS = 300;

function checkAccessFast_(email, name) {
  const e = normEmail_(email);
  if (!e) return { status: "NO_EMAIL" };
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
   Returns NO_EMAIL / DOMAIN / PENDING / APPROVED / BLOCKED, or NEW (not in the sheet yet). */
function peekAccess_(email) {
  email = normEmail_(email);
  if (!email) return { status: "NO_EMAIL" };
  if (ENFORCE_DOMAIN_ON_EVERY_REQUEST && !isAllowedEmail_(email)) return { status: "DOMAIN" };
  const data = usersData_(getUsersSheet_());
  for (let i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === email) return { status: String(data[i][2] || "PENDING").trim().toUpperCase() };
  }
  if (!isAllowedEmail_(email)) return { status: "DOMAIN" };
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
function notifyOwner_(email, name, phone, how) {
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
    const ok = ' &nbsp;<span style="color:#1c5e3a;font-size:12px">(✓ verified)</span>';
    const emailLine = escapeHtml_(email) + (how === "EMAIL" ? ok.replace("verified", "verified by e-mail code") : "");
    const waLine = phone
      ? ('<br><b>WhatsApp:</b> ' + escapeHtml_(phone) +
         (how === "WHATSAPP" ? ok : ' &nbsp;<span style="color:#8797a0;font-size:12px">(not verified)</span>'))
      : '';

    const html =
      '<div style="font-family:Arial,sans-serif;font-size:14px;color:#20323a;max-width:520px">' +
      '<h2 style="color:#1c5e3a;margin:0 0 12px">MasterCAL Pro — new access request</h2>' +
      '<p style="line-height:1.6"><b>Email:</b> ' + emailLine +
      '<br><b>Name:</b> ' + (name ? escapeHtml_(name) : "(not given)") + waLine + '</p>' +
      (base
        ? ('<p style="margin:22px 0">' + btn(approveUrl, "#1c5e3a", "✓ APPROVE") +
           btn(rejectUrl, "#d8261c", "✕ REJECT") + '</p>' +
           '<p style="color:#8797a0;font-size:12px">Click a button above — it opens a confirmation page.</p>')
        : '<p style="color:#d8261c">Deploy the web app so approve/reject links can be generated.</p>') +
      '<p style="color:#8797a0;font-size:12px">Or: master sheet → ⚙️ MasterCAL Admin → ✅ Approve a user.</p>' +
      '</div>';

    MailApp.sendEmail({
      to: to,
      subject: "MasterCAL Pro — new access request: " + email,
      htmlBody: html,
      body: "New request: " + email + " (" + (name || "") + ")\n" +
            (how === "EMAIL" ? "E-mail verified by code.\n" : "") +
            (phone ? "WhatsApp: " + phone + (how === "WHATSAPP" ? " (verified)" : " (not verified)") + "\n" : "") +
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
  if (!email) return approvalPage_("Missing email.", false);
  if (String(token) !== approvalToken_(email)) {
    return approvalPage_("Invalid or expired link.", false);
  }
  const status = (action === "approveUser") ? "APPROVED" : "BLOCKED";
  if (status === "APPROVED" && !isAllowedEmail_(email)) {
    return approvalPage_("Only @" + ALLOWED_EMAIL_DOMAIN + " e-mail addresses can be approved.<br>" + escapeHtml_(email), false);
  }
  const s = getUsersSheet_();
  const data = usersData_(s);
  for (let i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === email) {
      s.getRange(i + 1, 3).setValue(status);
      if (status === "APPROVED") s.getRange(i + 1, 5).setValue(new Date());
      accessCacheClear_(email);       /* after the sheet change, so nothing stale can be re-cached */
      return approvalPage_(email + " → " + status, status === "APPROVED");
    }
  }
  s.appendRow([email, "", status, new Date(), status === "APPROVED" ? new Date() : ""]);
  accessCacheClear_(email);
  return approvalPage_(email + " → " + status, status === "APPROVED");
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
    "Approve කරන්න ඕන email එක type කරන්න:", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;

  const email = normEmail_(r.getResponseText());
  if (!email) { ui.alert("Email එකක් දාන්න."); return; }
  if (!isAllowedEmail_(email)) {
    ui.alert("Not allowed ⛔", "Only @" + ALLOWED_EMAIL_DOMAIN + " e-mail addresses can be approved.\n\n" + email, ui.ButtonSet.OK);
    return;
  }

  const s = getUsersSheet_();
  const data = usersData_(s);
  for (let i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === email) {
      s.getRange(i + 1, 3).setValue("APPROVED");
      s.getRange(i + 1, 5).setValue(new Date());
      ui.alert("Approved ✅", email + " approved.", ui.ButtonSet.OK);
      return;
    }
  }
  s.appendRow([email, "", "APPROVED", new Date(), new Date()]);
  ui.alert("Approved ✅", email + " added & approved.", ui.ButtonSet.OK);
}

function menuBlockUser_() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt("Block user",
    "Block කරන්න ඕන email එක type කරන්න:", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const email = normEmail_(r.getResponseText());
  if (!email) return;
  const s = getUsersSheet_();
  const data = usersData_(s);
  for (let i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === email) {
      s.getRange(i + 1, 3).setValue("BLOCKED");
      accessCacheClear_(email);
      ui.alert("Blocked", email + " blocked.", ui.ButtonSet.OK);
      return;
    }
  }
  ui.alert("Not found", email + " list එකේ නෑ.", ui.ButtonSet.OK);
}

/* Build an APPROVED_USERS sheet listing everyone approved. */
function menuApprovedList_() {
  const ui = SpreadsheetApp.getUi();
  const s = getUsersSheet_();
  const data = usersData_(s);

  const out = [["Email", "Name", "Approved On"]];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim().toUpperCase() === "APPROVED") {
      out.push([ data[i][0], data[i][1], data[i][4] ]);
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

/* Menu: who is in USERS but outside the allowed domain (nothing is changed). */
function menuNonCfUsers_() {
  const ui = SpreadsheetApp.getUi();
  const data = usersData_(getUsersSheet_());
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const e = normEmail_(data[i][0]);
    if (e && !isAllowedEmail_(e)) out.push(e + "  —  " + String(data[i][2] || "PENDING").trim().toUpperCase());
  }
  ui.alert("Users outside @" + ALLOWED_EMAIL_DOMAIN,
    out.length
      ? out.length + " user(s):\n\n" + out.slice(0, 25).join("\n") + (out.length > 25 ? "\n…" : "") +
        "\n\nAPPROVED ones keep their access unless ENFORCE_DOMAIN_ON_EVERY_REQUEST is true (Access.gs). " +
        "PENDING ones can no longer be approved. Block anyone you do not want."
      : "Everybody in the USERS sheet is on @" + ALLOWED_EMAIL_DOMAIN + ".",
    ui.ButtonSet.OK);
}
