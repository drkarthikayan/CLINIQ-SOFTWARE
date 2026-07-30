import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../store/authStore'
import { Chip, Stat, Modal } from '../components/ui'
import {
  searchByMobile, getPatient, getPatientVisits, updatePatient,
  ageFrom, normalizeMobile,
} from '../services/patients.service'
import { flagVitals } from '../services/clinical.service'
import { getTenantSettings } from '../services/settings.service'
import { openRxPrint, downloadRxPdf, shareRxPdf } from '../lib/rxSheet'

const toMillis = (t) => {
  if (!t) return 0
  if (typeof t === 'string') return new Date(t).getTime()
  if (typeof t?.toMillis === 'function') return t.toMillis()
  if (t?.seconds != null) return t.seconds * 1000
  return 0
}
const dateStr = (t) => (toMillis(t) ? new Date(toMillis(t)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const monthsAgo = (t) => {
  const ms = toMillis(t); if (!ms) return ''
  const d = Math.round((Date.now() - ms) / 86400000)
  if (d < 1) return 'today'
  if (d < 30) return `${d}d ago`
  if (d < 365) return `${Math.round(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

export default function History() {
  const user = useAuth((s) => s.user)
  const location = useLocation()
  const [phone, setPhone] = useState('')
  const [family, setFamily] = useState(null)
  const [patient, setPatient] = useState(null)
  const [visits, setVisits] = useState([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('timeline')
  const [editing, setEditing] = useState(null)   // { kind: 'allergies'|'conditions', draft: [], input: '' }
  const [settings, setSettings] = useState(null)
  const [busyVisit, setBusyVisit] = useState(null)
  const [toastMsg, setToastMsg] = useState('')

  useEffect(() => { getTenantSettings(user.tenantId).then(setSettings) }, [user.tenantId])

  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3000) }

  const loadPatient = async (p) => {
    setPatient(p); setLoading(true); setTab('timeline')
    setVisits(await getPatientVisits(user.tenantId, p.id))
    setLoading(false)
  }

  useEffect(() => {
    const pid = location.state?.patientId
    if (!pid) return
    getPatient(user.tenantId, pid).then((p) => { if (p) loadPatient(p) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.patientId])

  const onPhone = async (v) => {
    setPhone(v); setPatient(null); setVisits([])
    setFamily(normalizeMobile(v).length >= 10 ? await searchByMobile(user.tenantId, v) : null)
  }

  /* -------- derived clinical views -------- */
  const withVitals = useMemo(
    () => visits.filter((v) => (v.vitalsDoctor?.bp || v.vitals?.bp || v.vitalsDoctor?.weight || v.vitals?.weight))
      .map((v) => ({ ...v, v: { ...(v.vitals || {}), ...(v.vitalsDoctor || {}) } })),
    [visits],
  )
  const medHistory = useMemo(() => {
    const m = new Map()
    visits.forEach((v) => (v.consult?.rx || []).forEach((r) => {
      const k = r.drug
      const prev = m.get(k)
      if (!prev || toMillis(v.createdAt) > toMillis(prev.last)) m.set(k, { drug: k, last: v.createdAt, times: (prev?.times || 0) + 1 })
      else m.set(k, { ...prev, times: prev.times + 1 })
    }))
    return [...m.values()].sort((a, b) => toMillis(b.last) - toMillis(a.last))
  }, [visits])
  const dxHistory = useMemo(() => {
    const m = new Map()
    visits.forEach((v) => { const d = v.consult?.dx || v.consult?.a; if (d) m.set(d, (m.get(d) || 0) + 1) })
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [visits])

  /* -------- reprint a past consultation --------
     A completed visit leaves the queue, so the only place to re-issue its
     prescription is here. Rebuild the same payload the consult screen used. */
  const payloadFor = (v) => ({
    clinic: { name: settings?.name || user.tenantName || user.tenantId, city: settings?.city, ...(settings?.letterhead || {}) },
    doctor: { name: v.doctor || user.name, qualification: settings?.letterhead?.doctorQualification, regNo: settings?.letterhead?.doctorRegNo },
    patient,
    visit: { ...v, age: ageFrom(patient?.dob), sex: patient?.sex },
    consult: v.consult || {},
    lang: settings?.letterhead?.rxLang || '',
    mobile: patient?.mobile,
  })
  const reprint = (v) => { if (!openRxPrint(payloadFor(v))) toast('Allow pop-ups to print') }
  const rePdf = async (v) => {
    if (busyVisit) return
    setBusyVisit(v.id)
    try { await downloadRxPdf(payloadFor(v)); toast('Prescription PDF saved') }
    catch { toast('Could not generate the PDF') }
    finally { setBusyVisit(null) }
  }
  const reShare = async (v) => {
    if (busyVisit) return
    if (!patient?.mobile) { toast('No mobile number on this patient record'); return }
    setBusyVisit(v.id)
    try {
      const { mode } = await shareRxPdf(payloadFor(v))
      if (mode === 'downloaded') toast('PDF downloaded · attach it in the WhatsApp chat that just opened')
      else if (mode === 'shared') toast('Prescription shared')
    } catch { toast('Could not share the prescription') }
    finally { setBusyVisit(null) }
  }

  /* -------- allergy / condition editing -------- */
  const openEdit = (kind) => setEditing({ kind, draft: [...(patient?.[kind] || [])], input: '' })
  const addChip = () => {
    const val = editing.input.trim()
    if (!val) return
    setEditing((e) => ({ ...e, draft: [...e.draft, val], input: '' }))
  }
  const saveEdit = async () => {
    await updatePatient(user.tenantId, patient.id, { [editing.kind]: editing.draft })
    setPatient((p) => ({ ...p, [editing.kind]: editing.draft }))
    toast(`${editing.kind === 'allergies' ? 'Allergies' : 'Conditions'} updated`)
    setEditing(null)
  }

  const TABS = [['timeline', `Visits (${visits.length})`], ['vitals', 'Vitals trend'], ['meds', `Medications (${medHistory.length})`]]

  return (
    <div>
      <div className="card p-4 mb-4">
        <label className="lbl">Find patient history by mobile number</label>
        <input className="inp !w-auto min-w-[240px] font-mono !text-[14px] !py-2.5"
          placeholder="98400 12345" value={phone} onChange={(e) => onPhone(e.target.value)} />
        {family && (
          <div className="flex gap-2.5 mt-3 flex-wrap">
            {family.map((p) => (
              <button key={p.id} onClick={() => loadPatient(p)}
                className={`text-left bg-white border rounded-[10px] px-3.5 py-2.5 min-w-[150px] hover:border-teal hover:bg-teal-wash transition-colors ${patient?.id === p.id ? 'border-teal border-2 bg-teal-wash' : 'border-line-strong'}`}>
                <b className="block text-[14px]">{p.name}</b>
                <small className="font-mono text-body-2 text-[12px]">{ageFrom(p.dob)} {p.sex}{p.mrn ? ` · ${p.mrn}` : ''}</small>
                <div className="mt-1.5 flex gap-1 flex-wrap">
                  <Chip tone={p.relation === 'Self' ? 'teal' : 'gray'}>{p.relation}</Chip>
                  {p.allergies?.length > 0 && <Chip tone="red">⚠ {p.allergies[0].split(' ')[0]}</Chip>}
                </div>
              </button>
            ))}
          </div>
        )}
        {family && family.length === 0 && <p className="text-[12px] text-body-3 mt-2.5">No patient found with this number.</p>}
      </div>

      {patient && (
        <div id="history-print">
          {/* Patient header */}
          <div className="card p-4 mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-disp text-[19px] font-semibold">{patient.name}</div>
                <div className="text-body-2 text-[13px]">
                  {ageFrom(patient.dob)} yrs · {patient.sex} · {patient.relation || 'Self'}{patient.mrn ? ` · MRN ${patient.mrn}` : ''} · {normalizeMobile(patient.mobile)}
                </div>
              </div>
              <button className="btn no-print" onClick={() => window.print()}>Print / PDF</button>
            </div>

            {/* Allergies — editable, because this drives the prescribing block */}
            <div className={`mt-3 rounded-lg px-3 py-2.5 border ${patient.allergies?.length ? 'bg-danger-wash border-danger' : 'bg-[#FBFAF7] border-line'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <b className={`text-[13px] ${patient.allergies?.length ? 'text-danger' : 'text-body-2'}`}>
                    {patient.allergies?.length ? '⚠ Allergies' : 'No known allergies'}
                  </b>
                  {(patient.allergies || []).map((a) => <Chip key={a} tone="red">{a}</Chip>)}
                </div>
                <button className="btn-ghost !text-[12px] no-print" onClick={() => openEdit('allergies')}>Edit</button>
              </div>
              {patient.allergies?.length > 0 && (
                <p className="text-[11.5px] text-danger mt-1.5">Same-class drugs are blocked at prescribing; cross-reactive ones are flagged.</p>
              )}
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex gap-1.5 flex-wrap items-center">
                <span className="text-[12px] text-body-3">Conditions:</span>
                {(patient.conditions || []).map((c) => <Chip key={c} tone="gray">{c}</Chip>)}
                {!(patient.conditions || []).length && <span className="text-[12.5px] text-body-3">none recorded</span>}
              </div>
              <button className="btn-ghost !text-[12px] no-print" onClick={() => openEdit('conditions')}>Edit</button>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
            <Stat k="Total visits" v={visits.length} />
            <Stat k="Last visit" v={visits.length ? monthsAgo(visits[0].createdAt) : '—'} />
            <Stat k="Distinct diagnoses" v={dxHistory.length} />
            <Stat k="Medicines used" v={medHistory.length} />
          </div>

          <div className="flex bg-[#F0EFEA] rounded-lg p-0.5 mb-4 w-fit no-print">
            {TABS.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3.5 py-1.5 rounded-md text-[12.5px] ${tab === k ? 'bg-white shadow-sm font-medium' : 'text-body-2'}`}>{label}</button>
            ))}
          </div>

          {tab === 'timeline' && (
            <div className="card overflow-hidden">
              <div className="flex justify-between items-center px-4 py-3.5 border-b border-line">
                <b className="font-disp">Visit timeline</b>
                <span className="text-[12px] text-body-3">{visits.length} visit{visits.length === 1 ? '' : 's'}</span>
              </div>
              <div className="divide-y divide-line">
                {loading && <div className="px-4 py-6 text-body-3 text-[13px]">Loading…</div>}
                {!loading && visits.length === 0 && <div className="px-4 py-8 text-center text-body-3 text-[13px]">No visits recorded yet.</div>}
                {!loading && visits.map((v) => {
                  const c = v.consult || {}
                  return (
                    <div key={v.id} className="px-4 py-3.5 hover:bg-[#FBFAF7]">
                      <div className="flex justify-between items-center mb-1.5 flex-wrap gap-1">
                        <div className="flex items-center gap-2">
                          <b className="font-mono text-[13px]">{dateStr(v.createdAt || v.completedAt)}</b>
                          <span className="text-[11.5px] text-body-3">{monthsAgo(v.createdAt || v.completedAt)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] text-body-3">{v.doctor}{v.token ? ` · ${v.token}` : ''}</span>
                          {v.consult?.rx?.length > 0 && (
                            <span className="flex gap-1 no-print">
                              <button className="btn-ghost !text-[11.5px] !px-1.5 !py-0.5" onClick={() => reprint(v)}>Print</button>
                              <button className="btn-ghost !text-[11.5px] !px-1.5 !py-0.5" disabled={busyVisit === v.id} onClick={() => rePdf(v)}>PDF</button>
                              <button className="btn-ghost !text-[11.5px] !px-1.5 !py-0.5" disabled={busyVisit === v.id} onClick={() => reShare(v)}>WhatsApp</button>
                            </span>
                          )}
                        </div>
                      </div>
                      {v.complaint && <div className="text-[13px] mb-1"><span className="text-body-3">Complaint: </span>{v.complaint}</div>}
                      {(c.dx || c.a) && <div className="text-[13px] mb-1"><span className="text-body-3">Diagnosis: </span><b>{c.dx || c.a}</b></div>}
                      {(c.labs?.length > 0 || c.labsCustom) && (
                        <div className="flex gap-1.5 flex-wrap my-1.5">
                          {(c.labs || []).map((l) => <Chip key={l} tone="teal">{l}</Chip>)}
                          {c.labsCustom && <Chip tone="gray">{c.labsCustom}</Chip>}
                        </div>
                      )}
                      {c.rx?.length > 0 && (
                        <ul className="text-[13px] mt-1 ml-4 list-disc text-body-2">
                          {c.rx.map((r, i) => (
                            <li key={i}><b className="text-body">{r.drug}</b>{r.dose ? ` · ${r.dose}` : ''}{r.freq ? ` · ${r.freq}` : ''}{r.days ? ` · ${r.days}d` : ''}</li>
                          ))}
                        </ul>
                      )}
                      {c.advice && <div className="text-[13px] mt-1.5 text-body-2"><span className="text-body-3">Advice: </span>{c.advice}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {tab === 'vitals' && (
            <div className="card overflow-hidden">
              <div className="flex justify-between items-center px-4 py-3.5 border-b border-line">
                <b className="font-disp">Vitals across visits</b>
                <span className="text-[12px] text-body-3">newest first · abnormal values highlighted</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] border-collapse min-w-[600px]">
                  <thead><tr>
                    <th className="th w-32">Date</th><th className="th">BP</th><th className="th">Pulse</th>
                    <th className="th">Temp °F</th><th className="th">SpO₂</th><th className="th">Weight</th>
                  </tr></thead>
                  <tbody>
                    {withVitals.map((row) => {
                      const f = flagVitals(row.v, ageFrom(patient.dob))
                      const cell = (key, val, suffix = '') => (
                        <td className={`td font-mono ${f[key] ? (f[key].level === 'high' ? 'text-danger font-semibold' : 'text-caution font-medium') : ''}`}>
                          {val ? `${val}${suffix}` : '—'}
                        </td>
                      )
                      return (
                        <tr key={row.id} className="hover:bg-[#FBFAF7]">
                          <td className="td font-mono text-body-2">{dateStr(row.createdAt)}</td>
                          {cell('bp', row.v.bp)}{cell('pulse', row.v.pulse)}{cell('temp', row.v.temp)}{cell('spo2', row.v.spo2, '%')}
                          <td className="td font-mono">{row.v.weight ? `${row.v.weight} kg` : '—'}</td>
                        </tr>
                      )
                    })}
                    {withVitals.length === 0 && <tr><td className="td text-center text-body-3 py-8" colSpan={6}>No vitals recorded in any visit yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'meds' && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="card overflow-hidden">
                <div className="px-4 py-3.5 border-b border-line"><b className="font-disp">Medications previously prescribed</b></div>
                <table className="w-full text-[13px] border-collapse">
                  <tbody>
                    {medHistory.map((m) => (
                      <tr key={m.drug} className="border-b border-line">
                        <td className="td"><b>{m.drug}</b></td>
                        <td className="td w-24 text-body-2 text-[12px]">×{m.times}</td>
                        <td className="td w-28 font-mono text-body-2 text-[12px]">{monthsAgo(m.last)}</td>
                      </tr>
                    ))}
                    {medHistory.length === 0 && <tr><td className="td text-body-3 py-6 text-center">No medicines prescribed yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="card overflow-hidden">
                <div className="px-4 py-3.5 border-b border-line"><b className="font-disp">Recurring diagnoses</b></div>
                <table className="w-full text-[13px] border-collapse">
                  <tbody>
                    {dxHistory.map(([dx, n]) => (
                      <tr key={dx} className="border-b border-line"><td className="td">{dx}</td><td className="td w-20 text-body-2 text-[12px]">×{n}</td></tr>
                    ))}
                    {dxHistory.length === 0 && <tr><td className="td text-body-3 py-6 text-center">No diagnoses recorded yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Allergy / condition editor */}
      <Modal
        open={!!editing}
        title={editing?.kind === 'allergies' ? 'Record allergies' : 'Record conditions'}
        onClose={() => setEditing(null)}
        footer={<>
          <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn-pri" onClick={saveEdit}>Save</button>
        </>}
      >
        {editing && (
          <div>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {editing.draft.map((d, i) => (
                <span key={i} className={editing.kind === 'allergies' ? 'chip-red' : 'chip-gray'}>
                  {d}
                  <button className="ml-1 font-bold" onClick={() => setEditing((e) => ({ ...e, draft: e.draft.filter((_, idx) => idx !== i) }))}>✕</button>
                </span>
              ))}
              {editing.draft.length === 0 && <span className="text-[12.5px] text-body-3">Nothing recorded yet.</span>}
            </div>
            <div className="flex gap-2">
              <input className="inp" autoFocus
                placeholder={editing.kind === 'allergies' ? 'e.g. Penicillin (rash, 2021)' : 'e.g. Hypothyroidism (2023)'}
                value={editing.input}
                onChange={(e) => setEditing((s) => ({ ...s, input: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChip() } }} />
              <button className="btn" onClick={addChip}>Add</button>
            </div>
            {editing.kind === 'allergies' && (
              <p className="text-[12px] text-body-3 mt-3">
                Name the drug or class (e.g. “Penicillin”, “Sulfa”, “Ibuprofen”). Prescribing that drug — or another in the same class — is then blocked in consult.
              </p>
            )}
          </div>
        )}
      </Modal>

      {toastMsg && <div className="fixed bottom-6 right-6 bg-ink text-white px-5 py-3 rounded-[10px] text-[13px] z-50 shadow-xl">{toastMsg}</div>}
    </div>
  )
}
