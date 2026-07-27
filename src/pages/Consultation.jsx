import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../store/authStore'
import { watchTodayQueue, ageFrom, getPatient } from '../services/patients.service'
import {
  startConsult, saveConsultDraft, saveDoctorVitals, finalizeConsult,
  listTemplates, saveTemplate, bumpTemplateUse,
} from '../services/visits.service'
import { watchStock, searchDrugs, checkAllergyMatch } from '../services/stock.service'
import { getPriceList } from '../services/billing.service'
import { Chip } from '../components/ui'

const EMPTY_VITALS = { bp: '', pulse: '', temp: '', spo2: '', weight: '' }
const EMPTY_CONSULT = { mode: 'quick', complaint: '', dx: '', advice: '', s: '', o: '', a: '', p: '', labs: [], labsCustom: '', rx: [] }

const LAB_GROUPS = [
  { key: 'blood', label: 'Blood', items: ['CBC', 'RBS', 'FBS/PPBS', 'HbA1c', 'LFT', 'RFT', 'Lipid profile', 'TSH', 'Urea/Creatinine', 'Electrolytes', 'CRP', 'Widal', 'Dengue NS1/IgM'] },
  { key: 'urine', label: 'Urine & others', items: ['Urine routine', 'Urine culture', 'Stool routine'] },
  { key: 'imaging', label: 'Imaging & cardiac', items: ['ECG', 'Echo', 'TMT', 'X-ray', 'USG', 'CT', 'MRI'] },
]

function VField({ label, value, onChange, placeholder, readOnly }) {
  return (
    <div className="bg-[#FBFAF7] border border-line rounded-lg px-2.5 py-2">
      <span className="lbl !mb-0.5">{label}</span>
      <input
        className="w-full bg-transparent font-mono text-[16px] font-medium focus:outline-none focus:border-b-2 focus:border-teal disabled:text-body-3"
        value={value ?? ''} placeholder={placeholder} disabled={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  )
}

export default function Consultation() {
  const user = useAuth((s) => s.user)
  const location = useLocation()

  const [queue, setQueue] = useState([])
  const [stock, setStock] = useState([])
  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState(location.state?.visitId || null)
  const [patient, setPatient] = useState(null)
  const [consult, setConsult] = useState(EMPTY_CONSULT)
  const [vitalsDraft, setVitalsDraft] = useState(EMPTY_VITALS)
  const [rxSearch, setRxSearch] = useState('')
  const [toastMsg, setToastMsg] = useState('')

  useEffect(() => watchTodayQueue(user.tenantId, setQueue), [user.tenantId])
  useEffect(() => watchStock(user.tenantId, setStock), [user.tenantId])
  useEffect(() => { listTemplates(user.tenantId).then(setTemplates) }, [user.tenantId])

  const visit = useMemo(() => queue.find((v) => v.id === selectedId) || null, [queue, selectedId])
  const waitingList = useMemo(
    () => queue.filter((v) => v.status === 'waiting' || v.status === 'vitals')
      .sort((a, b) => (a.token || a.id).localeCompare(b.token || b.id)),
    [queue],
  )

  useEffect(() => {
    if (!visit) { setPatient(null); return }
    setConsult(visit.consult ? { ...EMPTY_CONSULT, ...visit.consult } : { ...EMPTY_CONSULT, complaint: visit.complaint || '' })
    setVitalsDraft(visit.vitalsDoctor || visit.vitals || EMPTY_VITALS)
    setRxSearch('')
    if (visit.patientId) getPatient(user.tenantId, visit.patientId).then(setPatient)
    else setPatient(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit?.id])

  const allergies = patient?.allergies?.length ? patient.allergies : (visit?.allergyFlag ? [visit.allergyFlag] : [])
  const conditions = patient?.conditions || []

  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3400) }

  const openVisit = async (v) => {
    setSelectedId(v.id)
    if (v.status !== 'in_consult') await startConsult(user.tenantId, v.id)
  }

  const backToQueue = () => setSelectedId(null)

  const saveVitals = async () => {
    await saveDoctorVitals(user.tenantId, visit.id, vitalsDraft, user.name)
    toast('Vitals saved')
  }

  const toggleLab = (code) => setConsult((c) => ({
    ...c, labs: c.labs.includes(code) ? c.labs.filter((x) => x !== code) : [...c.labs, code],
  }))

  const matchedDrugs = useMemo(() => searchDrugs(stock, rxSearch), [stock, rxSearch])

  const addRxLine = (pick) => {
    const clash = checkAllergyMatch(allergies, pick.drug)
    if (clash) { toast(`⚠ Blocked — patient is allergic to ${clash}`); return }
    setConsult((c) => ({
      ...c,
      rx: [...c.rx, { drug: pick.drug, dose: '', freq: '', days: 3, batchId: pick.batchId, mrp: pick.mrp, nearExpiry: pick.nearExpiry, lowStock: pick.lowStock }],
    }))
    setRxSearch('')
  }
  const updateRxLine = (i, patch) => setConsult((c) => ({ ...c, rx: c.rx.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }))
  const removeRxLine = (i) => setConsult((c) => ({ ...c, rx: c.rx.filter((_, idx) => idx !== i) }))

  const applyTemplate = (t) => {
    setConsult((c) => ({
      ...c, mode: t.mode || 'quick', complaint: t.complaint || c.complaint, dx: t.dx || '', advice: t.advice || '',
      labs: t.labs || [], rx: (t.rx || []).map((r) => ({ ...r })),
    }))
    bumpTemplateUse(user.tenantId, t.id)
    toast(`Applied "${t.name}" — edit as needed`)
  }

  const saveAsTemplate = async () => {
    const name = window.prompt('Template name?', consult.complaint?.slice(0, 30) || 'New template')
    if (!name) return
    await saveTemplate(user.tenantId, {
      name, mode: consult.mode, complaint: consult.complaint, dx: consult.dx, advice: consult.advice,
      rx: consult.rx.map(({ drug, dose, freq, days }) => ({ drug, dose, freq, days })), labs: consult.labs,
    })
    listTemplates(user.tenantId).then(setTemplates)
    toast('Saved as template')
  }

  const saveDraft = async () => { await saveConsultDraft(user.tenantId, visit.id, consult); toast('Draft saved') }

  const complete = async () => {
    const blocked = consult.rx.find((r) => checkAllergyMatch(allergies, r.drug))
    if (blocked) { toast('⚠ Cannot complete — an Rx line conflicts with a known allergy'); return }
    const priceList = await getPriceList(user.tenantId)
    const { dispense } = await finalizeConsult(user.tenantId, {
      visit, consult, vitalsDoctor: vitalsDraft, editedBy: user.name,
      priceList, stockRows: stock, pharmacyOn: true,
    })
    const short = (dispense?.dispensedLines || []).filter((l) => l.shortBy > 0)
    toast(short.length
      ? `Consult completed · billing queued · ⚠ short stock: ${short.map((s) => s.drug).join(', ')}`
      : 'Consult completed · billing queued · stock updated')
    setSelectedId(null)
  }

  if (!visit) {
    return (
      <div>
        {toastMsg && <div className="card px-4 py-2.5 mb-4 text-[13px] font-medium text-teal-dark bg-teal-wash border-teal">{toastMsg}</div>}
        <div className="card overflow-hidden">
          <div className="flex justify-between items-center px-4 py-3.5 border-b border-line">
            <b className="font-disp">Waiting to be seen</b>
            <span className="text-[12px] text-body-3">{waitingList.length} in queue</span>
          </div>
          <table className="w-full text-[13px] border-collapse">
            <thead><tr>
              <th className="th w-16">Token</th><th className="th">Patient</th>
              <th className="th w-28">Doctor</th><th className="th w-24">Status</th><th className="th w-24"></th>
            </tr></thead>
            <tbody>
              {waitingList.map((v) => (
                <tr key={v.id} className="hover:bg-[#FBFAF7]">
                  <td className="td font-mono font-semibold">{v.token || v.id.slice(0, 4)}</td>
                  <td className="td">
                    <b>{v.patientName}</b> · {v.age ?? ageFrom(v.dob)} {v.sex}
                    {v.allergyFlag && <span className="chip-red ml-1.5">⚠ {v.allergyFlag}</span>}
                  </td>
                  <td className="td text-body-2">{v.doctor}</td>
                  <td className="td"><Chip tone={v.status === 'vitals' ? 'amber' : 'gray'}>{v.status === 'vitals' ? 'Vitals' : 'Waiting'}</Chip></td>
                  <td className="td"><button className="btn-pri !py-1.5 !text-[12px]" onClick={() => openVisit(v)}>Start consult →</button></td>
                </tr>
              ))}
              {waitingList.length === 0 && (
                <tr><td className="td text-body-3" colSpan={5}>No one waiting. Check patients in from Front desk.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div>
      {toastMsg && <div className="card px-4 py-2.5 mb-4 text-[13px] font-medium text-teal-dark bg-teal-wash border-teal">{toastMsg}</div>}

      <div className="flex items-center justify-between mb-3">
        <button className="btn-ghost !px-0 text-[12.5px]" onClick={backToQueue}>← Back to queue</button>
        <span className="font-mono text-[12px] text-body-3">Token {visit.token || visit.id.slice(0, 4)}</span>
      </div>

      {/* Patient banner */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-disp text-[18px] font-semibold">{visit.patientName}</div>
            <div className="text-body-2 text-[13px]">
              {visit.age ?? ageFrom(visit.dob)} yrs · {visit.sex} · {patient?.relation || 'Self'}{patient?.mrn ? ` · MRN ${patient.mrn}` : ''}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 justify-end max-w-[420px]">
            {conditions.map((c) => <Chip key={c} tone="gray">{c}</Chip>)}
          </div>
        </div>
        {allergies.length > 0 && (
          <div className="mt-3 bg-danger-wash border border-danger rounded-lg px-3 py-2 text-[13px] font-medium text-danger">
            ⚠ Allergy: {allergies.join(', ')} — prescribing any matching drug is blocked below.
          </div>
        )}
      </div>

      {/* Vitals */}
      <div className="card p-4 mb-4">
        <b className="font-disp block mb-3">Vitals</b>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-3">
          <VField label="BP (nurse)" value={visit.vitals?.bp} readOnly />
          <VField label="Pulse (nurse)" value={visit.vitals?.pulse} readOnly />
          <VField label="Temp (nurse)" value={visit.vitals?.temp} readOnly />
          <VField label="SpO2 (nurse)" value={visit.vitals?.spo2} readOnly />
          <VField label="Weight (nurse)" value={visit.vitals?.weight} readOnly />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          <VField label="BP" value={vitalsDraft.bp} onChange={(v) => setVitalsDraft((s) => ({ ...s, bp: v }))} placeholder="120/80" />
          <VField label="Pulse" value={vitalsDraft.pulse} onChange={(v) => setVitalsDraft((s) => ({ ...s, pulse: v }))} placeholder="76" />
          <VField label="Temp °F" value={vitalsDraft.temp} onChange={(v) => setVitalsDraft((s) => ({ ...s, temp: v }))} placeholder="98.6" />
          <VField label="SpO2" value={vitalsDraft.spo2} onChange={(v) => setVitalsDraft((s) => ({ ...s, spo2: v }))} placeholder="99" />
          <VField label="Weight kg" value={vitalsDraft.weight} onChange={(v) => setVitalsDraft((s) => ({ ...s, weight: v }))} placeholder="58" />
        </div>
        <div className="flex justify-end mt-2.5"><button className="btn" onClick={saveVitals}>Save vitals</button></div>
      </div>

      {/* Templates */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-2.5">
          <b className="font-disp text-[14px]">Templates</b>
          <button className="btn-ghost !text-[12px]" onClick={saveAsTemplate}>+ Save as template</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <button key={t.id} className="chip-teal hover:opacity-80" onClick={() => applyTemplate(t)}>{t.name}</button>
          ))}
          {templates.length === 0 && <span className="text-body-3 text-[12.5px]">No templates yet.</span>}
        </div>
      </div>

      {/* Quick / SOAP */}
      <div className="card p-4 mb-4">
        <div className="flex gap-2 mb-3">
          <button className={consult.mode === 'quick' ? 'btn-pri !py-1.5 !text-[12.5px]' : 'btn !py-1.5 !text-[12.5px]'} onClick={() => setConsult((c) => ({ ...c, mode: 'quick' }))}>Quick</button>
          <button className={consult.mode === 'soap' ? 'btn-pri !py-1.5 !text-[12.5px]' : 'btn !py-1.5 !text-[12.5px]'} onClick={() => setConsult((c) => ({ ...c, mode: 'soap' }))}>Full SOAP</button>
        </div>
        {consult.mode === 'quick' ? (
          <div className="grid gap-2.5">
            <div><span className="lbl">Complaint</span><textarea className="inp !h-16" value={consult.complaint} onChange={(e) => setConsult((c) => ({ ...c, complaint: e.target.value }))} /></div>
            <div><span className="lbl">Diagnosis</span><input className="inp" value={consult.dx} onChange={(e) => setConsult((c) => ({ ...c, dx: e.target.value }))} /></div>
            <div><span className="lbl">Advice</span><textarea className="inp !h-16" value={consult.advice} onChange={(e) => setConsult((c) => ({ ...c, advice: e.target.value }))} /></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <div><span className="lbl">Subjective</span><textarea className="inp !h-16" value={consult.s} onChange={(e) => setConsult((c) => ({ ...c, s: e.target.value }))} /></div>
            <div><span className="lbl">Objective</span><textarea className="inp !h-16" value={consult.o} onChange={(e) => setConsult((c) => ({ ...c, o: e.target.value }))} /></div>
            <div><span className="lbl">Assessment</span><textarea className="inp !h-16" value={consult.a} onChange={(e) => setConsult((c) => ({ ...c, a: e.target.value }))} /></div>
            <div><span className="lbl">Plan</span><textarea className="inp !h-16" value={consult.p} onChange={(e) => setConsult((c) => ({ ...c, p: e.target.value }))} /></div>
          </div>
        )}
      </div>

      {/* Labs */}
      <div className="card p-4 mb-4">
        <b className="font-disp block mb-3">Lab / imaging requests</b>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
          {LAB_GROUPS.map((g) => (
            <div key={g.key}>
              <div className="text-[11px] uppercase tracking-wide text-body-3 mb-1.5">{g.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((code) => (
                  <button key={code} onClick={() => toggleLab(code)}
                    className={consult.labs.includes(code) ? 'chip-teal' : 'chip-gray hover:opacity-80'}>
                    {code}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <input className="inp" placeholder="Custom test / instruction (free text)" value={consult.labsCustom}
          onChange={(e) => setConsult((c) => ({ ...c, labsCustom: e.target.value }))} />
      </div>

      {/* Rx */}
      <div className="card p-4 mb-4">
        <b className="font-disp block mb-3">Prescription</b>
        <div className="relative mb-3">
          <input className="inp" placeholder="Search drug to add…" value={rxSearch} onChange={(e) => setRxSearch(e.target.value)} />
          {matchedDrugs.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-line-strong rounded-lg shadow-lg overflow-hidden">
              {matchedDrugs.map((m) => {
                const blocked = checkAllergyMatch(allergies, m.drug)
                return (
                  <button key={m.drug} disabled={!!blocked}
                    className={`w-full text-left px-3 py-2 text-[13px] flex items-center justify-between gap-2 ${blocked ? 'bg-danger-wash text-danger cursor-not-allowed' : 'hover:bg-[#FBFAF7]'}`}
                    onClick={() => addRxLine(m)}>
                    <span>{m.drug}</span>
                    <span className="flex gap-1.5 items-center shrink-0">
                      {blocked && <Chip tone="red">Allergy</Chip>}
                      {m.nearExpiry && <Chip tone="amber">Batch exp {m.expiry}</Chip>}
                      {m.lowStock && <Chip tone="red">Low stock</Chip>}
                      <span className="font-mono text-[11.5px] text-body-3">qty {m.totalQty}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <table className="w-full text-[13px] border-collapse">
          <thead><tr>
            <th className="th">Drug</th><th className="th w-28">Dose</th><th className="th w-32">Frequency</th>
            <th className="th w-16">Days</th><th className="th w-16"></th>
          </tr></thead>
          <tbody>
            {consult.rx.map((r, i) => (
              <tr key={i}>
                <td className="td">
                  {r.drug}
                  {r.nearExpiry && <Chip tone="amber" className="ml-1.5">near-expiry batch</Chip>}
                  {r.lowStock && <Chip tone="red" className="ml-1.5">low stock</Chip>}
                </td>
                <td className="td"><input className="inp !py-1" value={r.dose} onChange={(e) => updateRxLine(i, { dose: e.target.value })} /></td>
                <td className="td"><input className="inp !py-1" value={r.freq} onChange={(e) => updateRxLine(i, { freq: e.target.value })} /></td>
                <td className="td"><input className="inp !py-1" type="number" value={r.days} onChange={(e) => updateRxLine(i, { days: Number(e.target.value) })} /></td>
                <td className="td"><button className="btn-ghost !text-[12px]" onClick={() => removeRxLine(i)}>Remove</button></td>
              </tr>
            ))}
            {consult.rx.length === 0 && <tr><td className="td text-body-3" colSpan={5}>No drugs added yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2.5 mb-8">
        <button className="btn" onClick={saveDraft}>Save draft</button>
        <button className="btn-pri" onClick={complete}>Complete consult</button>
      </div>
    </div>
  )
}
