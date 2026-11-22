# MasterCAL Pro — Standalone (online)

The MasterCAL calculator (4W / 3W / BIKE + Valuations) that calculates on the staff member's own device,
built from the Google Sheet formulas. There is no offline file: staff always use a link.

## Staff links (approved MasterCAL users only)
- https://drcjayawardena.github.io/MasterCAL/standalone/ (can be installed as an app)
- `<exec URL>?app=standalone`

Both pages hold no rates. After the normal MasterCAL login the model (formulas + rates) is downloaded
from the hidden `_SA_STORE` sheet of the master Sheet, and every calculation runs locally.

## Updating the app
- **Rates / formulas changed in the Sheet**: Admin tab → **🔄 Update app** (or Sheet menu "📦 Publish Standalone app").
  Both links get the new version; the app shows "Rates updated: <date>" bottom-left.
- **App code changed** (`Standalone/app`, `Standalone/engine`, `FrontEND/app.js|index.html|styles.css`):
  1. `node Standalone/tools/build_standalone.js Standalone/template/MasterCAL_Standalone_template.html`
  2. Commit and push to `main`: the GitHub link updates by itself (`pages-deploy.yml` runs `build_pages.js`).
  3. Admin tab → **Update app**, so the `/exec` link gets the new template too.

## Admin tab
Shown only to users whose USERS "Role" column = `ADMIN` (menu "👑 Make a user Admin (Standalone)").
Approve users from the list or by typing their WhatsApp number, block users, and update the app.
The server re-checks every admin call.

Valuations: the riyasewana link always opens the same named tab (`riyasewanaTab`), so a new check reloads it instead of opening another.
