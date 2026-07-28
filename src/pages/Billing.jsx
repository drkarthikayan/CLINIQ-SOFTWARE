import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../store/authStore'
import { Chip, Stat, Modal } from '../components/ui'
import {
  watchInvoices, settleInvoice, voidInvoice, updateInvoice, normalizeInvoice,
} from '../services/billing.service'

const MODES = [
  { key: 'upi', label: 'UPI' },
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Card' },
  { key: 'credit', label: 'Credit' },
]
const STATUS_TONE = { paid: 'green', partial: 'amber', unpaid: 'gray', void: 'red' }

const rupee = (n) => '₹' + (Math.round((n ?? 0) * 100) / 100).toLocaleString('en-IN')
const toMillis = (t) => {
  if (!t) return 0
  if (typeof t === 'string') return new Date(t).getTime()
  if (typeof t?.toMillis === 'function') return t.toMillis()
  if (t?.seconds != null) return t.seconds * 1000
  return 0
}
const dayKey = (t) => { const ms = toMillis(t); return ms ? new Date(ms).toLocaleDateString('en-CA') : '' }
const timeStr = (t) => (toMillis(t) ? new Date(toMillis(t)).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—')
const todayISO = () => new Date().toLocaleDateString('en-CA')
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
const prettyDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
const invoiceNo = (id) => 'INV-' + String(id || '').slice(-6).toUpperCase()

export default function Billing() {
  const user = useAuth((s) => s.user)
  const [raw, setRaw] = useState([])
  const [dateISO, setDateISO] = useState(todayISO())
  const [settling, setSettling] = useState(null)     // normalized invoice
  const [pay, setPay] = useState({ discount: '', received: '', mode: 'cash', note: '' })
  const [receipt, setReceipt] = useState(null)
  const [addItemFor, setAddItemFor] = useState(null)
  const [item, setItem] = useState({ label: '', amount: '' })
  const [busy, setBusy] = useState(false)
  const [toastMsg, setToastMsg] = useState('')

  useEffect(() => watchInvoices(user.tenantId, setRaw), [user.tenantId])
  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3200) }

  const invoices = useMemo(() => raw.map(normalizeInvoice), [raw])
  const open = useMemo(() => invoices.filter((i) => i.status === 'unpaid' || i.status === 'partial'), [invoices])
  const settledOnDate = useMemo(
    () => invoices.filter((i) => (i.status === 'paid' || i.status === 'partial') && dayKey(i.paidAt) === dateISO),
    [invoices, dateISO],
  )

  const collected = useMemo(() => settledOnDate.reduce((s, i) => s + (i.paid || 0), 0), [settledOnDate])
  const byMode = useMemo(() => {
    const m = { upi: 0, cash: 0, card: 0, credit: 0 }
    settledOnDate.forEach((i) => { if (m[i.mode] != null) m[i.mode] += i.paid || 0 })
    return m
  }, [settledOnDate])
  const outstanding = useMemo(() => open.reduce((s, i) => s + i.balance, 0), [open])
  const discountToday = useMemo(() => settledOnDate.reduce((s, i) => s + (i.discount || 0), 0), [settledOnDate])

  /* ---------------- settle ---------------- */
  const openSettle = (inv) => {
    setSettling(inv)
    setPay({ discount: inv.discount ? String(inv.discount) : '', received: String(inv.balance), mode: 'cash', note: '' })
  }
  const discountNum = Number(pay.discount) || 0
  const payableNow = settling ? Math.max(0, settling.total - discountNum) : 0
  const receivedNum = Number(pay.received) || 0
  const balanceNow = Math.max(0, payableNow - (settling ? settling.paid : 0) - receivedNum)

  const applyPct = (pct) => setPay((p) => ({ ...p, discount: String(Math.round((settling.total * pct) / 100)) }))

  const doSettle = async () => {
    if (!settling || busy) return
    if (discountNum > settling.total) { toast('Discount cannot exceed the bill total'); return }
    setBusy(true)
    try {
      await settleInvoice(user.tenantId, settling.id, {
        mode: pay.mode, received: settling.paid + receivedNum, discount: discountNum,
        total: settling.total, note: pay.note,
      })
      setSettling(null)
      toast(balanceNow > 0
        ? `${settling.patientName} · ${rupee(receivedNum)} received · ${rupee(balanceNow)} balance`
        : `${settling.patientName} · ${rupee(receivedNum)} collected via ${pay.mode.toUpperCase()}`)
    } finally { setBusy(false) }
  }

  const doVoid = async (inv) => {
    const reason = window.prompt(`Void ${invoiceNo(inv.id)} for ${inv.patientName}? Enter a reason:`)
    if (!reason) return
    await voidInvoice(user.tenantId, inv.id, reason)
    toast('Invoice voided')
  }

  const addItem = async () => {
    const amount = Number(item.amount)
    if (!item.label.trim() || !amount) { toast('Enter an item name and amount'); return }
    const lines = [...(addItemFor.lines || []), { label: item.label.trim(), amount, source: 'custom' }]
    await updateInvoice(user.tenantId, addItemFor.id, { lines })
    setAddItemFor(null); setItem({ label: '', amount: '' })
    toast('Item added')
  }
  const removeLine = async (inv, idx) => {
    const lines = (inv.lines || []).filter((_, i) => i !== idx)
    await updateInvoice(user.tenantId, inv.id, { lines })
    toast('Line removed')
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
        <Stat k="To collect" v={rupee(outstanding)} tone={outstanding ? 'text-caution' : ''} />
        <Stat k={dateISO === todayISO() ? 'Collected today' : 'Collected'} v={rupee(collected)} tone="text-teal-dark" />
        <Stat k="Bills settled" v={settledOnDate.length} />
        <Stat k="Open bills" v={open.length} />
      </div>

      <div className="card p-3.5 mb-4 flex flex-wrap gap-x-6 gap-y-1.5 text-[13px] items-center">
        <span className="text-body-3 uppercase text-[11px] tracking-wide">By mode</span>
        {MODES.map((m) => (
          <span key={m.key} className="font-mono"><b className="text-body">{m.label}</b> {rupee(byMode[m.key])}</span>
        ))}
        {discountToday > 0 && <span className="font-mono text-caution">Discounts {rupee(discountToday)}</span>}
      </div>

      {/* Open bills */}
      <div className="card overflow-hidden mb-4">
        <div className="flex justify-between items-center px-4 py-3.5 border-b border-line">
          <b className="font-disp">To collect</b>
          <span className="text-[12px] text-body-3">{open.length} open · {rupee(outstanding)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse min-w-[720px]">
            <thead><tr>
              <th className="th w-24">Invoice</th><th className="th">Patient</th><th className="th">Items</th>
              <th className="th w-24 text-right">Due</th><th className="th w-56"></th>
            </tr></thead>
            <tbody>
              {open.map((inv) => (
                <tr key={inv.id} className="hover:bg-[#FBFAF7]">
                  <td className="td font-mono text-[12px] text-body-2">{invoiceNo(inv.id)}</td>
                  <td className="td">
                    <b>{inv.patientName}</b>
                    {inv.status === 'partial' && <Chip tone="amber" className="ml-1.5">part paid {rupee(inv.paid)}</Chip>}
                  </td>
                  <td className="td text-body-2 text-[12.5px]">{(inv.lines || []).map((l) => l.label).join(', ')}</td>
                  <td className="td text-right font-mono font-semibold">{rupee(inv.balance)}</td>
                  <td className="td">
                    <div className="flex gap-1.5 justify-end whitespace-nowrap">
                      <button className="btn-ghost !text-[12px] !px-1.5" onClick={() => setAddItemFor(inv)}>+ Item</button>
                      <button className="btn-ghost !text-[12px] !px-1.5" onClick={() => setReceipt(inv)}>Bill</button>
                      <button className="btn-ghost !text-[12px] !px-1.5 !text-danger" onClick={() => doVoid(inv)}>Void</button>
                      <button className="btn-pri !py-1 !px-2.5 !text-[12px]" onClick={() => openSettle(inv)}>Settle →</button>
                    </div>
                  </td>
                </tr>
              ))}
              {open.length === 0 && (
                <tr><td className="td text-center text-body-3 py-8" colSpan={5}>Nothing pending. Completed consults queue here automatically.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Collections for a day */}
      <div className="card overflow-hidden">
        <div className="flex justify-between items-center px-4 py-3 border-b border-line flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <b className="font-disp">Collections</b>
            <div className="flex items-center gap-1">
              <button className="btn !px-2 !py-1 !text-[12px]" onClick={() => setDateISO((d) => addDays(d, -1))}>‹</button>
              <button className="btn !py-1 !text-[12px]" onClick={() => setDateISO(todayISO())}>Today</button>
              <button className="btn !px-2 !py-1 !text-[12px]" onClick={() => setDateISO((d) => addDays(d, 1))}>›</button>
            </div>
            <span className="text-[12.5px] text-body-2">{prettyDate(dateISO)}</span>
          </div>
          <span className="text-[12px] text-body-3 font-mono">{rupee(collected)} · {settledOnDate.length} bill{settledOnDate.length === 1 ? '' : 's'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse min-w-[640px]">
            <thead><tr>
              <th className="th w-24">Invoice</th><th className="th">Patient</th><th className="th w-24">Mode</th>
              <th className="th w-20">Time</th><th className="th w-24 text-right">Received</th>
              <th className="th w-24">Status</th><th className="th w-20"></th>
            </tr></thead>
            <tbody>
              {settledOnDate.map((inv) => (
                <tr key={inv.id} className="hover:bg-[#FBFAF7]">
                  <td className="td font-mono text-[12px] text-body-2">{invoiceNo(inv.id)}</td>
                  <td className="td">{inv.patientName}{inv.discount > 0 && <span className="text-[11.5px] text-caution"> · disc {rupee(inv.discount)}</span>}</td>
                  <td className="td"><Chip tone="gray">{(inv.mode || '').toUpperCase()}</Chip></td>
                  <td className="td font-mono text-body-2 text-[12px]">{timeStr(inv.paidAt)}</td>
                  <td className="td text-right font-mono font-semibold">{rupee(inv.paid)}</td>
                  <td className="td"><Chip tone={STATUS_TONE[inv.status]}>{inv.status}</Chip></td>
                  <td className="td"><button className="btn-ghost !text-[12px]" onClick={() => setReceipt(inv)}>Bill</button></td>
                </tr>
              ))}
              {settledOnDate.length === 0 && (
                <tr><td className="td text-center text-body-3 py-8" colSpan={7}>No collections on {prettyDate(dateISO)}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Settle */}
      <Modal
        open={!!settling}
        title={settling ? `Settle ${invoiceNo(settling.id)} — ${settling.patientName}` : 'Settle'}
        onClose={() => setSettling(null)}
        width="max-w-[620px]"
        footer={<>
          <button className="btn" onClick={() => setSettling(null)}>Cancel</button>
          <button className="btn-pri" disabled={busy} onClick={doSettle}>
            {balanceNow > 0 ? `Record ${rupee(receivedNum)} (part)` : `Collect ${rupee(receivedNum)}`}
          </button>
        </>}
      >
        {settling && (
          <div className="grid gap-3">
            <table className="w-full text-[13px]">
              <tbody>
                {(settling.lines || []).map((l, i) => (
                  <tr key={i} className="border-b border-line">
                    <td className="py-1.5">{l.label}<span className="text-body-3 text-[11.5px]"> · {l.source}</span></td>
                    <td className="py-1.5 text-right font-mono">{rupee(l.amount)}</td>
                    <td className="py-1.5 w-8 text-right"><button className="btn-ghost !text-[11px] !px-1" onClick={() => { removeLine(settling, i); setSettling(null) }}>✕</button></td>
                  </tr>
                ))}
                <tr><td className="pt-2">Subtotal</td><td className="pt-2 text-right font-mono">{rupee(settling.total)}</td><td /></tr>
                {settling.paid > 0 && <tr><td className="text-body-2">Already paid</td><td className="text-right font-mono text-body-2">− {rupee(settling.paid)}</td><td /></tr>}
              </tbody>
            </table>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="lbl">Discount ₹</label>
                <input className="inp font-mono" type="number" value={pay.discount} onChange={(e) => setPay((p) => ({ ...p, discount: e.target.value }))} />
                <div className="flex gap-1.5 mt-1.5">
                  {[5, 10, 20].map((p) => <button key={p} className="chip-gray hover:opacity-80" onClick={() => applyPct(p)}>{p}%</button>)}
                  <button className="chip-gray hover:opacity-80" onClick={() => setPay((p) => ({ ...p, discount: '' }))}>clear</button>
                </div>
              </div>
              <div>
                <label className="lbl">Amount received ₹</label>
                <input className="inp font-mono" type="number" value={pay.received} onChange={(e) => setPay((p) => ({ ...p, received: e.target.value }))} />
                <button className="chip-teal mt-1.5 hover:opacity-80" onClick={() => setPay((p) => ({ ...p, received: String(Math.max(0, payableNow - settling.paid)) }))}>
                  exact {rupee(Math.max(0, payableNow - settling.paid))}
                </button>
              </div>
            </div>

            <div>
              <label className="lbl">Payment mode</label>
              <div className="flex gap-1.5 flex-wrap">
                {MODES.map((m) => (
                  <button key={m.key} onClick={() => setPay((p) => ({ ...p, mode: m.key }))}
                    className={pay.mode === m.key ? 'btn-pri !py-1.5 !text-[12.5px]' : 'btn !py-1.5 !text-[12.5px]'}>{m.label}</button>
                ))}
              </div>
            </div>

            <input className="inp" placeholder="Note (optional) — e.g. concession approved by Dr. Priya" value={pay.note} onChange={(e) => setPay((p) => ({ ...p, note: e.target.value }))} />

            <div className="bg-[#FBFAF7] border border-line rounded-lg px-3.5 py-2.5 text-[13px] grid gap-1">
              <div className="flex justify-between"><span>Payable after discount</span><b className="font-mono">{rupee(payableNow)}</b></div>
              <div className="flex justify-between"><span>Receiving now</span><b className="font-mono">{rupee(receivedNum)}</b></div>
              <div className={`flex justify-between ${balanceNow > 0 ? 'text-caution font-medium' : 'text-ok'}`}>
                <span>{balanceNow > 0 ? 'Balance remaining' : 'Fully settled'}</span>
                <b className="font-mono">{rupee(balanceNow)}</b>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Add custom item */}
      <Modal open={!!addItemFor} title="Add line item"
        onClose={() => { setAddItemFor(null); setItem({ label: '', amount: '' }) }}
        footer={<>
          <button className="btn" onClick={() => { setAddItemFor(null); setItem({ label: '', amount: '' }) }}>Cancel</button>
          <button className="btn-pri" onClick={addItem}>Add to bill</button>
        </>}>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><label className="lbl">Item</label>
            <input className="inp" placeholder="Dressing, procedure, etc." value={item.label} onChange={(e) => setItem((s) => ({ ...s, label: e.target.value }))} /></div>
          <div><label className="lbl">Amount ₹</label>
            <input className="inp font-mono" type="number" value={item.amount} onChange={(e) => setItem((s) => ({ ...s, amount: e.target.value }))} /></div>
        </div>
      </Modal>

      {/* Bill / receipt */}
      <Modal open={!!receipt} title="Bill" onClose={() => setReceipt(null)}
        footer={<>
          <button className="btn" onClick={() => setReceipt(null)}>Close</button>
          <button className="btn-pri" onClick={() => window.print()}>Print</button>
        </>}>
        {receipt && (
          <div id="receipt-print" className="text-[13px]">
            <div className="text-center border-b border-line pb-2.5 mb-2.5">
              <div className="font-disp font-semibold text-[17px]">{user.tenantName || user.tenantId}</div>
              <div className="text-body-3 text-[12px]">
                {invoiceNo(receipt.id)} · {new Date(toMillis(receipt.createdAt) || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
            <div className="flex justify-between mb-2.5">
              <span><b>{receipt.patientName}</b></span>
              <span className="font-mono text-body-2">{receipt.status === 'paid' ? `${(receipt.mode || '').toUpperCase()} · paid` : receipt.status === 'partial' ? 'Part paid' : receipt.status}</span>
            </div>
            <table className="w-full">
              <tbody>
                {(receipt.lines || []).map((l, i) => (
                  <tr key={i}><td className="py-1">{l.label}</td><td className="py-1 text-right font-mono">{rupee(l.amount)}</td></tr>
                ))}
                <tr className="border-t border-line"><td className="pt-2">Subtotal</td><td className="pt-2 text-right font-mono">{rupee(receipt.total)}</td></tr>
                {receipt.discount > 0 && <tr><td>Discount</td><td className="text-right font-mono">− {rupee(receipt.discount)}</td></tr>}
                <tr className="font-semibold"><td>Payable</td><td className="text-right font-mono">{rupee(receipt.payable)}</td></tr>
                <tr><td>Paid</td><td className="text-right font-mono">{rupee(receipt.paid)}</td></tr>
                {receipt.balance > 0 && <tr className="text-caution font-semibold"><td>Balance</td><td className="text-right font-mono">{rupee(receipt.balance)}</td></tr>}
              </tbody>
            </table>
            {receipt.note && <p className="text-[11.5px] text-body-3 mt-2">{receipt.note}</p>}
          </div>
        )}
      </Modal>

      {toastMsg && (
        <div className="fixed bottom-6 right-6 bg-ink text-white px-5 py-3 rounded-[10px] text-[13px] z-50 shadow-xl">{toastMsg}</div>
      )}
    </div>
  )
}
