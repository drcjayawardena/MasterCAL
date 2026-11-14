# Codex Chat Record — MasterCAL

**Date:** 2026-11-02  
**Repository:** C:\Users\Pentium\Documents\Project\MasterCAL

## Authentication overview

The conversation began with a request to explain authentication in MasterCAL and VehicleHUB, in Sinhala. The explanation covered registration and admin approval, MasterCAL signed session tokens, per-user spreadsheet copies, VehicleHUB's whoami single sign-on check, session storage, password hashing, lockout, and deployment secrets. Relevant source files include BackEND/Api.gs, BackEND/Login.gs, BackEND/Register.gs, BackEND/Access.gs, and VehicleHUB's BackEND/McLogin.gs and BackEND/Code.gs.

## Vehicle Lease layout

A screenshot showed the requested three-column layout: Facility Details on the left, Payment Detail and Rental with Residual in the center, and Charges Calculation on the right. The local frontend was updated in:

- FrontEND/index.html
- FrontEND/styles.css
- FrontEND/app.js

The first local preview did not update the hosted app. After that was pointed out, the changes were pushed to main. The service-worker cache version was also bumped so returning users could receive the new frontend. GitHub Pages deployed successfully, and the published page, stylesheet, and service worker were checked.

Commits: 44c1bed (layout) and e3c8265 (cache refresh).

## WhatsApp quotation

A follow-up request asked to remove capitalized amount details from WhatsApp quotations. The separate “Capitalized Insurance” and “Capitalized StampDuty” lines were removed; the facility amount, monthly rental, and total initial charges remain. The service-worker cache was bumped again.

Commit: bd770e7 — Remove capitalized amounts from WhatsApp quotes.

The GitHub Pages deployment succeeded. The published app.js was checked and no longer contains either capitalized detail line; the published service worker reports cache version mastercal-v101.

## Links

- [MasterCAL app](https://drcjayawardena.github.io/MasterCAL/)
- [MasterCAL repository](https://github.com/drcjayawardena/MasterCAL)
- [Latest deployment](https://github.com/drcjayawardena/MasterCAL/actions/runs/41498505923)
## APCal 4W calculator

**Date:** 2026-11-03

The user requested a new web app named APCal based on the supplied Google Sheet and the MasterCAL Vehicle Lease layout, then specified a red / black / white theme and narrowed scope to the exact `4W` tab (not the separate `4 W` tab). Added a standalone GitHub Pages page at `FrontEND/APCal/` with Facility Details, Payment Detail, Rental with Residual, Charges Calculation, and an expandable / printable rental schedule.

Files added: `FrontEND/APCal/index.html`, `FrontEND/APCal/styles.css`, `FrontEND/APCal/app.js`, and `FrontEND/APCal/README.md`. The initial inputs match the 4W tab's REG CAR example: LKR 4,300,000 valuation, 70% exposure, LKR 4,000,000 facility, 72 months, 16% IRR, normal schedule, 40% / LKR 1,600,000 bulk setting. The regular rental uses the tab's PMT approach, annual IRR divided by 12, LKR 150 fee, and rupee ceiling. The external `PRODUCT PROFILE` import is unavailable in the downloaded workbook, so profile-dependent stamp/fee inputs are editable; the displayed default matches the exported 4W values.

Local verification: `node --check` passed. An Edge visual preview was captured at `C:\Users\Pentium\.codex\visualizations\2026\11\02\01a19d03-db71-7552-85e9-8a15e7818d6b\APCal-preview.png`. With the sheet's sample inputs, APCal shows monthly rental LKR 86,918.00, total paid LKR 6,258,096.00, total interest LKR 2,258,096.00, and total charges LKR 24,000.00. No deployment or push was performed; the page will be included at `/APCal/` when the repo's existing GitHub Pages workflow deploys `FrontEND/`.

## APCal mobile layout update

The user supplied a mobile screenshot. Updated `FrontEND/APCal/styles.css` and `FrontEND/APCal/index.html` so the phone view shows the core 4W inputs and rental summary in one compact card, hides the advanced exposure/bulk controls and desktop-only charges/residual panels, removes the empty tab-note block and exposure warning, and keeps the schedule button label visible. The full 4W calculator remains available in the desktop layout. Edge mobile preview: `C:\Users\Pentium\.codex\visualizations\2026\11\02\01a19d03-db71-7552-85e9-8a15e7818d6b\APCal-mobile-after.png`.

## APCal bullet payment schedule

The user asked to add bullet payments. Added an “ADD BULLET PAYMENT” control with editable month and amount rows. Each payment adjusts the rental calculation and appears in the corresponding printable schedule row. Verified in an Edge mobile preview using a LKR 500,000 bullet at month 36: monthly rental recalculated to LKR 80,185 and month 36 shows the bullet amount. Changes are ready for the requested live update.

## APCal bullet button cache fix

The user reported that bullet payments were not working on the live page. A clean live browser session confirmed the click handler adds a row and LKR 500,000 at month 36 recalculates monthly rental to LKR 80,185 and appears in the month 36 schedule. Updated the asset URLs with a version query to bypass stale cached JavaScript, scroll/focus the new amount field, and change the action label after a row is added. Local browser check passed; publishing the cache fix.

## APCal bullet payment live issue

The user reported bullet payments were not working. A clean live browser reproduced the current handler: clicking adds a row; entering LKR 500,000 for month 36 updates rental to LKR 80,185 and places LKR 500,000 in month 36 of the schedule. Published a cache-busting asset URL and interaction feedback (auto-scroll/focus, button label changes) in commit `0f6a9a6`. GitHub Pages succeeded; the cache-busted live page was re-tested with the same month-36 calculation. User may need Ctrl+F5 once to load the latest page HTML if their browser retained an older copy.

## APCal single-card layout

The user requested removing the Payment Detail, Rental with Residual, and Charges Calculation panels and provided a screenshot. Rebuilt the APCal page to match it: one 4W Lease tab; a single Facility Details card with rental amount and totals inside; bullet rows; an empty workspace to the right on desktop; a full-width rental schedule button along the bottom. Removed residual/charges UI and its calculator logic. Local visual preview matches the supplied screenshot layout. Browser check for LKR 500,000 at month 36: rental LKR 80,185, total paid LKR 6,273,320, bullet shown on schedule row 36. Preparing the live deployment.

## APCal files and final live verification

The user requested APCal, MasterCAL, and VehicleHUB to remain separate folders under `C:\Users\Pentium\Documents\Project`. Confirmed the existing MasterCAL and VehicleHUB directories and created `Project\APCal` as a separate copy of the four app files. Verified source and standalone copies match by SHA-256. The simplified UI was deployed in commit `fb56879`; GitHub Pages completed successfully. Live HTTP 200 check confirmed Payment Detail, Rental with Residual, and Charges Calculation panels are absent. Live browser verification still passes with month 36 / LKR 500,000: monthly rental LKR 80,185, total paid LKR 6,273,320, and the bullet appears on row 36.

## Standalone APCal site and width

The user requested a separate APCal site at `https://drcjayawardena.github.io/APCal/` and then asked for the app width to match the Facility Details card. Confirmed the existing `drcjayawardena/APCal` repository was empty, pushed the standalone app and Pages workflow, and enabled GitHub Pages with workflow deployment. The page content is capped at 480px, the blank workspace is removed, and the UI matches the single-card screenshot. The separate folders `Project\APCal`, `Project\MasterCAL`, and `Project\VehicleHUB` are present. Standalone deployment succeeded (`5d3d89f`); the MasterCAL-hosted compatibility path was also updated and deployed (`87a0362`). Live bullet test remains correct: month 36 / LKR 500,000 yields rental LKR 80,185 and appears in the month 36 schedule.
