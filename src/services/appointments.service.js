// Appointments: a per-doctor day book. Slots are filtered server-side by the
// day's slotStart range and sorted client-side (composite-index rule). Marking
// an appointment "arrived" hands off to patients.service.checkIn so a booked
// patient flows into the same queue as a walk-in. See docs/FIRESTORE_SCHEMA.md.
import { DEMO, db } from '../lib/firebase'
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, doc,
  Timestamp, serverTimestamp,
} from 'firebase/firestore'

export const toMillis = (t) => {
  if (!t) return 0
  if (typeof t === 'string') return new Date(t).getTime()
  if (typeof t?.toMillis === 'function') return t.toMillis()
  if (t?.seconds != null) return t.seconds * 1000
  return 0
}
export const slotTime = (t) => new Date(toMillis(t)).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
const dayBounds = (dateISO) => {
  const start = new Date(dateISO + 'T00:00:00')
  const end = new Date(start); end.setDate(end.getDate() + 1)
  return { start, end }
}
const sameDay = (t, dateISO) => {
  const d = new Date(toMillis(t))
  const [y, m, day] = dateISO.split('-').map(Number)
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day
}

/* ---------------- demo store ---------------- */
const iso = (time) => { const d = new Date(); const [h, m] = time.split(':'); d.setHours(+h, +m, 0, 0); return d.toISOString() }
let demoAppts = [
  { id: 'a1', patientId: 'p1', name: 'Meena Ramesh', mobile: '9840012345', dob: '1992-03-12', sex: 'F',
    doctor: 'Dr. Priya', slotStart: iso('09:20'), reason: 'Migraine follow-up', status: 'booked' },
  { id: 'a2', patientId: null, name: 'Karthik R', mobile: '9791122334', dob: '1988-07-02', sex: 'M',
    doctor: 'Dr. Priya', slotStart: iso('10:00'), reason: 'Fever, body ache', status: 'booked' },
  { id: 'a3', patientId: 'p3', name: 'Ramesh Kumar', mobile: '9840012345', dob: '1964-06-30', sex: 'M',
    doctor: 'Dr. Arun', slotStart: iso('11:20'), reason: 'BP review', status: 'arrived' },
]
let demoListeners = []
const emit = () => demoListeners.forEach((cb) => cb(demoAppts.map((a) => ({ ...a }))))

export function watchAppointmentsForDay(tenantId, dateISO, cb) {
  if (DEMO) {
    const listener = () => cb(demoAppts.filter((a) => sameDay(a.slotStart, dateISO)).map((a) => ({ ...a })))
    demoListeners.push(listener); listener()
    return () => { demoListeners = demoListeners.filter((f) => f !== listener) }
  }
  const { start, end } = dayBounds(dateISO)
  const q = query(
    collection(db, 'tenants', tenantId, 'appointments'),
    where('slotStart', '>=', Timestamp.fromDate(start)),
    where('slotStart', '<', Timestamp.fromDate(end)),
  )
  return onSnapshot(q, (snap) => {
    const rows = snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
    rows.sort((a, b) => toMillis(a.slotStart) - toMillis(b.slotStart))
    cb(rows)
  })
}

// Same as watchAppointmentsForDay but over an arbitrary [startISO, endISO) range
// — powers the week view. One subscription covers the whole week; the day view
// derives its rows by filtering client-side.
export function watchAppointmentsRange(tenantId, startISO, endISO, cb) {
  if (DEMO) {
    const startMs = new Date(startISO + 'T00:00:00').getTime()
    const endMs = new Date(endISO + 'T00:00:00').getTime()
    const listener = () => cb(demoAppts.filter((a) => { const m = toMillis(a.slotStart); return m >= startMs && m < endMs }).map((a) => ({ ...a })))
    demoListeners.push(listener); listener()
    return () => { demoListeners = demoListeners.filter((f) => f !== listener) }
  }
  const start = new Date(startISO + 'T00:00:00')
  const end = new Date(endISO + 'T00:00:00')
  const q = query(
    collection(db, 'tenants', tenantId, 'appointments'),
    where('slotStart', '>=', Timestamp.fromDate(start)),
    where('slotStart', '<', Timestamp.fromDate(end)),
  )
  return onSnapshot(q, (snap) => {
    const rows = snap?.docs?.map((d) => ({ id: d.id, ...d.data() })) ?? []
    rows.sort((a, b) => toMillis(a.slotStart) - toMillis(b.slotStart))
    cb(rows)
  })
}

export async function bookAppointment(tenantId, { patient, doctor, dateISO, time, reason }) {
  const slotStart = new Date(`${dateISO}T${time}:00`)
  const base = {
    patientId: patient.id ?? null, name: patient.name, mobile: patient.mobile ?? null,
    dob: patient.dob ?? null, sex: patient.sex ?? null, doctor, reason: reason || '', status: 'booked',
  }
  if (DEMO) {
    const appt = { id: 'a' + (demoAppts.length + 1) + '-' + Date.now(), ...base, slotStart: slotStart.toISOString() }
    demoAppts = [...demoAppts, appt]; emit()
    return appt
  }
  const ref = await addDoc(collection(db, 'tenants', tenantId, 'appointments'), {
    ...base, slotStart: Timestamp.fromDate(slotStart), createdAt: serverTimestamp(),
  })
  return { id: ref.id, ...base }
}

export async function setAppointmentStatus(tenantId, apptId, status) {
  if (DEMO) {
    demoAppts = demoAppts.map((a) => (a.id === apptId ? { ...a, status } : a)); emit()
    return
  }
  await updateDoc(doc(db, 'tenants', tenantId, 'appointments', apptId), { status })
}
