# CLINIQ — setup (do once)

## 0. Run the UI immediately (no Firebase needed)
```bash
npm install
cp .env.example .env.local        # VITE_DEMO_MODE=true is already set
npm run dev                        # login with any credentials, search 98400 12345
```

## 1. Create the Firebase project
- console.firebase.google.com → Add project → project: **cliniq-software** (already created ✅)
- Region for Firestore: **asia-south1 (Mumbai)** — DPDP data-residency answer, same as OHC
- Enable: **Authentication → Email/Password**, **Firestore**, **Hosting**
- Project settings → add a **Web app** → copy config values into `.env.local`
- Set `VITE_DEMO_MODE=false`

## 2. Wire the repo (repo already created: nammadoctorji/CLINIQ-SOFTWARE)
```bash
git init
git branch -M main
git remote add origin https://github.com/nammadoctorji/CLINIQ-SOFTWARE.git
git add -A
git commit -m "Session 1: scaffold + auth + multi-tenant rules + front desk"
git push -u origin main
```
Then link Firebase:
```bash
git init && git add -A && git commit -m "Session 1: scaffold + auth + front desk"
# edit .firebaserc → replace REPLACE_WITH_CLINIQ_PROJECT_ID with real project id
firebase use cliniq-software
firebase deploy --only firestore:rules
```

## 3. Seed the first tenant
- Project settings → Service accounts → **Generate new private key** → save as
  `serviceAccount.json` in project root (already gitignored)
- Edit tenant/doctor details at the top of `scripts/seedTenant.mjs`
- `npm i firebase-admin --save-dev && npm run seed`
- Delete or secure `serviceAccount.json` afterwards. If it ever leaks, revoke the
  key in GCP console immediately.

## 4. Deploy
```bash
npm run build
firebase deploy --only hosting     # single site for now; add prod/uat targets like OHC later
```

## Known traps carried over from OHC
- Never plain `firebase deploy` once multiple targets exist.
- Firebase deploy circular-JSON error is transient — retry.
- Stale-file trap: grep a unique string in any file you copy from Downloads before `cp`.


## Offline-first (Session 17)

CLINIQ keeps working when the connection drops - the normal case in Tier-2/3 towns.

- **Data**: Firestore uses `persistentLocalCache` (IndexedDB). Reads are served
  from the local copy when offline; writes queue and sync on reconnect. The
  multi-tab manager lets front desk + consult room tabs share one cache.
- **App shell**: `public/sw.js` caches the shell so the page opens with no
  network at all. Navigations are network-first (a deploy is picked up
  immediately) with the cached shell as fallback; `/assets/*` are content-hashed
  and cached first. Cross-origin requests (Firestore, Auth, fonts) are never
  intercepted.
- **Installable**: `public/manifest.webmanifest` - staff can add CLINIQ to a
  phone/tablet home screen and run it standalone.
- **UI**: an amber "Working offline" strip plus a status dot in the header.

**Bumping the shell cache:** change `CACHE = 'cliniq-shell-v1'` in `public/sw.js`
when the shell files themselves change, so old caches are dropped on activate.


## Dependency security (Session 20)

`npm audit` after the PDF work flagged a **critical** in `jspdf@2.5.2`, which
Session 18 introduced. Fixed by upgrading to **jspdf 4.2.1**; `addImage` /
`addPage` / `output('blob')` are unchanged, and PDF output was re-verified
(valid single-page file, no console errors). `npm audit fix` cleared the
remaining high advisories (brace-expansion, nanoid, react-router, postcss).

### Known remaining: `xlsx` (high, accepted risk)

The npm-published `xlsx` is 0.18.5 and is no longer updated - SheetJS ships
patched builds only from `cdn.sheetjs.com`.

**Do NOT try to install the CDN tarball.** It fails in both environments we
build in:

- the agent sandbox blocks the host (`403`), and
- Cloud Shell's npm refuses remote tarballs entirely
  (`EALLOWREMOTE - Fetching packages of type "remote" have been disabled`).

Attempting it uninstalls `xlsx` first, so the build then dies with
`Rollup failed to resolve import "xlsx"` and the next `firebase deploy` silently
re-ships the previous `dist/`. If that has already happened:

```bash
git checkout -- package.json package-lock.json
git pull && npm install && npm run build
```

**Accepted risk.** We stay on `xlsx@0.18.5`. The advisories (prototype
pollution, ReDoS) require parsing a hostile spreadsheet; the only parse path in
CLINIQ is the pharmacy stock import, i.e. a file a staff member deliberately
chooses. Revisit if SheetJS resumes publishing to npm, or if importing
third-party sheets ever becomes routine - the alternative is a CSV-only import,
which drops `.xlsx` support.

Do **not** run `npm audit fix --force` - it moves dependencies across majors and
can break a working build.
