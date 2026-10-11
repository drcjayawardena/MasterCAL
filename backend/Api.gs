/******************************************************
 * MasterCAL Pro
 * Api.gs  (v3 — per-user API + email approval)
 *
 * PWA sends { action, args, phone, name, userId }.
 *   1. Access is checked against the USERS sheet.
 *      Only APPROVED WhatsApp numbers may use the app.
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

    /* 0) PUBLIC actions — WhatsApp OTP registration runs BEFORE the
          approval gate, because a brand-new user is not APPROVED yet. */
    if (action === "getAuthMode")         return json_({ ok: true, data: { mode: authMode_() } });
    if (action === "requestWhatsAppCode") return json_(requestWhatsAppCode_(body.args || []));
    if (action === "verifyWhatsAppCode")  return json_(verifyWhatsAppCode_(body.args || []));

    /* 1) approval gate */
    const key = userKey_(body);
    const access = checkAccessFast_(key, body.name);
    if (access.status !== "APPROVED") {
      return json_({ ok: false, access: access.status, error: "Access " + access.status });
    }

    /* 2) route to this user's own copy (keyed by "wa:<number>") */
    setUserContext_(key);
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
    const key = userKey_(e.parameter);
    const access = checkAccessFast_(key, e.parameter.name);
    if (access.status !== "APPROVED") {
      return json_({ ok: false, access: access.status, error: "Access " + access.status });
    }
    setUserContext_(key);
    const args = e.parameter.args ? JSON.parse(e.parameter.args) : [];
    return json_({ ok: true, data: dispatch_(action, args) });
  } catch (err) {
    return json_({ ok: false, error: errMsg_(err) });
  }
}

function dispatch_(action, args) {
  args = args || [];
  switch (action) {
    case "init":                return initApp();
    case "getDropdownData":     return getDropdownData();
    case "getRentalSchedule":   return getRentalSchedule();
    case "saveProductType":     return saveProductType(args[0]);
    case "calcInputs":          return calcInputs(args[0]);
    case "saveScheduleType":    return saveScheduleType(args[0]);
    case "addScheduleRow":      return addScheduleRow(args[0], args[1], args[2]);
    case "updateScheduleFrom":  return updateScheduleFrom(args[0], args[1]);
    case "updateScheduleAmount":return updateScheduleAmount(args[0], args[1]);
    case "deleteScheduleRow":   return deleteScheduleRow(args[0]);
    case "saveSchedule":        return saveSchedule(args[0]);
    case "setRmvType":          return setRmvType(args[0], args[1]);
    case "clearSchedule":       return clearScheduleInputs();
    case "get3W":               return get3W();
    case "set3W":               return set3W(args[0], args[1]);
    case "reset3W":             return reset3W();
    case "getBike":             return getBike();
    case "setBike":             return setBike(args[0], args[1]);
    case "resetBike":           return resetBike();
    default: throw new Error("Unknown action: " + action);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function errMsg_(err) { return String(err && err.message ? err.message : err); }
