# CLINIQ — Firestore schema (v1, Session 1)

Multi-tenant, OHC Command pattern: **custom claims `{ tenantId, role }` are the
tenancy mechanism**; every read/write is scoped under `tenants/{tenantId}` and
`firestore.rules` enforces `request.auth.token.tenantId == tenantId`.

Roles: `admin` · `doctor` · `nurse` · `frontdesk`

## Patient identity — the decision that matters

A family shares one mobile number. Identity key = **mobile + name + dob**.
DOB, not age: age changes every year and would fork records at each birthday.
Age is always *derived* for display (`ageFrom(dob)`).

```
tenants/{tenantId}
  name, city, plan
  modules: { pharmacy, frontDeskVitals, sms, abha }   ← settings toggles

  staff/{uid}
    name, email, role

  patients/{patientId}            ← auto-ID; NEVER key by mobile
    mobile      "9840012345"      ← normalized 10-digit, indexed for family search
    name, dob (ISO), sex, relation ("Self" | "Spouse" | ...)
    mrn         "CLQ-0412"        ← human-readable, per-tenant counter (Session 2)
    allergies   ["Penicillin (rash, 2021)"]      ← doctor-confirmed only
    conditions  ["Hypothyroidism (2023)"]
    abhaId      null | "91-...."  ← optional, module-gated

  visits/{visitId}                ← one per check-in; drives queue AND history
    patientId, patientName, dob, sex, mobile     ← denormalized for queue speed
    tokenNum (int), token ("T-21")
    doctor, visitType ("walk_in" | "appointment" | "review")
    complaint
    status: waiting → vitals → in_consult → completed
    vitals: { bp, pulse, temp, spo2, rr, weight, height, grbs,
              recordedBy, recordedAt }            ← nurse entry
    vitalsDoctor: { ...same, editedBy, editedAt } ← doctor override (audit trail)
    consult: { mode ("quick"|"soap"), complaint, dx, advice,
               s, o, a, p,                        ← soap mode
               labs: [ ...codes ], labsCustom,
               rx: [ { drug, dose, freq, days, batchId } ] }
    createdAt (serverTimestamp)

  appointments/{apptId}
    patientId?, name, mobile, doctor, slotStart (Timestamp), slotEnd, status

  invoices/{invoiceId}
    visitId, patientId, lines: [ { label, amount, source: "pricelist"|"custom"|"pharmacy" } ]
    total, mode ("upi"|"cash"|"card"|"credit"), paidAt

  dispensary/{recordId}            ← OPD→pharmacy handoff (Session 6)
    visitId, patientId, patientName, doctor
    items: [ { drug, batchId, qty, dose, freq, days, mrp } ]   ← qty auto = freq×days×dose
    status: "pending" | "dispensed", dispensedAt, dispensedBy
  dispensary_log/{logId}           ← one per dispense action
    visitId, patientName, doctor, dispensedBy, dispensedAt
    lines: [ { drug, need, dispensed, shortBy, batches: [ { batch, take } ] } ]

  pharmacy_stock/{batchId}        ← ONE DOC PER BATCH (FEFO needs batch granularity)
    drug "Paracetamol 650 mg", batch "PB-1042", expiry (Timestamp),
    qty (int), mrp, purchasePrice, importedFrom ("excel"|"manual")

  templates/{templateId}
    name, mode, complaint, dx, advice, rx[], labs[], ownerUid?, useCount

  settings/billing
    priceList: [ { label, amount } ]
```

## Query rules learned the hard way (from OHC)

- `where()` + `orderBy()` on **different fields** requires a composite index →
  Session-1 convention: filter server-side, **sort client-side**.
- Always optional-chain snapshots: `snap?.docs ?? []`.
- Stock receipt + qty decrement use `writeBatch` (atomic) — **done in Session 4**
  via `visits.service.finalizeConsult` (visit status + invoice + FEFO stock
  decrement commit together, or all roll back).
- Demo tenant excluded from any future platform stats (OHC platformStats lesson).

## Rules note (Session 4)

`tenants/{tenantId}` now allows **update** by `admin`/`doctor` (create/delete stay
superadmin-only) so the Settings page can edit clinic name/city and the `modules`
toggles. Redeploy rules after pulling: `firebase deploy --only firestore:rules`.

## FEFO dispensing (Session 4 contract)

Rx line stores `batchId` chosen at prescription time = earliest-expiry batch with
qty ≥ needed. Dispensing decrements that batch in a `writeBatch` with the invoice
write. Near-expiry = expiry ≤ today + 90d. Low stock threshold per drug (default 10).
