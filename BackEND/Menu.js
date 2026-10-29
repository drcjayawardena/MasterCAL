/******************************************************
 * MasterCAL Pro — Sheet menu (admin buttons)
 ******************************************************/

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("⚙️ MasterCAL Admin")
    .addItem("✅ Approve a user", "menuApproveUser_")
    .addItem("⛔ Block a user", "menuBlockUser_")
    .addItem("🔑 Reset a user's login", "menuResetLogin_")
    .addItem("👥 Pending users", "menuPendingCount_")
    .addItem("📋 Approved users list", "menuApprovedList_")
    .addItem("✉️ Test notification email", "menuTestEmail_")

    .addSeparator()
    .addItem("🔄 Refresh user copies (on next open)", "menuRefreshCopies_")
    .addItem("🔔 Turn on auto-refresh (one-time setup)", "menuAutoRefresh_")
    .addItem("ℹ️ Count user copies", "menuCountCopies_")
    .addItem("🗑 Delete ALL user copies now", "menuDeleteAllCopies_")
    .addSeparator()
    .addItem("🔎 Old e-mail users", "menuNonCfUsers_")
    .addItem("🔍 Check BIKE sheet", "menuCheckBikeSheet_")
    .addItem("⏱ Measure calculation time", "menuTimeCalc_")
    .addToUi();
}

/* Marks every copy as outdated. Nothing is deleted now: each user's copy is rebuilt from
   this master the next time that user opens the app (the app shows "Updating…"). */
function menuRefreshCopies_() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "Refresh user copies?",
    "Every user gets a fresh copy of this master sheet the next time they open the app " +
    "(their calculator inputs are reset). Nothing is deleted now. Continue?",
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;
  bumpMasterVersion_();
  ui.alert("Done ✅", "All user copies are marked as outdated.\nThey will be rebuilt as users open the app.", ui.ButtonSet.OK);
}

/* One-time: from now on, editing the master by hand marks the copies as outdated by itself. */
function menuAutoRefresh_() {
  const ui = SpreadsheetApp.getUi();
  installAutoRefreshTriggers_();
  ui.alert("Auto-refresh is ON ✅",
    "When you edit this master sheet (any tab except " + MASTER_IGNORE_SHEETS.join(", ") + "), " +
    "user copies are rebuilt as each user next opens the app.",
    ui.ButtonSet.OK);
}

/* The old behaviour: trash every copy right now. */
function menuDeleteAllCopies_() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "Delete ALL user copies now?",
    "This trashes every user copy immediately. Each user gets a new one on next open. " +
    "Normally you do not need this: use 'Refresh user copies (on next open)'. Continue?",
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;
  const n = adminDeleteAllCopies();
  ui.alert("Done ✅", "Removed " + n + " user copies.", ui.ButtonSet.OK);
}

function menuCountCopies_() {
  const ui = SpreadsheetApp.getUi();
  const p = PropertiesService.getScriptProperties().getProperties();
  const ver = p[MASTER_VER_KEY] || "0";
  const ids = Object.keys(p).filter(function (k) { return k.indexOf("copy_") === 0; });
  const outdated = ids.filter(function (k) { return (p["copyver_" + k.slice(5)] || "0") !== ver; }).length;
  ui.alert("User copies",
    "Current user copies: " + ids.length + "\nOutdated (rebuilt on next open): " + outdated,
    ui.ButtonSet.OK);
}
