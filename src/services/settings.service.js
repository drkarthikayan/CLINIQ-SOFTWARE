// Tenant-level settings: clinic name/city and the module toggles
// (pharmacy, frontDeskVitals, sms, abha) that gate optional features.
// Writes the tenant doc — firestore.rules allows admin/doctor to UPDATE it
// (create/delete stay superadmin-only). Price-list editing lives in
// billing.service (settings/billing subdoc).
import { DEMO, db } from '../lib/firebase'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'

const DEFAULT_MODULES = { pharmacy: true, frontDeskVitals: true, sms: true, abha: false }

let demoTenant = {
  id: 'demo-clinic', name: 'Sunrise Clinic', city: 'Chennai', plan: 'starter',
  modules: { ...DEFAULT_MODULES },
}

export async function getTenantSettings(tenantId) {
  if (DEMO) return { ...demoTenant, modules: { ...demoTenant.modules } }
  const snap = await getDoc(doc(db, 'tenants', tenantId))
  if (!snap?.exists?.()) return null
  const data = snap.data()
  return { id: snap.id, ...data, modules: { ...DEFAULT_MODULES, ...(data.modules || {}) } }
}

export async function saveTenantSettings(tenantId, patch) {
  if (DEMO) {
    demoTenant = { ...demoTenant, ...patch, modules: { ...demoTenant.modules, ...(patch.modules || {}) } }
    return { ...demoTenant }
  }
  await setDoc(doc(db, 'tenants', tenantId), { ...patch, updatedAt: serverTimestamp() }, { merge: true })
  return patch
}

export { DEFAULT_MODULES }
