// Tenant-level settings: clinic name/city and the module toggles
// (pharmacy, frontDeskVitals, sms, abha) that gate optional features.
// Writes the tenant doc — firestore.rules allows admin/doctor to UPDATE it
// (create/delete stay superadmin-only). Price-list editing lives in
// billing.service (settings/billing subdoc).
import { DEMO, db } from '../lib/firebase'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'

const DEFAULT_MODULES = { pharmacy: true, frontDeskVitals: true, sms: true, abha: false }
// Prescription letterhead — clinic registration and prescriber details are
// required on a printed Indian Rx. rxLang adds a vernacular dosage line under
// each English sig ('' = English only).
const DEFAULT_LETTERHEAD = { logoUrl: '', address: '', phone: '', regNo: '', doctorName: '', doctorQualification: '', doctorRegNo: '', rxLang: '' }

let demoTenant = {
  id: 'demo-clinic', name: 'Sunrise Clinic', city: 'Chennai', plan: 'starter',
  modules: { ...DEFAULT_MODULES },
  letterhead: { ...DEFAULT_LETTERHEAD, address: '12 Anna Salai', phone: '044 4000 1234', regNo: 'TN/CLQ/2026/114', doctorQualification: 'MBBS, MD (Gen. Med.)', doctorRegNo: 'TNMC 78421', rxLang: 'ta' },
}

export async function getTenantSettings(tenantId) {
  if (DEMO) return { ...demoTenant, modules: { ...demoTenant.modules }, letterhead: { ...DEFAULT_LETTERHEAD, ...demoTenant.letterhead } }
  const snap = await getDoc(doc(db, 'tenants', tenantId))
  if (!snap?.exists?.()) return null
  const data = snap.data()
  return { id: snap.id, ...data, modules: { ...DEFAULT_MODULES, ...(data.modules || {}) }, letterhead: { ...DEFAULT_LETTERHEAD, ...(data.letterhead || {}) } }
}

export async function saveTenantSettings(tenantId, patch) {
  if (DEMO) {
    demoTenant = { ...demoTenant, ...patch, modules: { ...demoTenant.modules, ...(patch.modules || {}) }, letterhead: { ...demoTenant.letterhead, ...(patch.letterhead || {}) } }
    return { ...demoTenant }
  }
  await setDoc(doc(db, 'tenants', tenantId), { ...patch, updatedAt: serverTimestamp() }, { merge: true })
  return patch
}

export { DEFAULT_MODULES, DEFAULT_LETTERHEAD }
