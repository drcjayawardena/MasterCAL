/******************************************************
 * MasterCAL Pro
 * WhatsApp.gs — WhatsApp OTP new-user registration
 *               (Meta WhatsApp Cloud API)
 *
 * The ONLY way to register: the verified WhatsApp number is the user's identity
 * (USERS key "wa:<digits>", see phoneKey_ in Access.gs). There is no e-mail.
 *
 * Flow
 *   1) User enters WhatsApp Number + Name in the app.
 *   2) requestWhatsAppCode  -> a 6-digit code is generated,
 *      stored (hashed, with expiry) and SENT to the number
 *      via the Meta Cloud API authentication template.
 *   3) verifyWhatsAppCode   -> the code is checked. On success
 *      the user is written to the USERS sheet (with the phone)
 *      and given access.
 *
 * These two actions are PUBLIC — they run BEFORE the approval
 * gate in Api.gs (a brand-new user is not APPROVED yet).
 *
 * SECRETS live in Script Properties (Project Settings ->
 * Script properties), NEVER in this file / GitHub:
 *   WA_TOKEN       permanent access token   (required)
 *   WA_PHONE_ID    phone number ID          (required)
 *   WA_TEMPLATE    OTP template name        (recommended)
 *   WA_LANG        template language code   (default en_US)
 *   WA_COUNTRY     default country code      (default 94 = Sri Lanka)
 *   WA_VERIFY_MODE APPROVAL | INSTANT       (default APPROVAL)
 *   WA_NO_BUTTON   "1" if the template has NO copy-code button
 ******************************************************/

/* ---- OTP settings ---- */
var OTP_TTL_MS    = 5 * 60 * 1000;   /* code valid 5 minutes            */
var OTP_MAX_TRY   = 5;               /* wrong tries before it is killed  */
var OTP_RESEND_MS = 45 * 1000;       /* min gap between two code sends    */
var OTP_LEN       = 6;               /* digits                           */

function waProps_() { return PropertiesService.getScriptProperties(); }

/* True only when both required WhatsApp credentials are present. */
function waIsConfigured_() {
  var p = waProps_();
  return !!(p.getProperty("WA_TOKEN") && p.getProperty("WA_PHONE_ID"));
}

/* The app always shows the WhatsApp register screen (kept for older app versions). */
function authMode_() { return "whatsapp"; }

/* A new person must always pass the WhatsApp code screen. */
function otpRequired_() { return true; }

function waCountry_() { return String(waProps_().getProperty("WA_COUNTRY") || "94"); }

/* APPROVAL (default): after the OTP is entered the user is PENDING and the owner gets the
   approval e-mail (APPROVE / REJECT buttons + the verified WhatsApp number).
   INSTANT: approved at once, no e-mail (switch with the menu "Verify mode"). */
function verifyMode_() {
  return String(waProps_().getProperty("WA_VERIFY_MODE") || "APPROVAL").trim().toUpperCase();
}

/* Normalize any local/international input to E.164 digits (no +). */
function normPhone_(raw) {
  var d = String(raw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  var cc = waCountry_();
  if (d.indexOf("00") === 0) d = d.slice(2);               /* 0094... -> 94...   */
  if (d.indexOf(cc) === 0 && d.length >= cc.length + 8) return d;  /* already CC */
  if (d.charAt(0) === "0") return cc + d.slice(1);         /* 077... -> 9477...  */
  if (d.length <= 10) return cc + d;                       /* 77... -> 9477...   */
  return d;
}

function otpKey_(phone) { return "otp_" + phone; }

function sha_(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s));
  var h = "";
  for (var i = 0; i < b.length; i++) h += ("0" + (b[i] & 0xff).toString(16)).slice(-2);
  return h;
}

function genCode_() {
  var c = "";
  for (var i = 0; i < OTP_LEN; i++) c += Math.floor(Math.random() * 10);
  return c;
}


/* =========================================================
   PUBLIC ACTION 1 — request a code
   args = [ phone, name ]
========================================================= */
function requestWhatsAppCode_(args) {
  args = args || [];
  var key   = phoneKey_(args[0]);
  var phone = key ? key.slice(3) : "";
  var name  = String(args[1] || "").trim().slice(0, 80);

  if (!key)  return { ok: false, error: "Enter a valid WhatsApp number." };
  if (!name) return { ok: false, error: "Enter your name." };

  var props = waProps_();

  /* If this number is already BLOCKED, stop here.
     read-only: asking for a code must not create a row or e-mail the owner (that happens
     only after the code is entered correctly) */
  try {
    if (peekAccess_(key).status === "BLOCKED") return { ok: false, error: "This account is blocked." };
  } catch (e) {}

  /* Rate-limit resends. */
  var raw = props.getProperty(otpKey_(phone));
  if (raw) {
    try {
      var prev = JSON.parse(raw);
      if (prev.last && (Date.now() - prev.last) < OTP_RESEND_MS) {
        var wait = Math.ceil((OTP_RESEND_MS - (Date.now() - prev.last)) / 1000);
        return { ok: false, error: "Please wait " + wait + "s before requesting another code." };
      }
    } catch (e) {}
  }

  var code = genCode_();
  var rec = {
    hash:  sha_(code),
    exp:   Date.now() + OTP_TTL_MS,
    tries: 0,
    last:  Date.now(),
    name:  name
  };
  props.setProperty(otpKey_(phone), JSON.stringify(rec));

  var send = sendWhatsAppOtp_(phone, code);
  if (!send.ok) {
    props.deleteProperty(otpKey_(phone));
    return { ok: false, error: send.error || "Could not send the WhatsApp code." };
  }

  return { ok: true, data: { sent: true, phone: phone } };
}


/* =========================================================
   PUBLIC ACTION 2 — verify a code
   args = [ phone, code ]
========================================================= */
function verifyWhatsAppCode_(args) {
  args = args || [];
  var key   = phoneKey_(args[0]);
  var phone = key ? key.slice(3) : "";
  if (!key) return { ok: false, error: "Enter a valid WhatsApp number." };
  var code  = String(args[1] || "").replace(/[^\d]/g, "");

  var props = waProps_();
  var raw = props.getProperty(otpKey_(phone));
  if (!raw) return { ok: false, error: "No code found. Please request a new code." };

  var rec;
  try { rec = JSON.parse(raw); }
  catch (e) { props.deleteProperty(otpKey_(phone)); return { ok: false, error: "Please request a new code." }; }

  if (Date.now() > rec.exp) {
    props.deleteProperty(otpKey_(phone));
    return { ok: false, error: "Code expired. Request a new one." };
  }
  if (rec.tries >= OTP_MAX_TRY) {
    props.deleteProperty(otpKey_(phone));
    return { ok: false, error: "Too many attempts. Request a new code." };
  }
  if (!code || sha_(code) !== rec.hash) {
    rec.tries++;
    props.setProperty(otpKey_(phone), JSON.stringify(rec));
    var left = OTP_MAX_TRY - rec.tries;
    return { ok: false, error: "Wrong code." + (left > 0 ? " " + left + " tries left." : "") };
  }

  /* Success — code correct. Consume it and register the user. */
  props.deleteProperty(otpKey_(phone));
  var status = registerVerifiedUser_(key, rec.name, phone, "WHATSAPP");

  return {
    ok: true,
    data: { verified: true, status: status, name: rec.name, phone: phone }
  };
}


/* =========================================================
   Write / update the verified user in the USERS sheet.
   INSTANT  -> APPROVED immediately (OTP already proved the
               number, so no waiting).
   APPROVAL -> PENDING (still needs admin approve).
   BLOCKED users stay BLOCKED.
========================================================= */
/* key = USERS key "wa:<digits>"; phone = the same digits (column F).
   how = "WHATSAPP" — only used for the wording of the admin's approval e-mail. */
function registerVerifiedUser_(email, name, phone, how) {
  email = normEmail_(email);
  var s = getUsersSheet_();
  ensureUsersColumns_(s);

  var approve = (verifyMode_() === "INSTANT");    /* default: APPROVAL */
  var shown = keyToPhone_(email);                 /* "+94771234567" for the owner's e-mail */
  var now = new Date();

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var data = usersData_(s);
    for (var i = 1; i < data.length; i++) {
      if (normEmail_(data[i][0]) === email) {
        var cur = String(data[i][2] || "").trim().toUpperCase();
        if (cur === "BLOCKED") return "BLOCKED";
        if (name) s.getRange(i + 1, 2).setValue(name);
        if (cur !== "APPROVED") {
          if (approve) { s.getRange(i + 1, 3).setValue("APPROVED"); s.getRange(i + 1, 5).setValue(now); }
          else         { s.getRange(i + 1, 3).setValue("PENDING"); }
        }
        if (phone) s.getRange(i + 1, 6).setValue(phone);   /* Phone (never overwritten with blank) */
        s.getRange(i + 1, 7).setValue(now);      /* Verified */
        var out = (cur === "APPROVED") ? "APPROVED" : (approve ? "APPROVED" : "PENDING");
        if (out === "PENDING") { try { notifyOwner_(email, name, shown, how); } catch (e) {} }
        return out;
      }
    }
    /* New row. */
    s.appendRow([email, name || "", approve ? "APPROVED" : "PENDING", now, approve ? now : "", phone || "", now]);
  } finally {
    lock.releaseLock();
  }

  if (!approve) { try { notifyOwner_(email, name, shown, how); } catch (e) {} }   /* APPROVAL mode: e-mail the owner now */
  return approve ? "APPROVED" : "PENDING";
}

/* Row number (1-based) of a USERS key in USERS, or 0. */
function findUserRow_(s, email) {
  var data = usersData_(s);
  for (var i = 1; i < data.length; i++) if (normEmail_(data[i][0]) === email) return i + 1;
  return 0;
}

/* Make sure the USERS sheet has Phone (col 6) & Verified (col 7) headers. */
function ensureUsersColumns_(s) {
  var h = s.getRange(1, 1, 1, 7).getValues()[0];
  if (String(h[5] || "") !== "Phone")    s.getRange(1, 6).setValue("Phone");
  if (String(h[6] || "") !== "Verified") s.getRange(1, 7).setValue("Verified");
  s.getRange("F1:G1").setFontWeight("bold");
}


/* =========================================================
   Send the OTP via Meta WhatsApp Cloud API.
========================================================= */
function sendWhatsAppOtp_(phone, code) {
  var props   = waProps_();
  var token   = props.getProperty("WA_TOKEN");
  var phoneId = props.getProperty("WA_PHONE_ID");
  var tmpl    = props.getProperty("WA_TEMPLATE") || "";
  var lang    = props.getProperty("WA_LANG") || "en_US";
  var noBtn   = String(props.getProperty("WA_NO_BUTTON") || "") === "1";

  if (!token || !phoneId) {
    return { ok: false, error: "WhatsApp is not set up yet. (Admin: set WA_TOKEN & WA_PHONE_ID.)" };
  }

  var url = "https://graph.facebook.com/v21.0/" + phoneId + "/messages";
  var payload;

  if (tmpl) {
    var components = [
      { type: "body", parameters: [ { type: "text", text: code } ] }
    ];
    /* Authentication templates carry a copy-code / one-tap button that
       must receive the same code. Skip only if WA_NO_BUTTON = 1. */
    if (!noBtn) {
      components.push({
        type: "button", sub_type: "url", index: "0",
        parameters: [ { type: "text", text: code } ]
      });
    }
    payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: { name: tmpl, language: { code: lang }, components: components }
    };
  } else {
    /* Fallback plain text — only delivers inside a 24h session window.
       A template is strongly recommended for first-contact OTPs. */
    payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: "MasterCAL Pro verification code: " + code + "\nValid for 5 minutes." }
    };
  }

  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    return { ok: false, error: "Network error contacting WhatsApp." };
  }

  var rc  = resp.getResponseCode();
  var txt = resp.getContentText();
  if (rc >= 200 && rc < 300) return { ok: true };

  var msg = "WhatsApp send failed (" + rc + ").";
  try {
    var j = JSON.parse(txt);
    if (j.error && j.error.message) msg = j.error.message;
  } catch (e) {}
  Logger.log("WA send error " + rc + ": " + txt);
  return { ok: false, error: msg };
}


/* =========================================================
   ADMIN — set credentials & test (called from the menu)
========================================================= */
function menuSetWhatsApp_() {
  var ui = SpreadsheetApp.getUi();
  var props = waProps_();

  var t = ui.prompt("WhatsApp — Access Token",
    "Meta permanent access token එක paste කරන්න\n(හිස්ව තිබ්බොත් දැන් තියෙන එක වෙනස් වෙන්නේ නෑ):",
    ui.ButtonSet.OK_CANCEL);
  if (t.getSelectedButton() !== ui.Button.OK) return;
  if (t.getResponseText().trim()) props.setProperty("WA_TOKEN", t.getResponseText().trim());

  var p = ui.prompt("WhatsApp — Phone Number ID",
    "Phone number ID එක දාන්න (Meta app → WhatsApp → API Setup):",
    ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  if (p.getResponseText().trim()) props.setProperty("WA_PHONE_ID", p.getResponseText().trim());

  var m = ui.prompt("WhatsApp — Template Name",
    "OTP template එකේ නම දාන්න (උදා: mastercal_otp).\n" +
    "Template එකක් තාම හදලා නැත්නම් හිස්ව තියන්න:",
    ui.ButtonSet.OK_CANCEL);
  if (m.getSelectedButton() !== ui.Button.OK) return;
  if (m.getResponseText().trim()) props.setProperty("WA_TEMPLATE", m.getResponseText().trim());

  ui.alert("Saved ✅",
    "WhatsApp credentials save කරා.\n\n" +
    "Language (WA_LANG), Country (WA_COUNTRY), Verify mode (WA_VERIFY_MODE) " +
    "වෙනස් කරන්න ඕන නම් Project Settings → Script properties එකෙන් edit කරන්න.",
    ui.ButtonSet.OK);
}

/* Toggle INSTANT <-> APPROVAL without touching Script properties by hand. */
function menuVerifyMode_() {
  var ui = SpreadsheetApp.getUi();
  var props = waProps_();
  var cur = verifyMode_();

  var msg = "දැන් mode එක: " + cur + "\n\n" +
    "INSTANT  = code verify වුණාම වහාම access (admin approval නෑ).\n" +
    "APPROVAL = verify වුණාට පස්සෙත් ඔයා email එකෙන් Approve කරනකම් Pending.\n\n" +
    (cur === "APPROVAL"
      ? "INSTANT එකට මාරු කරන්නද?"
      : "APPROVAL එකට මාරු කරන්නද?");

  var r = ui.alert("Verify mode", msg, ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;

  var next = (cur === "APPROVAL") ? "INSTANT" : "APPROVAL";
  props.setProperty("WA_VERIFY_MODE", next);
  ui.alert("Saved ✅",
    "Verify mode දැන්: " + next + "\n\n" +
    (next === "APPROVAL"
      ? "අලුත් user code verify කරාට පස්සේ Pending වෙනවා. ඔයාට email එකෙන් " +
        "APPROVE/REJECT කරන්න පුළුවන් (WhatsApp number එකත් email එකේ පේනවා)."
      : "අලුත් user code verify කරාම වහාම access ලැබෙනවා."),
    ui.ButtonSet.OK);
}

function menuTestWhatsApp_() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt("Test WhatsApp code",
    "Test code එකක් යවන්න ඕන number එක දාන්න (උදා: 0771234567):",
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var phone = normPhone_(r.getResponseText());
  if (phone.length < 10) { ui.alert("Number එක වැරදියි."); return; }

  var code = genCode_();
  var res = sendWhatsAppOtp_(phone, code);
  if (res.ok) {
    ui.alert("Sent ✅",
      phone + " ට WhatsApp code එකක් යැව්වා.\nCode: " + code + "\n\n" +
      "ඔයාගේ WhatsApp එකේ message එක ආවද බලන්න.", ui.ButtonSet.OK);
  } else {
    ui.alert("Failed ❌",
      "යවන්න බැරි වුණා:\n\n" + res.error + "\n\n" +
      "WA_TOKEN, WA_PHONE_ID, WA_TEMPLATE හරිද කියලා බලන්න.", ui.ButtonSet.OK);
  }
}
