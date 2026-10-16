/******************************************************
 * MasterCAL Pro
 * Register.gs — sign-up with name + WhatsApp number + username + password
 *
 * Flow
 *   1) The user enters Name, WhatsApp number, e-mail, username and password.
 *      The username + password (Login.gs) is the one login for MasterCAL and
 *      VehicleHUB; the WhatsApp number keys the USERS row and the user's copy.
 *   2) register  -> the user is written to USERS as PENDING and the owner
 *      gets the approval e-mail (APPROVE / REJECT buttons).
 *   3) The owner approves -> the user can log in.
 *
 * The number and e-mail are NOT verified. The owner's approval is the check,
 * so look at the name + number before approving.
 *
 * This action is PUBLIC — it runs BEFORE the approval gate in Api.gs
 * (a brand-new user is not APPROVED yet).
 ******************************************************/

const PHONE_COUNTRY = "94";   /* default country code (Sri Lanka) */

/* Normalize any local/international input to E.164 digits (no +). */
function normPhone_(raw) {
  var d = String(raw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  var cc = PHONE_COUNTRY;
  if (d.indexOf("00") === 0) d = d.slice(2);                        /* 0094... -> 94...  */
  if (d.indexOf(cc) === 0 && d.length >= cc.length + 8) return d;   /* already CC        */
  if (d.charAt(0) === "0") return cc + d.slice(1);                  /* 077... -> 9477... */
  if (d.length <= 10) return cc + d;                                /* 77... -> 9477...  */
  return d;
}


/* =========================================================
   PUBLIC ACTION — request access
   args = [ phone, name, email, username, password ]
   Returns { ok, data: { status, phone, name, username } }
   status: PENDING (waiting for the owner)
========================================================= */
function register_(args) {
  args = args || [];
  var key   = phoneKey_(args[0]);
  var name  = String(args[1] || "").trim().slice(0, 80);
  var mail  = normEmail_(args[2]).slice(0, 120);
  var uname = normUsername_(args[3]);
  var pass  = String(args[4] || "");

  if (!key)  return { ok: false, error: "Enter a valid WhatsApp number." };
  if (!name) return { ok: false, error: "Enter your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { ok: false, error: "Enter a valid e-mail address." };
  if (!validUsername_(uname)) return { ok: false, error: "Username must be 3–30 characters (a-z, 0-9, . _ -)." };
  if (pass.length < 6 || pass.length > 100) return { ok: false, error: "Password must be at least 6 characters." };

  var status = registerUser_(key, name, mail, uname, hashPassword_(pass));
  if (status === "BLOCKED") return { ok: false, access: "BLOCKED", error: "This account is blocked." };
  if (status === "USERNAME_TAKEN") return { ok: false, error: "That username is already taken. Please choose another." };
  if (status === "HAS_LOGIN") return { ok: false, error: "An account already exists for this number. Please sign in, or ask the administrator to reset it." };
  return { ok: true, data: { status: status, phone: key.slice(3), name: name, username: uname } };
}


/* Write the user's request to USERS.
   New number          -> new PENDING row + owner e-mail.
   Number without login (users from before passwords, or after an admin reset)
                       -> username + password saved and the row goes to PENDING,
                          so the owner approves again: knowing someone's number
                          is not enough to take over their account.
   Number with a login -> HAS_LOGIN (nothing changes).
   A still-PENDING row e-mails the owner again only if the last e-mail is older
   than REGISTER_RENOTIFY_MS (no inbox flooding). */
const REGISTER_RENOTIFY_MS = 6 * 60 * 60 * 1000;   /* 6 hours */

function registerUser_(key, name, mail, uname, passHash) {
  key = normEmail_(key);
  var s = getUsersSheet_();
  ensureUsersColumns_(s);
  var phone = key.slice(3);
  var now = new Date();
  var notify = false;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var data = usersRows_(s);
    var taken = findUsername_(data, uname);
    if (taken > 0 && normEmail_(data[taken][0]) !== key) return "USERNAME_TAKEN";

    for (var i = 1; i < data.length; i++) {
      if (normEmail_(data[i][0]) !== key) continue;
      var cur = String(data[i][2] || "PENDING").trim().toUpperCase();
      if (cur === "BLOCKED") return "BLOCKED";
      if (String(data[i][PASS_COL - 1] || "")) return "HAS_LOGIN";
      s.getRange(i + 1, 2).setValue(name);
      s.getRange(i + 1, 8).setValue(mail);
      s.getRange(i + 1, USER_COL, 1, 2).setValues([[uname, passHash]]);
      var last = data[i][3] instanceof Date ? data[i][3].getTime() : 0;   /* Requested */
      if (cur !== "PENDING" || Date.now() - last > REGISTER_RENOTIFY_MS) {
        s.getRange(i + 1, 3, 1, 2).setValues([["PENDING", now]]);
        notify = true;
      }
      accessCacheClear_(key);
      break;
    }
    if (i >= data.length) {
      s.appendRow([key, name || "", "PENDING", now, "", phone, "", mail || "", uname, passHash]);
      notify = true;
    }
  } finally {
    lock.releaseLock();
  }

  if (notify) { try { notifyOwner_(key, name + " (username: " + uname + ")", keyToPhone_(key), "REQUEST", mail); } catch (e) {} }
  return "PENDING";
}

/* Make sure the USERS sheet has Phone (6), Verified (7), Email (8), Username (9) & Password (10) headers.
   Cosmetic only: if a header cell cannot be written (e.g. it is protected) registration
   still goes ahead and the reason is written to Executions -> Logs. */
function ensureUsersColumns_(s) {
  var want = { 6: "Phone", 7: "Verified", 8: "Email", 9: "Username", 10: "Password" };
  var h = s.getRange(1, 1, 1, 10).getValues()[0];
  Object.keys(want).forEach(function (col) {
    if (String(h[col - 1] || "") === want[col]) return;
    try { s.getRange(1, Number(col)).setValue(want[col]).setFontWeight("bold"); }
    catch (e) { Logger.log("USERS header " + want[col] + " (col " + col + ") not written: " + (e && e.message ? e.message : e)); }
  });
}
