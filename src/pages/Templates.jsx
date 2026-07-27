import { useEffect, useState } from 'react'
import { useAuth } from '../store/authStore'
import { Chip, Modal } from '../components/ui'
import { listTemplates, saveTemplate, updateTemplate, deleteTemplate } from '../services/visits.service'

const BLANK = { name: '', mode: 'quick', complaint: '', dx: '', advice: '', labs: [], rx: [] }
const BLANK_RX = { drug: '', dose: '', freq: '', days: 3 }

export default function Templates() {
  const user = useAuth((s) => s.user)
  const [templates, setTemplates] = useState([])
  const [editing, setEditing] = useState(null)   // template being edited (or new)
  const [toastMsg, setToastMsg] = useState('')

  const reload = () => listTemplates(user.tenantId).then(setTemplates)
  useEffect(() => { reload() }, [user.tenantId]) // eslint-disable-line react-hooks/exhaustive-deps
  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3000) }

  const openNew = () => setEditing({ ...BLANK, rx: [] })
  const openEdit = (t) => setEditing({ ...BLANK, ...t, rx: (t.rx || []).map((r) => ({ ...r })) })

  const setField = (k, v) => setEditing((e) => ({ ...e, [k]: v }))
  const setRx = (i, patch) => setEditing((e) => ({ ...e, rx: e.rx.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }))
  const addRx = () => setEditing((e) => ({ ...e, rx: [...e.rx, { ...BLANK_RX }] }))
  const removeRx = (i) => setEditing((e) => ({ ...e, rx: e.rx.filter((_, idx) => idx !== i) }))

  const save = async () => {
    if (!editing.name.trim()) { toast('Template name is required'); return }
    const payload = {
      name: editing.name.trim(), mode: editing.mode, complaint: editing.complaint,
      dx: editing.dx, advice: editing.advice, labs: editing.labs || [],
      rx: (editing.rx || []).filter((r) => r.drug.trim()),
    }
    if (editing.id) await updateTemplate(user.tenantId, editing.id, payload)
    else await saveTemplate(user.tenantId, payload)
    setEditing(null); reload()
    toast(editing.id ? 'Template updated' : 'Template created')
  }

  const remove = async (t) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return
    await deleteTemplate(user.tenantId, t.id); reload(); toast('Template deleted')
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-[13px] text-body-2 max-w-[520px]">Reusable consult templates — complaint, diagnosis, advice, labs and Rx. Apply and edit them from the consult screen; “Save as template” there also lands here.</p>
        <button className="btn-pri" onClick={openNew}>+ New template</button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {templates.map((t) => (
          <div key={t.id} className="card p-4">
            <div className="flex justify-between items-start gap-2 mb-2">
              <b className="font-disp text-[14.5px]">{t.name}</b>
              <div className="flex gap-1.5 items-center">
                <Chip tone="gray">{t.mode === 'soap' ? 'SOAP' : 'Quick'}</Chip>
                {t.useCount > 0 && <span className="text-[11.5px] text-body-3 font-mono">×{t.useCount}</span>}
              </div>
            </div>
            {t.dx && <div className="text-[13px] mb-1"><span className="text-body-3">Dx: </span>{t.dx}</div>}
            {t.complaint && <div className="text-[12.5px] text-body-2 mb-1.5 line-clamp-2">{t.complaint}</div>}
            {t.rx?.length > 0 && (
              <div className="text-[12px] text-body-2">{t.rx.map((r) => r.drug).join(' · ')}</div>
            )}
            <div className="flex gap-1.5 mt-3">
              <button className="btn !py-1 !text-[12px]" onClick={() => openEdit(t)}>Edit</button>
              <button className="btn-ghost !py-1 !text-[12px]" onClick={() => remove(t)}>Delete</button>
            </div>
          </div>
        ))}
        {templates.length === 0 && (
          <div className="card p-8 text-center text-body-3 text-[13px] md:col-span-2">No templates yet. Create one, or save a completed consult as a template.</div>
        )}
      </div>

      <Modal open={!!editing} title={editing?.id ? 'Edit template' : 'New template'} width="max-w-[640px]"
        onClose={() => setEditing(null)}
        footer={<>
          <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn-pri" onClick={save}>{editing?.id ? 'Save changes' : 'Create'}</button>
        </>}>
        {editing && (
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><label className="lbl">Name</label>
                <input className="inp" value={editing.name} onChange={(e) => setField('name', e.target.value)} /></div>
              <div><label className="lbl">Mode</label>
                <select className="inp" value={editing.mode} onChange={(e) => setField('mode', e.target.value)}>
                  <option value="quick">Quick</option><option value="soap">SOAP</option>
                </select></div>
            </div>
            <div><label className="lbl">Complaint</label>
              <textarea className="inp !h-16" value={editing.complaint} onChange={(e) => setField('complaint', e.target.value)} /></div>
            <div><label className="lbl">Diagnosis</label>
              <input className="inp" value={editing.dx} onChange={(e) => setField('dx', e.target.value)} /></div>
            <div><label className="lbl">Advice</label>
              <textarea className="inp !h-16" value={editing.advice} onChange={(e) => setField('advice', e.target.value)} /></div>
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="lbl !mb-0">Prescription</span>
                <button className="btn-ghost !text-[12px]" onClick={addRx}>+ Add drug</button>
              </div>
              {editing.rx.map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-1.5 mb-1.5">
                  <input className="inp !py-1 col-span-4" placeholder="Drug" value={r.drug} onChange={(e) => setRx(i, { drug: e.target.value })} />
                  <input className="inp !py-1 col-span-3" placeholder="Dose" value={r.dose} onChange={(e) => setRx(i, { dose: e.target.value })} />
                  <input className="inp !py-1 col-span-3" placeholder="Freq" value={r.freq} onChange={(e) => setRx(i, { freq: e.target.value })} />
                  <input className="inp !py-1 col-span-1 font-mono" type="number" value={r.days} onChange={(e) => setRx(i, { days: Number(e.target.value) })} />
                  <button className="btn-ghost !text-[12px] col-span-1" onClick={() => removeRx(i)}>✕</button>
                </div>
              ))}
              {editing.rx.length === 0 && <div className="text-[12px] text-body-3">No drugs. Add rows as needed.</div>}
            </div>
          </div>
        )}
      </Modal>

      {toastMsg && (
        <div className="fixed bottom-6 right-6 bg-ink text-white px-5 py-3 rounded-[10px] text-[13px] z-50 shadow-xl">{toastMsg}</div>
      )}
    </div>
  )
}
