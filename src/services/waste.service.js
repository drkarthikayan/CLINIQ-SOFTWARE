// Biomedical Waste Register (BMW) — India colour-category tracking, ported from
// OHC. Records what waste was generated, its category and disposal. Expired
// pharmacy batches can be discarded straight into the Yellow category, which
// also writes the batch qty off to zero. See docs/FIRESTORE_SCHEMA.md.
import { DEMO, db } from '../lib/firebase'
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore'

export const BMW_CATEGORIES = [
  'Yellow — infectious / anatomical / expired meds',
  'Red — contaminated plastic',
  'White — sharps',
  'Blue — glass / metallic',
]

const startOfMonth = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d }
const millis = (t) => {
  if (!t) return 0
  if (typeof t === 'string') return new Date(t).getTime()
  if (typeof t?.toMillis === 'function') return t.toMillis()
  if (t?.seconds != null) return t.seconds * 1000
  return 0
}

let demoWaste = [
  { id: 'w-seed', category: 'White — sharps', item: 'Used syringes & needles', qty: 12, unit: 'pcs', disposal: 'CBWTF pickup', handledBy: 'Staff nurse', createdAt: new Date().toISOString() },
]
let listeners = []
const emit = () => listeners.forEach((cb) => cb(demoWaste.map((r) => ({ ...r }))))

export function watchWaste(tenantId, cb) {
  if (DEMO) {
    const l = () => cb(demoWaste.filter((r) => millis(r.createdAt) >= startOfMonth().getTime()).map((r) => ({ ...r })))
    listeners.push(l); l()
    return () => { listeners = listeners.filter((f) => f !== l) }
  }
  const q = query(collection(db, 'tenants', tenantId, 'waste_register'), where('createdAt', '>=', Timestamp.fromDate(startOfMonth())))
  return onSnapshot(q, (snap) => {
    const rows = snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
    rows.sort((a, b) => millis(b.createdAt) - millis(a.createdAt))
    cb(rows)
  })
}

export async function addWaste(tenantId, entry) {
  const clean = {
    category: entry.category, item: String(entry.item || '').trim(),
    qty: Number(entry.qty) || 0, unit: entry.unit || 'pcs',
    disposal: entry.disposal || '', handledBy: entry.handledBy || null,
  }
  if (DEMO) { const row = { id: 'w' + Date.now(), ...clean, createdAt: new Date().toISOString() }; demoWaste = [row, ...demoWaste]; emit(); return row }
  const ref = await addDoc(collection(db, 'tenants', tenantId, 'waste_register'), { ...clean, createdAt: serverTimestamp() })
  return { id: ref.id, ...clean }
}
