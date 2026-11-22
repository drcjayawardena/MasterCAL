/******************************************************
 * MasterCAL Pro
 * Login.gs — username + password sign-in and session tokens
 *
 * Every user has a username + password (USERS columns I and J). Login
 * authenticates MasterCAL users only:
 *   - login   -> checks the password and returns a signed session token
 *                (the PWA keeps it in MasterCAL's own localStorage key)
 *   - authenticated MasterCAL requests carry the token.
 *
 * The password is stored only as a salted hash. A token says which USERS row
 * it belongs to and expires after SESSION_DAYS; changing / resetting the
 * password makes old tokens invalid. The row must still be APPROVED.
 ******************************************************/

const USER_COL = 9;          /* USERS column I: Username */
const PASS_COL = 10;         /* USERS column J: Password (salt$hash — never the password itself) */
const SESSION_DAYS = 30;
const LOGIN_MAX_FAILS = 5;   /* wrong passwords before the username is locked for LOGIN_LOCK_SECONDS */
const LOGIN_LOCK_SECONDS = 900;

function normUsername_(u) { return String(u || "").trim().toLowerCase(); }

/* All USERS rows with the login columns: [[key, name, status, ..., username, pass], ...] (row 0 = header). */
function usersRows_(s) {
  return s.getRange(1, 1, Math.max(s.getLastRow(), 1), PASS_COL).getValues();
}

/* Row index (0-based, in usersRows_) of a username, or -1. */
function findUsername_(data, uname) {
  for (var i = 1; i < data.length; i++) {
    if (normUsername_(data[i][USER_COL - 1]) === uname) return i;
  }
  return -1;
}

/* WhatsApp is the login name going forward. Existing usernames remain valid
   so current users keep access without resetting passwords or re-registering. */
function findLoginUser_(data, loginName) {
  const key = phoneKey_(loginName);
  if (key) {
    for (var i = 1; i < data.length; i++) {
      if (normEmail_(data[i][0]) === key) return i;
    }
  }
  return findUsername_(data, normUsername_(loginName));
}

/* ---------- passwords ---------- */

function hashPassword_(password, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g, "");
  var h = Utilities.computeHmacSha256Signature(String(password), salt, Utilities.Charset.UTF_8);
  for (var i = 0; i < 300; i++) h = Utilities.computeHmacSha256Signature(h, Utilities.newBlob(salt).getBytes());
  return salt + "$" + Utilities.base64EncodeWebSafe(h).replace(/=+$/, "");
}

function checkPassword_(password, stored) {
  stored = String(stored || "");
  var salt = stored.split("$")[0];
  return !!salt && stored.indexOf("$") > 0 && hashPassword_(password, salt) === stored;
}

/* ---------- session tokens ---------- */

function getSessionSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty("SESSION_SECRET");
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty("SESSION_SECRET", s); }
  return s;
}

/* The password hash is part of the signature, so a new password ends old sessions. */
function signSession_(payload, passHash) {
  const sig = Utilities.computeHmacSha256Signature(payload + "|" + passHash, getSessionSecret_(), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, "");
}

function makeToken_(key, uname, passHash) {
  const payload = key + "|" + uname + "|" + (Date.now() + SESSION_DAYS * 86400000);
  return Utilities.base64EncodeWebSafe(payload, Utilities.Charset.UTF_8).replace(/=+$/, "") + "." + signSession_(payload, passHash);
}

/* Returns { key, username, row } for a valid, unexpired token, else null.
   Status (APPROVED / BLOCKED) is NOT checked here — see tokenAccess_. */
function readToken_(token) {
  token = String(token || "");
  const dot = token.indexOf(".");
  if (dot < 1 || token.length > 400) return null;

  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  const ck = "tok_" + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8));   /* the whole token */
  if (cache) {
    try { const hit = cache.get(ck); if (hit) return JSON.parse(hit); } catch (e) {}
  }

  var payload;
  var b64 = token.slice(0, dot);
  while (b64.length % 4) b64 += "=";
  try { payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString("UTF-8"); }
  catch (e) { return null; }
  const p = payload.split("|");
  if (p.length !== 3 || !(Number(p[2]) > Date.now())) return null;

  const data = usersRows_(getUsersSheet_());
  const i = findUsername_(data, p[1]);
  if (i < 0 || normEmail_(data[i][0]) !== p[0]) return null;
  if (signSession_(payload, String(data[i][PASS_COL - 1] || "")) !== token.slice(dot + 1)) return null;

  const who = { key: p[0], username: p[1], name: String(data[i][1] || ""),
                email: String(data[i][7] || "") };
  if (cache) { try { cache.put(ck, JSON.stringify(who), ACCESS_CACHE_SECONDS); } catch (e) {} }
  return who;
}

/* { status: APPROVED | PENDING | BLOCKED | LOGIN, who } for a request's token. */
function tokenAccess_(token) {
  const who = readToken_(token);
  if (!who) return { status: "LOGIN" };
  const a = checkAccessFast_(who.key);
  return { status: a.status === "NO_PHONE" ? "LOGIN" : a.status, who: who };
}

/* =========================================================
   PUBLIC ACTION — login      args = [ username, password ]
   Returns { ok, data: { status, token?, name, username } }
   A token is given only when the user is APPROVED.
========================================================= */
function login_(args) {
  args = args || [];
  const loginName = String(args[0] || "").trim();
  const password = String(args[1] || "");
  if (!loginName || !password) return { ok: false, error: "Please enter your WhatsApp number and password." };

  const data = usersRows_(getUsersSheet_());
  const i = findLoginUser_(data, loginName);
  const uname = i > 0 ? normUsername_(data[i][USER_COL - 1]) : normUsername_(loginName);

  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  const failKey = "lfail_" + uname;
  const fails = cache ? Number(cache.get(failKey) || 0) : 0;
  if (fails >= LOGIN_MAX_FAILS) return { ok: false, error: "Too many unsuccessful attempts. Please try again in 15 minutes." };

  if (i < 0 || !checkPassword_(password, data[i][PASS_COL - 1])) {
    if (cache) { try { cache.put(failKey, String(fails + 1), LOGIN_LOCK_SECONDS); } catch (e) {} }
    return { ok: false, error: "Incorrect username or password." };
  }
  if (cache) { try { cache.remove(failKey); } catch (e) {} }

  const key = normEmail_(data[i][0]);
  const status = String(data[i][2] || "PENDING").trim().toUpperCase();
  const out = { status: status, username: uname, name: String(data[i][1] || ""), phone: keyToPhone_(key) };
  if (status === "BLOCKED") return { ok: false, access: "BLOCKED", error: "This account is blocked." };
  if (status === "APPROVED") out.token = makeToken_(key, uname, String(data[i][PASS_COL - 1]));
  return { ok: true, data: out };
}

/* Menu: clear a user's username + password. They register again (same WhatsApp
   number) and wait for approval; their old sessions stop working. */
function menuResetLogin_() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt("Reset a user's login",
    "Enter the WhatsApp number of the user whose login should be reset:", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const key = phoneKey_(r.getResponseText());
  if (!key) { ui.alert("Please enter a valid WhatsApp number."); return; }
  const s = getUsersSheet_();
  const data = usersRows_(s);
  for (var i = 1; i < data.length; i++) {
    if (normEmail_(data[i][0]) === key) {
      s.getRange(i + 1, USER_COL, 1, 2).setValues([["", ""]]);
      accessCacheClear_(key);
      ui.alert("Reset ✅", keyToPhone_(key) + ": login cleared. They can register again with this number.", ui.ButtonSet.OK);
      return;
    }
  }
  ui.alert("Not found", keyToPhone_(key) + " was not found in the user list.", ui.ButtonSet.OK);
}

/* =========================================================
   FORGOT PASSWORD
   PUBLIC ACTION — resetRequest   args = [ whatsapp, newPassword ]
   The new password is kept in the "Reset Password" column (salt$hash) and the
   owner is e-mailed. The old password keeps working until an admin approves the
   reset in the Admin tab, so knowing someone's number is not enough to take over
   (or lock out) their account. The answer is the same whether or not the number
   is registered.
========================================================= */
const RESET_HEADER = "Reset Password";
const RESET_AT_HEADER = "Reset Requested";
const RESET_MAX_PER_HOUR = 3;

/* Column number of a USERS header (case-insensitive), 0 when missing; create = add it at the end. */
function usersCol_(s, header, create) {
  const h = s.getRange(1, 1, 1, Math.max(s.getLastColumn(), 1)).getValues()[0];
  for (var i = 0; i < h.length; i++) if (String(h[i]).trim().toLowerCase() === header.toLowerCase()) return i + 1;
  if (!create) return 0;
  const col = Math.max(s.getLastColumn(), PASS_COL) + 1;
  s.getRange(1, col).setValue(header).setFontWeight("bold");
  return col;
}

function resetRequest_(args) {
  args = args || [];
  const key = phoneKey_(args[0]);
  const pass = String(args[1] || "");
  if (!key) return { ok: false, error: "Enter a valid WhatsApp number." };
  if (pass.length < 6 || pass.length > 100) return { ok: false, error: "Password must be at least 6 characters." };

  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  const ck = "rreq_" + key, n = cache ? Number(cache.get(ck) || 0) : 0;
  if (n >= RESET_MAX_PER_HOUR) return { ok: false, error: "Too many requests. Please try again in an hour." };
  if (cache) { try { cache.put(ck, String(n + 1), 3600); } catch (e) {} }

  const done = { ok: true, data: { status: "RESET_PENDING", phone: key.slice(3) } };
  const s = getUsersSheet_();
  var name = "", mail = "", found = false;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const data = usersRows_(s);
    for (var i = 1; i < data.length; i++) {
      if (normEmail_(data[i][0]) !== key) continue;
      if (String(data[i][2] || "").trim().toUpperCase() === "BLOCKED") return done;
      if (!String(data[i][PASS_COL - 1] || "")) return done;   /* no login yet: they use Register */
      const colP = usersCol_(s, RESET_HEADER, true), colT = usersCol_(s, RESET_AT_HEADER, true);
      s.getRange(i + 1, colP).setValue(hashPassword_(pass));
      s.getRange(i + 1, colT).setValue(new Date());
      name = String(data[i][1] || ""); mail = String(data[i][7] || ""); found = true;
      break;
    }
  } finally {
    lock.releaseLock();
  }
  if (found) notifyResetOwner_(key, name, mail);
  return done;
}

function notifyResetOwner_(key, name, mail) {
  try {
    const to = adminEmail_(); if (!to) return;
    const phone = keyToPhone_(key);
    MailApp.sendEmail({
      to: to,
      subject: "MasterCAL Pro — password reset request: " + phone,
      body: "Password reset requested for " + phone + " (" + (name || "") + ")" + (mail ? ", " + mail : "") + ".\n\n" +
            "The number is not verified — phone the user first to make sure the request is theirs.\n" +
            "Approve it in the Standalone app: Admin tab → filter \"Reset requests\" → Approve reset.\n" +
            "Until then the old password keeps working."
    });
  } catch (e) {
    try { Logger.log("notifyResetOwner_ FAILED for " + key + ": " + (e && e.message ? e.message : e)); } catch (e2) {}
  }
}

/* Admin tab: approve (the requested password becomes the password, old sessions end) or reject a reset. */
function adminResetDecide_(key, approve) {
  key = normEmail_(key);
  const s = getUsersSheet_();
  const colP = usersCol_(s, RESET_HEADER, false), colT = usersCol_(s, RESET_AT_HEADER, false);
  if (!colP) throw new Error("No reset request for this user.");
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const n = Math.max(s.getLastRow(), 1), keys = s.getRange(1, 1, n, 1).getValues(), pend = s.getRange(1, colP, n, 1).getValues();
    for (var i = 1; i < n; i++) {
      if (normEmail_(keys[i][0]) !== key) continue;
      const hash = String(pend[i][0] || "");
      if (!hash) throw new Error("No reset request for this user.");
      if (approve) s.getRange(i + 1, PASS_COL).setValue(hash);
      s.getRange(i + 1, colP).setValue("");
      if (colT) s.getRange(i + 1, colT).setValue("");
      accessCacheClear_(key);
      return { key: key, reset: approve ? "APPROVED" : "REJECTED" };
    }
  } finally {
    lock.releaseLock();
  }
  throw new Error("User not found.");
}
