/*====================================================
  WhatsApp.gs — "you are approved" WhatsApp message

  When a user is approved (approval e-mail link or the sheet menu), they get a
  WhatsApp message from the VehicleHub number (WhatsApp Business Cloud API,
  paid) using the approved template "user_approved". The template text holds
  the officers' WhatsApp group link, so new users can join with one tap:
    VehicleHUB: Hi {{1}}, your MasterCAL and VehicleHUB account is approved...
  A user approved for MasterCAL only (no VehicleHUB) gets WA_APPROVED_MC_TEMPLATE instead
  (1 body variable: {{1}} name), which does not mention VehicleHUB. Until that property is
  set, MasterCAL-only users get no WhatsApp message.

  Settings (Project Settings → Script properties):
    WA_TOKEN      System User access token (same WhatsApp account as VehicleHub; never share)
    WA_PHONE_ID   1316273428243645
    WA_APPROVED_TEMPLATE     user_approved        (optional)
    WA_APPROVED_MC_TEMPLATE  mastercal_approved   (MasterCAL-only users)
    WA_LANG       en                      (optional, template language code)
  With no WA_TOKEN set nothing is sent, so approval keeps working as before.
====================================================*/

const WA_API_ = "https://graph.facebook.com/v21.0/";

function waProp_(k, def) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  return v === null || v === "" ? def : v;
}

/* row = USERS row (A key "wa:9477…", B name); withVh = false for a MasterCAL-only user.
   Never throws; returns true when sent. */
function sendApprovedWhatsApp_(row, withVh) {
  try {
    const token = waProp_("WA_TOKEN", ""), phoneId = waProp_("WA_PHONE_ID", "");
    const to = String(row[0] || "").replace(/^wa:/i, "").replace(/\D/g, "");
    if (!token || !phoneId || to.length < 10) return false;
    const template = withVh === false ? waProp_("WA_APPROVED_MC_TEMPLATE", "")
                                      : waProp_("WA_APPROVED_TEMPLATE", "user_approved");
    if (!template) return false;
    const name = String(row[1] || "").replace(/[\n\t]+/g, " ").replace(/ {4,}/g, " ").trim() || "Officer";
    const res = UrlFetchApp.fetch(WA_API_ + phoneId + "/messages", {
      method: "post", contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify({
        messaging_product: "whatsapp", to: to, type: "template",
        template: {
          name: template,
          language: { code: waProp_("WA_LANG", "en") },
          components: [{ type: "body", parameters: [{ type: "text", text: name }] }]
        }
      }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) Logger.log("sendApprovedWhatsApp_ " + code + " " + res.getContentText().slice(0, 300));
    return code >= 200 && code < 300;
  } catch (e) {
    try { Logger.log("sendApprovedWhatsApp_ FAILED: " + (e && e.message ? e.message : e)); } catch (e2) {}
    return false;
  }
}
