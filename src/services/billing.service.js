// Billing: the doctor-managed price list, the pure invoice-line builder
// (shared by consult finalize), and the invoices ledger the Billing page
// reads. On consult completion an unpaid invoice (paidAt:null) is queued;
// Billing marks it paid with a payment mode. See docs/FIRESTORE_SCHEMA.md.
import { DEMO, db } from '../lib/firebase'
import {
  doc, getDoc, setDoc, collection, addDoc, updateDoc,
  query, onSnapshot, serverTimestamp,
} from 'firebase/firestore'

const DEFAULT_PRICE_LIST = [
  { label: 'Consultation', amount: 300 },
  { label: 'Follow-up consult (within 7 days)', amount: 150 },
  { label: 'ECG', amount: 250 },
  { label: 'Nebulization', amount: 200 },
  { label: 'Dressing — minor', amount: 100 },
  { label: 'Injection administration', amount: 60 },
]

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
// Kept side-effect free so the atomic consult-finalize writeBatch and the
// standalone queue path build identical lines.
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

  ;(consult.rx || []).forEach((r) => {
    if (r.mrp) lines.push({ label: r.drug, amount: r.mrp, source: 'pharmacy' })
  })

  const total = lines.reduce((s, l) => s + (l.amount || 0), 0)
  return { lines, total }
}

export function makeInvoicePayload(visit, consult, priceList) {
  const { lines, total } = buildInvoiceLines(visit, consult, priceList)
  return {
    visitId: visit.id, patientId: visit.patientId ?? null, patientName: visit.patientName,
    lines, total, mode: null, paidAt: null,
  }
}

/* ---------------- invoices ledger ---------------- */
const todayISO = () => new Date().toISOString()
let demoInvoices = [
  { id: 'inv-seed-1', visitId: 'vh-1', patientId: 'p1', patientName: 'Meena Ramesh',
    lines: [{ label: 'Consultation', amount: 300, source: 'pricelist' }, { label: 'ECG', amount: 250, source: 'pricelist' }],
    total: 550, mode: 'upi', paidAt: todayISO(), createdAt: todayISO() },
  { id: 'inv-seed-2', visitId: 'vh-2', patientId: null, patientName: 'Suresh K',
    lines: [{ label: 'Consultation', amount: 300, source: 'pricelist' }],
    total: 300, mode: null, paidAt: null, createdAt: todayISO() },
]
let demoInvListeners = []
const emitInvoices = () => demoInvListeners.forEach((cb) => cb([...demoInvoices]))
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
    cb([...demoInvoices])
    return () => { demoInvListeners = demoInvListeners.filter((f) => f !== cb) }
  }
  const q = query(collection(db, 'tenants', tenantId, 'invoices'))
  return onSnapshot(q, (snap) => {
    const rows = snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
    rows.sort((a, b) => millis(b.createdAt) - millis(a.createdAt))
    cb(rows)
  })
}

export async function queueInvoiceForConsult(tenantId, visit, consult, priceList) {
  const payload = { ...makeInvoicePayload(visit, consult, priceList), createdAt: DEMO ? todayISO() : serverTimestamp() }
  if (DEMO) {
    const inv = { id: 'inv-demo-' + visit.id + '-' + Date.now(), ...payload }
    _demoAddInvoice(inv)
    return inv
  }
  const ref = await addDoc(collection(db, 'tenants', tenantId, 'invoices'), payload)
  return { id: ref.id, ...payload }
}

export async function markInvoicePaid(tenantId, invoiceId, mode) {
  if (DEMO) {
    demoInvoices = demoInvoices.map((i) => (i.id === invoiceId ? { ...i, mode, paidAt: todayISO() } : i))
    emitInvoices()
    return
  }
  await updateDoc(doc(db, 'tenants', tenantId, 'invoices', invoiceId), { mode, paidAt: serverTimestamp() })
}

// Used to attach custom line items before settling. Recomputes total.
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
