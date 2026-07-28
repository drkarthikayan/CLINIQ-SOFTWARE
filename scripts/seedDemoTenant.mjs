// Seed the public DEMO clinic: a self-contained tenant ("demo-clinic") with a
// non-superadmin demo doctor, a full pharmacy stock, patients (incl. a
// Penicillin allergy so the block can be shown), a price list and a template.
// The demo credentials are safe to display on the login screen because this
// account has NO superadmin claim and only touches demo-clinic data.
//   node scripts/seedDemoTenant.mjs
// Re-runnable (idempotent-ish: merges docs, reuses the auth user).
import { readFileSync } from 'node:fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const CONFIG = {
  tenantId: 'demo-clinic',
  tenantName: 'Demo Clinic',
  city: 'Chennai',
  doctor: { email: 'demo@cliniq.app', password: 'Demo@1234', name: 'Dr. Demo', role: 'doctor' },
}

const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

const STOCK = [
  { drug: 'Paracetamol 650 mg', batch: 'PB-1042', expiry: plusDays(400), qty: 120, mrp: 2, purchasePrice: 1.1 },
  { drug: 'Paracetamol 650 mg', batch: 'PB-1039', expiry: plusDays(50), qty: 8, mrp: 2, purchasePrice: 1.1 },
  { drug: 'Amoxicillin 500 mg', batch: 'AM-556', expiry: plusDays(20), qty: 40, mrp: 6, purchasePrice: 3.4 },
  { drug: 'Azithromycin 500 mg', batch: 'AZ-118', expiry: plusDays(120), qty: 15, mrp: 12, purchasePrice: 7 },
  { drug: 'Cetirizine 10 mg', batch: 'CT-221', expiry: plusDays(300), qty: 60, mrp: 1.5, purchasePrice: 0.6 },
  { drug: 'Pantoprazole 40 mg', batch: 'PT-330', expiry: plusDays(500), qty: 90, mrp: 3, purchasePrice: 1.5 },
  { drug: 'ORS sachet', batch: 'ORS-77', expiry: plusDays(200), qty: 200, mrp: 20, purchasePrice: 11 },
  { drug: 'Ibuprofen 400 mg', batch: 'IB-902', expiry: plusDays(-10), qty: 4, mrp: 3, purchasePrice: 1.2 },
]
const PATIENTS = [
  { name: 'Aarti Sharma', mobile: '9800000001', dob: '1990-06-15', sex: 'F', relation: 'Self',
    allergies: ['Penicillin (rash, 2021)'], conditions: ['Hypothyroidism (2022)'] },
  { name: 'Vikram Sharma', mobile: '9800000001', dob: '1986-02-02', sex: 'M', relation: 'Spouse',
    allergies: [], conditions: [] },
  { name: 'Ravi Kumar', mobile: '9800000002', dob: '1959-11-20', sex: 'M', relation: 'Self',
    allergies: [], conditions: ['T2DM', 'HTN'] },
]

const sa = JSON.parse(readFileSync('./serviceAccount.json', 'utf8'))
initializeApp({ credential: cert(sa) })
const auth = getAuth()
const db = getFirestore()

const run = async () => {
  await db.doc(`tenants/${CONFIG.tenantId}`).set({
    name: CONFIG.tenantName, city: CONFIG.city, plan: 'demo',
    modules: { pharmacy: true, frontDeskVitals: true, sms: true, abha: false },
    isDemo: true, createdAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  let user
  try { user = await auth.getUserByEmail(CONFIG.doctor.email) }
  catch { user = await auth.createUser({ email: CONFIG.doctor.email, password: CONFIG.doctor.password, displayName: CONFIG.doctor.name }) }
  // Clinic staff only — explicitly NOT superadmin.
  await auth.setCustomUserClaims(user.uid, { tenantId: CONFIG.tenantId, role: CONFIG.doctor.role })
  await db.doc(`tenants/${CONFIG.tenantId}/staff/${user.uid}`).set({
    name: CONFIG.doctor.name, email: CONFIG.doctor.email, role: CONFIG.doctor.role, createdAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  await db.doc(`tenants/${CONFIG.tenantId}/settings/billing`).set({
    priceList: [
      { label: 'Consultation', amount: 300 },
      { label: 'Follow-up consult (within 7 days)', amount: 150 },
      { label: 'ECG', amount: 250 },
      { label: 'Nebulization', amount: 200 },
      { label: 'Dressing — minor', amount: 100 },
      { label: 'Injection administration', amount: 60 },
    ],
  }, { merge: true })

  for (const s of STOCK) {
    await db.collection(`tenants/${CONFIG.tenantId}/pharmacy_stock`).doc(s.batch).set({ ...s, importedFrom: 'demo-seed' }, { merge: true })
  }
  for (const p of PATIENTS) {
    await db.collection(`tenants/${CONFIG.tenantId}/patients`).add({ ...p, createdAt: FieldValue.serverTimestamp() })
  }
  await db.collection(`tenants/${CONFIG.tenantId}/templates`).doc('acute-pharyngitis').set({
    name: 'Acute pharyngitis', mode: 'quick',
    complaint: 'Fever __ days, sore throat. Throat congested, no exudate. Chest clear.',
    dx: 'J02.9 · Acute pharyngitis', advice: 'Warm saline gargles, fluids, rest. Review if fever persists beyond 48 h.',
    rx: [{ drug: 'Paracetamol 650 mg', dose: '1 tab', freq: 'TDS after food', days: 3 }, { drug: 'Cetirizine 10 mg', dose: '1 tab', freq: 'HS', days: 3 }],
    labs: [],
  }, { merge: true })

  console.log(`Demo clinic ready: tenant "${CONFIG.tenantId}"`)
  console.log(`Login (Clinic staff tab): ${CONFIG.doctor.email} / ${CONFIG.doctor.password}`)
  console.log(`Seeded ${STOCK.length} stock batches, ${PATIENTS.length} patients (Aarti Sharma has a Penicillin allergy).`)
}
run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
