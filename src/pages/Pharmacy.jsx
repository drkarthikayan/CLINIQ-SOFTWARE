import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../store/authStore'
import { Chip, Stat, Modal } from '../components/ui'
import {
  watchStock, addStockItem, importStockRows, writeOffBatch, drugMinStock,
  isNearExpiry, isExpired,
} from '../services/stock.service'
import { watchPendingDispensary, watchDispensaryLog, dispenseRecord } from '../services/dispensary.service'
import { watchWaste, addWaste, BMW_CATEGORIES } from '../services/waste.service'

const rupee = (n) => '₹' + (n ?? 0).toLocaleString('en-IN')
const EMPTY = { drug: '', batch: '', expiry: '', qty: '', mrp: '', minStock: '', purchasePrice: '' }
const EMPTY_WASTE = { category: BMW_CATEGORIES[0], item: '', qty: '', unit: 'pcs', disposal: '', handledBy: '' }
const TABS = [['stock', 'Stock register'], ['dispensary', 'Dispensary'], ['log', 'Dispensary log'], ['waste', 'Waste register']]

const timeStr = (t) => {
  const ms = typeof t === 'string' ? new Date(t).getTime() : typeof t?.toMillis === 'function' ? t.toMillis() : t?.seconds != null ? t.seconds * 1000 : 0
  return ms ? new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'
}

function normalizeExpiry(v) {
  if (!v) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.toISOString().slice(0, 10) }
  const parsed = new Date(v)
  return isNaN(parsed) ? String(v) : parsed.toISOString().slice(0, 10)
}
function pickCol(row, names) {
  for (const key of Object.keys(row)) if (names.includes(key.trim().toLowerCase())) return row[key]
  return ''
}

export default function Pharmacy() {
  const user = useAuth((s) => s.user)
  const [tab, setTab] = useState('stock')
  const [stock, setStock] = useState([])
  const [pending, setPending] = useState([])
  const [log, setLog] = useState([])
  const [waste, setWaste] = useState([])
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [wasteForm, setWasteForm] = useState(EMPTY_WASTE)
  const [busy, setBusy] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const fileRef = useRef(null)

  useEffect(() => watchStock(user.tenantId, setStock), [user.tenantId])
  useEffect(() => watchPendingDispensary(user.tenantId, setPending), [user.tenantId])
  useEffect(() => watchDispensaryLog(user.tenantId, setLog), [user.tenantId])
  useEffect(() => watchWaste(user.tenantId, setWaste), [user.tenantId])
  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3600) }

  const drugTotals = useMemo(() => {
    const m = {}; stock.forEach((r) => { m[r.drug] = (m[r.drug] || 0) + (r.qty ?? 0) }); return m
  }, [stock])
  const stockOf = (drug) => drugTotals[drug] ?? 0

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return stock.filter((r) => !t || r.drug?.toLowerCase().includes(t) || r.batch?.toLowerCase().includes(t))
      .sort((a, b) => new Date(a.expiry) - new Date(b.expiry))
  }, [stock, q])

  const stats = useMemo(() => {
    const drugs = Object.keys(drugTotals)
    return {
      batches: stock.length,
      lowStock: drugs.filter((d) => drugTotals[d] <= drugMinStock(stock, d)).length,
      nearExpiry: stock.filter((r) => (r.qty ?? 0) > 0 && !isExpired(r.expiry) && isNearExpiry(r.expiry)).length,
      expired: stock.filter((r) => (r.qty ?? 0) > 0 && isExpired(r.expiry)).length,
    }
  }, [stock, drugTotals])

  const unitsToday = useMemo(() => log.reduce((s, r) => s + (r.lines || []).reduce((x, l) => x + (l.dispensed || 0), 0), 0), [log])

  const save = async () => {
    if (!form.drug.trim() || !form.batch.trim() || !form.expiry) { toast('Drug, batch and expiry are required'); return }
    await addStockItem(user.tenantId, form); setModal(false); setForm(EMPTY)
    toast(`Added ${form.drug} · batch ${form.batch}`)
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const mapped = raw.map((row) => ({
        drug: pickCol(row, ['medicine', 'drug', 'name', 'item']),
        batch: pickCol(row, ['batch', 'batch no', 'batch number', 'batchno']),
        expiry: normalizeExpiry(pickCol(row, ['expiry', 'expiry date', 'exp', 'exp date'])),
        qty: pickCol(row, ['qty', 'quantity', 'stock']),
        mrp: pickCol(row, ['mrp', 'price']),
        purchasePrice: pickCol(row, ['purchase price', 'purchase', 'cost']),
      })).filter((r) => r.drug)
      if (!mapped.length) { toast('No rows found — expected: Medicine, Batch, Expiry, Qty, MRP, Purchase price'); return }
      const n = await importStockRows(user.tenantId, mapped)
      toast(`Imported ${n} batch${n === 1 ? '' : 'es'} from ${file.name}`)
    } catch { toast('Import failed — check the file format (.xlsx or .csv)') }
    finally { if (fileRef.current) fileRef.current.value = '' }
  }

  const dispense = async (rec) => {
    if (busy) return
    setBusy(true)
    try {
      const plan = await dispenseRecord(user.tenantId, rec, stock, user.name)
      const short = plan.lines.filter((l) => l.shortBy > 0)
      toast(short.length ? `Dispensed ${rec.patientName} · ⚠ short: ${short.map((s) => s.drug).join(', ')}` : `Dispensed for ${rec.patientName}`)
    } finally { setBusy(false) }
  }

  const expiredBatches = useMemo(() => stock.filter((r) => (r.qty ?? 0) > 0 && isExpired(r.expiry)), [stock])
  const logWaste = async () => {
    if (!wasteForm.item.trim() || !wasteForm.qty) { toast('Enter an item and quantity'); return }
    await addWaste(user.tenantId, { ...wasteForm, handledBy: wasteForm.handledBy || user.name })
    setWasteForm(EMPTY_WASTE); toast('Waste entry recorded')
  }
  const discardExpired = async (r) => {
    if (busy) return
    setBusy(true)
    try {
      await addWaste(user.tenantId, { category: BMW_CATEGORIES[0], item: `${r.drug} · batch ${r.batch} (expired ${r.expiry})`, qty: r.qty, unit: 'pcs', disposal: 'Yellow bag', handledBy: user.name })
      await writeOffBatch(user.tenantId, r.id)
      toast(`Discarded ${r.drug} (${r.qty}) to waste`)
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="flex bg-[#F0EFEA] rounded-lg p-0.5 mb-4 w-fit">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3.5 py-1.5 rounded-md text-[12.5px] ${tab === k ? 'bg-white shadow-sm font-medium' : 'text-body-2'}`}>
            {label}{k === 'dispensary' && pending.length ? ` (${pending.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'stock' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
            <Stat k="Batches in stock" v={stats.batches} />
            <Stat k="Low stock drugs" v={stats.lowStock} tone={stats.lowStock ? 'text-danger' : ''} />
            <Stat k="Near expiry ≤90d" v={stats.nearExpiry} tone={stats.nearExpiry ? 'text-caution' : ''} />
            <Stat k="Expired" v={stats.expired} tone={stats.expired ? 'text-danger' : ''} />
          </div>
          <div className="card p-4 mb-4 flex gap-2.5 flex-wrap items-center">
            <input className="inp !w-auto flex-1 min-w-[220px]" placeholder="Search drug or batch…" value={q} onChange={(e) => setQ(e.target.value)} />
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
            <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Import Excel / CSV</button>
            <button className="btn-pri" onClick={() => setModal(true)}>+ Add stock</button>
          </div>
          <div className="card overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3.5 border-b border-line">
              <b className="font-disp">Stock register</b>
              <span className="text-[12px] text-body-3">Sorted first-expiry-first-out (FEFO)</span>
            </div>
            <table className="w-full text-[13px] border-collapse">
              <thead><tr>
                <th className="th">Drug</th><th className="th w-28">Batch</th><th className="th w-28">Expiry</th>
                <th className="th w-20 text-right">Qty</th><th className="th w-20 text-right">MRP</th><th className="th w-40">Flags</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const expired = isExpired(r.expiry); const near = !expired && isNearExpiry(r.expiry); const low = stockOf(r.drug) <= drugMinStock(stock, r.drug)
                  return (
                    <tr key={r.id} className="hover:bg-[#FBFAF7]">
                      <td className="td"><b>{r.drug}</b></td>
                      <td className="td font-mono text-body-2">{r.batch}</td>
                      <td className="td font-mono text-body-2">{r.expiry}</td>
                      <td className="td text-right font-mono">{r.qty}</td>
                      <td className="td text-right font-mono">{rupee(r.mrp)}</td>
                      <td className="td"><div className="flex gap-1.5 flex-wrap">
                        {expired && <Chip tone="red">Expired</Chip>}
                        {near && <Chip tone="amber">Near expiry</Chip>}
                        {low && <Chip tone="red">Low stock</Chip>}
                        {!expired && !near && !low && <Chip tone="green">OK</Chip>}
                      </div></td>
                    </tr>
                  )
                })}
                {rows.length === 0 && <tr><td className="td text-body-3" colSpan={6}>No stock yet. Add manually or import an Excel/CSV sheet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'dispensary' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mb-4">
            <Stat k="To dispense" v={pending.length} tone={pending.length ? 'text-caution' : ''} />
            <Stat k="Dispensed today" v={log.length} tone="text-teal-dark" />
            <Stat k="Units dispensed" v={unitsToday} />
          </div>
          <div className="grid gap-3">
            {pending.map((rec) => (
              <div key={rec.id} className="card p-4">
                <div className="flex justify-between items-start mb-2.5 flex-wrap gap-2">
                  <div>
                    <b className="font-disp text-[15px]">{rec.patientName}</b>
                    <span className="text-body-2 text-[13px]"> · {rec.doctor} · {timeStr(rec.createdAt)}</span>
                  </div>
                  <button className="btn-pri !py-1.5 !text-[12.5px]" disabled={busy} onClick={() => dispense(rec)}>Verify & dispense →</button>
                </div>
                <table className="w-full text-[13px] border-collapse">
                  <thead><tr>
                    <th className="th">Drug</th><th className="th w-40">Sig</th><th className="th w-20 text-right">Qty</th><th className="th w-28">Availability</th>
                  </tr></thead>
                  <tbody>
                    {(rec.items || []).map((it, i) => {
                      const avail = stockOf(it.drug); const short = avail < it.qty
                      return (
                        <tr key={i}>
                          <td className="td"><b>{it.drug}</b></td>
                          <td className="td text-body-2">{[it.dose, it.freq, it.days ? `${it.days}d` : ''].filter(Boolean).join(' · ')}</td>
                          <td className="td text-right font-mono font-semibold">{it.qty}</td>
                          <td className="td">{short ? <Chip tone="red">only {avail} in stock</Chip> : <Chip tone="green">{avail} available</Chip>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="text-[11.5px] text-body-3 mt-2">⚡ FEFO — the earliest-expiry batch of each drug is dispensed first.</p>
              </div>
            ))}
            {pending.length === 0 && <div className="card p-8 text-center text-body-3 text-[13px]">Nothing to dispense. Completed consults with in-stock drugs queue here.</div>}
          </div>
        </>
      )}

      {tab === 'log' && (
        <div className="card overflow-hidden">
          <div className="flex justify-between items-center px-4 py-3.5 border-b border-line">
            <b className="font-disp">Dispensed today</b>
            <span className="text-[12px] text-body-3">{log.length} record{log.length === 1 ? '' : 's'} · {unitsToday} units</span>
          </div>
          <div className="divide-y divide-line">
            {log.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex justify-between items-center mb-1 flex-wrap gap-1">
                  <b className="text-[13.5px]">{r.patientName}</b>
                  <span className="text-[12px] text-body-3 font-mono">{timeStr(r.dispensedAt)}{r.dispensedBy ? ` · ${r.dispensedBy}` : ''}</span>
                </div>
                <div className="text-[13px] text-body-2">
                  {(r.lines || []).map((l, i) => (
                    <span key={i} className="inline-block mr-3">
                      {l.drug} <b className="font-mono">×{l.dispensed}</b>{l.shortBy > 0 ? <span className="text-danger"> (short {l.shortBy})</span> : ''}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {log.length === 0 && <div className="px-4 py-8 text-center text-body-3 text-[13px]">No medicines dispensed yet today.</div>}
          </div>
        </div>
      )}

      {tab === 'waste' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 flex flex-col gap-4">
            {expiredBatches.length > 0 && (
              <div className="card overflow-hidden">
                <div className="flex justify-between items-center px-4 py-3.5 border-b border-line">
                  <b className="font-disp">Expired batches to discard</b>
                  <span className="text-[12px] text-body-3">{expiredBatches.length} batch{expiredBatches.length === 1 ? '' : 'es'}</span>
                </div>
                <table className="w-full text-[13px] border-collapse">
                  <tbody>
                    {expiredBatches.map((r) => (
                      <tr key={r.id} className="hover:bg-[#FBFAF7]">
                        <td className="td"><b>{r.drug}</b> <span className="font-mono text-body-2">· {r.batch}</span></td>
                        <td className="td font-mono text-body-2">exp {r.expiry}</td>
                        <td className="td text-right font-mono">{r.qty}</td>
                        <td className="td w-40"><button className="btn !py-1 !text-[12px]" disabled={busy} onClick={() => discardExpired(r)}>Discard → waste</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="card overflow-hidden">
              <div className="flex justify-between items-center px-4 py-3.5 border-b border-line">
                <b className="font-disp">Biomedical waste register</b>
                <span className="text-[12px] text-body-3">this month · {waste.length} entr{waste.length === 1 ? 'y' : 'ies'}</span>
              </div>
              <table className="w-full text-[13px] border-collapse">
                <thead><tr><th className="th">Item</th><th className="th w-56">Category</th><th className="th w-16 text-right">Qty</th><th className="th w-28">Disposal</th></tr></thead>
                <tbody>
                  {waste.map((w) => (
                    <tr key={w.id}>
                      <td className="td">{w.item}<div className="text-[11.5px] text-body-3">{w.handledBy || '—'}</div></td>
                      <td className="td"><Chip tone={w.category?.startsWith('Yellow') ? 'amber' : w.category?.startsWith('Red') ? 'red' : w.category?.startsWith('Blue') ? 'teal' : 'gray'}>{(w.category || '').split(' — ')[0]}</Chip></td>
                      <td className="td text-right font-mono">{w.qty} {w.unit}</td>
                      <td className="td text-body-2">{w.disposal || '—'}</td>
                    </tr>
                  ))}
                  {waste.length === 0 && <tr><td className="td text-body-3" colSpan={4}>No waste entries this month.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card p-4 h-fit">
            <b className="font-disp block mb-3">Record waste</b>
            <div className="grid gap-2.5">
              <div><label className="lbl">Category</label>
                <select className="inp" value={wasteForm.category} onChange={(e) => setWasteForm((w) => ({ ...w, category: e.target.value }))}>
                  {BMW_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></div>
              <div><label className="lbl">Item</label><input className="inp" placeholder="Used syringes, expired vials…" value={wasteForm.item} onChange={(e) => setWasteForm((w) => ({ ...w, item: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-2.5">
                <div><label className="lbl">Qty</label><input className="inp font-mono" type="number" value={wasteForm.qty} onChange={(e) => setWasteForm((w) => ({ ...w, qty: e.target.value }))} /></div>
                <div><label className="lbl">Unit</label><input className="inp" value={wasteForm.unit} onChange={(e) => setWasteForm((w) => ({ ...w, unit: e.target.value }))} /></div>
              </div>
              <div><label className="lbl">Disposal route</label><input className="inp" placeholder="CBWTF pickup / Yellow bag" value={wasteForm.disposal} onChange={(e) => setWasteForm((w) => ({ ...w, disposal: e.target.value }))} /></div>
              <button className="btn-pri" onClick={logWaste}>+ Record</button>
            </div>
          </div>
        </div>
      )}

      <Modal open={modal} title="Add stock batch" onClose={() => { setModal(false); setForm(EMPTY) }}
        footer={<>
          <button className="btn" onClick={() => { setModal(false); setForm(EMPTY) }}>Cancel</button>
          <button className="btn-pri" onClick={save}>Add batch</button>
        </>}>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="col-span-2"><label className="lbl">Drug (with strength)</label>
            <input className="inp" placeholder="Paracetamol 650 mg" value={form.drug} onChange={(e) => setForm((f) => ({ ...f, drug: e.target.value }))} /></div>
          <div><label className="lbl">Batch no.</label><input className="inp font-mono" value={form.batch} onChange={(e) => setForm((f) => ({ ...f, batch: e.target.value }))} /></div>
          <div><label className="lbl">Expiry</label><input className="inp font-mono" type="date" value={form.expiry} onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))} /></div>
          <div><label className="lbl">Quantity</label><input className="inp font-mono" type="number" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} /></div>
          <div><label className="lbl">MRP ₹</label><input className="inp font-mono" type="number" value={form.mrp} onChange={(e) => setForm((f) => ({ ...f, mrp: e.target.value }))} /></div>
          <div><label className="lbl">Min-stock alert</label><input className="inp font-mono" type="number" placeholder="10" value={form.minStock} onChange={(e) => setForm((f) => ({ ...f, minStock: e.target.value }))} /></div>
          <div className="col-span-2"><label className="lbl">Purchase price ₹ (optional)</label>
            <input className="inp font-mono" type="number" value={form.purchasePrice} onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))} /></div>
        </div>
        <p className="text-[12px] text-body-3">Excel import expects columns: <b>Medicine · Batch · Expiry · Qty · MRP · Purchase price</b>.</p>
      </Modal>

      {toastMsg && <div className="fixed bottom-6 right-6 bg-ink text-white px-5 py-3 rounded-[10px] text-[13px] z-50 shadow-xl">{toastMsg}</div>}
    </div>
  )
}
