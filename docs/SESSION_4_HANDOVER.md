# Session 4 handover — Billing, Pharmacy, Patient History, Settings, Templates

**Date:** 27 Jul 2026
**Live app:** https://cliniq-software.web.app (still on Session-3 build until you deploy — see runbook below)
**Repo:** github.com/**drkarthikayan**/CLINIQ-SOFTWARE (transferred from nammadoctorji this session; Firebase project `cliniq-software` unchanged, still owned by nammadoctorji@gmail.com)
**Branch with this work:** `claude/cliniq-software-dev-0isi1k` (PR opened against `main`)
**Exam constraint reconfirmed:** NEET PG 30 Aug 2026 — committed, deployable state, no half-wired features.

## Why the repo moved

Claude Code on the web connects to the **drkarthikayan** GitHub account, but the code
lived under **nammadoctorji**, so no session could reach it. We transferred the repo to
drkarthikayan (GitHub Settings → Transfer). Firebase, the live site, and Cloud Shell
deploys are all still nammadoctorji and untouched — GitHub owner and Firebase owner are
independent. Deploy from Cloud Shell as **nammadoctorji** exactly as before.

## What shipped this session (all verified in demo mode with a real browser)

Every page below was driven end-to-end with Playwright on `VITE_DEMO_MODE=true`; screenshots
confirmed layout, and the flows below actually fired.

- **Billing page** (`src/pages/Billing.jsx`) — "To collect" vs "Settled today", daily
  collection total + by-mode split (UPI/Cash/Card/Credit), one-click settle, add custom
  line item, printable receipt. *Verified: settled a queued invoice via UPI → moved to
  Settled, collection total updated.*
- **Pharmacy page** (`src/pages/Pharmacy.jsx`) — FEFO stock register (sorted by expiry),
  Expired / Near-expiry ≤90d / Low-stock flags, summary stats, manual add-batch, and
  **Excel/CSV import** (columns: Medicine · Batch · Expiry · Qty · MRP · Purchase price).
  SheetJS (`xlsx`) is **lazy-loaded** (dynamic `import()`), so it stays out of the main
  bundle and only downloads when someone clicks Import.
- **Pharmacy stock decrement — the Session-4 atomic contract** (`stock.service.planDispense`
  + `visits.service.finalizeConsult`). Completing a consult now commits, in **one
  `writeBatch`**: visit → completed, unpaid invoice queued, and FEFO decrement of every
  stocked Rx line across batches. Auto-quantity = frequency (OD/BD/TDS/QID or `1-0-1`) ×
  days × dose. If any part fails, the whole thing rolls back. *Verified: added Paracetamol,
  completed consult → toast "stock updated", patient left queue, batch qty dropped.*
- **Patient history page** (`src/pages/History.jsx`) — mobile → family strip → patient
  banner (conditions + allergy band) → visit timeline (date, doctor, complaint, diagnosis,
  labs, Rx, advice), Print/PDF. Also deep-linkable via `{ state: { patientId } }`.
  New: `patients.service.getPatientVisits`.
- **Settings page** (`src/pages/Settings.jsx`) — clinic name/city, module toggles
  (pharmacy / frontDeskVitals / sms / abha), billing price-list editor. New:
  `settings.service.js`. Needs the rules change below.
- **Templates page** (`src/pages/Templates.jsx`) — manage per-doctor templates (create,
  edit, delete); "Save as template" from a consult still lands here. New:
  `visits.service.updateTemplate` / `deleteTemplate`.
- **Appointments page** (`src/pages/Appointments.jsx`) — per-doctor day book: date nav +
  doctor filter, day schedule with Booked/Arrived/Cancelled, an "open slots" quick-book
  panel, and a booking modal with family search. **"Arrived" checks the patient into the
  queue** (calls `patients.service.checkIn` with `visitType: 'appointment'`), so booked
  patients flow into Front Desk → Consultation like walk-ins. New:
  `appointments.service.js`. *Verified: booked a new patient at 09:00 (rows 3→4) and marked
  an appointment arrived → token assigned.* ⚠️ Built in the existing design system because
  the approved `CLINIQ_prototype.html` is still missing from the repo — restyle to match if
  that file surfaces.

### Service / infra changes
- `billing.service.js` — invoice ledger (`watchInvoices`, `markInvoicePaid`, `updateInvoice`),
  pure `buildInvoiceLines`/`makeInvoicePayload`, price-list read/write, demo invoice store.
- `stock.service.js` — mutable demo store, `planDispense` (FEFO across batches), `qtyForRx`,
  `addStockItem`, `importStockRows`, expiry/low-stock helpers.
- `firestore.rules` — `tenants/{tenantId}` now allows **update** by admin/doctor
  (create/delete stay superadmin-only) so Settings can save modules + clinic details.
- `src/index.css` — print styles so Receipt / Patient-history print cleanly.
- `package.json` — added `xlsx@0.18.5` (lazy-loaded).

`npm run build` — clean, 3 chunks over the 500 kB warning (firebase-firestore, xlsx,
index); xlsx only loads on demand. No errors.

## ⚠️ DEPLOY RUNBOOK — do this in Cloud Shell tomorrow (~3 min)

The code is pushed but **NOT deployed** (Claude has no access to your Firebase credentials).
Run this signed in as **nammadoctorji** (verify the account name on the page first):

```bash
cd ~/cliniq
git fetch origin
git checkout claude/cliniq-software-dev-0isi1k   # or merge the PR to main first, then: git checkout main && git pull
npm install                                       # picks up xlsx
firebase use cliniq-software
firebase deploy --only firestore:rules            # REQUIRED — Settings module toggles need the new tenant-update rule
npm run build
firebase deploy --only hosting                    # → live at cliniq-software.web.app
```

If you merged the PR on GitHub first, use the `main` path in line 3. Either way the
**rules deploy is required** — without it, saving module toggles in Settings will fail
with a permissions error.

## Still a data gap (carried from Session 3, not closed)

`sunrise-clinic`'s live `pharmacy_stock` and `patients` are still empty, so the live
allergy-block and live drug-search have still only been proven in demo mode. Fastest close:
open the app live → **Superadmin** page → seed a few stock batches and one patient with an
allergy → run a check-in → consult → Rx once. <10 min.

## Remaining / next up

- **`CLINIQ_prototype.html` is missing** from the repo (and from Drive). Appointments and
  future screens were built in the established design system without it. Commit the
  prototype so the approved look can be cross-checked and any restyle done.
- **Cloud Function to set staff claims on creation** (needs Blaze) — still S5, unchanged.
- **Appointments week view + SMS confirmations** — day view is done; week grid and the
  actual SMS send (needs a gateway) are the natural follow-ons.
- **Close the live data gap** (below) so the allergy-block and drug-search are proven
  against real Firestore data, not just demo.

## Standing rules (unchanged)
- Verify the signed-in Google account by reading the name/email on the page before any
  console/terminal action — `/u/0/`, `/u/1/` slot index is not stable across tabs.
- No heredocs in the terminal.
- `where()` + `orderBy()` on different fields → filter server-side, sort client-side.
- Never store credentials in this doc or in memory.
- Session end = commit + push + handover doc.
