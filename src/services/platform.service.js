// Platform-level (SaaS) config + billing, superadmin-only. Plan definitions
// live in platform/config; the SaaS invoices CLINIQ raises to each clinic live
// in platform_invoices. firestore.rules gate both to isSuperadmin(). This is
// the platform's own billing — distinct from a clinic's patient invoices.
import { DEMO, db } from '../lib/firebase'
import { doc, getDoc, setDoc, collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore'

export const DEFAULT_PLANS = [
  { key: 'trial', name: 'Trial', price: 0, trialDays: 14 },
  { key: 'starter', name: 'Starter', price: 999, trialDays: 0 },
  { key: 'pro', name: 'Pro', price: 2499, trialDays: 0 },
  { key: 'enterprise', name: 'Enterprise', price: 5999, trialDays: 0 },
]

let demoPlans = DEFAULT_PLANS.map((p) => ({ ...p }))
let demoInvoices = [
  { id: 'pi-seed', tenantId: 'sunrise-clinic', tenantName: 'Sunrise Clinic', plan: 'pro', amount: 2499, period: 'Jul 2026', status: 'issued', createdAt: new Date().toISOString() },
]

export async function getPlatformConfig() {
  if (DEMO) return { plans: demoPlans.map((p) => ({ ...p })) }
  const snap = await getDoc(doc(db, 'platform', 'config'))
  const plans = snap?.exists?.() ? snap.data().plans : null
  return { plans: plans?.length ? plans : DEFAULT_PLANS }
}

export async function savePlatformPlans(plans) {
  if (DEMO) { demoPlans = plans.map((p) => ({ ...p })); return }
  await setDoc(doc(db, 'platform', 'config'), { plans, updatedAt: serverTimestamp() }, { merge: true })
}

const millis = (t) => (typeof t === 'string' ? new Date(t).getTime() : typeof t?.toMillis === 'function' ? t.toMillis() : t?.seconds != null ? t.seconds * 1000 : 0)

export async function listPlatformInvoices() {
  if (DEMO) return demoInvoices.map((i) => ({ ...i })).sort((a, b) => millis(b.createdAt) - millis(a.createdAt))
  const snap = await getDocs(collection(db, 'platform_invoices'))
  const rows = snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
  return rows.sort((a, b) => millis(b.createdAt) - millis(a.createdAt))
}

export async function createPlatformInvoice(entry) {
  const clean = { tenantId: entry.tenantId, tenantName: entry.tenantName, plan: entry.plan, amount: Number(entry.amount) || 0, period: entry.period, status: 'issued' }
  if (DEMO) { const row = { id: 'pi' + Date.now(), ...clean, createdAt: new Date().toISOString() }; demoInvoices = [row, ...demoInvoices]; return row }
  const ref = await addDoc(collection(db, 'platform_invoices'), { ...clean, createdAt: serverTimestamp() })
  return { id: ref.id, ...clean }
}

export const currentPeriod = () => new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
