// Patient + queue data access. Identity key: mobile (10-digit, normalized)
// + name + dob. Age is DISPLAYED, never stored as identity (it changes yearly).
import { DEMO, db } from '../lib/firebase'
import {
  collection, query, where, getDocs, addDoc, updateDoc, onSnapshot,
  serverTimestamp, Timestamp, doc, getDoc,
} from 'firebase/firestore'

export const normalizeMobile = (raw) => (raw || '').replace(/\D/g, '').slice(-10)

export const ageFrom = (dobISO) => {
  if (!dobISO) return '—'
  const dob = new Date(dobISO)
  const now = new Date()
  let a = now.getFullYear() - dob.getFullYear()
  if (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate())) a--
  return a
}

/* ---------------- demo data ---------------- */
const demoPatients = [
  { id: 'p1', name: 'Meena Ramesh', dob: '1992-03-12', sex: 'F', mobile: '9840012345',
    relation: 'Self', mrn: 'CLQ-0412', allergies: ['Penicillin (rash, 2021)'],
    conditions: ['Hypothyroidism (2023)', 'Migraine'] },
  { id: 'p2', name: 'Ayaan Ramesh', dob: '2020-01-05', sex: 'M', mobile: '9840012345',
    relation: 'Son', mrn: 'CLQ-0413', allergies: [], conditions: [] },
  { id: 'p3', name: 'Ramesh Kumar', dob: '1964-06-30', sex: 'M', mobile: '9840012345',
    relation: 'Father-in-law', mrn: 'CLQ-0288', allergies: [],
    conditions: ['T2DM', 'HTN'] },
]
let demoQueue = [
  { id: 'v1', token: 'T-21', tokenNum: 21, patientId: 'p1', patientName: 'Meena Ramesh', dob: '1992-03-12', age: 34, sex: 'F',
    doctor: 'Dr. Priya', status: 'in_consult', vitals: { bp: '118/76', pulse: 92, temp: 101.2, spo2: 98 },
    allergyFlag: 'Penicillin' },
  { id: 'v2', token: 'T-22', tokenNum: 22, patientId: null, patientName: 'Suresh K', dob: null, age: 58, sex: 'M',
    doctor: 'Dr. Priya', status: 'vitals', vitals: null, allergyFlag: null },
  { id: 'v3', token: 'T-23', tokenNum: 23, patientId: 'p2', patientName: 'Ayaan Ramesh', dob: '2020-01-05', age: 6, sex: 'M',
    doctor: 'Dr. Arun', status: 'waiting', vitals: null, allergyFlag: null },
  { id: 'v4', token: 'T-24', tokenNum: 24, patientId: null, patientName: 'Lakshmi V', dob: null, age: 71, sex: 'F',
    doctor: 'Dr. Priya', status: 'waiting', vitals: null, allergyFlag: null },
]
let demoListeners = []
const demoEmit = () => demoListeners.forEach((cb) => cb([...demoQueue]))

/* ---------------- API ---------------- */
export async function searchByMobile(tenantId, rawMobile) {
  const mobile = normalizeMobile(rawMobile)
  if (mobile.length < 10) return []
  if (DEMO) return demoPatients.filter((p) => p.mobile === mobile)
  const q = query(
    collection(db, 'tenants', tenantId, 'patients'),
    where('mobile', '==', mobile),
  )
  const snap = await getDocs(q)
  return snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
}

export async function getPatient(tenantId, patientId) {
  if (!patientId) return null
  if (DEMO) return demoPatients.find((p) => p.id === patientId) || null
  const snap = await getDoc(doc(db, 'tenants', tenantId, 'patients', patientId))
  return snap?.exists?.() ? { id: snap.id, ...snap.data() } : null
}

// A little demo history so the Patient history page has a timeline to show
// offline. Real tenants read from the visits collection below.
const demoPastVisits = [
  { id: 'h1', patientId: 'p1', patientName: 'Meena Ramesh', doctor: 'Dr. Priya', createdAt: '2026-05-02T10:15:00Z',
    complaint: 'Headache, throbbing, left side, 2 days', status: 'completed',
    consult: { mode: 'quick', dx: 'G43.9 · Migraine', advice: 'Hydration, regular sleep. Avoid known triggers. Review if aura or vomiting.',
      labs: ['CBC'], labsCustom: '',
      rx: [{ drug: 'Naproxen 250 mg', dose: '1 tab', freq: 'BD after food', days: 3 },
        { drug: 'Domperidone 10 mg', dose: '1 tab', freq: 'TDS before food', days: 2 }] } },
  { id: 'h2', patientId: 'p1', patientName: 'Meena Ramesh', doctor: 'Dr. Priya', createdAt: '2026-02-18T09:40:00Z',
    complaint: 'Routine thyroid review', status: 'completed',
    consult: { mode: 'quick', dx: 'E03.9 · Hypothyroidism — stable', advice: 'Continue Thyroxine. Repeat TSH in 3 months.',
      labs: ['TSH'], labsCustom: '',
      rx: [{ drug: 'Thyroxine 50 mcg', dose: '1 tab', freq: 'OD empty stomach', days: 90 }] } },
  { id: 'h3', patientId: 'p3', patientName: 'Ramesh Kumar', doctor: 'Dr. Arun', createdAt: '2026-06-10T18:05:00Z',
    complaint: 'BP review, occasional giddiness', status: 'completed',
    consult: { mode: 'quick', dx: 'I10 · Essential hypertension', advice: 'Reduce salt. Home BP monitoring. Continue medication.',
      labs: ['RFT', 'Electrolytes'], labsCustom: '',
      rx: [{ drug: 'Amlodipine 5 mg', dose: '1 tab', freq: 'OD', days: 30 }] } },
]

const visitMillis = (t) => {
  if (!t) return 0
  if (typeof t === 'string') return new Date(t).getTime()
  if (typeof t?.toMillis === 'function') return t.toMillis()
  if (t?.seconds != null) return t.seconds * 1000
  return 0
}

// All visits for one patient, newest first. Filter server-side on patientId,
// sort client-side (composite-index rule from OHC).
export async function getPatientVisits(tenantId, patientId) {
  if (!patientId) return []
  if (DEMO) {
    const today = demoQueue.filter((v) => v.patientId === patientId && v.status === 'completed')
    return [...today, ...demoPastVisits.filter((v) => v.patientId === patientId)]
      .sort((a, b) => visitMillis(b.createdAt) - visitMillis(a.createdAt))
  }
  const q = query(collection(db, 'tenants', tenantId, 'visits'), where('patientId', '==', patientId))
  const snap = await getDocs(q)
  const rows = snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
  return rows.sort((a, b) => visitMillis(b.createdAt) - visitMillis(a.createdAt))
}

export function watchTodayQueue(tenantId, cb) {
  if (DEMO) {
    demoListeners.push(cb)
    cb([...demoQueue])
    return () => { demoListeners = demoListeners.filter((f) => f !== cb) }
  }
  const start = new Date(); start.setHours(0, 0, 0, 0)
  // NOTE: where() + orderBy() on different fields needs a composite index.
  // Session-1 rule: filter server-side, sort client-side (OHC lesson).
  const q = query(
    collection(db, 'tenants', tenantId, 'visits'),
    where('createdAt', '>=', Timestamp.fromDate(start)),
  )
  return onSnapshot(q, (snap) => {
    const rows = snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
    rows.sort((a, b) => (a.tokenNum ?? 0) - (b.tokenNum ?? 0))
    cb(rows)
  })
}

// Demo-only mutator used by visits.service to move a visit through the
// waiting -> vitals -> in_consult -> completed lifecycle without a second
// source of truth for the in-memory queue.
export function _demoUpdateVisit(visitId, patch) {
  demoQueue = demoQueue.map((v) => (v.id === visitId ? { ...v, ...patch } : v))
  demoEmit()
}

// Nurse vitals recorded from the front desk AFTER check-in. Writes the nurse
// entry (never the doctor's `vitalsDoctor` audit field) and moves a waiting
// visit to `vitals`.
export async function recordNurseVitals(tenantId, visitId, vitals, recordedBy) {
  const entry = { ...vitals, recordedBy, recordedAt: DEMO ? new Date().toISOString() : serverTimestamp() }
  if (DEMO) {
    demoQueue = demoQueue.map((v) => (v.id === visitId
      ? { ...v, vitals: entry, status: v.status === 'waiting' ? 'vitals' : v.status }
      : v))
    demoEmit()
    return
  }
  const ref = doc(db, 'tenants', tenantId, 'visits', visitId)
  const snap = await getDoc(ref)
  const status = snap?.data()?.status
  await updateDoc(ref, { vitals: entry, ...(status === 'waiting' ? { status: 'vitals' } : {}) })
}

// Human queue tokens (T-1, T-2 …) restart each day. Derived from the max
// tokenNum among today's visits — visits are readable by every clinic role,
// unlike a settings counter doc, and a single front desk won't race.
async function nextTokenNum(tenantId) {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const snap = await getDocs(query(
    collection(db, 'tenants', tenantId, 'visits'),
    where('createdAt', '>=', Timestamp.fromDate(start)),
  ))
  const max = (snap?.docs ?? []).reduce((m, d) => Math.max(m, d.data()?.tokenNum ?? 0), 0)
  return max + 1
}

export async function checkIn(tenantId, { patient, doctor, visitType, complaint, vitals }) {
  if (DEMO) {
    let patientId = patient.id
    if (!patientId) {
      patientId = 'p' + (demoPatients.length + 1)
      demoPatients.push({
        id: patientId, name: patient.name, dob: patient.dob, sex: patient.sex,
        mobile: normalizeMobile(patient.mobile), relation: patient.relation || 'Self',
        mrn: null, allergies: patient.allergies || [], conditions: patient.conditions || [],
      })
    }
    const n = 21 + demoQueue.length
    demoQueue = [...demoQueue, {
      id: 'v' + (demoQueue.length + 1), token: 'T-' + n, tokenNum: n, patientId,
      patientName: patient.name, dob: patient.dob, age: ageFrom(patient.dob), sex: patient.sex,
      doctor, visitType: visitType || 'walk_in', complaint: complaint || '',
      status: vitals?.bp ? 'vitals' : 'waiting', vitals: vitals?.bp ? vitals : null,
      allergyFlag: patient.allergies?.[0]?.split(' ')[0] || null,
    }]
    demoEmit()
    return { token: 'T-' + n, patientId }
  }
  // Every check-in gets a real patients/{id} doc, even brand-new walk-ins.
  // Allergy safety and family history both depend on this record existing.
  let patientId = patient.id ?? null
  if (!patientId) {
    const pRef = await addDoc(collection(db, 'tenants', tenantId, 'patients'), {
      name: patient.name, dob: patient.dob ?? null, sex: patient.sex ?? null,
      mobile: normalizeMobile(patient.mobile), relation: patient.relation || 'Self',
      allergies: patient.allergies || [], conditions: patient.conditions || [],
      createdAt: serverTimestamp(),
    })
    patientId = pRef.id
  }
  const tokenNum = await nextTokenNum(tenantId)
  const token = 'T-' + tokenNum
  await addDoc(collection(db, 'tenants', tenantId, 'visits'), {
    patientId,
    patientName: patient.name, dob: patient.dob ?? null, sex: patient.sex ?? null,
    mobile: normalizeMobile(patient.mobile),
    tokenNum, token,
    doctor, visitType: visitType || 'walk_in', complaint: complaint || '',
    vitals: vitals ? { ...vitals, recordedBy: 'Front desk' } : null,
    status: vitals?.bp ? 'vitals' : 'waiting',
    createdAt: serverTimestamp(),
  })
  return { token, patientId }
}
