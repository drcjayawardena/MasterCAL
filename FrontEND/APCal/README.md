# APCal — 4W calculator

Standalone 4W leasing calculator page for MasterCAL GitHub Pages. It follows the Facility Details / Payment Detail / Charges Calculation / Rental Schedule layout and uses a red, black and white theme.

The starting values are from the spreadsheet's exact `4W` tab (no space): REG CAR, LKR 4,300,000 valuation, 70% maximum exposure, LKR 4,000,000 facility, 72 months, 16% IRR, normal schedule, and a 40% / LKR 1,600,000 last payment setting. The spreadsheet's `PRODUCT PROFILE` tab is an external IMPORTRANGE and is unavailable in the downloaded workbook, so the profile-dependent stamp rate and fees remain editable and default to the exported 4W result (zero stamp duty collected, LKR 24,000 normal RMV charge).

Calculations use the 4W tab's PMT formulas, monthly rate (IRR / 12), LKR 150 regular-schedule fee, and ceiling-to-rupee rental rounding. The rental schedule can be expanded and printed. No spreadsheet credentials or private data are embedded.

The form includes an Add Bullet Payment control. Each bullet has a month and LKR amount; adding or editing a row recalculates the fixed rental and inserts that payment into the printable rental schedule. The desktop normal/bulk schedule behavior remains available.


The JS/CSS assets use a versioned URL so browsers refresh them after a Pages deployment. Adding a bullet scrolls to and focuses its amount field; the button label changes to Add Another Bullet Payment while rows exist.

