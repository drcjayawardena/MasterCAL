/*====================================================
  WhatsApp.gs — send a customer quotation through the WhatsApp Business Cloud API

  The app's "Send automatically" button calls the action sendQuote. The server sends an APPROVED
  TEMPLATE message (WhatsApp only allows free text inside 24 hours after the customer wrote to you).

  Settings (Project Settings → Script properties — never put these in the code or in GitHub):
    WA_TOKEN           System User access token
    WA_PHONE_ID        phone number ID of the WhatsApp Business number
    WA_QUOTE_TEMPLATE  template name (default: mastercal_quotation)
    WA_LANG            template language code (default: en)

  The template (category Utility) must have exactly 7 body variables, in this order:
    Dear Customer, please find below your requested {{1}} quotation.
    Facility Amount: {{2}}
    Period (months): {{3}}
    Monthly Rental: {{4}}
    Bullet Payments: {{5}}
    Initial Charges: {{6}}
    This quotation is an estimate only. For further details, please contact us on {{7}}.

  Safety: only signed-in APPROVED users reach this; every value is checked against a strict pattern
  (nobody can send free text from your number); Sri Lankan numbers only; a daily limit per user.
====================================================*/

const WA_QUOTE_DAILY_LIMIT = 40;                      /* messages per user per day */
const WA_QUOTE_TITLES = ["Vehicle Lease", "Three-Wheel Lease", "Bike Lease"];
const WA_MONEY_RE = /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d{1,12}(\.\d{1,2})?$/;

function waProp_(k, def) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  return v === null || v === "" ? def : v;
}

function waLocal_(key) {                              /* "wa:94771234567" -> "0771234567" */
  const d = String(key || "").replace(/\D/g, "");
  return d.indexOf("94") === 0 && d.length === 11 ? "0" + d.slice(2) : "+" + d;
}

/* one counter per user, stored as "YYYYMMDD:count" */
function waQuoteCount_(userKey, add) {
  const p = PropertiesService.getScriptProperties();
  const k = "wqc_" + userKey;
  const today = Utilities.formatDate(new Date(), "Asia/Colombo", "yyyyMMdd");
  const parts = String(p.getProperty(k) || "").split(":");
  let n = parts[0] === today ? Number(parts[1]) || 0 : 0;
  if (add) { n += add; p.setProperty(k, today + ":" + n); }
  return n;
}

function waMoney_(v, what) {
  const s = String(v == null ? "" : v).trim();
  if (!WA_MONEY_RE.test(s)) throw new Error("Invalid " + what + ".");
  return s;
}

/* args[0] = { title, facility, period, rental, bullets:[[label, amount]], total, to } */
function sendQuote_(userKey, args) {
  const q = (args && args[0]) || {};
  const token = waProp_("WA_TOKEN", ""), phoneId = waProp_("WA_PHONE_ID", "");
  if (!token || !phoneId) throw new Error("Automatic sending is not set up yet. Use 'Send via WhatsApp'.");

  if (WA_QUOTE_TITLES.indexOf(q.title) === -1) throw new Error("Invalid quotation type.");
  const to = String(q.to || "").replace(/\D/g, "");
  if (!/^94\d{9}$/.test(to)) throw new Error("Enter a valid Sri Lankan WhatsApp number (e.g. 0771234567).");

  const facility = q.facility ? waMoney_(q.facility, "facility amount") : "-";
  const period = String(q.period || "").trim();
  if (period && !/^\d{1,3}(\.\d{1,2})?$/.test(period)) throw new Error("Invalid period.");
  const rental = waMoney_(q.rental, "monthly rental");
  if (!Number(rental.replace(/,/g, ""))) throw new Error("The monthly rental is zero. Complete the calculation first.");
  const total = q.total ? waMoney_(q.total, "initial charges") : "-";

  const bl = Array.isArray(q.bullets) ? q.bullets : [];
  if (bl.length > 12) throw new Error("Too many bullet payments.");
  const bullets = bl.map(function (b) {
    const label = String(b && b[0] || "").trim();
    if (!/^Month \d{1,3}(–\d{1,3})?$/.test(label)) throw new Error("Invalid bullet payment.");
    return label + ": " + waMoney_(b[1], "bullet amount");
  }).join(", ") || "None";

  if (waQuoteCount_(userKey, 0) >= WA_QUOTE_DAILY_LIMIT) throw new Error("Daily quotation limit reached. Try again tomorrow.");

  const vars = [q.title, facility, period || "-", rental, bullets, total, waLocal_(userKey)];
  const res = UrlFetchApp.fetch("https://graph.facebook.com/v21.0/" + phoneId + "/messages", {
    method: "post", contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({
      messaging_product: "whatsapp", to: to, type: "template",
      template: {
        name: waProp_("WA_QUOTE_TEMPLATE", "mastercal_quotation"),
        language: { code: waProp_("WA_LANG", "en") },
        components: [{ type: "body", parameters: vars.map(function (t) { return { type: "text", text: String(t) }; }) }]
      }
    }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode(), text = res.getContentText();
  if (code < 200 || code >= 300) {
    let msg = "";
    try { msg = JSON.parse(text).error.message || ""; } catch (e) {}
    Logger.log("sendQuote_ " + code + " " + text.slice(0, 300));
    if (/template/i.test(msg)) throw new Error("The WhatsApp template is missing or not approved yet.");
    throw new Error("WhatsApp could not send the message (" + code + "). " + msg.slice(0, 120));
  }
  waQuoteCount_(userKey, 1);
  return { sent: true };
}
