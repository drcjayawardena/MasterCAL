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
    .addItem("🔄 Refresh all user copies", "menuRefreshCopies_")
    .addItem("ℹ️ Count user copies", "menuCountCopies_")
    .addSeparator()
    .addItem("🔎 Old e-mail users", "menuNonCfUsers_")
    .addItem("🔍 Check BIKE sheet", "menuCheckBikeSheet_")
    .addItem("⏱ Measure calculation time", "menuTimeCalc_")
    .addToUi();
}

function menuRefreshCopies_() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    "Refresh all user copies?",
    "This deletes all user copies. Each user will get a fresh copy with the latest profiles " +
    "the next time they open the app. Continue?",
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;
  const n = adminDeleteAllCopies();
  ui.alert("Done ✅",
    "Removed " + n + " user copies.\nUsers will get fresh copies on next open.",
    ui.ButtonSet.OK);
}

function menuCountCopies_() {
  const ui = SpreadsheetApp.getUi();
  ui.alert("User copies",
    "Current user copies: " + adminCountCopies(),
    ui.ButtonSet.OK);
}
