import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../store/authStore'
import { Chip, Stat } from '../components/ui'
import {
  listTenants, createTenant, updateTenantMeta, seedStockItem, seedPatient, savePriceList,
  PLANS, PLAN_PRICE,
} from '../services/admin.service'
import { getPriceList } from '../services/billing.service'

const EMPTY_STOCK = { drug: '', batch: '', expiry: '', qty: '', mrp: '' }
const EMPTY_PATIENT = { name: '', mobile: '', dob: '', sex: 'F', relation: 'Self', allergies: '', conditions: '' }
const EMPTY_STAFF = { email: '', password: '', name: '', role: 'doctor' }
const ROLES = ['admin', 'doctor', 'nurse', 'frontdesk']
const TABS = [['overview', 'Overview'], ['clinics', 'Clinics'], ['provision', 'Provision']]
const rupee = (n) => '₹' + (n ?? 0).toLocaleString('en-IN')
const dateStr = (t) => {
  const ms = typeof t === 'string' ? new Date(t).getTime() : typeof t?.toMillis === 'function' ? t.toMillis() : t?.seconds != null ? t.seconds * 1000 : 0
  return ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}
const statusTone = (s) => (s === 'suspended' ? 'red' : s === 'trial' ? 'amber' : 'green')

const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const STARTER_STOCK = [
  { drug: 'Paracetamol 650 mg', batch: 'PB-1042', expiry: plusDays(400), qty: 120, mrp: 2, purchasePrice: 1.1 },
  { drug: 'Paracetamol 650 mg', batch: 'PB-1039', expiry: plusDays(50), qty: 8, mrp: 2, purchasePrice: 1.1 },
  { drug: 'Amoxicillin 500 mg', batch: 'AM-556', expiry: plusDays(20), qty: 40, mrp: 6, purchasePrice: 3.4 },
  { drug: 'Azithromycin 500 mg', batch: 'AZ-118', expiry: plusDays(120), qty: 15, mrp: 12, purchasePrice: 7 },
  { drug: 'Cetirizine 10 mg', batch: 'CT-221', expiry: plusDays(300), qty: 60, mrp: 1.5, purchasePrice: 0.6 },
  { drug: 'Pantoprazole 40 mg', batch: 'PT-330', expiry: plusDays(500), qty: 90, mrp: 3, purchasePrice: 1.5 },
  { drug: 'ORS sachet', batch: 'ORS-77', expiry: plusDays(200), qty: 200, mrp: 20, purchasePrice: 11 },
  { drug: 'Ibuprofen 400 mg', batch: 'IB-902', expiry: plusDays(-10), qty: 4, mrp: 3, purchasePrice: 1.2 },
]
const SAMPLE_ALLERGY_PATIENT = { name: 'Aarti Sharma', mobile: '9800000001', dob: '1990-06-15', sex: 'F', relation: 'Self', allergies: 'Penicillin (rash, 2021)', conditions: 'Hypothyroidism (2022)' }

export default function SuperAdmin() {
  const user = useAuth((s) => s.user)
  const [tab, setTab] = useState('overview')
  const [tenants, setTenants] = useState([])
  const [tenantId, setTenantId] = useState('')
  const [newTenant, setNewTenant] = useState({ id: '', name: '', city: '', plan: 'trial' })
  const [stock, setStock] = useState(EMPTY_STOCK)
  const [patient, setPatient] = useState(EMPTY_PATIENT)
  const [staff, setStaff] = useState(EMPTY_STAFF)
  const [priceList, setPriceList] = useState([])
  const [newPrice, setNewPrice] = useState({ label: '', amount: '' })
  const [toastMsg, setToastMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3600) }

  const refreshTenants = async () => { const rows = await listTenants(); setTenants(rows); return rows }
  useEffect(() => { if (user.superadmin) refreshTenants().then((rows) => { if (rows.length) setTenantId((id) => id || rows[0].id) }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tenantId) getPriceList(tenantId).then(setPriceList); else setPriceList([]) }, [tenantId])

  const stats = useMemo(() => {
    const active = tenants.filter((t) => (t.status || 'active') === 'active').length
    const trial = tenants.filter((t) => t.plan === 'trial').length
    const suspended = tenants.filter((t) => t.status === 'suspended').length
    const mrr = tenants.filter((t) => (t.status || 'active') === 'active' && !t.isDemo).reduce((s, t) => s + (PLAN_PRICE[t.plan] || 0), 0)
    const byPlan = PLANS.map((p) => ({ plan: p, count: tenants.filter((t) => t.plan === p).length }))
    return { total: tenants.length, active, trial, suspended, mrr, byPlan }
  }, [tenants])
  const recent = useMemo(() => [...tenants].sort((a, b) => (dateStr(b.createdAt) > dateStr(a.createdAt) ? 1 : -1)).slice(0, 5), [tenants])

  if (!user.superadmin) {
    return <div className="card p-8 text-center"><h3 className="font-disp font-semibold text-[16px] mb-1">Not authorized</h3><p className="text-body-2 text-[13.5px]">This area is restricted to super admins.</p></div>
  }

  const addTenant = async (e) => {
    e.preventDefault()
    if (!newTenant.id || !newTenant.name) return toast('Tenant ID and name are required')
    await createTenant(newTenant.id, { name: newTenant.name, city: newTenant.city, plan: newTenant.plan })
    const id = newTenant.id
    setNewTenant({ id: '', name: '', city: '', plan: 'trial' })
    await refreshTenants(); setTenantId(id)
    toast(`Clinic "${id}" created`)
  }
  const changeTenant = async (id, patch) => { await updateTenantMeta(id, patch); await refreshTenants(); toast('Clinic updated') }
  const provision = (id) => { setTenantId(id); setTab('provision') }

  const addStock = async (e) => {
    e.preventDefault()
    if (!tenantId || !stock.drug || !stock.batch) return
    await seedStockItem(tenantId, { drug: stock.drug, batch: stock.batch, expiry: stock.expiry, qty: Number(stock.qty) || 0, mrp: Number(stock.mrp) || 0 })
    setStock(EMPTY_STOCK); toast(`Added stock: ${stock.drug}`)
  }
  const addPatient = async (e) => {
    e.preventDefault()
    if (!tenantId || !patient.name) return
    await seedPatient(tenantId, { name: patient.name, mobile: patient.mobile, dob: patient.dob || null, sex: patient.sex, relation: patient.relation, allergies: patient.allergies.split(',').map((s) => s.trim()).filter(Boolean), conditions: patient.conditions.split(',').map((s) => s.trim()).filter(Boolean) })
    setPatient(EMPTY_PATIENT); toast(`Added patient: ${patient.name}`)
  }
  const seedStarterStock = async () => { if (!tenantId || busy) return; setBusy(true); try { for (const it of STARTER_STOCK) await seedStockItem(tenantId, { ...it, importedFrom: 'starter' }); toast(`Seeded ${STARTER_STOCK.length} starter batches into ${tenantId}`) } finally { setBusy(false) } }
  const seedAllergyPatient = async () => { if (!tenantId || busy) return; setBusy(true); try { await seedPatient(tenantId, { ...SAMPLE_ALLERGY_PATIENT, allergies: SAMPLE_ALLERGY_PATIENT.allergies.split(',').map((s) => s.trim()).filter(Boolean), conditions: SAMPLE_ALLERGY_PATIENT.conditions.split(',').map((s) => s.trim()).filter(Boolean) }); toast(`Seeded sample patient ${SAMPLE_ALLERGY_PATIENT.name}`) } finally { setBusy(false) } }
  const addPrice = () => { if (!newPrice.label || !newPrice.amount) return; setPriceList((p) => [...p, { label: newPrice.label, amount: Number(newPrice.amount) }]); setNewPrice({ label: '', amount: '' }) }
  const removePrice = (i) => setPriceList((p) => p.filter((_, idx) => idx !== i))
  const saveList = async () => { if (!tenantId) return; await savePriceList(tenantId, priceList); toast('Price list saved') }
  const staffCommand = tenantId && staff.email && staff.password && staff.name ? `node scripts/seedStaff.mjs ${tenantId} ${staff.email} '${staff.password}' "${staff.name}" ${staff.role}` : ''
  const copyCommand = async () => { if (!staffCommand) return; await navigator.clipboard.writeText(staffCommand); toast('Command copied — paste into Cloud Shell') }

  const activeTenant = tenants.find((t) => t.id === tenantId)

  return (
    <div>
      {toastMsg && <div className="card px-4 py-2.5 mb-4 text-[13px] font-medium text-teal-dark bg-teal-wash border-teal">{toastMsg}</div>}

      <div className="flex bg-[#F0EFEA] rounded-lg p-0.5 mb-4 w-fit">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-1.5 rounded-md text-[12.5px] ${tab === k ? 'bg-white shadow-sm font-medium' : 'text-body-2'}`}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-4">
            <Stat k="Clinics" v={stats.total} />
            <Stat k="Active" v={stats.active} tone="text-teal-dark" />
            <Stat k="On trial" v={stats.trial} tone={stats.trial ? 'text-caution' : ''} />
            <Stat k="Suspended" v={stats.suspended} tone={stats.suspended ? 'text-danger' : ''} />
            <Stat k="MRR" v={rupee(stats.mrr)} />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="card p-4">
              <b className="font-disp block mb-3">Plan distribution</b>
              {stats.byPlan.map(({ plan, count }) => (
                <div key={plan} className="flex items-center gap-3 mb-2">
                  <span className="w-24 text-[13px] capitalize">{plan}</span>
                  <div className="flex-1 bg-[#EFEEE9] rounded h-2.5 overflow-hidden"><div className="bg-teal h-full" style={{ width: `${stats.total ? (count / stats.total) * 100 : 0}%` }} /></div>
                  <span className="font-mono text-[12.5px] w-6 text-right">{count}</span>
                </div>
              ))}
              <p className="text-[11.5px] text-body-3 mt-2">Plan pricing: {PLANS.map((p) => `${p} ${rupee(PLAN_PRICE[p])}`).join(' · ')} /mo</p>
            </div>
            <div className="card p-4">
              <b className="font-disp block mb-3">Recent clinics</b>
              <div className="divide-y divide-line">
                {recent.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2">
                    <div><b className="text-[13.5px]">{t.name}</b><span className="text-body-3 text-[12px]"> · {t.city || '—'}</span></div>
                    <div className="flex items-center gap-2"><Chip tone="gray">{t.plan || '—'}</Chip><span className="text-[11.5px] text-body-3 font-mono">{dateStr(t.createdAt)}</span></div>
                  </div>
                ))}
                {recent.length === 0 && <p className="text-body-3 text-[13px] py-2">No clinics yet.</p>}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'clinics' && (
        <>
          <div className="card overflow-hidden mb-4">
            <div className="flex justify-between items-center px-4 py-3.5 border-b border-line"><b className="font-disp">All clinics</b><span className="text-[12px] text-body-3">{tenants.length} total</span></div>
            <table className="w-full text-[13px] border-collapse">
              <thead><tr><th className="th">Clinic</th><th className="th w-28">City</th><th className="th w-32">Plan</th><th className="th w-32">Status</th><th className="th w-28">Created</th><th className="th w-24"></th></tr></thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-[#FBFAF7]">
                    <td className="td"><b>{t.name}</b>{t.isDemo && <Chip tone="teal" className="ml-1.5">demo</Chip>}<div className="text-[11.5px] text-body-3 font-mono">{t.id}</div></td>
                    <td className="td text-body-2">{t.city || '—'}</td>
                    <td className="td"><select className="inp !py-1 !text-[12.5px]" value={t.plan || 'trial'} onChange={(e) => changeTenant(t.id, { plan: e.target.value })}>{PLANS.map((p) => <option key={p} value={p}>{p}</option>)}</select></td>
                    <td className="td"><select className="inp !py-1 !text-[12.5px]" value={t.status || 'active'} onChange={(e) => changeTenant(t.id, { status: e.target.value })}>{['active', 'trial', 'suspended'].map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                    <td className="td font-mono text-body-2 text-[12px]">{dateStr(t.createdAt)}</td>
                    <td className="td"><button className="btn-ghost !text-[12px]" onClick={() => provision(t.id)}>Provision →</button></td>
                  </tr>
                ))}
                {tenants.length === 0 && <tr><td className="td text-body-3" colSpan={6}>No clinics yet. Create one below.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card p-4">
            <b className="font-disp block mb-3">Create clinic</b>
            <form onSubmit={addTenant} className="grid grid-cols-1 md:grid-cols-5 gap-2.5 items-end">
              <div><span className="lbl">Tenant ID (slug)</span><input className="inp" placeholder="new-clinic" value={newTenant.id} onChange={(e) => setNewTenant((t) => ({ ...t, id: e.target.value.trim() }))} /></div>
              <div><span className="lbl">Name</span><input className="inp" placeholder="New Clinic" value={newTenant.name} onChange={(e) => setNewTenant((t) => ({ ...t, name: e.target.value }))} /></div>
              <div><span className="lbl">City</span><input className="inp" placeholder="Chennai" value={newTenant.city} onChange={(e) => setNewTenant((t) => ({ ...t, city: e.target.value }))} /></div>
              <div><span className="lbl">Plan</span><select className="inp" value={newTenant.plan} onChange={(e) => setNewTenant((t) => ({ ...t, plan: e.target.value }))}>{PLANS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
              <button className="btn-pri" type="submit">+ Create</button>
            </form>
          </div>
        </>
      )}

      {tab === 'provision' && (
        <>
          <div className="card p-4 mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[240px]"><span className="lbl">Active clinic</span>
                <select className="inp" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                  <option value="">— select —</option>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name || t.id} ({t.id})</option>)}
                </select>
              </div>
              {activeTenant && <span className="text-[12.5px] text-body-3">Plan <b>{activeTenant.plan}</b> · {activeTenant.city || '—'}</span>}
            </div>
          </div>

          {tenantId && (
            <>
              <div className="card p-4 mb-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <b className="font-disp">Seed pharmacy stock</b>
                  <div className="flex gap-2">
                    <button className="btn" type="button" disabled={busy} onClick={seedStarterStock}>⬡ Seed starter stock ({STARTER_STOCK.length})</button>
                    <button className="btn" type="button" disabled={busy} onClick={seedAllergyPatient}>+ Sample allergy patient</button>
                  </div>
                </div>
                <form onSubmit={addStock} className="grid grid-cols-2 md:grid-cols-5 gap-2.5 items-end">
                  <div><span className="lbl">Drug</span><input className="inp" placeholder="Paracetamol 650 mg" value={stock.drug} onChange={(e) => setStock((s) => ({ ...s, drug: e.target.value }))} /></div>
                  <div><span className="lbl">Batch</span><input className="inp" placeholder="PB-1042" value={stock.batch} onChange={(e) => setStock((s) => ({ ...s, batch: e.target.value }))} /></div>
                  <div><span className="lbl">Expiry</span><input className="inp" type="date" value={stock.expiry} onChange={(e) => setStock((s) => ({ ...s, expiry: e.target.value }))} /></div>
                  <div><span className="lbl">Qty</span><input className="inp" type="number" value={stock.qty} onChange={(e) => setStock((s) => ({ ...s, qty: e.target.value }))} /></div>
                  <div className="flex gap-2 items-end"><div className="flex-1"><span className="lbl">MRP</span><input className="inp" type="number" value={stock.mrp} onChange={(e) => setStock((s) => ({ ...s, mrp: e.target.value }))} /></div><button className="btn-pri" type="submit">Add</button></div>
                </form>
              </div>

              <div className="card p-4 mb-4">
                <b className="font-disp block mb-3">Seed patient</b>
                <form onSubmit={addPatient} className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <div><span className="lbl">Name</span><input className="inp" value={patient.name} onChange={(e) => setPatient((p) => ({ ...p, name: e.target.value }))} /></div>
                  <div><span className="lbl">Mobile</span><input className="inp" value={patient.mobile} onChange={(e) => setPatient((p) => ({ ...p, mobile: e.target.value }))} /></div>
                  <div><span className="lbl">DOB</span><input className="inp" type="date" value={patient.dob} onChange={(e) => setPatient((p) => ({ ...p, dob: e.target.value }))} /></div>
                  <div className="md:col-span-3"><span className="lbl">Allergies (comma separated)</span><input className="inp" placeholder="Penicillin (rash, 2021), Sulfa" value={patient.allergies} onChange={(e) => setPatient((p) => ({ ...p, allergies: e.target.value }))} /></div>
                  <div className="md:col-span-3"><span className="lbl">Conditions (comma separated)</span><input className="inp" placeholder="Hypothyroidism, Migraine" value={patient.conditions} onChange={(e) => setPatient((p) => ({ ...p, conditions: e.target.value }))} /></div>
                  <button className="btn-pri md:col-span-3" type="submit">+ Add patient</button>
                </form>
              </div>

              <div className="card p-4 mb-4">
                <b className="font-disp block mb-3">Billing price list</b>
                <table className="w-full text-[13px] border-collapse mb-3"><tbody>
                  {priceList.map((p, i) => (<tr key={i} className="border-b border-line"><td className="td">{p.label}</td><td className="td w-28 font-mono">₹{p.amount}</td><td className="td w-16"><button className="btn-ghost !text-[12px]" onClick={() => removePrice(i)}>Remove</button></td></tr>))}
                  {priceList.length === 0 && <tr><td className="td text-body-3" colSpan={3}>No price list yet.</td></tr>}
                </tbody></table>
                <div className="flex gap-2.5 items-end">
                  <div className="flex-1"><span className="lbl">Label</span><input className="inp" value={newPrice.label} onChange={(e) => setNewPrice((p) => ({ ...p, label: e.target.value }))} /></div>
                  <div className="w-28"><span className="lbl">Amount</span><input className="inp" type="number" value={newPrice.amount} onChange={(e) => setNewPrice((p) => ({ ...p, amount: e.target.value }))} /></div>
                  <button className="btn" type="button" onClick={addPrice}>+ Row</button>
                  <button className="btn-pri" type="button" onClick={saveList}>Save</button>
                </div>
              </div>

              <div className="card p-4 mb-8">
                <b className="font-disp block mb-1">Staff account</b>
                <p className="text-body-3 text-[12.5px] mb-3">Firebase Auth claims can only be set from a trusted server. Fill this in, then run the generated command in Cloud Shell.</p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 mb-3">
                  <div><span className="lbl">Email</span><input className="inp" value={staff.email} onChange={(e) => setStaff((s) => ({ ...s, email: e.target.value }))} /></div>
                  <div><span className="lbl">Temp password</span><input className="inp" value={staff.password} onChange={(e) => setStaff((s) => ({ ...s, password: e.target.value }))} /></div>
                  <div><span className="lbl">Name</span><input className="inp" value={staff.name} onChange={(e) => setStaff((s) => ({ ...s, name: e.target.value }))} /></div>
                  <div><span className="lbl">Role</span><select className="inp" value={staff.role} onChange={(e) => setStaff((s) => ({ ...s, role: e.target.value }))}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
                </div>
                {staffCommand && <div className="bg-[#0F1A1A] text-[#B9E5D8] font-mono text-[12px] rounded-lg p-3 flex items-center justify-between gap-3"><code className="break-all">{staffCommand}</code><button className="btn-ghost !text-[12px] !text-white shrink-0" type="button" onClick={copyCommand}>Copy</button></div>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
