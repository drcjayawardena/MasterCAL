/******************************************************
 * MasterCAL Pro
 * Manual.gs — VehicleHUB user manual e-mailed on approval
 *
 * When a user is approved (e-mail APPROVE link or the sheet menu) they get
 * an e-mail whose body IS the VehicleHUB user manual (Sinhala), so they know
 * how to use it from day one. Sent to the e-mail in USERS column H; nothing
 * is sent when that is empty. A failure never blocks the approval.
 ******************************************************/

const MANUAL_APP_URL = "https://drcjayawardena.github.io/MasterCAL/";

/* Each section: [heading, [lines]]. A line starting with "- " is a bullet,
   "1. " a numbered step; "**x**" is bold. Plain-text and HTML bodies are built from it. */
const VH_MANUAL = [
  ["1. VehicleHUB සහ Login වීම", [
    "VehicleHUB කියන්නේ වාහන ගන්න අය (Buyers) සහ විකුණන අය (Sellers) ගැන විස්තර save කරලා, ඒ දෙගොල්ලන්ව app එකෙන්ම ගලපන (match කරන) system එකක්.",
    "1. MasterCAL app එක open කරලා ඔබේ MasterCAL **username** සහ **password** එකෙන් login වෙන්න.",
    "2. උඩ තියෙන **Vehicle Hub** tab එක ඔබන්න. VehicleHUB ආයේ login නොවී open වෙනවා.",
    "Password අමතක වුණොත් admin ට කියන්න. Admin ඔබේ login එක reset කළාම ආයේ register වෙන්න පුළුවන්."
  ]],
  ["2. Dashboard සහ Menu එක", [
    "VehicleHUB open කළාම මුලින්ම පේන්නේ **Dashboard** එක. එකේ කොටුවක් ඔබුවාම ඒ list එක open වෙනවා.",
    "- **Active buyers**: තාම වාහනයක් හොයන buyers ගණන",
    "- **Available vehicles**: විකුණන්න තියෙන වාහන ගණන",
    "- **New matches**: අලුතින් හම්බුණු buyer–vehicle ගැලපීම්",
    "- **In progress**: කතා කරමින් යන matches",
    "- **Deals this month**: මේ මාසේ විකුණුණු deals",
    "- **New requests**: Website එකෙන් ආව අලුත් customer requests",
    "Dashboard එකේ උඩම notice එකක් ආවොත්, ඒකේ link එක ඔබලා ඒ වැඩේ මුලින්ම කරන්න.",
    "**Menu එකේ tabs:** Dashboard · New Call · Requests · Buyers · Vehicles · Matches · Deals · Approvals (admin ට විතරයි) · Settings"
  ]],
  ["3. New Call එකක් Add කරන හැටි", [
    "Customer කෙනෙක් call කළාම මේ පියවර කරන්න.",
    "1. **New Call** tab එක (හැම තිස්සේම Dashboard එකේ **Add a new call**) ඔබන්න.",
    "2. Customer ගේ phone number එක (07XXXXXXXX) type කරලා **Search** ඔබන්න. කලින් call කරලා තියෙනවා නම් ඒ records පේනවා.",
    "3. **Wants to buy a vehicle** (buyer) හෝ **Has a vehicle to sell** (seller) තෝරලා form එක පුරවන්න.",
    "4. **Save** ඔබන්න. එවෙලාම ගැලපෙන vehicles / buyers ලිස්ටුව පේනවා.",
    "අලුත් vehicle එකක් save කළාම admin approve කරනකම් **Pending**. Approve කළාට පස්සේ matching පටන් ගන්නවා.",
    "Form එකේ **Wanted page** / **website showroom** tick එක තියෙනවා නම්, ඒ විස්තර public website එකේ පේනවා (නම සහ phone number පෙන්නන්නේ නෑ). Customer කැමති නැත්නම් tick එක අයින් කරන්න."
  ]],
  ["4. අනිත් Tabs", [
    "**Requests:** Website එකෙන් එන requests. ඉක්මනට call කරන්න. **Mark contacted**, **Save as Buyer / Vehicle**, නැත්නම් හේතුවක් එක්ක **Reject** කරන්න.",
    "**Buyers සහ Vehicles:** Save කරපු සියලු දේ. Status filter එකෙන් හොයන්න. අලුතින් දාන්න **+ Buyer** / **+ Vehicle**, වෙනස් කරන්න **Edit**.",
    "**Matches:** හැම match එකකටම % score එකක් තියෙනවා (කොළ = 80%+). Call / WhatsApp button එකෙන් කතා කරලා, status එක තෝරලා notes එක්ක **Save** කරන්න. විකුණුණොත් deal status එක දාන්න.",
    "**Deals:** විකුණුණු (close කළ) deals.",
    "**Settings:** ඔබේ නම, phone, email වෙනස් කරන්න. Email එක දැම්මොත් අලුත් match එකකට email එකක් එනවා. **My customer request link** එක Facebook / WhatsApp වල share කරන්න."
  ]],
  ["5. ගැටලු ආවොත්", [
    "- Login page එක ආයේ එනවා → MasterCAL එකට ආයේ login වෙලා Vehicle Hub tab එක open කරන්න.",
    "- අලුත් වෙනස්කම් පේන්නේ නෑ → App එක වහලා ආයේ open කරන්න.",
    "- එකතු කළ vehicle එක matches වල නෑ → එය තාම Pending; admin approve කරනකම් ඉන්න.",
    "- Match emails එන්නේ නෑ → Settings එකේ email එක දාන්න.",
    "- Password අමතකයි → Admin ට කියලා login එක reset කරගන්න."
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
    '<p>ආයුබෝවන් ' + escapeHtml_(name || "") + ', ඔබේ MasterCAL account එක approve කළා ✅. ' +
    'දැන් <a href="' + MANUAL_APP_URL + '">MasterCAL</a> සහ VehicleHUB දෙකටම ඔබේ username + password එකෙන් login වෙන්න පුළුවන්.</p>' +
    '<p>👥 Officers ලාගේ WhatsApp group එකට එකතු වෙන්න: <a href="' + TEAM_GROUP_URL + '">' + TEAM_GROUP_URL + '</a></p>';
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
  var t = "ආයුබෝවන් " + (name || "") + ", ඔබේ MasterCAL account එක approve කළා.\n" +
    "MasterCAL සහ VehicleHUB දෙකටම ඔබේ username + password එකෙන් login වෙන්න පුළුවන්: " + MANUAL_APP_URL + "\n" +
    "Officers ලාගේ WhatsApp group එකට එකතු වෙන්න: " + TEAM_GROUP_URL + "\n\n" +
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
