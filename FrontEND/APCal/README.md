# APCal — 4W calculator

A standalone 4W leasing calculator page for MasterCAL GitHub Pages, styled in red, black, and white to match the requested screenshot.

The interface contains one Facility Details card with product type, facility amount, BIC, insurance, stamp duty, period, and IRR inputs. The monthly rental, rate per LKR 100,000, total interest, total paid, and amount financed appear in the same card. Users can add multiple month-and-amount bullet payments; each one recalculates rental and appears in the printable rental schedule.

Default values follow the spreadsheet's exact `4W` tab (no space): REG CAR, LKR 4,000,000 facility, 72 months, and 16% IRR. Rental calculations use the 4W PMT method, IRR / 12, a LKR 150 regular monthly fee, and ceiling-to-rupee rounding. The schedule can be expanded and printed.

The external `PRODUCT PROFILE` import is not included in the workbook export. The stamp duty dropdown uses the available 4W profile values; its default is INITIAL PAID. The page does not embed spreadsheet credentials or private data.

JS and CSS asset URLs are versioned to prevent stale browser assets after deployment.
