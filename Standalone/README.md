# MasterCAL Pro — Standalone

One self-contained HTML file (4W / 3W / BIKE + Valuations) built from the Google Sheet formulas.

## Update the file after the Google Sheet changed ("Publish")
1. Google Sheet: File → Download → Microsoft Excel (.xlsx).
2. `python3 -I Standalone/tools/publish.py MasterCAL_Pro.xlsx MasterCAL_Pro_Standalone.html`
   (needs Python with `openpyxl`, and Node.js)
3. Read the report: `RESULT: OK` = safe; otherwise it lists functions the engine cannot do.
4. Share the new HTML by email/OneDrive/SharePoint.

NEVER commit model.json or the built HTML to the public repo (they contain rates and formulas).

## Which parts change?
Normally only the **PRODUCT PROFILE** (rates/profile) data changes, not the formulas. The routine is the same:
edit the Sheet -> menu "Publish Standalone app" -> share the new file. The file shows "Rates updated: <date>" bottom-left
so staff can see whether they hold the latest version.

## Online link (staff open this, no file to share)
- Link: `<exec URL>?app=standalone` (shown in the Publish dialog). Staff log in with their normal MasterCAL web account (APPROVED users only).
- The page holds no rates; after login the model is downloaded from `online_model.json` in Drive folder `MasterCAL_Standalone`.
  **Publish Standalone app** (Sheet menu) refreshes it, so the link is always current.
- **Admin tab**: shown only to users whose USERS "Role" column = `ADMIN` (menu "👑 Make a user Admin (Standalone)"). Approve / Block users there; the server re-checks every call.
- Valuations: the riyasewana link always opens the same named tab (`riyasewanaTab`), so a new check reloads it instead of opening another.
