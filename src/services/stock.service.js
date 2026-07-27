// Pharmacy stock: drug search, FEFO (first-expiry-first-out) batch pick and
// allergy matching for the consult Rx table, plus the Session-4 dispense
// contract — an atomic FEFO decrement across batches computed by
// planDispense() and committed inside the consult-finalize writeBatch.
// Stock is batch-granular (one doc per batch) per docs/FIRESTORE_SCHEMA.md.
import { DEMO, db } from '../lib/firebase'
import { collection, query, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore'

const NEAR_EXPIRY_DAYS = 90
const LOW_STOCK_THRESHOLD = 10

/* ---------------- demo store (mutable, so dispense + import reflect live) ---- */
let demoStock = [
  { id: 'b1', drug: 'Paracetamol 650 mg', batch: 'PB-1042', expiry: '2027-03-01', qty: 120, mrp: 2 },
  { id: 'b2', drug: 'Paracetamol 650 mg', batch: 'PB-1039', expiry: '2026-09-15', qty: 8, mrp: 2 },
  { id: 'b3', drug: 'Cetirizine 10 mg', batch: 'CT-221', expiry: '2027-01-10', qty: 60, mrp: 1.5 },
  { id: 'b4', drug: 'Amoxicillin 500 mg', batch: 'AM-556', expiry: '2026-08-01', qty: 40, mrp: 6 },
  { id: 'b5', drug: 'Azithromycin 500 mg', batch: 'AZ-118', expiry: '2026-11-20', qty: 15, mrp: 12 },
  { id: 'b6', drug: 'Pantoprazole 40 mg', batch: 'PT-330', expiry: '2027-05-05', qty: 90, mrp: 3 },
  { id: 'b7', drug: 'ORS sachet', batch: 'ORS-77', expiry: '2027-02-01', qty: 200, mrp: 20 },
  { id: 'b8', drug: 'Ibuprofen 400 mg', batch: 'IB-902', expiry: '2026-07-01', qty: 4, mrp: 3 },
]
let demoStockListeners = []
const emitStock = () => demoStockListeners.forEach((cb) => cb([...demoStock]))

export function watchStock(tenantId, cb) {
  if (DEMO) {
    demoStockListeners.push(cb)
    cb([...demoStock])
    return () => { demoStockListeners = demoStockListeners.filter((f) => f !== cb) }
  }
  const q = query(collection(db, 'tenants', tenantId, 'pharmacy_stock'))
  return onSnapshot(q, (snap) => cb(snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []))
}

/* ---------------- flags ---------------- */
export const daysToExpiry = (expiry) => (new Date(expiry) - new Date()) / 86400000
export const isNearExpiry = (expiry) => daysToExpiry(expiry) <= NEAR_EXPIRY_DAYS
export const isExpired = (expiry) => daysToExpiry(expiry) < 0

/* ---------------- search / FEFO pick ---------------- */
export function pickFefoBatch(stockRows, drugName) {
  const batches = stockRows
    .filter((r) => r.drug === drugName && (r.qty ?? 0) > 0)
    .sort((a, b) => new Date(a.expiry) - new Date(b.expiry))
  if (!batches.length) return null
  const first = batches[0]
  const totalQty = batches.reduce((s, b) => s + (b.qty ?? 0), 0)
  return {
    drug: drugName, batchId: first.id, batch: first.batch, expiry: first.expiry, mrp: first.mrp,
    totalQty, nearExpiry: isNearExpiry(first.expiry), lowStock: totalQty <= LOW_STOCK_THRESHOLD,
  }
}

export function searchDrugs(stockRows, text) {
  const t = (text || '').trim().toLowerCase()
  if (!t) return []
  const names = [...new Set(stockRows.filter((r) => r.drug?.toLowerCase().includes(t)).map((r) => r.drug))]
  return names.slice(0, 8).map((name) => pickFefoBatch(stockRows, name)).filter(Boolean)
}

// Allergy list entries look like "Penicillin (rash, 2021)" — match on the
// leading token against the drug name being prescribed. Not a substitute for
// a real drug-class allergy database, but enough to enforce the "prescribing a
// listed allergen is blocked" rule at MVP scale.
export function checkAllergyMatch(allergies, drugName) {
  if (!allergies?.length || !drugName) return null
  const d = drugName.toLowerCase()
  const hit = allergies.find((a) => {
    const token = (a || '').split(/[\s(]/)[0].toLowerCase()
    return token && d.includes(token)
  })
  return hit || null
}

/* ---------------- dispense contract (Session 4) ---------------- */
// Auto-quantity: units per day parsed from frequency (OD/BD/TDS/QID or a
// "1-0-1" pattern) × days × dose count. Deliberately conservative — an
// unparseable frequency falls back to once daily rather than over-dispensing.
const FREQ_PER_DAY = { QID: 4, QDS: 4, TDS: 3, TID: 3, BID: 2, BD: 2, OD: 1, HS: 1, SOS: 1, STAT: 1 }
export function perDayFromFreq(freq) {
  const f = (freq || '').toUpperCase()
  const pattern = f.match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/)
  if (pattern) return Number(pattern[1]) + Number(pattern[2]) + Number(pattern[3])
  for (const k of Object.keys(FREQ_PER_DAY)) if (f.includes(k)) return FREQ_PER_DAY[k]
  return 1
}

export function qtyForRx(line) {
  const perDay = perDayFromFreq(line.freq)
  const days = Number(line.days) || 0
  const doseMatch = String(line.dose || '').match(/([\d.]+)/)
  const doseUnits = doseMatch ? Number(doseMatch[1]) : 1
  return Math.max(0, Math.ceil(perDay * days * (doseUnits || 1)))
}

// Returns { allocations, dispensedLines }. allocations = the per-batch
// decrements to commit (batchId → newQty). dispensedLines = per-drug summary
// for the completion toast (need vs dispensed vs shortBy). Drugs not carried
// in stock are ignored (external prescriptions).
export function planDispense(stockRows, rxLines) {
  const allocations = []
  const dispensedLines = []
  const remaining = new Map(stockRows.map((r) => [r.id, r.qty ?? 0]))
  for (const line of rxLines || []) {
    if (!line?.drug) continue
    const stocked = stockRows.some((r) => r.drug === line.drug)
    if (!stocked) continue
    const need = qtyForRx(line)
    let toTake = need
    let taken = 0
    const batches = stockRows
      .filter((r) => r.drug === line.drug && (remaining.get(r.id) ?? 0) > 0)
      .sort((a, b) => new Date(a.expiry) - new Date(b.expiry))
    for (const b of batches) {
      if (toTake <= 0) break
      const avail = remaining.get(b.id) ?? 0
      const t = Math.min(avail, toTake)
      if (t > 0) {
        const newQty = avail - t
        remaining.set(b.id, newQty)
        allocations.push({ batchId: b.id, drug: b.drug, batch: b.batch, take: t, newQty })
        taken += t
        toTake -= t
      }
    }
    dispensedLines.push({ drug: line.drug, need, dispensed: taken, shortBy: Math.max(0, need - taken) })
  }
  return { allocations, dispensedLines }
}

// Demo-mode application of the plan (prod path commits inside the finalize
// writeBatch in visits.service).
export function _demoApplyDispense(allocations) {
  if (!allocations?.length) return
  const byId = new Map(allocations.map((a) => [a.batchId, a.newQty]))
  demoStock = demoStock.map((r) => (byId.has(r.id) ? { ...r, qty: byId.get(r.id) } : r))
  emitStock()
}

/* ---------------- stock receipt (manual add / Excel import) ---------------- */
function normalizeStockItem(item) {
  return {
    drug: String(item.drug || '').trim(),
    batch: String(item.batch || '').trim(),
    expiry: String(item.expiry || '').trim(),
    qty: Number(item.qty) || 0,
    mrp: Number(item.mrp) || 0,
    purchasePrice: item.purchasePrice != null && item.purchasePrice !== '' ? Number(item.purchasePrice) : null,
    importedFrom: item.importedFrom || 'manual',
  }
}

export async function addStockItem(tenantId, item) {
  const clean = normalizeStockItem(item)
  if (DEMO) {
    const row = { id: 'b' + (demoStock.length + 1) + '-' + Date.now(), ...clean }
    demoStock = [...demoStock, row]
    emitStock()
    return row
  }
  const ref = await addDoc(collection(db, 'tenants', tenantId, 'pharmacy_stock'), { ...clean, createdAt: serverTimestamp() })
  return { id: ref.id, ...clean }
}

export async function importStockRows(tenantId, rows) {
  const clean = rows.map((r) => normalizeStockItem({ ...r, importedFrom: 'excel' })).filter((r) => r.drug)
  let added = 0
  if (DEMO) {
    const stamped = clean.map((c, i) => ({ id: 'imp' + Date.now() + '-' + i, ...c }))
    demoStock = [...demoStock, ...stamped]
    emitStock()
    return stamped.length
  }
  for (const c of clean) {
    await addDoc(collection(db, 'tenants', tenantId, 'pharmacy_stock'), { ...c, createdAt: serverTimestamp() })
    added++
  }
  return added
}

export { NEAR_EXPIRY_DAYS, LOW_STOCK_THRESHOLD }
