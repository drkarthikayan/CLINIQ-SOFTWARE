// Superadmin (cross-tenant) operations. Gated by the `superadmin` custom
// claim (see scripts/setSuperadmin.mjs) and mirrored in firestore.rules via
// isSuperadmin(). Staff-account creation still goes through a Cloud Shell
// script (scripts/seedStaff.mjs) since setting Firebase Auth custom claims
// requires the Admin SDK and must never run in the browser.
import { DEMO, db } from '../lib/firebase'
import {
  collection, doc, getDocs, setDoc, addDoc, serverTimestamp,
} from 'firebase/firestore'

export const PLANS = ['trial', 'starter', 'pro', 'enterprise']
export const PLAN_PRICE = { trial: 0, starter: 999, pro: 2499, enterprise: 5999 }

let demoTenants = [
  { id: 'sunrise-clinic', name: 'Sunrise Clinic', city: 'Chennai', plan: 'pro', status: 'active', createdAt: '2026-07-17T04:40:00Z' },
  { id: 'demo-clinic', name: 'Demo Clinic', city: 'Chennai', plan: 'trial', status: 'active', isDemo: true, createdAt: '2026-07-28T06:00:00Z' },
  { id: 'anand-poly', name: 'Anand Polyclinic', city: 'Coimbatore', plan: 'starter', status: 'active', createdAt: '2026-07-22T09:15:00Z' },
  { id: 'metro-care', name: 'Metro Care', city: 'Madurai', plan: 'trial', status: 'suspended', createdAt: '2026-07-20T11:00:00Z' },
]

export async function listTenants() {
  if (DEMO) return demoTenants.map((t) => ({ ...t }))
  const snap = await getDocs(collection(db, 'tenants'))
  return snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
}

export async function createTenant(tenantId, { name, city, plan = 'trial' }) {
  if (DEMO) { const t = { id: tenantId, name, city, plan, status: 'active', createdAt: new Date().toISOString() }; demoTenants = [t, ...demoTenants]; return t }
  await setDoc(doc(db, 'tenants', tenantId), {
    name, city, plan, status: 'active',
    modules: { pharmacy: true, frontDeskVitals: true, sms: true, abha: false },
    createdAt: serverTimestamp(),
  }, { merge: true })
  return { id: tenantId, name, city, plan }
}

// Update a tenant's plan / status from the Superadmin console.
export async function updateTenantMeta(tenantId, patch) {
  if (DEMO) { demoTenants = demoTenants.map((t) => (t.id === tenantId ? { ...t, ...patch } : t)); return }
  await setDoc(doc(db, 'tenants', tenantId), { ...patch, updatedAt: serverTimestamp() }, { merge: true })
}

export async function seedStockItem(tenantId, item) {
  if (DEMO) return { id: 'demo-stock', ...item }
  const ref = await addDoc(collection(db, 'tenants', tenantId, 'pharmacy_stock'), item)
  return { id: ref.id, ...item }
}

export async function seedPatient(tenantId, patient) {
  if (DEMO) return { id: 'demo-patient', ...patient }
  const ref = await addDoc(collection(db, 'tenants', tenantId, 'patients'), {
    ...patient, createdAt: serverTimestamp(),
  })
  return { id: ref.id, ...patient }
}

export async function savePriceList(tenantId, priceList) {
  if (DEMO) return
  await setDoc(doc(db, 'tenants', tenantId, 'settings', 'billing'), { priceList }, { merge: true })
}
