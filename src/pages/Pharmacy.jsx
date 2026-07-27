import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../store/authStore'
import { Chip, Stat, Modal } from '../components/ui'
import {
  watchStock, addStockItem, importStockRows,
  isNearExpiry, isExpired, LOW_STOCK_THRESHOLD,
} from '../services/stock.service'

const rupee = (n) => '₹' + (n ?? 0).toLocaleString('en-IN')
const EMPTY = { drug: '', batch: '', expiry: '', qty: '', mrp: '', purchasePrice: '' }

// Normalize an imported expiry cell (Excel Date, serial, or string) to ISO date.
function normalizeExpiry(v) {
  if (!v) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const parsed = new Date(v)
  return isNaN(parsed) ? String(v) : parsed.toISOString().slice(0, 10)
}
function pickCol(row, names) {
  for (const key of Object.keys(row)) {
    if (names.includes(key.trim().toLowerCase())) return row[key]
  }
  return ''
}

export default function Pharmacy() {
  const user = useAuth((s) => s.user)
  const [stock, setStock] = useState([])
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [toastMsg, setToastMsg] = useState('')
  const fileRef = useRef(null)

  useEffect(() => watchStock(user.tenantId, setStock), [user.tenantId])
  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3400) }

  // Per-drug totals drive the low-stock flag (a drug is low if all its batches
  // together fall to/below the threshold).
  const drugTotals = useMemo(() => {
    const m = {}
    stock.forEach((r) => { m[r.drug] = (m[r.drug] || 0) + (r.qty ?? 0) })
    return m
  }, [stock])

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return stock
      .filter((r) => !t || r.drug?.toLowerCase().includes(t) || r.batch?.toLowerCase().includes(t))
      .sort((a, b) => new Date(a.expiry) - new Date(b.expiry))
  }, [stock, q])

  const stats = useMemo(() => {
    const drugs = Object.keys(drugTotals)
    return {
      batches: stock.length,
      lowStock: drugs.filter((d) => drugTotals[d] <= LOW_STOCK_THRESHOLD).length,
      nearExpiry: stock.filter((r) => (r.qty ?? 0) > 0 && !isExpired(r.expiry) && isNearExpiry(r.expiry)).length,
      expired: stock.filter((r) => (r.qty ?? 0) > 0 && isExpired(r.expiry)).length,
    }
  }, [stock, drugTotals])

  const save = async () => {
    if (!form.drug.trim() || !form.batch.trim() || !form.expiry) { toast('Drug, batch and expiry are required'); return }
    await addStockItem(user.tenantId, form)
    setModal(false); setForm(EMPTY)
    toast(`Added ${form.drug} · batch ${form.batch}`)
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const mapped = raw.map((row) => ({
        drug: pickCol(row, ['medicine', 'drug', 'name', 'item']),
        batch: pickCol(row, ['batch', 'batch no', 'batch number', 'batchno']),
        expiry: normalizeExpiry(pickCol(row, ['expiry', 'expiry date', 'exp', 'exp date'])),
        qty: pickCol(row, ['qty', 'quantity', 'stock']),
        mrp: pickCol(row, ['mrp', 'price']),
        purchasePrice: pickCol(row, ['purchase price', 'purchase', 'cost', 'purchase price ']),
      })).filter((r) => r.drug)
      if (!mapped.length) { toast('No rows found — expected columns: Medicine, Batch, Expiry, Qty, MRP, Purchase price'); return }
      const n = await importStockRows(user.tenantId, mapped)
      toast(`Imported ${n} batch${n === 1 ? '' : 'es'} from ${file.name}`)
    } catch (err) {
      toast('Import failed — check the file format (.xlsx or .csv)')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
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
              const expired = isExpired(r.expiry)
              const near = !expired && isNearExpiry(r.expiry)
              const low = (drugTotals[r.drug] ?? 0) <= LOW_STOCK_THRESHOLD
              return (
                <tr key={r.id} className="hover:bg-[#FBFAF7]">
                  <td className="td"><b>{r.drug}</b></td>
                  <td className="td font-mono text-body-2">{r.batch}</td>
                  <td className="td font-mono text-body-2">{r.expiry}</td>
                  <td className="td text-right font-mono">{r.qty}</td>
                  <td className="td text-right font-mono">{rupee(r.mrp)}</td>
                  <td className="td">
                    <div className="flex gap-1.5 flex-wrap">
                      {expired && <Chip tone="red">Expired</Chip>}
                      {near && <Chip tone="amber">Near expiry</Chip>}
                      {low && <Chip tone="red">Low stock</Chip>}
                      {!expired && !near && !low && <Chip tone="green">OK</Chip>}
                    </div>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td className="td text-body-3" colSpan={6}>No stock yet. Add manually or import an Excel/CSV sheet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={modal} title="Add stock batch" onClose={() => { setModal(false); setForm(EMPTY) }}
        footer={<>
          <button className="btn" onClick={() => { setModal(false); setForm(EMPTY) }}>Cancel</button>
          <button className="btn-pri" onClick={save}>Add batch</button>
        </>}>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="col-span-2"><label className="lbl">Drug (with strength)</label>
            <input className="inp" placeholder="Paracetamol 650 mg" value={form.drug} onChange={(e) => setForm((f) => ({ ...f, drug: e.target.value }))} /></div>
          <div><label className="lbl">Batch no.</label>
            <input className="inp font-mono" value={form.batch} onChange={(e) => setForm((f) => ({ ...f, batch: e.target.value }))} /></div>
          <div><label className="lbl">Expiry</label>
            <input className="inp font-mono" type="date" value={form.expiry} onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))} /></div>
          <div><label className="lbl">Quantity</label>
            <input className="inp font-mono" type="number" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} /></div>
          <div><label className="lbl">MRP ₹</label>
            <input className="inp font-mono" type="number" value={form.mrp} onChange={(e) => setForm((f) => ({ ...f, mrp: e.target.value }))} /></div>
          <div className="col-span-2"><label className="lbl">Purchase price ₹ (optional)</label>
            <input className="inp font-mono" type="number" value={form.purchasePrice} onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))} /></div>
        </div>
        <p className="text-[12px] text-body-3">Excel import expects columns: <b>Medicine · Batch · Expiry · Qty · MRP · Purchase price</b>.</p>
      </Modal>

      {toastMsg && (
        <div className="fixed bottom-6 right-6 bg-ink text-white px-5 py-3 rounded-[10px] text-[13px] z-50 shadow-xl">{toastMsg}</div>
      )}
    </div>
  )
}
