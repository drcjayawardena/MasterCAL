/******************************************************
 * MasterCAL Pro
 * Register.gs — sign-up with name + WhatsApp number (no OTP)
 *
 * Flow
 *   1) The user enters Name + WhatsApp number + e-mail in the app.
 *      The e-mail (any address) is a contact detail kept in USERS column H;
 *      the WhatsApp number is the identity.
 *   2) register  -> the user is written to USERS as PENDING
 *      (key "wa:<digits>", see phoneKey_ in Access.gs) and the
 *      owner gets the approval e-mail (APPROVE / REJECT buttons).
 *   3) The owner approves -> the user can use the app.
 *
 * No code is sent: the number and e-mail are NOT verified. The owner's approval
 * is the only check, so look at the name + number before approving.
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
   PUBLIC ACTION — request access     args = [ phone, name, email ]
   Returns { ok, data: { status, phone, name } }
   status: PENDING (waiting for the owner) | APPROVED | BLOCKED
========================================================= */
function register_(args) {
  args = args || [];
  var key  = phoneKey_(args[0]);
  var name = String(args[1] || "").trim().slice(0, 80);
  var mail = normEmail_(args[2]).slice(0, 120);

  if (!key)  return { ok: false, error: "Enter a valid WhatsApp number." };
  if (!name) return { ok: false, error: "Enter your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { ok: false, error: "Enter a valid e-mail address." };

  var status = registerUser_(key, name, mail);
  if (status === "BLOCKED") return { ok: false, access: "BLOCKED", error: "This account is blocked." };
  return { ok: true, data: { status: status, phone: key.slice(3), name: name } };
}


/* Write the user to USERS (or update the name / e-mail of a still-PENDING row).
   New row  -> PENDING + owner e-mail.
   Existing -> status unchanged (APPROVED stays APPROVED, BLOCKED stays BLOCKED);
               the owner is e-mailed again only if the row is still PENDING and
               the last e-mail is older than REGISTER_RENOTIFY_MS (no inbox flooding). */
const REGISTER_RENOTIFY_MS = 6 * 60 * 60 * 1000;   /* 6 hours */

function registerUser_(key, name, mail) {
  key = normEmail_(key);
  var s = getUsersSheet_();
  ensureUsersColumns_(s);
  var phone = key.slice(3);
  var now = new Date();
  var notify = false;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var data = usersData_(s);
    for (var i = 1; i < data.length; i++) {
      if (normEmail_(data[i][0]) !== key) continue;
      var cur = String(data[i][2] || "PENDING").trim().toUpperCase();
      if (cur === "BLOCKED") return "BLOCKED";
      if (cur === "PENDING") {
        /* only a request that is still waiting may change its details: nobody can overwrite
           an APPROVED user's name / e-mail just by typing that user's number */
        if (name) s.getRange(i + 1, 2).setValue(name);
        if (mail) s.getRange(i + 1, 8).setValue(mail);
        var last = data[i][3] instanceof Date ? data[i][3].getTime() : 0;   /* Requested */
        if (Date.now() - last > REGISTER_RENOTIFY_MS) {
          s.getRange(i + 1, 4).setValue(now);
          notify = true;
        }
      }
      if (notify) { try { notifyOwner_(key, name, keyToPhone_(key), "REQUEST", mail); } catch (e) {} }
      return cur;
    }
    /* New row. */
    s.appendRow([key, name || "", "PENDING", now, "", phone, "", mail || ""]);
  } finally {
    lock.releaseLock();
  }

  try { notifyOwner_(key, name, keyToPhone_(key), "REQUEST", mail); } catch (e) {}
  return "PENDING";
}

/* Make sure the USERS sheet has Phone (col 6), Verified (col 7) & Email (col 8) headers.
   Cosmetic only: if a header cell cannot be written (e.g. it is protected) registration
   still goes ahead and the reason is written to Executions -> Logs. */
function ensureUsersColumns_(s) {
  var want = { 6: "Phone", 7: "Verified", 8: "Email" };
  var h = s.getRange(1, 1, 1, 8).getValues()[0];
  Object.keys(want).forEach(function (col) {
    if (String(h[col - 1] || "") === want[col]) return;
    try { s.getRange(1, Number(col)).setValue(want[col]).setFontWeight("bold"); }
    catch (e) { Logger.log("USERS header " + want[col] + " (col " + col + ") not written: " + (e && e.message ? e.message : e)); }
  });
}
