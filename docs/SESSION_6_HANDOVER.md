# Session 6 handover — Dispensary workflow (OHC OPD→pharmacy pattern)

**Date:** 28 Jul 2026 · **Live:** https://cliniq-software.web.app · **Repo:** drkarthikayan/CLINIQ-SOFTWARE

## What shipped (verified end-to-end in demo mode)

Ported the OHC **OPD → Dispensary → Pharmacy** flow. Previously a completed
consult silently FEFO-deducted stock; now it routes the prescription to a
pharmacist who **verifies and dispenses**, with a log — the real clinic flow.

- **`finalizeConsult` changed** (`visits.service.js`): on complete it now, in one
  writeBatch, marks the visit completed + queues the invoice + creates a
  **pending `dispensary` record** for the in-stock Rx lines. It no longer
  deducts stock directly.
- **`dispensary.service.js`** (new): `buildDispensaryItems` (auto-qty =
  freq×days×dose, stocked lines only), `watchPendingDispensary`,
  `watchDispensaryLog`, `planRecordDispense` (FEFO across batches, shared
  remaining map), `dispenseRecord` (one writeBatch: decrement batches + mark
  record dispensed + write `dispensary_log`).
- **Pharmacy page is now tabbed** (`Pharmacy.jsx`): **Stock register** (as
  before) · **Dispensary** (pending queue → "Verify & dispense", live
  availability + short-stock flag, FEFO note) · **Dispensary log** (today's
  dispensed records + units).
- **`firestore.rules`**: added `dispensary` + `dispensary_log` (read/write if
  inTenant). **Requires a rules redeploy.**
- Schema updated in `docs/FIRESTORE_SCHEMA.md`.

*Verified:* complete a consult with Paracetamol → 1 pending record in Dispensary
→ Verify & dispense → log entry appears and batch PB-1039 dropped 8→5 (3 units,
earliest-expiry batch). Zero console errors. Build clean.

## Deploy
```bash
cd ~/cliniq && git checkout main && git pull
npm install && npm run build
firebase deploy --only hosting,firestore:rules   # rules deploy REQUIRED for dispensary
```

## Next up (from the OHC references, not yet built)
- **Superadmin dashboard**: tenant/user tables, plan distribution, activity,
  plans & pricing, invoice generation (OHC super-admin.html structure).
- **Pharmacy**: per-drug min-stock threshold, restock-existing-medicine,
  **Biomedical Waste Register** (BMW, category-wise) from the OHC app.
- SMS + staff-claims Cloud Function (needs Blaze).
