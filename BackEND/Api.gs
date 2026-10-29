/******************************************************
 * MasterCAL Pro
 * Api.gs  (v3 — per-user API + email approval)
 *
 * PWA sends { action, args, token }.
 *   1. The token comes from logging in with username + password
 *      (Login.gs); only APPROVED users get one and may use the app.
 *   2. Each APPROVED user is routed to their OWN copy
 *      of the spreadsheet (keyed by "wa:<number>").
 *
 * Only ONE doGet may exist — it's here.
 * Deploy: Execute as = Me, Who has access = Anyone.
 ******************************************************/

function doPost(e) {
  try {
    const body = (e && e.postData && e.postData.contents)
      ? JSON.parse(e.postData.contents) : {};
    const action = body.action;
    if (!action) return json_({ ok: false, error: "Missing 'action'." });

    /* 0) PUBLIC action — registration runs BEFORE the approval gate,
          because a brand-new user is not APPROVED yet. */
    if (action === "register")            return json_(register_(body.args || []));
    if (action === "login")               return json_(login_(body.args || []));
    if (action === "whoami")              return json_(whoami_(body.args || []));   /* VehicleHUB's server */

    /* 1) login + approval gate */
    const access = tokenAccess_(body.token);
    if (access.status !== "APPROVED") {
      return json_({ ok: false, access: access.status, error: "Access " + access.status });
    }

    /* 2) the master sheet changed (or this user has no copy yet): build a fresh copy first.
          The app shows "Updating…" and calls syncCopy; every other action just says "stale". */
    const syncGuard = copySyncGuard_(access.who.key, action);
    if (syncGuard) return json_(syncGuard);

    /* 3) route to this user's own copy (keyed by "wa:<number>") */
    setUserContext_(access.who.key);
    return json_({ ok: true, data: dispatch_(action, body.args || []) });
  } catch (err) {
    return json_({ ok: false, error: errMsg_(err) });
  }
}

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  /* Email APPROVE / REJECT links (token-secured) — handled before the
     app gate, and return an HTML confirmation page (not JSON). */
  if (action === "approveUser" || action === "blockUser") {
    return handleEmailApproval_(action, e.parameter.email, e.parameter.token);
  }

  if (!action) {
    return ContentService
      .createTextOutput("MasterCAL Pro API is running.")
      .setMimeType(ContentService.MimeType.TEXT);
  }
  try {
    const access = tokenAccess_(e.parameter.token);
    if (access.status !== "APPROVED") {
      return json_({ ok: false, access: access.status, error: "Access " + access.status });
    }
    const syncGuard = copySyncGuard_(access.who.key, action);
    if (syncGuard) return json_(syncGuard);
    setUserContext_(access.who.key);
    const args = e.parameter.args ? JSON.parse(e.parameter.args) : [];
    return json_({ ok: true, data: dispatch_(action, args) });
  } catch (err) {
    return json_({ ok: false, error: errMsg_(err) });
  }
}

/* null = go on; otherwise the JSON answer to send back. */
function copySyncGuard_(userKey, action) {
  const stale = copyIsStale_(userKey);
  if (action === "syncCopy") return { ok: true, data: stale ? syncUserCopy_(userKey) : { updated: false } };
  if (stale) return { ok: false, stale: true, error: "Updating MasterCAL…" };
  return null;
}

function dispatch_(action, args) {
  args = args || [];
  switch (action) {
    case "init":                return initApp();
    case "getRentalSchedule":   return getRentalSchedule();
    case "saveProductType":     return saveProductType(args[0]);
    case "calcInputs":          return calcInputs(args[0]);
    case "saveScheduleType":    return saveScheduleType(args[0]);
    case "addScheduleRow":      return addScheduleRow(args[0], args[1], args[2]);
    case "updateScheduleFrom":  return updateScheduleFrom(args[0], args[1]);
    case "updateScheduleAmount":return updateScheduleAmount(args[0], args[1]);
    case "deleteScheduleRow":   return deleteScheduleRow(args[0]);
    case "setRmvType":          return setRmvType(args[0], args[1]);
    case "setAdditionalCharge": return setAdditionalCharge(args[0]);
    case "clearSchedule":       return clearScheduleInputs();
    case "get3W":               return get3W();
    case "set3W":               return set3W(args[0], args[1]);
    case "reset3W":             return reset3W();
    case "getBike":             return getBike();
    case "setBike":             return setBike(args[0], args[1]);
    case "resetBike":           return resetBike();
    case "checkVehicle":        return checkVehicle_(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
    case "vcIkman":             return vcIkmanInfo_(args[0], args[1], args[2]);
    default: throw new Error("Unknown action: " + action);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function errMsg_(err) { return String(err && err.message ? err.message : err); }
