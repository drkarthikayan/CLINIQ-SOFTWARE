// One-shot activation: gives the super-admin + demo accounts their proper
// custom claims (the reliable multi-tenancy mechanism) and seeds the demo
// clinic's data. Reuses accounts you already created in the Firebase console
// (Add user) — it only ADDS claims, it never changes your passwords. If an
// account doesn't exist yet it is created.
//
//   node scripts/activate.mjs [superAdminPasswordIfCreatingNew]
//
// Needs serviceAccount.json in ~/cliniq (gitignored). After it runs, sign out
// and back in so the new claims land in your ID token.
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const SUPERADMIN_EMAIL = 'superadmin@cliniq.app'
const DEMO = { email: 'demo@cliniq.app', password: 'Demo@1234', name: 'Dr. Demo', tenantId: 'demo-clinic' }
const superAdminPw = process.argv[2] || 'ChangeMe#Super2026'

const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const STOCK = [
  { batch: 'PB-1042', drug: 'Paracetamol 650 mg', expiry: plusDays(400), qty: 120, mrp: 2, purchasePrice: 1.1 },
  { batch: 'PB-1039', drug: 'Paracetamol 650 mg', expiry: plusDays(50), qty: 8, mrp: 2, purchasePrice: 1.1 },
  { batch: 'AM-556', drug: 'Amoxicillin 500 mg', expiry: plusDays(20), qty: 40, mrp: 6, purchasePrice: 3.4 },
  { batch: 'AZ-118', drug: 'Azithromycin 500 mg', expiry: plusDays(120), qty: 15, mrp: 12, purchasePrice: 7 },
  { batch: 'CT-221', drug: 'Cetirizine 10 mg', expiry: plusDays(300), qty: 60, mrp: 1.5, purchasePrice: 0.6 },
  { batch: 'PT-330', drug: 'Pantoprazole 40 mg', expiry: plusDays(500), qty: 90, mrp: 3, purchasePrice: 1.5 },
  { batch: 'ORS-77', drug: 'ORS sachet', expiry: plusDays(200), qty: 200, mrp: 20, purchasePrice: 11 },
  { batch: 'IB-902', drug: 'Ibuprofen 400 mg', expiry: plusDays(-10), qty: 4, mrp: 3, purchasePrice: 1.2 },
]
const PATIENTS = [
  { id: 'demo-aarti', name: 'Aarti Sharma', mobile: '9800000001', dob: '1990-06-15', sex: 'F', relation: 'Self', allergies: ['Penicillin (rash, 2021)'], conditions: ['Hypothyroidism (2022)'] },
  { id: 'demo-vikram', name: 'Vikram Sharma', mobile: '9800000001', dob: '1986-02-02', sex: 'M', relation: 'Spouse', allergies: [], conditions: [] },
  { id: 'demo-ravi', name: 'Ravi Kumar', mobile: '9800000002', dob: '1959-11-20', sex: 'M', relation: 'Self', allergies: [], conditions: ['T2DM', 'HTN'] },
]

const sa = JSON.parse(readFileSync('./serviceAccount.json', 'utf8'))
initializeApp({ credential: cert(sa) })
const auth = getAuth()
const db = getFirestore()

const ensureUser = async (email, password, name) => {
  try { return await auth.getUserByEmail(email) }
  catch { return await auth.createUser({ email, password, displayName: name }) }
}

const run = async () => {
  // 1. Super admin — superadmin claim, NO tenantId.
  const admin = await ensureUser(SUPERADMIN_EMAIL, superAdminPw, 'Super Admin')
  await auth.setCustomUserClaims(admin.uid, { superadmin: true })
  console.log(`✔ Super admin claim set: ${SUPERADMIN_EMAIL}`)

  // 2. Demo doctor — tenantId + role claims (NOT superadmin).
  const demo = await ensureUser(DEMO.email, DEMO.password, DEMO.name)
  await auth.setCustomUserClaims(demo.uid, { tenantId: DEMO.tenantId, role: 'doctor' })
  await db.doc(`tenants/${DEMO.tenantId}/staff/${demo.uid}`).set({ name: DEMO.name, email: DEMO.email, role: 'doctor', createdAt: FieldValue.serverTimestamp() }, { merge: true })
  console.log(`✔ Demo doctor claim set: ${DEMO.email}`)

  // 3. Demo clinic data.
  await db.doc(`tenants/${DEMO.tenantId}`).set({ name: 'Demo Clinic', city: 'Chennai', plan: 'demo', modules: { pharmacy: true, frontDeskVitals: true, sms: true, abha: false }, isDemo: true, createdAt: FieldValue.serverTimestamp() }, { merge: true })
  await db.doc(`tenants/${DEMO.tenantId}/settings/billing`).set({ priceList: [
    { label: 'Consultation', amount: 300 }, { label: 'Follow-up consult (within 7 days)', amount: 150 },
    { label: 'ECG', amount: 250 }, { label: 'Nebulization', amount: 200 },
    { label: 'Dressing — minor', amount: 100 }, { label: 'Injection administration', amount: 60 },
  ] }, { merge: true })
  for (const s of STOCK) await db.doc(`tenants/${DEMO.tenantId}/pharmacy_stock/${s.batch}`).set({ ...s, importedFrom: 'demo' }, { merge: true })
  for (const p of PATIENTS) { const { id, ...data } = p; await db.doc(`tenants/${DEMO.tenantId}/patients/${id}`).set({ ...data, createdAt: FieldValue.serverTimestamp() }, { merge: true }) }
  console.log(`✔ Demo clinic seeded: ${STOCK.length} stock batches, ${PATIENTS.length} patients (Aarti Sharma has a Penicillin allergy)`)

  console.log('\nDone. IMPORTANT: sign OUT and back IN so the new claims take effect.')
}
run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
