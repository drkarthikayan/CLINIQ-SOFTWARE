// Dispensary — the OPD→pharmacy handoff (OHC pattern). Completing a consult no
// longer silently deducts stock; instead it queues a PENDING dispensary record.
// A pharmacist reviews it here and dispenses: FEFO decrement across batches +
// a dispensary_log entry, all in one writeBatch. Auto-quantity = frequency ×
// days × dose (stock.service.qtyForRx). See docs/FIRESTORE_SCHEMA.md.
import { DEMO, db } from '../lib/firebase'
import {
  collection, query, where, onSnapshot, doc, writeBatch,
  serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { qtyForRx, _demoApplyDispense } from './stock.service'

/* ---------------- record builders (pure) ---------------- */
// Only Rx lines actually carried in stock (they got a batchId at prescribe
// time) go to the dispensary; free-typed drugs are the patient's to buy outside.
export function buildDispensaryItems(consult) {
  return (consult?.rx || [])
    .filter((r) => r.batchId)
    .map((r) => ({ drug: r.drug, batchId: r.batchId, qty: qtyForRx(r), dose: r.dose || '', freq: r.freq || '', days: Number(r.days) || 0, mrp: r.mrp ?? null }))
}

export function makeDispensaryPayload(visit, items) {
  return {
    visitId: visit.id, patientId: visit.patientId ?? null, patientName: visit.patientName,
    doctor: visit.doctor ?? null, items, status: 'pending', dispensedAt: null, dispensedBy: null,
  }
}

/* ---------------- demo stores ---------------- */
const todayISO = () => new Date().toISOString()
let demoPending = []
let demoLog = []
let pendListeners = []
let logListeners = []
const emitPending = () => pendListeners.forEach((cb) => cb(demoPending.map((r) => ({ ...r }))))
const emitLog = () => logListeners.forEach((cb) => cb(demoLog.map((r) => ({ ...r }))))
export function _demoAddDispensary(record) { demoPending = [record, ...demoPending]; emitPending() }

const millis = (t) => {
  if (!t) return 0
  if (typeof t === 'string') return new Date(t).getTime()
  if (typeof t?.toMillis === 'function') return t.toMillis()
  if (t?.seconds != null) return t.seconds * 1000
  return 0
}
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

/* ---------------- watchers ---------------- */
export function watchPendingDispensary(tenantId, cb) {
  if (DEMO) {
    const l = () => cb(demoPending.filter((r) => r.status === 'pending').map((r) => ({ ...r })))
    pendListeners.push(l); l()
    return () => { pendListeners = pendListeners.filter((f) => f !== l) }
  }
  const q = query(collection(db, 'tenants', tenantId, 'dispensary'), where('status', '==', 'pending'))
  return onSnapshot(q, (snap) => {
    const rows = snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
    rows.sort((a, b) => millis(a.createdAt) - millis(b.createdAt))
    cb(rows)
  })
}

export function watchDispensaryLog(tenantId, cb) {
  if (DEMO) {
    const l = () => cb(demoLog.map((r) => ({ ...r })))
    logListeners.push(l); l()
    return () => { logListeners = logListeners.filter((f) => f !== l) }
  }
  const q = query(collection(db, 'tenants', tenantId, 'dispensary_log'), where('dispensedAt', '>=', Timestamp.fromDate(startOfToday())))
  return onSnapshot(q, (snap) => {
    const rows = snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
    rows.sort((a, b) => millis(b.dispensedAt) - millis(a.dispensedAt))
    cb(rows)
  })
}

/* ---------------- dispense (FEFO decrement + log) ---------------- */
// Allocate each item's quantity across its drug's batches, earliest-expiry
// first, using a shared remaining map so two items of the same drug don't
// double-spend a batch.
export function planRecordDispense(stockRows, items) {
  const remaining = new Map(stockRows.map((r) => [r.id, r.qty ?? 0]))
  const allocations = []
  const lines = []
  for (const it of items) {
    const batches = stockRows
      .filter((r) => r.drug === it.drug && (remaining.get(r.id) ?? 0) > 0)
      .sort((a, b) => new Date(a.expiry) - new Date(b.expiry))
    let toTake = it.qty, taken = 0
    const took = []
    for (const b of batches) {
      if (toTake <= 0) break
      const avail = remaining.get(b.id) ?? 0
      const t = Math.min(avail, toTake)
      if (t > 0) { remaining.set(b.id, avail - t); allocations.push({ batchId: b.id, newQty: avail - t }); took.push({ batch: b.batch, take: t }); taken += t; toTake -= t }
    }
    lines.push({ drug: it.drug, need: it.qty, dispensed: taken, shortBy: Math.max(0, it.qty - taken), batches: took })
  }
  return { allocations, lines }
}

export async function dispenseRecord(tenantId, record, stockRows, dispensedBy) {
  const plan = planRecordDispense(stockRows || [], record.items || [])
  const logEntry = {
    visitId: record.visitId ?? null, patientName: record.patientName, doctor: record.doctor ?? null,
    dispensedBy: dispensedBy || null, lines: plan.lines,
  }

  if (DEMO) {
    _demoApplyDispense(plan.allocations)   // apply decrements to the shared demo stock
    demoPending = demoPending.map((r) => (r.id === record.id ? { ...r, status: 'dispensed', dispensedAt: todayISO(), dispensedBy } : r))
    emitPending()
    demoLog = [{ id: 'log-' + record.id + '-' + Date.now(), ...logEntry, dispensedAt: todayISO() }, ...demoLog]
    emitLog()
    return plan
  }

  const batch = writeBatch(db)
  for (const a of plan.allocations) batch.update(doc(db, 'tenants', tenantId, 'pharmacy_stock', a.batchId), { qty: a.newQty })
  batch.update(doc(db, 'tenants', tenantId, 'dispensary', record.id), { status: 'dispensed', dispensedAt: serverTimestamp(), dispensedBy: dispensedBy || null })
  batch.set(doc(collection(db, 'tenants', tenantId, 'dispensary_log')), { ...logEntry, dispensedAt: serverTimestamp() })
  await batch.commit()
  return plan
}
