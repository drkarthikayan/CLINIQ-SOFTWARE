// Visit lifecycle (waiting -> vitals -> in_consult -> completed) and
// per-doctor consult templates. Demo-mode visit mutations go through
// patients.service's _demoUpdateVisit so there is one source of truth
// for the in-memory queue that FrontDesk also renders.
import { DEMO, db } from '../lib/firebase'
import {
  collection, query, getDocs, addDoc, updateDoc, deleteDoc, doc,
  writeBatch, serverTimestamp, increment,
} from 'firebase/firestore'
import { _demoUpdateVisit } from './patients.service'
import { makeInvoicePayload, _demoAddInvoice } from './billing.service'
import { planDispense, _demoApplyDispense } from './stock.service'

/* ---------------- demo templates ---------------- */
let demoTemplates = [
  { id: 'acute-pharyngitis', name: 'Acute pharyngitis', mode: 'quick',
    complaint: 'Fever __ days, sore throat. Throat congested, no exudate. Chest clear.',
    dx: 'J02.9 · Acute pharyngitis',
    advice: 'Warm saline gargles, fluids, rest. Review if fever persists beyond 48 h.',
    rx: [
      { drug: 'Paracetamol 650 mg', dose: '1 tab', freq: 'TDS after food', days: 3 },
      { drug: 'Cetirizine 10 mg', dose: '1 tab', freq: 'HS', days: 3 },
    ],
    labs: [], useCount: 0 },
]

/* ---------------- visit mutations ---------------- */
export async function updateVisit(tenantId, visitId, patch) {
  if (DEMO) return _demoUpdateVisit(visitId, patch)
  await updateDoc(doc(db, 'tenants', tenantId, 'visits', visitId), patch)
}

export function startConsult(tenantId, visitId) {
  return updateVisit(tenantId, visitId, { status: 'in_consult' })
}

export function saveConsultDraft(tenantId, visitId, consult) {
  return updateVisit(tenantId, visitId, { consult })
}

export function saveDoctorVitals(tenantId, visitId, vitals, editedBy) {
  return updateVisit(tenantId, visitId, {
    vitalsDoctor: { ...vitals, editedBy, editedAt: DEMO ? new Date().toISOString() : serverTimestamp() },
  })
}

export function completeConsult(tenantId, visitId, consult) {
  return updateVisit(tenantId, visitId, {
    consult, status: 'completed',
    completedAt: DEMO ? new Date().toISOString() : serverTimestamp(),
  })
}

// Atomic consult completion (Session 4 contract): in ONE writeBatch —
//   1. mark the visit completed (+ save the doctor's vitals audit entry),
//   2. queue the unpaid invoice for Billing,
//   3. FEFO-decrement pharmacy stock for every stocked Rx line.
// If any part fails the whole thing rolls back, so stock can never drift out
// of sync with a billed consult. Returns { invoice, dispense }.
export async function finalizeConsult(tenantId, { visit, consult, vitalsDoctor, editedBy, priceList, stockRows, pharmacyOn = true }) {
  const invoicePayload = makeInvoicePayload(visit, consult, priceList)
  const plan = pharmacyOn ? planDispense(stockRows || [], consult.rx || []) : { allocations: [], dispensedLines: [] }
  const vitalsEntry = { ...(vitalsDoctor || {}), editedBy }

  if (DEMO) {
    _demoUpdateVisit(visit.id, {
      consult, vitalsDoctor: { ...vitalsEntry, editedAt: new Date().toISOString() },
      status: 'completed', completedAt: new Date().toISOString(),
    })
    _demoAddInvoice({ id: 'inv-demo-' + visit.id + '-' + Date.now(), ...invoicePayload, createdAt: new Date().toISOString() })
    _demoApplyDispense(plan.allocations)
    return { invoice: invoicePayload, dispense: plan }
  }

  const batch = writeBatch(db)
  batch.update(doc(db, 'tenants', tenantId, 'visits', visit.id), {
    consult, vitalsDoctor: { ...vitalsEntry, editedAt: serverTimestamp() },
    status: 'completed', completedAt: serverTimestamp(),
  })
  const invRef = doc(collection(db, 'tenants', tenantId, 'invoices'))
  batch.set(invRef, { ...invoicePayload, createdAt: serverTimestamp() })
  for (const a of plan.allocations) {
    batch.update(doc(db, 'tenants', tenantId, 'pharmacy_stock', a.batchId), { qty: a.newQty })
  }
  await batch.commit()
  return { invoice: { id: invRef.id, ...invoicePayload }, dispense: plan }
}

/* ---------------- templates ---------------- */
export async function listTemplates(tenantId) {
  if (DEMO) return [...demoTemplates]
  const snap = await getDocs(query(collection(db, 'tenants', tenantId, 'templates')))
  return snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
}

export async function saveTemplate(tenantId, tpl) {
  if (DEMO) {
    const t = { id: 'tpl' + (demoTemplates.length + 1), useCount: 0, ...tpl }
    demoTemplates = [...demoTemplates, t]
    return t
  }
  const ref = await addDoc(collection(db, 'tenants', tenantId, 'templates'), {
    ...tpl, useCount: 0, createdAt: serverTimestamp(),
  })
  return { id: ref.id, ...tpl }
}

export async function bumpTemplateUse(tenantId, templateId) {
  if (DEMO) {
    demoTemplates = demoTemplates.map((t) => (t.id === templateId ? { ...t, useCount: (t.useCount || 0) + 1 } : t))
    return
  }
  await updateDoc(doc(db, 'tenants', tenantId, 'templates', templateId), { useCount: increment(1) })
}

export async function updateTemplate(tenantId, templateId, patch) {
  if (DEMO) {
    demoTemplates = demoTemplates.map((t) => (t.id === templateId ? { ...t, ...patch } : t))
    return
  }
  await updateDoc(doc(db, 'tenants', tenantId, 'templates', templateId), patch)
}

export async function deleteTemplate(tenantId, templateId) {
  if (DEMO) {
    demoTemplates = demoTemplates.filter((t) => t.id !== templateId)
    return
  }
  await deleteDoc(doc(db, 'tenants', tenantId, 'templates', templateId))
}
