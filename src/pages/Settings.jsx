import { useEffect, useState } from 'react'
import { useAuth } from '../store/authStore'
import { getTenantSettings, saveTenantSettings } from '../services/settings.service'
import { getPriceList, savePriceList } from '../services/billing.service'

const MODULE_INFO = [
  ['pharmacy', 'Pharmacy & stock', 'FEFO stock register, drug search in consult, dispense decrement.'],
  ['frontDeskVitals', 'Front-desk vitals', 'Let the staff nurse record vitals at check-in.'],
  ['sms', 'SMS notifications', 'Token and appointment SMS to patients (needs a gateway).'],
  ['abha', 'ABHA / ABDM', 'Link patients to their ABHA health ID.'],
]

const rupee = (n) => '₹' + (n ?? 0).toLocaleString('en-IN')

function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick}
      className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${on ? 'bg-teal' : 'bg-line-strong'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

export default function Settings() {
  const user = useAuth((s) => s.user)
  const [tenant, setTenant] = useState(null)
  const [prices, setPrices] = useState([])
  const [newPrice, setNewPrice] = useState({ label: '', amount: '' })
  const [toastMsg, setToastMsg] = useState('')

  useEffect(() => {
    getTenantSettings(user.tenantId).then(setTenant)
    getPriceList(user.tenantId).then(setPrices)
  }, [user.tenantId])

  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3000) }

  const toggleModule = async (key) => {
    const modules = { ...tenant.modules, [key]: !tenant.modules[key] }
    setTenant((t) => ({ ...t, modules }))
    await saveTenantSettings(user.tenantId, { modules })
    toast(`${key} ${modules[key] ? 'enabled' : 'disabled'}`)
  }

  const saveClinic = async () => {
    await saveTenantSettings(user.tenantId, { name: tenant.name, city: tenant.city })
    toast('Clinic details saved')
  }

  const setLetter = (k, v) => setTenant((t) => ({ ...t, letterhead: { ...(t.letterhead || {}), [k]: v } }))
  const saveLetterhead = async () => {
    await saveTenantSettings(user.tenantId, { letterhead: tenant.letterhead })
    toast('Letterhead saved')
  }

  const commitPrices = async (list) => { setPrices(list); await savePriceList(user.tenantId, list) }
  const addPrice = async () => {
    const amount = Number(newPrice.amount)
    if (!newPrice.label.trim() || !amount) { toast('Enter a label and amount'); return }
    await commitPrices([...prices, { label: newPrice.label.trim(), amount }])
    setNewPrice({ label: '', amount: '' }); toast('Price added')
  }
  const removePrice = async (i) => { await commitPrices(prices.filter((_, idx) => idx !== i)); toast('Price removed') }

  if (!tenant) return <div className="card p-8 text-body-3 text-[13px]">Loading settings…</div>

  return (
    <div className="grid gap-4 max-w-[760px]">
      {/* Clinic */}
      <div className="card p-4">
        <b className="font-disp block mb-3">Clinic details</b>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Clinic name</label>
            <input className="inp" value={tenant.name || ''} onChange={(e) => setTenant((t) => ({ ...t, name: e.target.value }))} /></div>
          <div><label className="lbl">City</label>
            <input className="inp" value={tenant.city || ''} onChange={(e) => setTenant((t) => ({ ...t, city: e.target.value }))} /></div>
        </div>
        <div className="flex justify-end mt-3"><button className="btn-pri" onClick={saveClinic}>Save</button></div>
      </div>

      {/* Prescription letterhead */}
      <div className="card p-4">
        <b className="font-disp block mb-1">Prescription letterhead</b>
        <p className="text-[12px] text-body-3 mb-3">Printed at the top of every prescription. Registration numbers are a legal requirement on an Indian Rx.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="lbl">Clinic logo URL (optional)</label>
            <input className="inp" placeholder="https://…/logo.png" value={tenant.letterhead?.logoUrl || ''} onChange={(e) => setLetter('logoUrl', e.target.value)} /></div>
          <div className="col-span-2"><label className="lbl">Clinic address</label>
            <input className="inp" placeholder="12 Anna Salai" value={tenant.letterhead?.address || ''} onChange={(e) => setLetter('address', e.target.value)} /></div>
          <div><label className="lbl">Clinic phone</label>
            <input className="inp font-mono" placeholder="044 4000 1234" value={tenant.letterhead?.phone || ''} onChange={(e) => setLetter('phone', e.target.value)} /></div>
          <div><label className="lbl">Clinic registration no.</label>
            <input className="inp font-mono" placeholder="TN/CLQ/2026/114" value={tenant.letterhead?.regNo || ''} onChange={(e) => setLetter('regNo', e.target.value)} /></div>
          <div><label className="lbl">Doctor qualification</label>
            <input className="inp" placeholder="MBBS, MD (Gen. Med.)" value={tenant.letterhead?.doctorQualification || ''} onChange={(e) => setLetter('doctorQualification', e.target.value)} /></div>
          <div><label className="lbl">Medical council reg. no.</label>
            <input className="inp font-mono" placeholder="TNMC 78421" value={tenant.letterhead?.doctorRegNo || ''} onChange={(e) => setLetter('doctorRegNo', e.target.value)} /></div>
          <div className="col-span-2"><label className="lbl">Dosage instructions language</label>
            <select className="inp !w-auto" value={tenant.letterhead?.rxLang || ''} onChange={(e) => setLetter('rxLang', e.target.value)}>
              <option value="">English only</option>
              <option value="ta">English + தமிழ்</option>
              <option value="hi">English + हिन्दी</option>
            </select>
            <p className="text-[11.5px] text-body-3 mt-1">Adds a local-language timing line under each medicine. The English instruction always stays — check the printed sheet before handing it over.</p>
          </div>
        </div>
        <div className="flex justify-end mt-3"><button className="btn-pri" onClick={saveLetterhead}>Save letterhead</button></div>
      </div>

      {/* Modules */}
      <div className="card p-4">
        <b className="font-disp block mb-3">Modules</b>
        <div className="divide-y divide-line">
          {MODULE_INFO.map(([key, label, desc]) => (
            <div key={key} className="flex items-center justify-between gap-4 py-2.5">
              <div>
                <div className="text-[13.5px] font-medium">{label}</div>
                <div className="text-[12px] text-body-3">{desc}</div>
              </div>
              <Toggle on={!!tenant.modules?.[key]} onClick={() => toggleModule(key)} />
            </div>
          ))}
        </div>
      </div>

      {/* Price list */}
      <div className="card p-4">
        <b className="font-disp block mb-3">Billing price list</b>
        <p className="text-[12px] text-body-3 mb-3">Drives the consultation fee and lab charges auto-added to invoices, and the quick-add buttons in Billing.</p>
        <table className="w-full text-[13px] border-collapse mb-3">
          <tbody>
            {prices.map((p, i) => (
              <tr key={i} className="border-b border-line">
                <td className="td">{p.label}</td>
                <td className="td w-24 text-right font-mono">{rupee(p.amount)}</td>
                <td className="td w-16"><button className="btn-ghost !text-[12px]" onClick={() => removePrice(i)}>Remove</button></td>
              </tr>
            ))}
            {prices.length === 0 && <tr><td className="td text-body-3" colSpan={3}>No price items yet.</td></tr>}
          </tbody>
        </table>
        <div className="flex gap-2.5 flex-wrap items-end">
          <div className="flex-1 min-w-[200px]"><label className="lbl">Item</label>
            <input className="inp" placeholder="e.g. Nebulization" value={newPrice.label} onChange={(e) => setNewPrice((s) => ({ ...s, label: e.target.value }))} /></div>
          <div className="w-28"><label className="lbl">Amount ₹</label>
            <input className="inp font-mono" type="number" value={newPrice.amount} onChange={(e) => setNewPrice((s) => ({ ...s, amount: e.target.value }))} /></div>
          <button className="btn-pri" onClick={addPrice}>Add</button>
        </div>
      </div>

      {toastMsg && (
        <div className="fixed bottom-6 right-6 bg-ink text-white px-5 py-3 rounded-[10px] text-[13px] z-50 shadow-xl">{toastMsg}</div>
      )}
    </div>
  )
}
