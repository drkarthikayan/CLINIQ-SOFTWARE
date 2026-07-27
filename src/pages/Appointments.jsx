import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../store/authStore'
import { Chip, Stat, Modal } from '../components/ui'
import {
  watchAppointmentsForDay, bookAppointment, setAppointmentStatus, slotTime,
} from '../services/appointments.service'
import { searchByMobile, checkIn, ageFrom, normalizeMobile } from '../services/patients.service'

const DOCTORS = ['Dr. Priya', 'Dr. Arun']
const STATUS = { booked: ['gray', 'Booked'], arrived: ['green', 'Arrived'], cancelled: ['red', 'Cancelled'] }

// Consulting slots: morning 09:00–13:00, evening 16:00–20:00, 20-min each.
const SLOTS = (() => {
  const out = []
  const add = (from, to) => { for (let m = from; m < to; m += 20) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`) }
  add(9 * 60, 13 * 60); add(16 * 60, 20 * 60)
  return out
})()

const todayISO = () => new Date().toLocaleDateString('en-CA')
const shiftDay = (dateISO, delta) => { const d = new Date(dateISO + 'T00:00:00'); d.setDate(d.getDate() + delta); return d.toLocaleDateString('en-CA') }
const prettyDate = (dateISO) => new Date(dateISO + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

const EMPTY_FORM = { mobile: '', name: '', dob: '', sex: 'F', doctor: 'Dr. Priya', time: '', reason: '' }

export default function Appointments() {
  const user = useAuth((s) => s.user)
  const [dateISO, setDateISO] = useState(todayISO())
  const [doctorFilter, setDoctorFilter] = useState('All')
  const [appts, setAppts] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [family, setFamily] = useState(null)
  const [picked, setPicked] = useState(null)
  const [slotDoctor, setSlotDoctor] = useState('Dr. Priya')
  const [toastMsg, setToastMsg] = useState('')

  useEffect(() => watchAppointmentsForDay(user.tenantId, dateISO, setAppts), [user.tenantId, dateISO])
  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3200) }

  const shown = useMemo(
    () => (doctorFilter === 'All' ? appts : appts.filter((a) => a.doctor === doctorFilter))
      .slice().sort((a, b) => slotTime(a.slotStart).localeCompare(slotTime(b.slotStart))),
    [appts, doctorFilter],
  )

  const stats = useMemo(() => ({
    booked: shown.filter((a) => a.status === 'booked').length,
    arrived: shown.filter((a) => a.status === 'arrived').length,
    cancelled: shown.filter((a) => a.status === 'cancelled').length,
  }), [shown])

  // Free slots for a doctor (cancelled slots free up again).
  const takenByDoctor = (docName) => new Set(
    appts.filter((a) => a.doctor === docName && a.status !== 'cancelled').map((a) => slotTime(a.slotStart)),
  )
  const freeSlots = useMemo(() => { const taken = takenByDoctor(slotDoctor); return SLOTS.filter((s) => !taken.has(s)) }, [appts, slotDoctor])
  const modalFreeSlots = useMemo(() => { const taken = takenByDoctor(form.doctor); return SLOTS.filter((s) => !taken.has(s) || s === form.time) }, [appts, form.doctor, form.time])

  const openBook = (doctor, time) => {
    setForm({ ...EMPTY_FORM, doctor: doctor || 'Dr. Priya', time: time || '' })
    setFamily(null); setPicked(null); setModal(true)
  }

  const onMobile = async (v) => {
    setForm((f) => ({ ...f, mobile: v })); setPicked(null)
    setFamily(normalizeMobile(v).length >= 10 ? await searchByMobile(user.tenantId, v) : null)
  }
  const pickPatient = (p) => { setPicked(p); setForm((f) => ({ ...f, name: p.name, dob: p.dob || '', sex: p.sex || 'F' })) }

  const book = async () => {
    if (!form.name.trim()) return toast('Patient name is required')
    if (!form.time) return toast('Pick a time slot')
    const patient = picked || { name: form.name, dob: form.dob, sex: form.sex, mobile: form.mobile }
    await bookAppointment(user.tenantId, { patient: { ...patient, mobile: form.mobile }, doctor: form.doctor, dateISO, time: form.time, reason: form.reason })
    setModal(false)
    toast(`Booked ${form.name} · ${form.doctor} · ${form.time}`)
  }

  const markArrived = async (appt) => {
    await setAppointmentStatus(user.tenantId, appt.id, 'arrived')
    const res = await checkIn(user.tenantId, {
      patient: { id: appt.patientId || undefined, name: appt.name, dob: appt.dob, sex: appt.sex, mobile: appt.mobile },
      doctor: appt.doctor, visitType: 'appointment', complaint: appt.reason,
    })
    toast(`${appt.name} arrived · checked in · token ${res.token}`)
  }
  const cancel = async (appt) => { await setAppointmentStatus(user.tenantId, appt.id, 'cancelled'); toast('Appointment cancelled') }

  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target?.value ?? e }))

  return (
    <div>
      {/* Controls */}
      <div className="card p-3.5 mb-4 flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-1">
          <button className="btn !px-2.5" onClick={() => setDateISO((d) => shiftDay(d, -1))}>‹</button>
          <button className="btn" onClick={() => setDateISO(todayISO())}>Today</button>
          <button className="btn !px-2.5" onClick={() => setDateISO((d) => shiftDay(d, 1))}>›</button>
        </div>
        <b className="font-disp text-[15px]">{prettyDate(dateISO)}</b>
        <input className="inp !w-auto font-mono" type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
        <select className="inp !w-auto" value={doctorFilter} onChange={(e) => setDoctorFilter(e.target.value)}>
          <option>All</option>{DOCTORS.map((d) => <option key={d}>{d}</option>)}
        </select>
        <button className="btn-pri ml-auto" onClick={() => openBook(slotDoctor, '')}>+ Book appointment</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
        <Stat k="Booked" v={stats.booked} />
        <Stat k="Arrived" v={stats.arrived} tone="text-teal-dark" />
        <Stat k="Cancelled" v={stats.cancelled} tone={stats.cancelled ? 'text-danger' : ''} />
        <Stat k="Open slots" v={SLOTS.length - takenByDoctor(slotDoctor).size} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Schedule */}
        <div className="card overflow-hidden lg:col-span-2">
          <div className="flex justify-between items-center px-4 py-3.5 border-b border-line">
            <b className="font-disp">Day schedule</b>
            <span className="text-[12px] text-body-3">{shown.length} appointment{shown.length === 1 ? '' : 's'}</span>
          </div>
          <table className="w-full text-[13px] border-collapse">
            <thead><tr>
              <th className="th w-16">Time</th><th className="th">Patient</th><th className="th w-24">Doctor</th>
              <th className="th w-24">Status</th><th className="th w-[150px]"></th>
            </tr></thead>
            <tbody>
              {shown.map((a) => {
                const [tone, label] = STATUS[a.status] || STATUS.booked
                return (
                  <tr key={a.id} className="hover:bg-[#FBFAF7]">
                    <td className="td font-mono font-semibold">{slotTime(a.slotStart)}</td>
                    <td className="td"><b>{a.name}</b>{a.reason ? <span className="text-body-2"> · {a.reason}</span> : ''}</td>
                    <td className="td text-body-2">{a.doctor}</td>
                    <td className="td"><Chip tone={tone}>{label}</Chip></td>
                    <td className="td">
                      {a.status === 'booked' && (
                        <div className="flex gap-1.5 justify-end">
                          <button className="btn-pri !py-1 !px-2 !text-[12px]" onClick={() => markArrived(a)}>Arrived</button>
                          <button className="btn-ghost !py-1 !text-[12px]" onClick={() => cancel(a)}>Cancel</button>
                        </div>
                      )}
                      {a.status === 'arrived' && <span className="text-[12px] text-teal-dark font-medium float-right">✓ Checked in</span>}
                    </td>
                  </tr>
                )
              })}
              {shown.length === 0 && <tr><td className="td text-body-3" colSpan={5}>No appointments for this day. Book one from the open slots →</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Open slots */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <b className="font-disp text-[14px]">Open slots</b>
            <select className="inp !w-auto !py-1 !text-[12.5px]" value={slotDoctor} onChange={(e) => setSlotDoctor(e.target.value)}>
              {DOCTORS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {freeSlots.map((s) => (
              <button key={s} className="chip-teal hover:opacity-80 font-mono" onClick={() => openBook(slotDoctor, s)}>{s}</button>
            ))}
            {freeSlots.length === 0 && <span className="text-body-3 text-[12.5px]">Fully booked for {slotDoctor}.</span>}
          </div>
        </div>
      </div>

      {/* Book modal */}
      <Modal open={modal} title="Book appointment" onClose={() => setModal(false)}
        footer={<>
          <button className="btn" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn-pri" onClick={book}>Book</button>
        </>}>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className="lbl">Mobile number</label><input className="inp font-mono" value={form.mobile} onChange={(e) => onMobile(e.target.value)} /></div>
          <div><label className="lbl">Patient name</label><input className="inp" value={form.name} onChange={setF('name')} /></div>
        </div>
        {family && family.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-3">
            {family.map((p) => (
              <button key={p.id} onClick={() => pickPatient(p)}
                className={`text-left border rounded-[10px] px-3 py-2 hover:border-teal ${picked?.id === p.id ? 'border-teal border-2 bg-teal-wash' : 'border-line-strong'}`}>
                <b className="block text-[13px]">{p.name}</b>
                <small className="font-mono text-body-2 text-[11.5px]">{ageFrom(p.dob)} {p.sex} · {p.relation}</small>
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div><label className="lbl">Date of birth</label><input className="inp font-mono" type="date" value={form.dob} onChange={setF('dob')} /></div>
          <div><label className="lbl">Sex</label>
            <select className="inp" value={form.sex} onChange={setF('sex')}><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option></select></div>
          <div><label className="lbl">Doctor</label>
            <select className="inp" value={form.doctor} onChange={setF('doctor')}>{DOCTORS.map((d) => <option key={d}>{d}</option>)}</select></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="lbl">Time slot</label>
            <select className="inp font-mono" value={form.time} onChange={setF('time')}>
              <option value="">Select…</option>{modalFreeSlots.map((s) => <option key={s}>{s}</option>)}
            </select></div>
          <div className="col-span-2"><label className="lbl">Reason</label><input className="inp" placeholder="Complaint / purpose" value={form.reason} onChange={setF('reason')} /></div>
        </div>
      </Modal>

      {toastMsg && <div className="fixed bottom-6 right-6 bg-ink text-white px-5 py-3 rounded-[10px] text-[13px] z-50 shadow-xl">{toastMsg}</div>}
    </div>
  )
}
