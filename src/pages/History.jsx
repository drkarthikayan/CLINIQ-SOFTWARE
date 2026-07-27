import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../store/authStore'
import { Chip } from '../components/ui'
import { searchByMobile, getPatient, getPatientVisits, ageFrom, normalizeMobile } from '../services/patients.service'

const dateStr = (t) => {
  const ms = typeof t === 'string' ? new Date(t).getTime()
    : typeof t?.toMillis === 'function' ? t.toMillis()
    : t?.seconds != null ? t.seconds * 1000 : 0
  return ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

export default function History() {
  const user = useAuth((s) => s.user)
  const location = useLocation()
  const [phone, setPhone] = useState('')
  const [family, setFamily] = useState(null)
  const [patient, setPatient] = useState(null)
  const [visits, setVisits] = useState([])
  const [loading, setLoading] = useState(false)

  const loadPatient = async (p) => {
    setPatient(p)
    setLoading(true)
    setVisits(await getPatientVisits(user.tenantId, p.id))
    setLoading(false)
  }

  // Deep-link: /history with { state: { patientId } } from another page.
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

  return (
    <div>
      <div className="card p-4 mb-4">
        <label className="lbl">Find patient history by mobile number</label>
        <input
          className="inp !w-auto min-w-[240px] font-mono !text-[14px] !py-2.5"
          placeholder="98400 12345" value={phone} onChange={(e) => onPhone(e.target.value)}
        />
        {family && (
          <div className="flex gap-2.5 mt-3 flex-wrap">
            {family.map((p) => (
              <button key={p.id} onClick={() => loadPatient(p)}
                className={`text-left bg-white border rounded-[10px] px-3.5 py-2.5 min-w-[150px] hover:border-teal hover:bg-teal-wash ${patient?.id === p.id ? 'border-teal border-2 bg-teal-wash' : 'border-line-strong'}`}>
                <b className="block text-[14px]">{p.name}</b>
                <small className="font-mono text-body-2 text-[12px]">{ageFrom(p.dob)} {p.sex} · {p.mrn || '—'}</small>
                <div className="mt-1.5 flex gap-1 flex-wrap">
                  <Chip tone={p.relation === 'Self' ? 'teal' : 'gray'}>{p.relation}</Chip>
                  {p.allergies?.length > 0 && <Chip tone="red">⚠ {p.allergies[0].split(' ')[0]}</Chip>}
                </div>
              </button>
            ))}
          </div>
        )}
        {family && family.length === 0 && (
          <p className="text-[12px] text-body-3 mt-2.5">No patient found with this number.</p>
        )}
      </div>

      {patient && (
        <div id="history-print">
          <div className="card p-4 mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-disp text-[18px] font-semibold">{patient.name}</div>
              <div className="text-body-2 text-[13px]">
                {ageFrom(patient.dob)} yrs · {patient.sex} · {patient.relation || 'Self'}{patient.mrn ? ` · MRN ${patient.mrn}` : ''} · {normalizeMobile(patient.mobile)}
              </div>
              <div className="flex gap-1.5 flex-wrap mt-2">
                {(patient.conditions || []).map((c) => <Chip key={c} tone="gray">{c}</Chip>)}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button className="btn no-print" onClick={() => window.print()}>Print / PDF</button>
              {patient.allergies?.length > 0 && (
                <div className="bg-danger-wash border border-danger rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-danger">
                  ⚠ Allergy: {patient.allergies.join(', ')}
                </div>
              )}
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3.5 border-b border-line">
              <b className="font-disp">Visit timeline</b>
              <span className="text-[12px] text-body-3">{visits.length} visit{visits.length === 1 ? '' : 's'}</span>
            </div>
            <div className="divide-y divide-line">
              {loading && <div className="px-4 py-6 text-body-3 text-[13px]">Loading…</div>}
              {!loading && visits.length === 0 && (
                <div className="px-4 py-6 text-body-3 text-[13px]">No visits recorded yet.</div>
              )}
              {!loading && visits.map((v) => {
                const c = v.consult || {}
                return (
                  <div key={v.id} className="px-4 py-3.5">
                    <div className="flex justify-between items-center mb-1.5 flex-wrap gap-1">
                      <b className="font-mono text-[13px]">{dateStr(v.createdAt || v.completedAt)}</b>
                      <span className="text-[12px] text-body-3">{v.doctor} · {v.status || 'completed'}</span>
                    </div>
                    {v.complaint && <div className="text-[13px] mb-1"><span className="text-body-3">Complaint: </span>{v.complaint}</div>}
                    {c.dx && <div className="text-[13px] mb-1"><span className="text-body-3">Diagnosis: </span><b>{c.dx}</b></div>}
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
        </div>
      )}
    </div>
  )
}
