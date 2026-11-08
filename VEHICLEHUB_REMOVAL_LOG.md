# VehicleHUB removal log

**Date:** 2026-11-08  
**Scope:** Remove the VehicleHUB integration from the MasterCAL repository and deployed MasterCAL app. The separate VehicleHUB repository is not modified.

**Restore point:** Git tag [`vehiclehub-mastercal-restore-2026-11-08`](https://github.com/drcjayawardena/MasterCAL/tree/vehiclehub-mastercal-restore-2026-11-08), pointing to commit `7ed94a318d8f8d327cd13784a4f1c28da745cf1a` (the last commit before these removals).

## Removed

- MasterCAL navigation tabs for VehicleHUB's Vehicles, Buyers, and Matches sections.
- The embedded VehicleHUB iframe, its CSS, and the `postMessage` view-switching code.
- VehicleHUB URLs and customer buy/sell request links from WhatsApp quotations.
- The `whoami` API endpoint, which exposed MasterCAL session identity to VehicleHUB.
- The shared `mastercal_token` browser-storage key and the old `vehiclehub_username` value. MasterCAL now uses `mastercal_session_token` and clears those legacy VehicleHUB keys when it loads.
- VehicleHUB access selection from registration approval emails and the spreadsheet admin approval prompt.
- VehicleHUB's USERS sheet access flag in column K. On the first MasterCAL request after deployment, the backend clears K only when its header is `VehicleHUB`.
- VehicleHUB approval-manual email and group links: `BackEND/Manual.gs` and `FrontEND/manual.html` were deleted.
- Approval WhatsApp notifications that used the VehicleHUB WhatsApp Business account: `BackEND/WhatsApp.gs` was deleted. MasterCAL's customer quotation sharing through `wa.me` remains.
- VehicleHUB references from the MasterCAL README and project notes, and its files were removed from the Apps Script deploy completeness list.

## User data handling

- MasterCAL USERS rows, account status, credentials, and user spreadsheet copies are preserved.
- The one-time cleanup removes only the dedicated VehicleHUB permission header and values from column K; it does not delete registrations or accounts.
- The old WhatsApp approval sender code was removed, but its Script Properties were left untouched so a future restoration can reuse them without exposing secrets in Git.
- Existing approval email links with an old `vh` query parameter still approve/reject the MasterCAL account; that parameter is ignored.

## Integration impact

MasterCAL no longer provides session identity or a shared login token to VehicleHUB. The separate VehicleHUB app was not changed and will need its own authentication path if it is still in use.
