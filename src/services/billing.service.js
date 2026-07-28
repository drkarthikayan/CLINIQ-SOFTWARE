// Billing: the doctor-managed price list, the pure invoice-line builder shared
// by consult finalize, and the invoices ledger the Billing page reads.
// A completed consult queues an unpaid invoice; Billing settles it with a
// discount, an amount received (part payment allowed) and a payment mode.
// See docs/FIRESTORE_SCHEMA.md.
import { DEMO, db } from '../lib/firebase'
import {
  doc, getDoc, setDoc, collection, addDoc, updateDoc,
  query, where, onSnapshot, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { qtyForRx } from './stock.service'

const DEFAULT_PRICE_LIST = [
  { label: 'Consultation', amount: 300 },
  { label: 'Follow-up consult (within 7 days)', amount: 150 },
  { label: 'ECG', amount: 250 },
  { label: 'Nebulization', amount: 200 },
  { label: 'Dressing — minor', amount: 100 },
  { label: 'Injection administration', amount: 60 },
]

// The ledger view is bounded so the Billing page never unboundedly grows;
// unpaid invoices older than this are still in Firestore, just not listed.
const LEDGER_WINDOW_DAYS = 30

/* ---------------- price list ---------------- */
let demoPriceList = [...DEFAULT_PRICE_LIST]

export async function getPriceList(tenantId) {
  if (DEMO) return [...demoPriceList]
  const snap = await getDoc(doc(db, 'tenants', tenantId, 'settings', 'billing'))
  return snap?.data()?.priceList ?? DEFAULT_PRICE_LIST
}

export async function savePriceList(tenantId, priceList) {
  if (DEMO) { demoPriceList = [...priceList]; return }
  await setDoc(doc(db, 'tenants', tenantId, 'settings', 'billing'), { priceList }, { merge: true })
}

/* ---------------- invoice line builder (pure) ---------------- */
export function buildInvoiceLines(visit, consult, priceList) {
  const list = priceList?.length ? priceList : DEFAULT_PRICE_LIST
  const lines = []
  const isFollowUp = visit.visitType === 'follow_up' || visit.visitType === 'review' || /follow.?up/i.test(visit.complaint || '')
  const feeLabel = isFollowUp ? 'Follow-up consult (within 7 days)' : 'Consultation'
  const fee = list.find((p) => p.label === feeLabel) || list.find((p) => p.label === 'Consultation') || DEFAULT_PRICE_LIST[0]
  lines.push({ label: fee.label, amount: fee.amount, source: 'pricelist' })

  ;(consult.labs || []).forEach((code) => {
    const m = list.find((p) => p.label.toLowerCase() === code.toLowerCase())
    if (m) lines.push({ label: m.label, amount: m.amount, source: 'pricelist' })
  })

  // Pharmacy lines are MRP × dispensed quantity (frequency × days), not a
  // single unit's MRP — billing must match what the patient actually receives.
  ;(consult.rx || []).forEach((r) => {
    if (!r.mrp) return
    const qty = qtyForRx(r) || 1
    lines.push({ label: `${r.drug} × ${qty}`, amount: Math.round(r.mrp * qty * 100) / 100, qty, unitMrp: r.mrp, source: 'pharmacy' })
  })

  const total = lines.reduce((s, l) => s + (l.amount || 0), 0)
  return { lines, total }
}

export function makeInvoicePayload(visit, consult, priceList) {
  const { lines, total } = buildInvoiceLines(visit, consult, priceList)
  return {
    visitId: visit.id, patientId: visit.patientId ?? null, patientName: visit.patientName,
    lines, total, discount: 0, payable: total, paid: 0,
    mode: null, paidAt: null, status: 'unpaid',
  }
}

/* ---------------- derived view of an invoice ---------------- */
// Older invoices predate discount/paid/status, so derive them defensively.
export function normalizeInvoice(inv) {
  const total = inv.total ?? 0
  const discount = inv.discount ?? 0
  const payable = inv.payable ?? Math.max(0, total - discount)
  const paid = inv.paid ?? (inv.paidAt ? payable : 0)
  const status = inv.status ?? (inv.paidAt ? 'paid' : 'unpaid')
  return { ...inv, total, discount, payable, paid, balance: Math.max(0, payable - paid), status }
}

/* ---------------- invoices ledger ---------------- */
const nowISO = () => new Date().toISOString()
let demoInvoices = [
  { id: 'inv-seed-1', visitId: 'vh-1', patientId: 'p1', patientName: 'Meena Ramesh',
    lines: [{ label: 'Consultation', amount: 300, source: 'pricelist' }, { label: 'ECG', amount: 250, source: 'pricelist' }],
    total: 550, discount: 50, payable: 500, paid: 500, mode: 'upi', status: 'paid', paidAt: nowISO(), createdAt: nowISO() },
  { id: 'inv-seed-2', visitId: 'vh-2', patientId: null, patientName: 'Suresh K',
    lines: [{ label: 'Consultation', amount: 300, source: 'pricelist' }],
    total: 300, discount: 0, payable: 300, paid: 0, mode: null, status: 'unpaid', paidAt: null, createdAt: nowISO() },
]
let demoInvListeners = []
const emitInvoices = () => demoInvListeners.forEach((cb) => cb(demoInvoices.map((i) => ({ ...i }))))
export function _demoAddInvoice(inv) { demoInvoices = [inv, ...demoInvoices]; emitInvoices() }

const millis = (t) => {
  if (!t) return 0
  if (typeof t === 'string') return new Date(t).getTime()
  if (typeof t?.toMillis === 'function') return t.toMillis()
  if (t?.seconds != null) return t.seconds * 1000
  return 0
}

export function watchInvoices(tenantId, cb) {
  if (DEMO) {
    demoInvListeners.push(cb)
    cb(demoInvoices.map((i) => ({ ...i })))
    return () => { demoInvListeners = demoInvListeners.filter((f) => f !== cb) }
  }
  const since = new Date(); since.setDate(since.getDate() - LEDGER_WINDOW_DAYS); since.setHours(0, 0, 0, 0)
  const q = query(collection(db, 'tenants', tenantId, 'invoices'), where('createdAt', '>=', Timestamp.fromDate(since)))
  return onSnapshot(q, (snap) => {
    const rows = snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
    rows.sort((a, b) => millis(b.createdAt) - millis(a.createdAt))
    cb(rows)
  })
}

export async function queueInvoiceForConsult(tenantId, visit, consult, priceList) {
  const payload = { ...makeInvoicePayload(visit, consult, priceList), createdAt: DEMO ? nowISO() : serverTimestamp() }
  if (DEMO) {
    const inv = { id: 'inv-demo-' + visit.id + '-' + Date.now(), ...payload }
    _demoAddInvoice(inv)
    return inv
  }
  const ref = await addDoc(collection(db, 'tenants', tenantId, 'invoices'), payload)
  return { id: ref.id, ...payload }
}

/* ---------------- settlement ---------------- */
// Records a payment against an invoice. `received` may be less than payable —
// the balance stays open and the invoice shows as partial.
export async function settleInvoice(tenantId, invoiceId, { mode, received, discount = 0, total, note = '' }) {
  const payable = Math.max(0, (total ?? 0) - discount)
  const paid = Math.max(0, received ?? 0)
  const status = paid >= payable && payable > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
  const patch = {
    discount, payable, paid, mode, note, status,
    paidAt: status === 'paid' ? (DEMO ? nowISO() : serverTimestamp()) : (status === 'partial' ? (DEMO ? nowISO() : serverTimestamp()) : null),
  }
  if (DEMO) {
    demoInvoices = demoInvoices.map((i) => (i.id === invoiceId ? { ...i, ...patch } : i))
    emitInvoices()
    return
  }
  await updateDoc(doc(db, 'tenants', tenantId, 'invoices', invoiceId), patch)
}

export async function voidInvoice(tenantId, invoiceId, reason) {
  const patch = { status: 'void', voidReason: reason || '', voidedAt: DEMO ? nowISO() : serverTimestamp() }
  if (DEMO) { demoInvoices = demoInvoices.map((i) => (i.id === invoiceId ? { ...i, ...patch } : i)); emitInvoices(); return }
  await updateDoc(doc(db, 'tenants', tenantId, 'invoices', invoiceId), patch)
}

// Used to attach or remove line items before settling. Recomputes the total.
export async function updateInvoice(tenantId, invoiceId, patch) {
  const withTotal = patch.lines
    ? { ...patch, total: patch.lines.reduce((s, l) => s + (l.amount || 0), 0) }
    : patch
  if (DEMO) {
    demoInvoices = demoInvoices.map((i) => (i.id === invoiceId ? { ...i, ...withTotal } : i))
    emitInvoices()
    return
  }
  await updateDoc(doc(db, 'tenants', tenantId, 'invoices', invoiceId), withTotal)
}

export { LEDGER_WINDOW_DAYS }
