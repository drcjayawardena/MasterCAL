# CLAUDE.md — MasterCAL Pro

## Owner preferences
- Explain to the owner in **Sinhala**, keeping technical terms in English (e.g. "Script property එක set කරන්න").
- The owner is not a developer: give click-by-click steps, and warn before anything that shows secrets on screen.

## Architecture
- **Local working copy**: `C:\Users\Pentium\Documents\Project\MasterCAL` (older folders under `Documents\Ravi` are history only).
- **Data**: master Google Sheet (Apps Script is bound to it):
  https://docs.google.com/spreadsheets/d/1ygU61ga19E67iE7iWjiGFp-AlUgRf21yhQdxIxjfsUE/edit
  Each APPROVED user is routed to their own copy of the sheet (Drive folder `MasterCAL_UserCopies`, keyed by `wa:<number>`).
- **Backend**: Apps Script in `BackEND/` — `Api.gs` holds the only `doGet`/`doPost`; actions are dispatched in `dispatch_`.
  Script ID `1gqq5BdFrmG49ayfNcj9pXqxvne3y93Uow8gwpa9zMBFAEIQ9JW-EihTk` (see `BackEND/.clasp.json`).
  Public actions before the login gate: `register`, `login`, `whoami` (used by VehicleHUB `McLogin.gs`).
- **Website**: `FrontEND/` (PWA), published by `.github/workflows/pages-deploy.yml` (Pages source = GitHub Actions) —
  https://drcjayawardena.github.io/MasterCAL/ . `FrontEND/app.js` `API_URL` holds the `/exec` URL.
  `sw.js` is cache-first: bump `CACHE_VERSION` whenever a FrontEND file changes.
  The root-level PNGs in `FrontEND/` duplicate `FrontEND/icons/`; the app uses `icons/`.
- **VehicleHUB** (separate repo `drcjayawardena/VehicleHUB`, local `Documents\Project\VehicleHUB`) logs in through this API.

## Deploy pipeline (clasp 2.4.2 via GitHub Actions)
- Push to `main` touching `BackEND/**` → `apps-script-deploy.yml` runs `clasp push --force` then `clasp deploy`
  to deployment `AKfycbx8m_v6iMUy8tTSGzxSfxi79ZyTfJgpy89WjVkqRMO3dvnm734znkdTvjpW92DhO-xN` (same /exec URL), then checks
  that `/exec` answers "MasterCAL Pro API is running.".
- `clasp push --force` replaces EVERY file in the Apps Script project; the workflow refuses to run if a listed file is missing.
  If a file is added to / removed from the project, update that list.
- Auth: repo secret `CLASPRC_JSON` (contents of `~/.clasprc.json`, clasp 2.4.2 format).
- **Rule**: if anyone edits code in the Apps Script editor, run Actions → "Apps Script — pull live code" first,
  then `git pull` here, before changing `BackEND/`.
- Push to `main` touching `FrontEND/**` → `pages-deploy.yml` publishes the website.

## Status (2026-10-29)
- Repo restructured into `BackEND/` / `FrontEND/`. `CLASPRC_JSON` added and "Apps Script — pull live code" ran:
  `BackEND/` now matches the live Apps Script editor code (9 of 11 files had been stale in the repo before).
- The deploy workflow has not run yet; the first push that touches `BackEND/` will publish the editor code as a new
  version of the /exec deployment.
