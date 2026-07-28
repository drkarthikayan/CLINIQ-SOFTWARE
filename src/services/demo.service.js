// Self-seeding for the public demo tenant. When the demo doctor signs in and
// demo-clinic has no stock yet, populate a realistic pharmacy + a few patients
// (one with a Penicillin allergy) so the demo is instantly usable — no
// Admin-SDK seed script needed. Idempotent: deterministic doc IDs + a one-shot
// guard, so repeated logins don't duplicate anything. Firestore rules open
// demo-clinic to any signed-in user, so these client writes are allowed.
import { DEMO, db } from '../lib/firebase'
import { collection, getDocs, doc, writeBatch, serverTimestamp } from 'firebase/firestore'

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
  { id: 'demo-aarti', name: 'Aarti Sharma', mobile: '9800000001', dob: '1990-06-15', sex: 'F', relation: 'Self',
    allergies: ['Penicillin (rash, 2021)'], conditions: ['Hypothyroidism (2022)'] },
  { id: 'demo-vikram', name: 'Vikram Sharma', mobile: '9800000001', dob: '1986-02-02', sex: 'M', relation: 'Spouse',
    allergies: [], conditions: [] },
  { id: 'demo-ravi', name: 'Ravi Kumar', mobile: '9800000002', dob: '1959-11-20', sex: 'M', relation: 'Self',
    allergies: [], conditions: ['T2DM', 'HTN'] },
]

let done = false

export async function ensureDemoData(tenantId = 'demo-clinic') {
  if (DEMO || done) return
  done = true
  try {
    const stockSnap = await getDocs(collection(db, 'tenants', tenantId, 'pharmacy_stock'))
    if (!stockSnap.empty) return   // already seeded
    const batch = writeBatch(db)
    STOCK.forEach((s) => batch.set(doc(db, 'tenants', tenantId, 'pharmacy_stock', s.batch), { ...s, importedFrom: 'demo' }))
    PATIENTS.forEach((p) => {
      const { id, ...data } = p
      batch.set(doc(db, 'tenants', tenantId, 'patients', id), { ...data, createdAt: serverTimestamp() })
    })
    batch.set(doc(db, 'tenants', tenantId, 'settings', 'billing'), {
      priceList: [
        { label: 'Consultation', amount: 300 },
        { label: 'Follow-up consult (within 7 days)', amount: 150 },
        { label: 'ECG', amount: 250 },
        { label: 'Nebulization', amount: 200 },
        { label: 'Dressing — minor', amount: 100 },
        { label: 'Injection administration', amount: 60 },
      ],
    }, { merge: true })
    await batch.commit()
  } catch (e) {
    done = false   // let a later attempt retry if this one failed
    console.warn('Demo seed skipped:', e?.message || e)
  }
}
