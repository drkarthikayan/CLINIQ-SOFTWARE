import { useEffect, useState } from 'react'
import { useAuth } from '../store/authStore'
import { listTenants, createTenant, seedStockItem, seedPatient, savePriceList } from '../services/admin.service'
import { getPriceList } from '../services/billing.service'

const EMPTY_STOCK = { drug: '', batch: '', expiry: '', qty: '', mrp: '' }
const EMPTY_PATIENT = { name: '', mobile: '', dob: '', sex: 'F', relation: 'Self', allergies: '', conditions: '' }
const EMPTY_STAFF = { email: '', password: '', name: '', role: 'doctor' }
const ROLES = ['admin', 'doctor', 'nurse', 'frontdesk']

// A realistic GP starter stock, one click to populate a fresh clinic. Expiries
// are relative to today so the near-expiry (≤90d) / low-stock flags show up.
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
const SAMPLE_ALLERGY_PATIENT = {
  name: 'Aarti Sharma', mobile: '9800000001', dob: '1990-06-15', sex: 'F', relation: 'Self',
  allergies: 'Penicillin (rash, 2021)', conditions: 'Hypothyroidism (2022)',
}

export default function SuperAdmin() {
  const user = useAuth((s) => s.user)

  const [tenants, setTenants] = useState([])
  const [tenantId, setTenantId] = useState('')
  const [newTenant, setNewTenant] = useState({ id: '', name: '', city: '' })

  const [stock, setStock] = useState(EMPTY_STOCK)
  const [patient, setPatient] = useState(EMPTY_PATIENT)
  const [staff, setStaff] = useState(EMPTY_STAFF)
  const [priceList, setPriceList] = useState([])
  const [newPrice, setNewPrice] = useState({ label: '', amount: '' })

  const [toastMsg, setToastMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3600) }

  const refreshTenants = async () => {
    const rows = await listTenants()
    setTenants(rows)
    return rows
  }

  useEffect(() => {
    if (!user.superadmin) return
    refreshTenants().then((rows) => { if (rows.length) setTenantId((id) => id || rows[0].id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!tenantId) { setPriceList([]); return }
    getPriceList(tenantId).then(setPriceList)
  }, [tenantId])

  if (!user.superadmin) {
    return (
      <div className="card p-8 text-center">
        <h3 className="font-disp font-semibold text-[16px] mb-1">Not authorized</h3>
        <p className="text-body-2 text-[13.5px]">This area is restricted to platform superadmins.</p>
      </div>
    )
  }

  const addTenant = async (e) => {
    e.preventDefault()
    if (!newTenant.id || !newTenant.name) return
    await createTenant(newTenant.id, { name: newTenant.name, city: newTenant.city })
    const id = newTenant.id
    setNewTenant({ id: '', name: '', city: '' })
    await refreshTenants()
    setTenantId(id)
    toast(`Tenant "${id}" created`)
  }

  const addStock = async (e) => {
    e.preventDefault()
    if (!tenantId || !stock.drug || !stock.batch) return
    await seedStockItem(tenantId, {
      drug: stock.drug, batch: stock.batch, expiry: stock.expiry,
      qty: Number(stock.qty) || 0, mrp: Number(stock.mrp) || 0,
    })
    const drugName = stock.drug
    setStock(EMPTY_STOCK)
    toast(`Added stock: ${drugName}`)
  }

  const addPatient = async (e) => {
    e.preventDefault()
    if (!tenantId || !patient.name) return
    await seedPatient(tenantId, {
      name: patient.name, mobile: patient.mobile, dob: patient.dob || null, sex: patient.sex,
      relation: patient.relation,
      allergies: patient.allergies.split(',').map((s) => s.trim()).filter(Boolean),
      conditions: patient.conditions.split(',').map((s) => s.trim()).filter(Boolean),
    })
    const patientName = patient.name
    setPatient(EMPTY_PATIENT)
    toast(`Added patient: ${patientName}`)
  }

  const seedStarterStock = async () => {
    if (!tenantId || busy) return
    setBusy(true)
    try {
      for (const item of STARTER_STOCK) await seedStockItem(tenantId, { ...item, importedFrom: 'starter' })
      toast(`Seeded ${STARTER_STOCK.length} starter stock batches into ${tenantId}`)
    } finally { setBusy(false) }
  }
  const seedAllergyPatient = async () => {
    if (!tenantId || busy) return
    setBusy(true)
    try {
      await seedPatient(tenantId, {
        ...SAMPLE_ALLERGY_PATIENT,
        allergies: SAMPLE_ALLERGY_PATIENT.allergies.split(',').map((s) => s.trim()).filter(Boolean),
        conditions: SAMPLE_ALLERGY_PATIENT.conditions.split(',').map((s) => s.trim()).filter(Boolean),
      })
      toast(`Seeded sample patient ${SAMPLE_ALLERGY_PATIENT.name} (Penicillin allergy)`)
    } finally { setBusy(false) }
  }

  const addPrice = () => {
    if (!newPrice.label || !newPrice.amount) return
    setPriceList((p) => [...p, { label: newPrice.label, amount: Number(newPrice.amount) }])
    setNewPrice({ label: '', amount: '' })
  }
  const removePrice = (i) => setPriceList((p) => p.filter((_, idx) => idx !== i))
  const saveList = async () => {
    if (!tenantId) return
    await savePriceList(tenantId, priceList)
    toast('Price list saved')
  }

  const staffCommand = tenantId && staff.email && staff.password && staff.name
    ? `node scripts/seedStaff.mjs ${tenantId} ${staff.email} '${staff.password}' "${staff.name}" ${staff.role}`
    : ''

  const copyCommand = async () => {
    if (!staffCommand) return
    await navigator.clipboard.writeText(staffCommand)
    toast('Command copied — paste it into Cloud Shell')
  }

  return (
    <div>
      {toastMsg && <div className="card px-4 py-2.5 mb-4 text-[13px] font-medium text-teal-dark bg-teal-wash border-teal">{toastMsg}</div>}

      <div className="card p-4 mb-4">
        <b className="font-disp block mb-3">Clinic (tenant)</b>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="min-w-[240px]">
            <span className="lbl">Active tenant</span>
            <select className="inp" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              <option value="">— select —</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name || t.id} ({t.id})</option>)}
            </select>
          </div>
        </div>
        <form onSubmit={addTenant} className="grid grid-cols-1 md:grid-cols-4 gap-2.5 items-end border-t border-line pt-3.5">
          <div><span className="lbl">New tenant ID (slug)</span><input className="inp" placeholder="new-clinic" value={newTenant.id} onChange={(e) => setNewTenant((t) => ({ ...t, id: e.target.value.trim() }))} /></div>
          <div><span className="lbl">Name</span><input className="inp" placeholder="New Clinic" value={newTenant.name} onChange={(e) => setNewTenant((t) => ({ ...t, name: e.target.value }))} /></div>
          <div><span className="lbl">City</span><input className="inp" placeholder="Chennai" value={newTenant.city} onChange={(e) => setNewTenant((t) => ({ ...t, city: e.target.value }))} /></div>
          <button className="btn-pri" type="submit">+ Create tenant</button>
        </form>
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
              <div className="flex gap-2 items-end">
                <div className="flex-1"><span className="lbl">MRP</span><input className="inp" type="number" value={stock.mrp} onChange={(e) => setStock((s) => ({ ...s, mrp: e.target.value }))} /></div>
                <button className="btn-pri" type="submit">Add</button>
              </div>
            </form>
          </div>

          <div className="card p-4 mb-4">
            <b className="font-disp block mb-3">Seed patient</b>
            <form onSubmit={addPatient} className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <div><span className="lbl">Name</span><input className="inp" value={patient.name} onChange={(e) => setPatient((p) => ({ ...p, name: e.target.value }))} /></div>
              <div><span className="lbl">Mobile</span><input className="inp" value={patient.mobile} onChange={(e) => setPatient((p) => ({ ...p, mobile: e.target.value }))} /></div>
              <div><span className="lbl">DOB</span><input className="inp" type="date" value={patient.dob} onChange={(e) => setPatient((p) => ({ ...p, dob: e.target.value }))} /></div>
              <div>
                <span className="lbl">Sex</span>
                <select className="inp" value={patient.sex} onChange={(e) => setPatient((p) => ({ ...p, sex: e.target.value }))}>
                  <option value="F">F</option><option value="M">M</option><option value="O">O</option>
                </select>
              </div>
              <div className="md:col-span-2"><span className="lbl">Relation</span><input className="inp" value={patient.relation} onChange={(e) => setPatient((p) => ({ ...p, relation: e.target.value }))} /></div>
              <div className="md:col-span-3"><span className="lbl">Allergies (comma separated)</span><input className="inp" placeholder="Penicillin (rash, 2021), Sulfa" value={patient.allergies} onChange={(e) => setPatient((p) => ({ ...p, allergies: e.target.value }))} /></div>
              <div className="md:col-span-3"><span className="lbl">Conditions (comma separated)</span><input className="inp" placeholder="Hypothyroidism, Migraine" value={patient.conditions} onChange={(e) => setPatient((p) => ({ ...p, conditions: e.target.value }))} /></div>
              <button className="btn-pri md:col-span-3" type="submit">+ Add patient</button>
            </form>
          </div>

          <div className="card p-4 mb-4">
            <b className="font-disp block mb-3">Billing price list</b>
            <table className="w-full text-[13px] border-collapse mb-3">
              <thead><tr><th className="th">Label</th><th className="th w-28">Amount</th><th className="th w-16"></th></tr></thead>
              <tbody>
                {priceList.map((p, i) => (
                  <tr key={i}>
                    <td className="td">{p.label}</td>
                    <td className="td font-mono">₹{p.amount}</td>
                    <td className="td"><button className="btn-ghost !text-[12px]" onClick={() => removePrice(i)}>Remove</button></td>
                  </tr>
                ))}
                {priceList.length === 0 && <tr><td className="td text-body-3" colSpan={3}>No price list yet.</td></tr>}
              </tbody>
            </table>
            <div className="flex gap-2.5 items-end">
              <div className="flex-1"><span className="lbl">Label</span><input className="inp" value={newPrice.label} onChange={(e) => setNewPrice((p) => ({ ...p, label: e.target.value }))} /></div>
              <div className="w-28"><span className="lbl">Amount</span><input className="inp" type="number" value={newPrice.amount} onChange={(e) => setNewPrice((p) => ({ ...p, amount: e.target.value }))} /></div>
              <button className="btn" type="button" onClick={addPrice}>+ Row</button>
              <button className="btn-pri" type="button" onClick={saveList}>Save price list</button>
            </div>
          </div>

          <div className="card p-4 mb-8">
            <b className="font-disp block mb-1">Staff account</b>
            <p className="text-body-3 text-[12.5px] mb-3">
              Firebase Auth roles are set via custom claims, which can only be assigned from a trusted server context — never from the browser.
              Fill this in, then copy and run the generated command in Cloud Shell to finish creating the account.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 mb-3">
              <div><span className="lbl">Email</span><input className="inp" value={staff.email} onChange={(e) => setStaff((s) => ({ ...s, email: e.target.value }))} /></div>
              <div><span className="lbl">Temp password</span><input className="inp" value={staff.password} onChange={(e) => setStaff((s) => ({ ...s, password: e.target.value }))} /></div>
              <div><span className="lbl">Name</span><input className="inp" value={staff.name} onChange={(e) => setStaff((s) => ({ ...s, name: e.target.value }))} /></div>
              <div>
                <span className="lbl">Role</span>
                <select className="inp" value={staff.role} onChange={(e) => setStaff((s) => ({ ...s, role: e.target.value }))}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            {staffCommand && (
              <div className="bg-[#0F1A1A] text-[#B9E5D8] font-mono text-[12px] rounded-lg p-3 flex items-center justify-between gap-3">
                <code className="break-all">{staffCommand}</code>
                <button className="btn-ghost !text-[12px] !text-white shrink-0" type="button" onClick={copyCommand}>Copy</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
