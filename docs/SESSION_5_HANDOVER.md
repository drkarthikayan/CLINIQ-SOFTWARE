# Session 5 handover — Platform (SaaS) admin, demo account, pharmacy seeding

**Date:** 27 Jul 2026
**Live app:** https://cliniq-software.web.app
**Repo:** github.com/drkarthikayan/CLINIQ-SOFTWARE
**Branch:** `claude/cliniq-software-dev-0isi1k` → PR to `main`

## What shipped (all verified in demo mode with a headless browser)

### 1. Separate platform (SaaS owner) login — multi-tenant admin
- **Login screen now has two tabs**: **Clinic staff** and **Platform admin** (`src/pages/Login.jsx`).
- **`auth.service.staffLogin(email, password, mode)`** validates the mode:
  - platform sign-in requires the `superadmin` claim,
  - clinic sign-in requires a `tenantId`,
  - clear errors if you use the wrong tab.
- **Routing** (`src/App.jsx`): a **platform owner = `superadmin` claim with NO `tenantId`** lands in a dedicated **Platform console** (`src/components/PlatformShell.jsx` + the existing cross-tenant Superadmin tools) — **no clinic rail**. Clinic staff land in the clinic app as before. A legacy hybrid account (tenantId + superadmin, e.g. `dr.priya`) still works both ways.
- *Verified: clinic demo → clinic rail (Superadmin nav correctly hidden); platform login → platform console, no clinic rail.*

### 2. Demo account with credentials pre-filled
- Login shows a **"Try the demo"** button that fills the demo clinic login: **`demo@cliniq.app` / `Demo@1234`** (a non-superadmin doctor scoped to the `demo-clinic` tenant — safe to show publicly).
- The account + its data are created by `scripts/seedDemoTenant.mjs` (below).

### 3. Pharmacy stock seeding (the "pharmacy stock part")
- Platform console → **"Seed starter stock (8)"** one-click populates a realistic GP stock (with near-expiry/low-stock/expired examples), and **"Sample allergy patient"** adds a Penicillin-allergic patient — so the FEFO drug search and the allergy-block can be demonstrated against real data. Manual add-stock and per-batch entry remain.
- `scripts/seedDemoTenant.mjs` seeds the same stock + 3 patients into `demo-clinic`.

## ⚠️ DEPLOY + ACTIVATION RUNBOOK (Cloud Shell, as nammadoctorji)

Claude cannot run these — no Firebase credentials in the automation environment. Verify the signed-in account on the page first.

```bash
cd ~/cliniq && git checkout main && git pull      # after PR is merged
npm install
npm run build
firebase deploy --only hosting

# --- one-time account setup (needs serviceAccount.json in ~/cliniq, gitignored) ---
# (Generate a key: Firebase console → Project settings → Service accounts → Generate key,
#  save as serviceAccount.json, and DELETE + revoke it right after, per your standing rule.)

# a) create the platform owner (separate SaaS admin):
node scripts/setupPlatform.mjs superadmin@cliniq.app 'ChooseAStrongPassword' "Super Admin"

# b) create the public demo clinic + demo@cliniq.app / Demo@1234 + stock + patients:
node scripts/seedDemoTenant.mjs

# c) (recommended) make the separation clean — strip superadmin from the clinic doctor
#    so the real clinic account can't reach platform tools:
node scripts/setSuperadmin.mjs dr.priya@sunriseclinic.in off
```

No `firestore.rules` change this session — the platform owner's `superadmin` claim already grants cross-tenant read/write, and create/delete of tenants is superadmin-only (set in Session 4).

## After deploy — 2-minute check
1. **Platform admin tab** → sign in as `superadmin@cliniq.app` → you should see the Platform console (no clinic rail), listing tenants.
2. Pick a tenant → **Seed starter stock** → open that clinic and confirm stock in Pharmacy.
3. **Clinic staff tab** → **Try the demo** → `demo@cliniq.app` → clinic app with stock + the allergic patient; prescribe Amoxicillin to Aarti Sharma to see the allergy block fire (closes the long-standing live-data gap).

## Login reference (after activation)
| Access | Tab | Email | Password |
|---|---|---|---|
| Platform owner (all clinics) | Platform admin | `superadmin@cliniq.app` | *(you set it)* |
| Public demo clinic | Clinic staff | `demo@cliniq.app` | `Demo@1234` |
| Real clinic (Sunrise) | Clinic staff | `dr.priya@sunriseclinic.in` | `ChangeMe#2026` (change it) |

## Remaining / next up
- **SMS + staff-claims Cloud Function** — still needs Blaze + a gateway (S5 infra proper).
- **`CLINIQ_prototype.html`** — still not in the repo.
- Standard rules unchanged: verify Google account before console actions; no heredocs; never store credentials in this doc.
