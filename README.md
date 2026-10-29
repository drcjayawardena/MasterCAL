# MasterCAL Pro

Vehicle leasing rental calculator (PWA). The calculation runs in a Google Sheet; each approved user gets their own copy.
The backend is Google Apps Script, the website is GitHub Pages. MasterCAL login is also used by VehicleHUB (`whoami`).

## 📁 Folders
| Folder | What it is | Deploys to |
|---|---|---|
| `BackEND/` | Google Apps Script code — `Api.gs` (doGet/doPost), `Code.gs`, `Access.gs`, `Login.gs`, `Register.gs`, `Bike.gs`, `VehicleCheck.gs`, `WhatsApp.gs`, `Manual.gs`, `Menu.gs`, `Perf.gs`, `appsscript.json`, `.clasp.json` | Apps Script web app (workflow **Apps Script — deploy**) |
| `FrontEND/` | Website — `index.html`, `app.js` (API_URL = /exec), `styles.css`, `sw.js`, `manifest.json`, `manual.html`, `icons/` | GitHub Pages (workflow **Website — deploy**) |
| `.github/workflows/` | Automatic deploy / pull workflows | — |
| `CLAUDE.md` | Project notes for Claude Code | — |

## 🚀 How deploy works
1. Change files in this folder (`C:\Users\Pentium\Documents\Project\MasterCAL`).
2. Commit and push to `main`.
3. GitHub Actions does the rest:
   - `BackEND/` changed → `clasp push` + `clasp deploy` to the same deployment (the /exec URL never changes).
   - `FrontEND/` changed → the website is published to GitHub Pages.
4. Check: https://github.com/drcjayawardena/MasterCAL/actions

⚠️ Apps Script editor එකේ code වෙනස් කළොත් → Actions → **"Apps Script — pull live code"** → Run workflow → ඊට පස්සේ මෙතන `git pull`.
නැත්නම් ඊළඟ deploy එකෙන් editor එකේ වෙනස්කම් මැකෙනවා.
⚠️ `FrontEND/` එකේ file එකක් වෙනස් කළොත් `sw.js` එකේ `CACHE_VERSION` එකත් වැඩි කරන්න (cache-first නිසා).

## 🌐 App
| What | Link |
|---|---|
| MasterCAL app | https://drcjayawardena.github.io/MasterCAL/ |
| User manual | https://drcjayawardena.github.io/MasterCAL/manual.html |

## 📊 Google Sheet (Master)
| What | Link |
|---|---|
| MasterCAL master sheet (Apps Script is bound to it) | https://docs.google.com/spreadsheets/d/1ygU61ga19E67iE7iWjiGFp-AlUgRf21yhQdxIxjfsUE/edit |

User copies are saved in the Drive folder `MasterCAL_UserCopies`.
⚠️ Sheet එකේ users ලාගේ data තියෙනවා — access දෙන්න ඕන අයට විතරයි.

## ⚙️ Apps Script (Backend)
| What | Link |
|---|---|
| Editor | https://script.google.com/home/projects/1gqq5BdFrmG49ayfNcj9pXqxvne3y93Uow8gwpa9zMBFAEIQ9JW-EihTk/edit |
| Project history | https://script.google.com/home/projects/1gqq5BdFrmG49ayfNcj9pXqxvne3y93Uow8gwpa9zMBFAEIQ9JW-EihTk/projecthistory |
| Project Settings (Script properties) | https://script.google.com/home/projects/1gqq5BdFrmG49ayfNcj9pXqxvne3y93Uow8gwpa9zMBFAEIQ9JW-EihTk/settings |
| Web app API (/exec) | https://script.google.com/macros/s/AKfycbx8m_v6iMUy8tTSGzxSfxi79ZyTfJgpy89WjVkqRMO3dvnm734znkdTvjpW92DhO-xN/exec |

Health check: open the /exec link — it shows `MasterCAL Pro API is running.`
🔒 Script Properties වල secrets (`SESSION_SECRET` වගේ) තියෙනවා — screenshot ගන්න එපා.

## 🐙 GitHub
| What | Link |
|---|---|
| Repository | https://github.com/drcjayawardena/MasterCAL |
| Actions | https://github.com/drcjayawardena/MasterCAL/actions |
| Secrets (`CLASPRC_JSON`) | https://github.com/drcjayawardena/MasterCAL/settings/secrets/actions |
| Pages settings (Source: GitHub Actions) | https://github.com/drcjayawardena/MasterCAL/settings/pages |

## 🔗 Related
- VehicleHUB: https://drcjayawardena.github.io/VehicleHUB/ — repo https://github.com/drcjayawardena/VehicleHUB
  (VehicleHUB's `McLogin.gs` calls this /exec with action `whoami` — don't change the deployment ID.)

## Notes
- The repository is public but holds **no data and no passwords** — only code.
