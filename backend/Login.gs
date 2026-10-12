/******************************************************
 * MasterCAL Pro
 * Login.gs — username + password sign-in and session tokens
 *
 * Every user has a username + password (USERS columns I and J). One login
 * is used for MasterCAL AND VehicleHUB:
 *   - login   -> checks the password and returns a signed session token
 *                (the PWA keeps it in localStorage "mastercal_token", which
 *                VehicleHUB can read because both sites share one origin)
 *   - whoami  -> VehicleHUB's server sends that token here and gets back who
 *                the user is (username, name, WhatsApp number, e-mail)
 *   - every other request carries the token instead of the WhatsApp number.
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
function validUsername_(u) { return /^[a-z0-9._-]{3,30}$/.test(u); }

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
  const uname = normUsername_(args[0]);
  const password = String(args[1] || "");
  if (!uname || !password) return { ok: false, error: "Username සහ password දාන්න." };

  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  const failKey = "lfail_" + uname;
  const fails = cache ? Number(cache.get(failKey) || 0) : 0;
  if (fails >= LOGIN_MAX_FAILS) return { ok: false, error: "වැරදි password ගොඩක් දැම්මා. විනාඩි 15කින් ආයේ try කරන්න." };

  const data = usersRows_(getUsersSheet_());
  const i = findUsername_(data, uname);
  if (i < 0 || !checkPassword_(password, data[i][PASS_COL - 1])) {
    if (cache) { try { cache.put(failKey, String(fails + 1), LOGIN_LOCK_SECONDS); } catch (e) {} }
    return { ok: false, error: "Username හෝ password වැරදියි." };
  }
  if (cache) { try { cache.remove(failKey); } catch (e) {} }

  const key = normEmail_(data[i][0]);
  const status = String(data[i][2] || "PENDING").trim().toUpperCase();
  const out = { status: status, username: uname, name: String(data[i][1] || ""), phone: keyToPhone_(key) };
  if (status === "BLOCKED") return { ok: false, access: "BLOCKED", error: "This account is blocked." };
  if (status === "APPROVED") out.token = makeToken_(key, uname, String(data[i][PASS_COL - 1]));
  return { ok: true, data: out };
}

/* =========================================================
   PUBLIC ACTION — whoami     args = [ token ]
   For VehicleHUB's server: who does this MasterCAL session belong to?
   Returns { ok, data: { username, name, phone, email } } for APPROVED users.
========================================================= */
function whoami_(args) {
  const a = tokenAccess_((args || [])[0]);
  if (a.status !== "APPROVED") return { ok: false, access: a.status, error: "Access " + a.status };
  return { ok: true, data: { username: a.who.username, name: a.who.name,
                             phone: keyToPhone_(a.who.key), email: a.who.email } };
}

/* Menu: clear a user's username + password. They register again (same WhatsApp
   number) and wait for approval; their old sessions stop working. */
function menuResetLogin_() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt("Reset a user's login",
    "Login එක reset කරන්න ඕන WhatsApp number එක type කරන්න:", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const key = phoneKey_(r.getResponseText());
  if (!key) { ui.alert("හරි WhatsApp number එකක් දාන්න."); return; }
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
  ui.alert("Not found", keyToPhone_(key) + " list එකේ නෑ.", ui.ButtonSet.OK);
}
