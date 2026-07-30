// Pharmacy stock: drug search, FEFO (first-expiry-first-out) batch pick and
// allergy matching for the consult Rx table, plus the Session-4 dispense
// contract — an atomic FEFO decrement across batches computed by
// planDispense() and committed inside the consult-finalize writeBatch.
// Stock is batch-granular (one doc per batch) per docs/FIRESTORE_SCHEMA.md.
import { DEMO, db } from '../lib/firebase'
import { collection, query, onSnapshot, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'

const NEAR_EXPIRY_DAYS = 90
const LOW_STOCK_THRESHOLD = 10

/* ---------------- demo store (mutable, so dispense + import reflect live) ---- */
// `generic` is the molecule + strength (what the allergy/class checks use);
// `brand` is what sits on the shelf. Several brands share one generic, which is
// exactly what the prescriber needs to see. `drug` stays as the display name so
// older records keep working.
let demoStock = [
  { id: 'b1', generic: 'Paracetamol 650 mg', brand: 'Dolo 650', drug: 'Dolo 650', batch: 'PB-1042', expiry: '2027-03-01', qty: 120, mrp: 2 },
  { id: 'b2', generic: 'Paracetamol 650 mg', brand: 'Dolo 650', drug: 'Dolo 650', batch: 'PB-1039', expiry: '2026-09-15', qty: 8, mrp: 2 },
  { id: 'b9', generic: 'Paracetamol 650 mg', brand: 'Calpol 650', drug: 'Calpol 650', batch: 'CP-220', expiry: '2027-06-10', qty: 45, mrp: 2.4 },
  { id: 'b10', generic: 'Paracetamol 650 mg', brand: 'Crocin 650', drug: 'Crocin 650', batch: 'CR-771', expiry: '2027-04-02', qty: 30, mrp: 2.2 },
  { id: 'b3', generic: 'Cetirizine 10 mg', brand: 'Cetzine 10', drug: 'Cetzine 10', batch: 'CT-221', expiry: '2027-01-10', qty: 60, mrp: 1.5 },
  { id: 'b11', generic: 'Cetirizine 10 mg', brand: 'Alerid 10', drug: 'Alerid 10', batch: 'AL-118', expiry: '2027-02-18', qty: 25, mrp: 1.7 },
  { id: 'b4', generic: 'Amoxicillin 500 mg', brand: 'Mox 500', drug: 'Mox 500', batch: 'AM-556', expiry: '2026-08-01', qty: 40, mrp: 6 },
  { id: 'b5', generic: 'Azithromycin 500 mg', brand: 'Azithral 500', drug: 'Azithral 500', batch: 'AZ-118', expiry: '2026-11-20', qty: 15, mrp: 12 },
  { id: 'b6', generic: 'Pantoprazole 40 mg', brand: 'Pantocid 40', drug: 'Pantocid 40', batch: 'PT-330', expiry: '2027-05-05', qty: 90, mrp: 3 },
  { id: 'b7', generic: 'ORS sachet', brand: 'Electral', drug: 'Electral', batch: 'ORS-77', expiry: '2027-02-01', qty: 200, mrp: 20 },
  { id: 'b8', generic: 'Ibuprofen 400 mg', brand: 'Brufen 400', drug: 'Brufen 400', batch: 'IB-902', expiry: '2026-07-01', qty: 4, mrp: 3 },
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

/* ---------------- brand / generic helpers ---------------- */
// Rows written before brands existed only have `drug`; treat that as both.
export const genericOf = (r) => r.generic || r.drug || ''
export const brandOf = (r) => r.brand || r.drug || ''

/* ---------------- flags ---------------- */
export const daysToExpiry = (expiry) => (new Date(expiry) - new Date()) / 86400000
export const isNearExpiry = (expiry) => daysToExpiry(expiry) <= NEAR_EXPIRY_DAYS
export const isExpired = (expiry) => daysToExpiry(expiry) < 0

/* ---------------- search / FEFO pick ---------------- */
export function pickFefoBatch(stockRows, drugName) {
  const batches = stockRows
    .filter((r) => (brandOf(r) === drugName || r.drug === drugName) && (r.qty ?? 0) > 0)
    .sort((a, b) => new Date(a.expiry) - new Date(b.expiry))
  if (!batches.length) return null
  const first = batches[0]
  const totalQty = batches.reduce((s, b) => s + (b.qty ?? 0), 0)
  return {
    drug: drugName, brand: brandOf(first), generic: genericOf(first),
    batchId: first.id, batch: first.batch, expiry: first.expiry, mrp: first.mrp,
    totalQty, nearExpiry: isNearExpiry(first.expiry), lowStock: totalQty <= LOW_STOCK_THRESHOLD,
  }
}

// Search matches EITHER the generic (molecule) or any brand name, and returns
// one entry per generic with every in-stock brand under it — so the prescriber
// can see at a glance that the same molecule is available under other brands.
export function searchDrugs(stockRows, text) {
  const t = (text || '').trim().toLowerCase()
  if (!t) return []
  const generics = new Map()
  stockRows.forEach((r) => {
    if ((r.qty ?? 0) <= 0) return
    const g = genericOf(r), b = brandOf(r)
    if (!g.toLowerCase().includes(t) && !b.toLowerCase().includes(t)) return
    if (!generics.has(g)) generics.set(g, new Set())
    generics.get(g).add(b)
  })
  return [...generics.entries()].slice(0, 8).map(([generic, brandSet]) => {
    const brands = [...brandSet]
      .map((b) => pickFefoBatch(stockRows, b))
      .filter(Boolean)
      .sort((a, b) => new Date(a.expiry) - new Date(b.expiry))
    return { generic, brands, brandCount: brands.length }
  }).filter((g) => g.brands.length)
}

// Every in-stock brand of a generic — used by the "other brands" switcher on an
// Rx line that has already been added.
export function brandsForGeneric(stockRows, generic) {
  const names = [...new Set(stockRows.filter((r) => (r.qty ?? 0) > 0 && genericOf(r) === generic).map(brandOf))]
  return names.map((b) => pickFefoBatch(stockRows, b)).filter(Boolean)
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
    const stocked = stockRows.some((r) => brandOf(r) === line.drug || r.drug === line.drug)
    if (!stocked) continue
    const need = qtyForRx(line)
    let toTake = need
    let taken = 0
    const batches = stockRows
      .filter((r) => (brandOf(r) === line.drug || r.drug === line.drug) && (remaining.get(r.id) ?? 0) > 0)
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
  const generic = String(item.generic || item.drug || '').trim()
  const brand = String(item.brand || item.drug || '').trim()
  return {
    generic, brand,
    drug: brand || generic,   // display name kept for backward compatibility

    batch: String(item.batch || '').trim(),
    expiry: String(item.expiry || '').trim(),
    qty: Number(item.qty) || 0,
    mrp: Number(item.mrp) || 0,
    minStock: item.minStock != null && item.minStock !== '' ? Number(item.minStock) : null,
    purchasePrice: item.purchasePrice != null && item.purchasePrice !== '' ? Number(item.purchasePrice) : null,
    importedFrom: item.importedFrom || 'manual',
  }
}

// A drug's low-stock threshold = the largest minStock set on any of its
// batches, falling back to the default. Used by the Pharmacy register.
export function drugMinStock(stockRows, drug) {
  const mins = stockRows.filter((r) => r.drug === drug && r.minStock != null).map((r) => r.minStock)
  return mins.length ? Math.max(...mins) : LOW_STOCK_THRESHOLD
}

// Write a batch's quantity off to zero (e.g. discarding an expired batch to the
// biomedical waste register).
export async function writeOffBatch(tenantId, batchId) {
  if (DEMO) { demoStock = demoStock.map((r) => (r.id === batchId ? { ...r, qty: 0 } : r)); emitStock(); return }
  await updateDoc(doc(db, 'tenants', tenantId, 'pharmacy_stock', batchId), { qty: 0 })
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
