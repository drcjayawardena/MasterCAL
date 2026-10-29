/******************************************************
 * MasterCAL Pro
 * Manual.gs — VehicleHUB user manual e-mailed on approval
 *
 * When a user is approved (e-mail APPROVE link or the sheet menu) they get
 * an e-mail whose body IS the VehicleHUB user manual, so they know
 * how to use it from day one. Sent to the e-mail in USERS column H; nothing
 * is sent when that is empty. A failure never blocks the approval.
 ******************************************************/

const MANUAL_APP_URL = "https://drcjayawardena.github.io/MasterCAL/";

/* Each section: [heading, [lines]]. A line starting with "- " is a bullet,
   "1. " a numbered step; "**x**" is bold. Plain-text and HTML bodies are built from it. */
const VH_MANUAL = [
  ["1. Getting Started and Signing In", [
    "VehicleHUB records customers who want to buy a vehicle (buyers) and customers who want to sell one (sellers), and automatically matches them.",
    "1. Open the MasterCAL app and sign in with your MasterCAL **username** and **password**.",
    "2. Tap the **Vehicle Hub** tab at the top. VehicleHUB opens without a second sign-in.",
    "If you forget your password, contact the administrator. Once your login has been reset, you can register again."
  ]],
  ["2. Dashboard and Menu", [
    "The **Dashboard** is the first screen in VehicleHUB. Tap any tile to open that list.",
    "- **Active buyers**: buyers still looking for a vehicle",
    "- **Available vehicles**: vehicles currently for sale",
    "- **New matches**: newly found buyer–vehicle matches",
    "- **In progress**: matches currently being followed up",
    "- **Deals this month**: deals closed this month",
    "- **New requests**: new customer requests received through the website",
    "If a notice appears at the top of the Dashboard, open its link and complete that task first.",
    "**Menu tabs:** Dashboard · New Call · Requests · Buyers · Vehicles · Matches · Deals · Approvals (administrators only) · Settings"
  ]],
  ["3. Recording a New Call", [
    "Follow these steps whenever a customer calls.",
    "1. Tap the **New Call** tab (or **Add a new call** on the Dashboard).",
    "2. Enter the customer's phone number (07XXXXXXXX) and tap **Search**. Any previous records for that number are shown.",
    "3. Select **Wants to buy a vehicle** (buyer) or **Has a vehicle to sell** (seller) and complete the form.",
    "4. Tap **Save**. Matching vehicles or buyers are listed immediately.",
    "A newly saved vehicle remains **Pending** until an administrator approves it. Matching begins once it is approved.",
    "If the **Wanted page** or **website showroom** option is ticked, the details are shown on the public website (the customer's name and phone number are never shown). Untick it if the customer does not agree."
  ]],
  ["4. Other Tabs", [
    "**Requests:** customer requests received through the website. Call the customer promptly, then tap **Mark contacted**, **Save as Buyer / Vehicle**, or **Reject** with a reason.",
    "**Buyers and Vehicles:** all saved records. Use the status filter to find a record, **+ Buyer** / **+ Vehicle** to add one, and **Edit** to change one.",
    "**Matches:** every match has a percentage score (green = 80% or higher). Contact the customer with the Call or WhatsApp button, select the status, add notes and tap **Save**. When a sale is completed, update the deal status.",
    "**Deals:** completed (closed) deals.",
    "**Settings:** update your name, phone number and e-mail address. If you add an e-mail address, you will be notified of each new match. Share **My customer request link** on Facebook or WhatsApp."
  ]],
  ["5. Troubleshooting", [
    "- The sign-in page keeps appearing → sign in to MasterCAL again and open the Vehicle Hub tab.",
    "- Recent changes are not showing → close the app completely and open it again.",
    "- A newly added vehicle is missing from Matches → it is still Pending; wait for administrator approval.",
    "- Match e-mails are not arriving → add your e-mail address in Settings.",
    "- Forgotten password → ask the administrator to reset your login."
  ]]
];

function manualInline_(s) {
  return escapeHtml_(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

/* The officers' WhatsApp group ("VehicleHUB Team"); also written in the user_approved WhatsApp template. */
const TEAM_GROUP_URL = "https://chat.whatsapp.com/GzYYI1SveTv5QoLZa7S1GK";

function manualHtml_(name) {
  var h = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#20323a;max-width:600px">' +
    '<h2 style="color:#1c5e3a;margin:0 0 6px">VehicleHUB User Manual</h2>' +
    '<p>Dear ' + escapeHtml_(name || "") + ', your MasterCAL account has been approved ✅. ' +
    'You can now sign in to <a href="' + MANUAL_APP_URL + '">MasterCAL</a> and VehicleHUB with your username and password.</p>' +
    '<p>👥 Please join the officers\' WhatsApp group: <a href="' + TEAM_GROUP_URL + '">' + TEAM_GROUP_URL + '</a></p>';
  VH_MANUAL.forEach(function (sec) {
    h += '<h3 style="color:#1c5e3a;margin:20px 0 6px">' + escapeHtml_(sec[0]) + '</h3>';
    var list = "";
    sec[1].forEach(function (line) {
      const m = line.match(/^(- )(.*)$/);
      if (m) { list += '<li>' + manualInline_(m[2]) + '</li>'; return; }
      if (list) { h += '<ul style="margin:4px 0 8px;padding-left:20px">' + list + '</ul>'; list = ""; }
      h += '<p style="margin:6px 0">' + manualInline_(line) + '</p>';
    });
    if (list) h += '<ul style="margin:4px 0 8px;padding-left:20px">' + list + '</ul>';
  });
  return h + '</div>';
}

function manualText_(name) {
  var t = "Dear " + (name || "") + ", your MasterCAL account has been approved.\n" +
    "You can now sign in to MasterCAL and VehicleHUB with your username and password: " + MANUAL_APP_URL + "\n" +
    "Please join the officers' WhatsApp group: " + TEAM_GROUP_URL + "\n\n" +
    "VEHICLEHUB USER MANUAL\n";
  VH_MANUAL.forEach(function (sec) {
    t += "\n" + sec[0] + "\n" + sec[1].map(function (l) { return l.replace(/\*\*/g, ""); }).join("\n") + "\n";
  });
  return t;
}

/* E-mail the manual to the user of USERS row `rowIndex` (0-based in usersRows_). */
function sendManualToRow_(row) {
  try {
    const to = String(row[7] || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return false;
    const name = String(row[1] || "").trim();
    MailApp.sendEmail({ to: to, subject: "MasterCAL account approved — VehicleHUB User Manual",
                        htmlBody: manualHtml_(name), body: manualText_(name), name: "MasterCAL Pro" });
    return true;
  } catch (e) {
    try { Logger.log("sendManualToRow_ FAILED: " + (e && e.message ? e.message : e)); } catch (e2) {}
    return false;
  }
}

/* Run from the editor to see the e-mail in your own inbox. */
function testManualEmail() {
  const to = adminEmail_();
  sendManualToRow_(["", "Test", "", "", "", "", "", to]);
  Logger.log("Manual sent to " + to);
}
