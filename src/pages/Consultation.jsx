import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../store/authStore'
import { watchTodayQueue, ageFrom, getPatient, getPatientVisits } from '../services/patients.service'
import {
  startConsult, saveConsultDraft, saveDoctorVitals, finalizeConsult,
  listTemplates, saveTemplate, bumpTemplateUse,
} from '../services/visits.service'
import { watchStock, searchDrugs, qtyForRx, brandsForGeneric } from '../services/stock.service'
import { getPriceList } from '../services/billing.service'
import { checkAllergy, flagVitals, bmiOf, validateConsult, detectDuplicates } from '../services/clinical.service'
import { getTenantSettings } from '../services/settings.service'
import { openRxPrint, downloadRxPdf, shareRxPdf } from '../lib/rxSheet'
import { FREQ_PRESETS, FOOD_PRESETS, defaultSigFor, suggestInstructions, suggestLineInstruction } from '../lib/rxPresets'
import { Chip, Modal } from '../components/ui'

const EMPTY_VITALS = { bp: '', pulse: '', temp: '', spo2: '', weight: '', height: '' }
const EMPTY_CONSULT = { mode: 'quick', complaint: '', dx: '', advice: '', s: '', o: '', a: '', p: '', labs: [], labsCustom: '', rx: [], reviewDays: '' }

const LAB_GROUPS = [
  { key: 'blood', label: 'Blood', items: ['CBC', 'RBS', 'FBS/PPBS', 'HbA1c', 'LFT', 'RFT', 'Lipid profile', 'TSH', 'Urea/Creatinine', 'Electrolytes', 'CRP', 'Widal', 'Dengue NS1/IgM'] },
  { key: 'urine', label: 'Urine & others', items: ['Urine routine', 'Urine culture', 'Stool routine'] },
  { key: 'imaging', label: 'Imaging & cardiac', items: ['ECG', 'Echo', 'TMT', 'X-ray', 'USG', 'CT', 'MRI'] },
]

const FLAG_STYLE = {
  warn: 'border-caution bg-caution-wash',
  high: 'border-danger bg-danger-wash',
}

function VField({ label, value, onChange, placeholder, readOnly, flag }) {
  return (
    <div className={`border rounded-lg px-2.5 py-2 ${flag ? FLAG_STYLE[flag.level] : 'bg-[#FBFAF7] border-line'}`}>
      <span className="lbl !mb-0.5">{label}</span>
      <input
        className="w-full bg-transparent font-mono text-[16px] font-medium focus:outline-none focus:border-b-2 focus:border-teal disabled:text-body-3"
        value={value ?? ''} placeholder={placeholder} disabled={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
      />
      {flag && <span className={`block text-[10.5px] mt-0.5 font-medium ${flag.level === 'high' ? 'text-danger' : 'text-caution'}`}>{flag.note}</span>}
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
  const [review, setReview] = useState(null)   // pre-completion checklist
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState(null)
  const [lastRx, setLastRx] = useState(null)   // most recent previous prescription
  const [brandFor, setBrandFor] = useState(null)   // Rx row index whose brand list is open

  useEffect(() => watchTodayQueue(user.tenantId, setQueue), [user.tenantId])
  useEffect(() => watchStock(user.tenantId, setStock), [user.tenantId])
  useEffect(() => { listTemplates(user.tenantId).then(setTemplates) }, [user.tenantId])
  useEffect(() => { getTenantSettings(user.tenantId).then(setSettings) }, [user.tenantId])

  const visit = useMemo(() => queue.find((v) => v.id === selectedId) || null, [queue, selectedId])
  const waitingList = useMemo(
    () => queue.filter((v) => v.status === 'waiting' || v.status === 'vitals')
      .sort((a, b) => (a.tokenNum ?? 0) - (b.tokenNum ?? 0)),
    [queue],
  )

  useEffect(() => {
    if (!visit) { setPatient(null); return }
    setConsult(visit.consult ? { ...EMPTY_CONSULT, ...visit.consult } : { ...EMPTY_CONSULT, complaint: visit.complaint || '' })
    setVitalsDraft({ ...EMPTY_VITALS, ...(visit.vitalsDoctor || visit.vitals || {}) })
    setRxSearch('')
    setLastRx(null)
    if (visit.patientId) {
      getPatient(user.tenantId, visit.patientId).then(setPatient)
      // Chronic patients repeat the same script — surface the last one to copy.
      getPatientVisits(user.tenantId, visit.patientId).then((rows) => {
        const prev = rows.find((r) => r.id !== visit.id && r.consult?.rx?.length)
        setLastRx(prev ? { when: prev.createdAt, rx: prev.consult.rx, dx: prev.consult.dx } : null)
      })
    } else setPatient(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit?.id])

  const allergies = patient?.allergies?.length ? patient.allergies : (visit?.allergyFlag ? [visit.allergyFlag] : [])
  const conditions = patient?.conditions || []
  const age = visit ? (visit.age ?? ageFrom(visit.dob)) : null

  const vFlags = useMemo(() => flagVitals(vitalsDraft, typeof age === 'number' ? age : undefined), [vitalsDraft, age])
  const bmi = useMemo(() => bmiOf(vitalsDraft), [vitalsDraft])
  const dupes = useMemo(() => detectDuplicates(consult.rx), [consult.rx])

  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3800) }

  const openVisit = async (v) => {
    setSelectedId(v.id)
    if (v.status !== 'in_consult') await startConsult(user.tenantId, v.id)
  }
  const backToQueue = () => setSelectedId(null)

  const saveVitals = async () => { await saveDoctorVitals(user.tenantId, visit.id, vitalsDraft, user.name); toast('Vitals saved') }

  const toggleLab = (code) => setConsult((c) => ({
    ...c, labs: c.labs.includes(code) ? c.labs.filter((x) => x !== code) : [...c.labs, code],
  }))

  const matchedDrugs = useMemo(() => searchDrugs(stock, rxSearch), [stock, rxSearch])
  const stockOf = (drug) => stock.filter((r) => (r.brand || r.drug) === drug).reduce((s2, r) => s2 + (r.qty ?? 0), 0)

  const addRxLine = (pick) => {
    // The allergy guard runs against the GENERIC — a brand name like "Mox 500"
    // would never match a "Penicillin" allergy on its own.
    const hit = checkAllergy(allergies, pick.generic || pick.drug)
    if (hit?.level === 'block') { toast(`⛔ Blocked — ${hit.reason}`); return }
    if (hit?.level === 'caution') toast(`⚠ Caution — ${hit.reason}`)
    const sig = defaultSigFor(pick.generic || pick.drug)
    setConsult((c) => ({
      ...c,
      rx: [...c.rx, {
        drug: pick.brand || pick.drug, generic: pick.generic || pick.drug,
        dose: '1 tab', freq: sig.freq, food: sig.food, days: 3,
        instruction: suggestLineInstruction(pick.generic || pick.drug),
        batchId: pick.batchId, mrp: pick.mrp, nearExpiry: pick.nearExpiry, lowStock: pick.lowStock,
      }],
    }))
    setRxSearch('')
  }

  // Swap an Rx line to another brand of the same molecule, keeping the sig.
  const switchBrand = (i, alt) => {
    updateRxLine(i, { drug: alt.brand || alt.drug, batchId: alt.batchId, mrp: alt.mrp, nearExpiry: alt.nearExpiry, lowStock: alt.lowStock })
    setBrandFor(null)
    toast(`Switched to ${alt.brand || alt.drug}`)
  }

  const applySuggestedAdvice = () => {
    const picks = suggestInstructions({ dx: consult.mode === 'soap' ? consult.a : consult.dx, rx: consult.rx })
    const text = picks.map((p) => p.text).join(' ')
    setConsult((c) => ({ ...c, advice: c.advice ? `${c.advice} ${text}` : text }))
    toast('Suggested instructions added — edit as needed')
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
    const name = window.prompt('Template name?', consult.dx?.slice(0, 30) || consult.complaint?.slice(0, 30) || 'New template')
    if (!name) return
    await saveTemplate(user.tenantId, {
      name, mode: consult.mode, complaint: consult.complaint, dx: consult.dx, advice: consult.advice,
      rx: consult.rx.map(({ drug, dose, freq, days }) => ({ drug, dose, freq, days })), labs: consult.labs,
    })
    listTemplates(user.tenantId).then(setTemplates)
    toast('Saved as template')
  }

  const saveDraft = async () => { await saveConsultDraft(user.tenantId, visit.id, consult); toast('Draft saved') }

  // Chronic refill: copy the previous script, re-running the allergy guard in
  // case the patient's allergy list changed since that visit.
  const repeatLastRx = () => {
    if (!lastRx?.rx?.length) return
    const safe = [], blocked = []
    lastRx.rx.forEach((r) => (checkAllergy(allergies, r.drug)?.level === 'block' ? blocked : safe).push(r))
    setConsult((c) => ({ ...c, rx: [...c.rx, ...safe.map((r) => ({ ...r }))] }))
    toast(blocked.length
      ? `Repeated ${safe.length} medicine${safe.length === 1 ? '' : 's'} · ${blocked.length} skipped (allergy)`
      : `Repeated ${safe.length} medicine${safe.length === 1 ? '' : 's'} from the last visit`)
  }

  const rxPayload = () => ({
    clinic: { name: settings?.name || user.tenantName || user.tenantId, city: settings?.city, ...(settings?.letterhead || {}) },
    doctor: { name: user.name, qualification: settings?.letterhead?.doctorQualification, regNo: settings?.letterhead?.doctorRegNo },
    patient, visit, consult, lang: settings?.letterhead?.rxLang || '',
  })
  const printRx = () => { if (!openRxPrint(rxPayload())) toast('Allow pop-ups to print the prescription') }
  const savePdf = async () => {
    if (busy) return
    setBusy(true)
    try { await downloadRxPdf(rxPayload()); toast('Prescription PDF saved') }
    catch { toast('Could not generate the PDF') }
    finally { setBusy(false) }
  }
  const shareRx = async () => {
    const mobile = patient?.mobile || visit.mobile
    if (!mobile) { toast('No mobile number on this patient record'); return }
    if (busy) return
    setBusy(true)
    try {
      const { mode } = await shareRxPdf({ ...rxPayload(), mobile })
      if (mode === 'downloaded') toast('PDF downloaded · attach it in the WhatsApp chat that just opened')
      else if (mode === 'shared') toast('Prescription shared')
    } catch { toast('Could not share the prescription') }
    finally { setBusy(false) }
  }

  // Run the clinical checks first; blockers stop, warnings need an explicit OK.
  const attemptComplete = () => {
    const { blockers, warnings } = validateConsult({ consult, allergies, vitalFlags: vFlags })
    if (blockers.length) { setReview({ blockers, warnings }); return }
    if (warnings.length) { setReview({ blockers: [], warnings }); return }
    doComplete()
  }

  const doComplete = async () => {
    if (busy) return
    setBusy(true)
    try {
      const priceList = await getPriceList(user.tenantId)
      const { dispensary } = await finalizeConsult(user.tenantId, {
        visit, consult, vitalsDoctor: vitalsDraft, editedBy: user.name, priceList, pharmacyOn: true,
      })
      setReview(null)
      toast(dispensary ? 'Consult completed · billing queued · sent to pharmacy' : 'Consult completed · billing queued')
      setSelectedId(null)
    } finally { setBusy(false) }
  }

  // Keyboard ergonomics: doctors type, they don't reach for the mouse.
  //   Ctrl/Cmd+Enter complete · Ctrl/Cmd+S draft · "/" focus drug search · Esc back
  useEffect(() => {
    if (!visit) return
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 'Enter') { e.preventDefault(); attemptComplete() }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveDraft() }
      else if (e.key === '/' && !typing) { e.preventDefault(); document.getElementById('rx-search')?.focus() }
      else if (e.key === 'Escape' && !review && !typing) backToQueue()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- queue view ---------------- */
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
              <th className="th w-20">Token</th><th className="th">Patient</th>
              <th className="th w-28">Doctor</th><th className="th w-32">Vitals</th><th className="th w-28"></th>
            </tr></thead>
            <tbody>
              {waitingList.map((v) => (
                <tr key={v.id} className="hover:bg-[#FBFAF7]">
                  <td className="td"><span className="font-mono font-semibold whitespace-nowrap bg-teal-wash text-teal-dark rounded-md px-2 py-1 text-[12.5px]">{v.token || '—'}</span></td>
                  <td className="td">
                    <b>{v.patientName}</b> · {v.age ?? ageFrom(v.dob)} {v.sex}
                    {v.allergyFlag && <Chip tone="red" className="ml-1.5">⚠ {v.allergyFlag}</Chip>}
                    {v.complaint && <div className="text-[12px] text-body-3">{v.complaint}</div>}
                  </td>
                  <td className="td text-body-2">{v.doctor}</td>
                  <td className="td">{v.vitals?.bp
                    ? <span className="font-mono text-[12px] text-body-2">{v.vitals.bp}{v.vitals.pulse ? ` · ${v.vitals.pulse}` : ''}</span>
                    : <Chip tone="gray">Pending</Chip>}</td>
                  <td className="td"><button className="btn-pri !py-1.5 !text-[12px]" onClick={() => openVisit(v)}>Start consult →</button></td>
                </tr>
              ))}
              {waitingList.length === 0 && (
                <tr><td className="td text-center text-body-3 py-8" colSpan={5}>No one waiting. Check patients in from Front desk.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  /* ---------------- consult view ---------------- */
  return (
    <div>
      {toastMsg && <div className="card px-4 py-2.5 mb-4 text-[13px] font-medium text-teal-dark bg-teal-wash border-teal">{toastMsg}</div>}

      <div className="flex items-center justify-between mb-3">
        <button className="btn-ghost !px-0 text-[12.5px]" onClick={backToQueue}>← Back to queue</button>
        <span className="font-mono text-[12px] text-body-3">Token {visit.token || '—'}</span>
      </div>

      {/* Patient banner */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-disp text-[18px] font-semibold">{visit.patientName}</div>
            <div className="text-body-2 text-[13px]">
              {age} yrs · {visit.sex} · {patient?.relation || 'Self'}{patient?.mrn ? ` · MRN ${patient.mrn}` : ''}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 justify-end max-w-[420px]">
            {conditions.map((c) => <Chip key={c} tone="gray">{c}</Chip>)}
          </div>
        </div>
        {allergies.length > 0 && (
          <div className="mt-3 bg-danger-wash border border-danger rounded-lg px-3 py-2 text-[13px] font-medium text-danger">
            ⚠ Allergy: {allergies.join(', ')} — same-class drugs are blocked below, cross-reactive ones flagged.
          </div>
        )}
      </div>

      {/* Vitals */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <b className="font-disp">Vitals</b>
          <div className="flex items-center gap-2">
            {bmi && <Chip tone={bmi.level === 'warn' ? 'amber' : 'green'}>BMI {bmi.value} · {bmi.band}</Chip>}
            <span className="text-[11.5px] text-body-3">{typeof age === 'number' && age < 12 ? 'Paediatric — BP/pulse flags off' : 'Adult reference ranges'}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
          <VField label="BP" value={vitalsDraft.bp} flag={vFlags.bp} onChange={(v) => setVitalsDraft((s) => ({ ...s, bp: v }))} placeholder="120/80" />
          <VField label="Pulse" value={vitalsDraft.pulse} flag={vFlags.pulse} onChange={(v) => setVitalsDraft((s) => ({ ...s, pulse: v }))} placeholder="76" />
          <VField label="Temp °F" value={vitalsDraft.temp} flag={vFlags.temp} onChange={(v) => setVitalsDraft((s) => ({ ...s, temp: v }))} placeholder="98.6" />
          <VField label="SpO₂" value={vitalsDraft.spo2} flag={vFlags.spo2} onChange={(v) => setVitalsDraft((s) => ({ ...s, spo2: v }))} placeholder="99" />
          <VField label="Weight kg" value={vitalsDraft.weight} onChange={(v) => setVitalsDraft((s) => ({ ...s, weight: v }))} placeholder="58" />
          <VField label="Height cm" value={vitalsDraft.height} onChange={(v) => setVitalsDraft((s) => ({ ...s, height: v }))} placeholder="165" />
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
            <div>
              <div className="flex items-center justify-between">
                <span className="lbl">Advice & instructions</span>
                <button className="btn-ghost !text-[11.5px] !py-0.5" onClick={applySuggestedAdvice}>✎ Suggest for this case</button>
              </div>
              <textarea className="inp !h-20" value={consult.advice} onChange={(e) => setConsult((c) => ({ ...c, advice: e.target.value }))} />
            </div>
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
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <b className="font-disp">Prescription</b>
            {lastRx && (
              <button className="btn !py-1 !px-2 !text-[12px]" onClick={repeatLastRx}
                title={lastRx.rx.map((r) => r.drug).join(', ')}>
                ↻ Repeat last Rx ({lastRx.rx.length})
              </button>
            )}
          </div>
          <span className="text-[11.5px] text-body-3">Quantity is calculated from frequency × days — that's what pharmacy dispenses.</span>
        </div>
        <div className="relative mb-3">
          <input id="rx-search" className="inp" placeholder="Search drug to add…  ( / )" value={rxSearch} onChange={(e) => setRxSearch(e.target.value)} />
          {matchedDrugs.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-line-strong rounded-lg shadow-lg overflow-hidden max-h-[340px] overflow-y-auto">
              {matchedDrugs.map((g) => {
                const hit = checkAllergy(allergies, g.generic)
                const blocked = hit?.level === 'block'
                return (
                  <div key={g.generic} className={`border-b border-line last:border-0 ${blocked ? 'bg-danger-wash' : ''}`}>
                    <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1">
                      <span className="text-[12px] font-medium text-body-2">
                        {g.generic}<span className="text-body-3 font-normal"> · generic</span>
                      </span>
                      <span className="flex gap-1.5 items-center">
                        {blocked && <Chip tone="red">⛔ {hit.reason}</Chip>}
                        {hit?.level === 'caution' && <Chip tone="amber">⚠ cross-reactive</Chip>}
                        {!blocked && g.brandCount > 1 && <Chip tone="teal">{g.brandCount} brands in stock</Chip>}
                      </span>
                    </div>
                    {g.brands.map((b) => (
                      <button key={b.brand} disabled={blocked}
                        className={`w-full text-left pl-5 pr-3 py-1.5 text-[13px] flex items-center justify-between gap-2 ${blocked ? 'text-danger cursor-not-allowed' : 'hover:bg-[#FBFAF7]'}`}
                        onClick={() => addRxLine(b)}>
                        <span><b>{b.brand}</b></span>
                        <span className="flex gap-1.5 items-center shrink-0">
                          {b.nearExpiry && <Chip tone="amber">exp {b.expiry}</Chip>}
                          {b.lowStock && <Chip tone="red">low</Chip>}
                          <span className="font-mono text-[11.5px] text-body-3">₹{b.mrp} · qty {b.totalQty}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse min-w-[640px]">
            <thead><tr>
              <th className="th">Medicine</th><th className="th w-24">Dose</th>
              <th className="th w-36">Frequency</th><th className="th w-32">Food</th>
              <th className="th w-16">Days</th><th className="th w-20 text-right">Qty</th><th className="th w-12"></th>
            </tr></thead>
            <tbody>
              {consult.rx.map((r, i) => {
                const hit = checkAllergy(allergies, r.generic || r.drug)
                const dup = dupes.find((d) => d.index === i)
                const qty = qtyForRx(r)
                const alts = r.generic ? brandsForGeneric(stock, r.generic).filter((b) => b.brand !== r.drug) : []
                return (
                  <tr key={i} className={hit?.level === 'block' ? 'bg-danger-wash' : ''}>
                    <td className="td align-top">
                      <div className="font-medium">{r.drug}</div>
                      {r.generic && r.generic !== r.drug && <div className="text-[11.5px] text-body-3">{r.generic}</div>}
                      <div className="flex gap-1.5 flex-wrap mt-1">
                        {hit?.level === 'block' && <Chip tone="red">⛔ {hit.reason}</Chip>}
                        {hit?.level === 'caution' && <Chip tone="amber">⚠ {hit.reason}</Chip>}
                        {dup && <Chip tone="amber">⚠ {dup.reason}</Chip>}
                        {r.nearExpiry && <Chip tone="amber">near-expiry batch</Chip>}
                        {r.lowStock && <Chip tone="red">low stock</Chip>}
                        {alts.length > 0 && (
                          <button className="chip-teal hover:opacity-80" onClick={() => setBrandFor(brandFor === i ? null : i)}>
                            ⇄ {alts.length} other brand{alts.length > 1 ? 's' : ''}
                          </button>
                        )}
                      </div>
                      {brandFor === i && alts.length > 0 && (
                        <div className="mt-1.5 border border-line rounded-lg overflow-hidden bg-white">
                          {alts.map((a) => (
                            <button key={a.brand} className="w-full text-left px-2.5 py-1.5 text-[12.5px] hover:bg-[#FBFAF7] flex justify-between gap-2"
                              onClick={() => switchBrand(i, a)}>
                              <span>{a.brand}</span>
                              <span className="font-mono text-[11.5px] text-body-3">₹{a.mrp} · qty {a.totalQty}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <input className="inp !py-1 !text-[12px] mt-1.5" placeholder="Instruction for the patient (optional)"
                        value={r.instruction || ''} onChange={(e) => updateRxLine(i, { instruction: e.target.value })} />
                    </td>
                    <td className="td align-top"><input className="inp !py-1" placeholder="1 tab" value={r.dose} onChange={(e) => updateRxLine(i, { dose: e.target.value })} /></td>
                    <td className="td align-top">
                      <select className="inp !py-1" value={r.freq || ''} onChange={(e) => updateRxLine(i, { freq: e.target.value })}>
                        <option value="">Select…</option>
                        {FREQ_PRESETS.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
                      </select>
                    </td>
                    <td className="td align-top">
                      <select className="inp !py-1" value={r.food ?? ''} onChange={(e) => updateRxLine(i, { food: e.target.value })}>
                        {FOOD_PRESETS.map((f) => <option key={f.label} value={f.code}>{f.label}</option>)}
                      </select>
                    </td>
                    <td className="td align-top"><input className="inp !py-1" type="number" value={r.days} onChange={(e) => updateRxLine(i, { days: Number(e.target.value) })} /></td>
                    <td className="td align-top text-right">
                      <div className="font-mono font-semibold">{qty || '—'}</div>
                      {qty > 0 && r.batchId && (() => {
                        const have = stockOf(r.drug)
                        const left = have - qty
                        return (
                          <div className={`text-[10.5px] font-mono ${left < 0 ? 'text-danger' : 'text-body-3'}`}>
                            {left < 0 ? `short by ${Math.abs(left)}` : `${have} → ${left}`}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="td align-top"><button className="btn-ghost !text-[12px]" onClick={() => removeRxLine(i)}>✕</button></td>
                  </tr>
                )
              })}
              {consult.rx.length === 0 && <tr><td className="td text-body-3" colSpan={7}>No drugs added yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span className="lbl !mb-0">Review after</span>
          <input className="inp !w-20 !py-1 font-mono" type="number" placeholder="7" value={consult.reviewDays}
            onChange={(e) => setConsult((c) => ({ ...c, reviewDays: e.target.value }))} />
          <span className="text-[12.5px] text-body-2">days {consult.reviewDays ? `· advise return by ${new Date(Date.now() + Number(consult.reviewDays) * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : '(optional)'}</span>
        </div>
      </div>

      <div className="flex justify-between items-center gap-2.5 mb-8 flex-wrap">
        <span className="text-[11.5px] text-body-3 font-mono">Ctrl+Enter complete · Ctrl+S draft · / drug search · Esc back</span>
        <div className="flex gap-2.5 flex-wrap">
          <button className="btn" onClick={printRx}>🖨 Print</button>
          <button className="btn" disabled={busy} onClick={savePdf}>PDF</button>
          <button className="btn" disabled={busy} onClick={shareRx}>WhatsApp</button>
          <button className="btn" onClick={saveDraft}>Save draft</button>
          <button className="btn-pri" disabled={busy} onClick={attemptComplete}>Complete consult</button>
        </div>
      </div>

      {/* Pre-completion clinical checklist */}
      <Modal
        open={!!review}
        title={review?.blockers?.length ? 'Cannot complete — safety check failed' : 'Confirm before completing'}
        onClose={() => setReview(null)}
        footer={review?.blockers?.length ? (
          <button className="btn-pri" onClick={() => setReview(null)}>Back to consult</button>
        ) : (<>
          <button className="btn" onClick={() => setReview(null)}>Back to consult</button>
          <button className="btn-pri" disabled={busy} onClick={doComplete}>Complete anyway</button>
        </>)}
      >
        {review?.blockers?.length > 0 && (
          <div className="mb-3">
            <b className="text-[13px] text-danger block mb-1.5">Must be resolved</b>
            <ul className="list-disc ml-5 text-[13px] text-danger grid gap-1">
              {review.blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        )}
        {review?.warnings?.length > 0 && (
          <div>
            <b className="text-[13px] text-caution block mb-1.5">Please confirm</b>
            <ul className="list-disc ml-5 text-[13px] text-body-2 grid gap-1">
              {review.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
        <p className="text-[12px] text-body-3 mt-3">
          Class-aware allergy checking covers common drug families and documented cross-reactivity. It supports, not replaces, your clinical judgement.
        </p>
      </Modal>
    </div>
  )
}
