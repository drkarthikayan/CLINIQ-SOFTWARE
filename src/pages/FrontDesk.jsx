import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/authStore'
import { Chip, Stat, Modal, VitalInput } from '../components/ui'
import {
  searchByMobile, watchTodayQueue, checkIn, recordNurseVitals,
  ageFrom, normalizeMobile,
} from '../services/patients.service'

const STATUS = {
  waiting: ['gray', 'Waiting'],
  vitals: ['amber', 'Vitals done'],
  in_consult: ['teal', 'In consult'],
  completed: ['green', 'Completed'],
}
const FILTERS = [['all', 'All'], ['waiting', 'Waiting'], ['in_consult', 'In consult'], ['completed', 'Completed']]
const EMPTY_VITALS = { bp: '', pulse: '', temp: '', spo2: '', weight: '' }

const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
const toMillis = (t) => {
  if (!t) return 0
  if (typeof t === 'string') return new Date(t).getTime()
  if (typeof t?.toMillis === 'function') return t.toMillis()
  if (t?.seconds != null) return t.seconds * 1000
  return 0
}
const waitedFor = (t) => {
  const ms = toMillis(t)
  if (!ms) return null
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)} h ${mins % 60} min`
}

export default function FrontDesk() {
  const user = useAuth((s) => s.user)
  const nav = useNavigate()
  const [queue, setQueue] = useState([])
  const [phone, setPhone] = useState('')
  const [family, setFamily] = useState(null)   // null = untouched, [] = no match
  const [picked, setPicked] = useState(null)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ name: '', dob: '', sex: 'F', relation: 'Self', doctor: 'Dr. Priya', visitType: 'walk_in', complaint: '' })
  const [vitals, setVitals] = useState(EMPTY_VITALS)
  const [vitalsFor, setVitalsFor] = useState(null)   // visit being given vitals from the queue
  const [queueVitals, setQueueVitals] = useState(EMPTY_VITALS)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [, force] = useState(0)

  useEffect(() => watchTodayQueue(user.tenantId, setQueue), [user.tenantId])
  // Keep the "waiting for N min" column honest without a full refetch.
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 60000); return () => clearInterval(t) }, [])

  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3400) }

  const onPhone = async (v) => {
    setPhone(v)
    setPicked(null)
    setFamily(normalizeMobile(v).length >= 10 ? await searchByMobile(user.tenantId, v) : null)
  }

  const openCheckin = (patient) => {
    setPicked(patient || null)
    setForm({
      name: patient?.name || '', dob: patient?.dob || '', sex: patient?.sex || 'F',
      relation: patient?.relation || 'Self', doctor: 'Dr. Priya', visitType: 'walk_in', complaint: '',
    })
    setVitals(EMPTY_VITALS)
    setModal(true)
  }

  const doCheckIn = async () => {
    if (!form.name.trim()) return toast('Name is required')
    if (busy) return
    setBusy(true)
    try {
      const patient = picked || { ...form, mobile: phone, allergies: [] }
      const res = await checkIn(user.tenantId, {
        patient: { ...patient, ...form }, doctor: form.doctor,
        visitType: form.visitType, complaint: form.complaint,
        vitals: vitals.bp ? vitals : null,
      })
      setModal(false)
      toast(`${form.name} checked in · token ${res.token}`)
    } finally { setBusy(false) }
  }

  const openVitals = (v) => { setVitalsFor(v); setQueueVitals({ ...EMPTY_VITALS, ...(v.vitals || {}) }) }
  const saveQueueVitals = async () => {
    if (busy) return
    setBusy(true)
    try {
      await recordNurseVitals(user.tenantId, vitalsFor.id, queueVitals, user.name)
      setVitalsFor(null)
      toast(`Vitals recorded for ${vitalsFor.patientName}`)
    } finally { setBusy(false) }
  }

  const stats = useMemo(() => ({
    waiting: queue.filter((q) => q.status === 'waiting' || q.status === 'vitals').length,
    consult: queue.filter((q) => q.status === 'in_consult').length,
    done: queue.filter((q) => q.status === 'completed').length,
    nextToken: 'T-' + (queue.reduce((m, q) => Math.max(m, q.tokenNum ?? 0), 0) + 1),
  }), [queue])

  const shown = useMemo(() => {
    const t = search.trim().toLowerCase()
    return queue.filter((v) => {
      const inFilter = filter === 'all'
        || (filter === 'waiting' ? (v.status === 'waiting' || v.status === 'vitals') : v.status === filter)
      const inSearch = !t || v.patientName?.toLowerCase().includes(t) || (v.token || '').toLowerCase().includes(t)
      return inFilter && inSearch
    })
  }, [queue, filter, search])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target?.value ?? e }))

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
        <Stat k="Waiting" v={stats.waiting} tone={stats.waiting ? 'text-caution' : ''} />
        <Stat k="In consult" v={stats.consult} tone={stats.consult ? 'text-teal-dark' : ''} />
        <Stat k="Completed" v={stats.done} />
        <Stat k="Next token" v={stats.nextToken} />
      </div>

      <div className="card p-4 mb-4">
        <label className="lbl">Find patient or family by mobile number</label>
        <div className="flex gap-2.5 flex-wrap">
          <input
            className="inp !w-auto flex-1 min-w-[240px] font-mono !text-[14px] !py-2.5"
            placeholder="98400 12345"
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
          />
          <button className="btn-pri !px-5" onClick={() => openCheckin(null)}>+ New check-in</button>
        </div>

        {family && (
          <div className="flex gap-2.5 mt-3 flex-wrap">
            {family.map((p) => (
              <button
                key={p.id}
                onClick={() => openCheckin(p)}
                className={`text-left bg-white border rounded-[10px] px-3.5 py-2.5 min-w-[150px] hover:border-teal hover:bg-teal-wash transition-colors ${picked?.id === p.id ? 'border-teal border-2 bg-teal-wash' : 'border-line-strong'}`}
              >
                <b className="block text-[14px]">{p.name}</b>
                <small className="font-mono text-body-2 text-[12px]">{ageFrom(p.dob)} {p.sex}{p.mrn ? ` · ${p.mrn}` : ''}</small>
                <div className="mt-1.5 flex gap-1 flex-wrap">
                  <Chip tone={p.relation === 'Self' ? 'teal' : 'gray'}>{p.relation}</Chip>
                  {p.allergies?.length > 0 && <Chip tone="red">⚠ {p.allergies[0].split(' ')[0]}</Chip>}
                  {p.conditions?.slice(0, 1).map((c) => <Chip key={c} tone="amber">{c.split(' ')[0]}</Chip>)}
                </div>
              </button>
            ))}
            <button
              onClick={() => openCheckin(null)}
              className="border border-dashed border-line-strong rounded-[10px] px-3.5 text-teal-dark font-medium hover:bg-teal-wash"
            >
              + New family member
            </button>
          </div>
        )}
        {family && family.length > 1 && (
          <p className="text-[12px] text-body-3 mt-2.5">
            {family.length} patients share this number. Records are kept separately by
            <b> name + date of birth</b> — select the right person before check-in.
          </p>
        )}
        {family && family.length === 0 && (
          <p className="text-[12px] text-body-3 mt-2.5">No patient with this number yet — use “New check-in” to register the first family member.</p>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex justify-between items-center gap-3 px-4 py-3 border-b border-line flex-wrap">
          <div className="flex items-center gap-2.5 flex-wrap">
            <b className="font-disp">Today's queue</b>
            <div className="flex bg-[#F0EFEA] rounded-lg p-0.5">
              {FILTERS.map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={`px-2.5 py-1 rounded-md text-[12px] ${filter === k ? 'bg-white shadow-sm font-medium' : 'text-body-2'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <input className="inp !w-auto !py-1.5 !text-[12.5px] min-w-[180px]" placeholder="Filter by name or token…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse min-w-[720px]">
            <thead>
              <tr>
                <th className="th w-20">Token</th><th className="th">Patient</th>
                <th className="th w-28">Doctor</th><th className="th w-44">Vitals</th>
                <th className="th w-28">Status</th><th className="th w-48"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => {
                const [tone, label] = STATUS[v.status] || STATUS.waiting
                const waiting = v.status === 'waiting' || v.status === 'vitals'
                const wait = waiting ? waitedFor(v.createdAt) : null
                const hasVitals = !!v.vitals?.bp
                return (
                  <tr key={v.id} className="hover:bg-[#FBFAF7]">
                    <td className="td">
                      <span className="inline-flex items-center justify-center whitespace-nowrap font-mono font-semibold text-[12.5px] bg-teal-wash text-teal-dark rounded-md px-2 py-1">
                        {v.token || '—'}
                      </span>
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 shrink-0 rounded-full bg-[#EFEEE9] text-body-2 flex items-center justify-center text-[11.5px] font-semibold">{initials(v.patientName)}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <b>{v.patientName}</b>
                            <span className="text-body-2">{v.age ?? ageFrom(v.dob)} {v.sex}</span>
                            {v.allergyFlag && <Chip tone="red">⚠ {v.allergyFlag}</Chip>}
                            {v.visitType === 'appointment' && <Chip tone="gray">appt</Chip>}
                          </div>
                          {v.complaint && <div className="text-[12px] text-body-3 truncate max-w-[280px]">{v.complaint}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="td text-body-2">{v.doctor}</td>
                    <td className="td">
                      {hasVitals ? (
                        <span className="font-mono text-[12px] text-body-2">
                          {v.vitals.bp}{v.vitals.pulse ? ` · ${v.vitals.pulse}` : ''}{v.vitals.temp ? ` · ${v.vitals.temp}°` : ''}{v.vitals.spo2 ? ` · ${v.vitals.spo2}%` : ''}
                        </span>
                      ) : <Chip tone="gray">Pending</Chip>}
                    </td>
                    <td className="td">
                      <Chip tone={tone}>{label}</Chip>
                      {wait && <div className="text-[11px] text-body-3 mt-0.5">waiting {wait}</div>}
                    </td>
                    <td className="td">
                      <div className="flex gap-1.5 justify-end whitespace-nowrap">
                        {v.status !== 'completed' && (
                          <button className="btn !py-1 !px-2 !text-[12px]" onClick={() => openVitals(v)}>
                            {hasVitals ? 'Edit vitals' : '+ Vitals'}
                          </button>
                        )}
                        {v.status === 'in_consult' && (
                          <button className="btn-pri !py-1 !px-2 !text-[12px]" onClick={() => nav('/consult', { state: { visitId: v.id } })}>Open →</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {shown.length === 0 && (
                <tr><td className="td text-center text-body-3 py-8" colSpan={6}>
                  {queue.length === 0
                    ? 'No visits yet today. Check in the first patient above.'
                    : 'No visits match this filter.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Check-in */}
      <Modal
        open={modal}
        title="Check in patient"
        onClose={() => setModal(false)}
        footer={<>
          <button className="btn" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn-pri" disabled={busy} onClick={doCheckIn}>Check in & assign token</button>
        </>}
      >
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className="lbl">Mobile number</label><input className="inp font-mono" value={phone} onChange={(e) => onPhone(e.target.value)} /></div>
          <div><label className="lbl">Full name</label><input className="inp" value={form.name} onChange={set('name')} /></div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div><label className="lbl">Date of birth</label><input className="inp font-mono" type="date" value={form.dob} onChange={set('dob')} /></div>
          <div><label className="lbl">Sex</label>
            <select className="inp" value={form.sex} onChange={set('sex')}>
              <option value="F">Female</option><option value="M">Male</option><option value="O">Other</option>
            </select>
          </div>
          <div><label className="lbl">Relation</label>
            <select className="inp" value={form.relation} onChange={set('relation')}>
              {['Self', 'Spouse', 'Child', 'Parent', 'Other'].map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className="lbl">Doctor</label>
            <select className="inp" value={form.doctor} onChange={set('doctor')}>
              <option>Dr. Priya</option><option>Dr. Arun</option>
            </select>
          </div>
          <div><label className="lbl">Visit type</label>
            <select className="inp" value={form.visitType} onChange={set('visitType')}>
              <option value="walk_in">Walk-in</option>
              <option value="appointment">Appointment</option>
              <option value="review">Review / follow-up</option>
            </select>
          </div>
        </div>
        <div className="mb-3.5"><label className="lbl">Chief complaint (optional)</label>
          <input className="inp" placeholder="Fever for 2 days" value={form.complaint} onChange={set('complaint')} />
        </div>
        <div className="bg-[#FBFAF7] border border-line rounded-[10px] p-3.5">
          <b className="text-[13px]">Vitals at check-in <span className="font-normal text-body-3">(staff nurse — optional, can also be added later)</span></b>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mt-2">
            <VitalInput label="BP" placeholder="120/80" value={vitals.bp} onChange={(v) => setVitals((s) => ({ ...s, bp: v }))} />
            <VitalInput label="Pulse" placeholder="76" value={vitals.pulse} onChange={(v) => setVitals((s) => ({ ...s, pulse: v }))} />
            <VitalInput label="Temp °F" placeholder="98.6" value={vitals.temp} onChange={(v) => setVitals((s) => ({ ...s, temp: v }))} />
            <VitalInput label="SpO₂" placeholder="99" value={vitals.spo2} onChange={(v) => setVitals((s) => ({ ...s, spo2: v }))} />
            <VitalInput label="Wt kg" placeholder="58" value={vitals.weight} onChange={(v) => setVitals((s) => ({ ...s, weight: v }))} />
          </div>
        </div>
      </Modal>

      {/* Record vitals for a queued patient */}
      <Modal
        open={!!vitalsFor}
        title={vitalsFor ? `Vitals — ${vitalsFor.patientName} (${vitalsFor.token || ''})` : 'Vitals'}
        onClose={() => setVitalsFor(null)}
        footer={<>
          <button className="btn" onClick={() => setVitalsFor(null)}>Cancel</button>
          <button className="btn-pri" disabled={busy} onClick={saveQueueVitals}>Save vitals</button>
        </>}
      >
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          <VitalInput label="BP" placeholder="120/80" value={queueVitals.bp} onChange={(v) => setQueueVitals((s) => ({ ...s, bp: v }))} />
          <VitalInput label="Pulse" placeholder="76" value={queueVitals.pulse} onChange={(v) => setQueueVitals((s) => ({ ...s, pulse: v }))} />
          <VitalInput label="Temp °F" placeholder="98.6" value={queueVitals.temp} onChange={(v) => setQueueVitals((s) => ({ ...s, temp: v }))} />
          <VitalInput label="SpO₂" placeholder="99" value={queueVitals.spo2} onChange={(v) => setQueueVitals((s) => ({ ...s, spo2: v }))} />
          <VitalInput label="Wt kg" placeholder="58" value={queueVitals.weight} onChange={(v) => setQueueVitals((s) => ({ ...s, weight: v }))} />
        </div>
        <p className="text-[12px] text-body-3 mt-3">Recorded as the staff-nurse entry. The doctor's own reading is kept separately in consult, so this is never overwritten.</p>
      </Modal>

      {toastMsg && (
        <div className="fixed bottom-6 right-6 bg-ink text-white px-5 py-3 rounded-[10px] text-[13px] z-50 shadow-xl">{toastMsg}</div>
      )}
    </div>
  )
}
