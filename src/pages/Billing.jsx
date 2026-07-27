import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../store/authStore'
import { Chip, Stat, Modal } from '../components/ui'
import { watchInvoices, markInvoicePaid, updateInvoice } from '../services/billing.service'

const MODES = [
  { key: 'upi', label: 'UPI' },
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Card' },
  { key: 'credit', label: 'Credit' },
]

const rupee = (n) => '₹' + (n ?? 0).toLocaleString('en-IN')
const toMillis = (t) => {
  if (!t) return 0
  if (typeof t === 'string') return new Date(t).getTime()
  if (typeof t?.toMillis === 'function') return t.toMillis()
  if (t?.seconds != null) return t.seconds * 1000
  return 0
}
const isToday = (t) => {
  const d = new Date(toMillis(t))
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}
const timeStr = (t) => new Date(toMillis(t)).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

export default function Billing() {
  const user = useAuth((s) => s.user)
  const [invoices, setInvoices] = useState([])
  const [receipt, setReceipt] = useState(null)   // invoice for receipt modal
  const [addItemFor, setAddItemFor] = useState(null)
  const [item, setItem] = useState({ label: '', amount: '' })
  const [toastMsg, setToastMsg] = useState('')

  useEffect(() => watchInvoices(user.tenantId, setInvoices), [user.tenantId])
  const toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3000) }

  const unpaid = useMemo(() => invoices.filter((i) => !i.paidAt), [invoices])
  const paidToday = useMemo(() => invoices.filter((i) => i.paidAt && isToday(i.paidAt)), [invoices])

  const collected = useMemo(() => paidToday.reduce((s, i) => s + (i.total || 0), 0), [paidToday])
  const byMode = useMemo(() => {
    const m = { upi: 0, cash: 0, card: 0, credit: 0 }
    paidToday.forEach((i) => { if (m[i.mode] != null) m[i.mode] += i.total || 0 })
    return m
  }, [paidToday])
  const outstanding = useMemo(() => unpaid.reduce((s, i) => s + (i.total || 0), 0), [unpaid])

  const settle = async (inv, mode) => {
    await markInvoicePaid(user.tenantId, inv.id, mode)
    toast(`${inv.patientName} · ${rupee(inv.total)} collected via ${mode.toUpperCase()}`)
  }

  const addItem = async () => {
    const amount = Number(item.amount)
    if (!item.label.trim() || !amount) { toast('Enter an item name and amount'); return }
    const lines = [...(addItemFor.lines || []), { label: item.label.trim(), amount, source: 'custom' }]
    await updateInvoice(user.tenantId, addItemFor.id, { lines })
    setAddItemFor(null); setItem({ label: '', amount: '' })
    toast('Item added')
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
        <Stat k="To collect" v={rupee(outstanding)} tone={outstanding ? 'text-caution' : ''} />
        <Stat k="Collected today" v={rupee(collected)} tone="text-teal-dark" />
        <Stat k="Bills settled" v={paidToday.length} />
        <Stat k="Pending bills" v={unpaid.length} />
      </div>

      <div className="card p-3.5 mb-4 flex flex-wrap gap-x-6 gap-y-1.5 text-[13px]">
        <span className="text-body-3 uppercase text-[11px] tracking-wide self-center">Today by mode</span>
        {MODES.map((m) => (
          <span key={m.key} className="font-mono"><b className="text-body">{m.label}</b> {rupee(byMode[m.key])}</span>
        ))}
      </div>

      {/* To collect */}
      <div className="card overflow-hidden mb-4">
        <div className="flex justify-between items-center px-4 py-3.5 border-b border-line">
          <b className="font-disp">To collect</b>
          <span className="text-[12px] text-body-3">{unpaid.length} pending</span>
        </div>
        <table className="w-full text-[13px] border-collapse">
          <thead><tr>
            <th className="th">Patient</th><th className="th">Items</th>
            <th className="th w-24 text-right">Amount</th><th className="th w-[300px]"></th>
          </tr></thead>
          <tbody>
            {unpaid.map((inv) => (
              <tr key={inv.id} className="hover:bg-[#FBFAF7]">
                <td className="td"><b>{inv.patientName}</b></td>
                <td className="td text-body-2">{(inv.lines || []).map((l) => l.label).join(', ')}</td>
                <td className="td text-right font-mono font-semibold">{rupee(inv.total)}</td>
                <td className="td">
                  <div className="flex gap-1.5 justify-end items-center flex-wrap">
                    <button className="btn-ghost !text-[12px] !px-1.5" onClick={() => setAddItemFor(inv)}>+ Item</button>
                    <button className="btn-ghost !text-[12px] !px-1.5" onClick={() => setReceipt(inv)}>Receipt</button>
                    {MODES.map((m) => (
                      <button key={m.key} className="btn !py-1 !px-2 !text-[12px]" onClick={() => settle(inv, m.key)}>{m.label}</button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {unpaid.length === 0 && (
              <tr><td className="td text-body-3" colSpan={4}>Nothing pending. Completed consults queue here automatically.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Settled today */}
      <div className="card overflow-hidden">
        <div className="flex justify-between items-center px-4 py-3.5 border-b border-line">
          <b className="font-disp">Settled today</b>
          <span className="text-[12px] text-body-3 font-mono">{rupee(collected)}</span>
        </div>
        <table className="w-full text-[13px] border-collapse">
          <thead><tr>
            <th className="th">Patient</th><th className="th w-24">Mode</th><th className="th w-20">Time</th>
            <th className="th w-24 text-right">Amount</th><th className="th w-24"></th>
          </tr></thead>
          <tbody>
            {paidToday.map((inv) => (
              <tr key={inv.id} className="hover:bg-[#FBFAF7]">
                <td className="td">{inv.patientName}</td>
                <td className="td"><Chip tone="green">{(inv.mode || '').toUpperCase()}</Chip></td>
                <td className="td font-mono text-body-2 text-[12px]">{timeStr(inv.paidAt)}</td>
                <td className="td text-right font-mono font-semibold">{rupee(inv.total)}</td>
                <td className="td"><button className="btn-ghost !text-[12px]" onClick={() => setReceipt(inv)}>Receipt</button></td>
              </tr>
            ))}
            {paidToday.length === 0 && (
              <tr><td className="td text-body-3" colSpan={5}>No collections yet today.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add custom item */}
      <Modal
        open={!!addItemFor}
        title="Add custom line item"
        onClose={() => { setAddItemFor(null); setItem({ label: '', amount: '' }) }}
        footer={<>
          <button className="btn" onClick={() => { setAddItemFor(null); setItem({ label: '', amount: '' }) }}>Cancel</button>
          <button className="btn-pri" onClick={addItem}>Add to bill</button>
        </>}
      >
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><label className="lbl">Item</label>
            <input className="inp" placeholder="Dressing, procedure, etc." value={item.label} onChange={(e) => setItem((s) => ({ ...s, label: e.target.value }))} /></div>
          <div><label className="lbl">Amount ₹</label>
            <input className="inp font-mono" type="number" value={item.amount} onChange={(e) => setItem((s) => ({ ...s, amount: e.target.value }))} /></div>
        </div>
      </Modal>

      {/* Receipt */}
      <Modal open={!!receipt} title="Receipt" onClose={() => setReceipt(null)}
        footer={<>
          <button className="btn" onClick={() => setReceipt(null)}>Close</button>
          <button className="btn-pri" onClick={() => window.print()}>Print</button>
        </>}>
        {receipt && (
          <div id="receipt-print" className="text-[13px]">
            <div className="text-center border-b border-line pb-2.5 mb-2.5">
              <div className="font-disp font-semibold text-[17px]">{user.tenantName || user.tenantId}</div>
              <div className="text-body-3 text-[12px]">Tax invoice · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
            </div>
            <div className="flex justify-between mb-2.5">
              <span><b>{receipt.patientName}</b></span>
              <span className="font-mono text-body-2">{receipt.paidAt ? (receipt.mode || '').toUpperCase() + ' · paid' : 'Unpaid'}</span>
            </div>
            <table className="w-full">
              <tbody>
                {(receipt.lines || []).map((l, i) => (
                  <tr key={i}><td className="py-1">{l.label}</td><td className="py-1 text-right font-mono">{rupee(l.amount)}</td></tr>
                ))}
                <tr className="border-t border-line font-semibold"><td className="pt-2">Total</td><td className="pt-2 text-right font-mono">{rupee(receipt.total)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {toastMsg && (
        <div className="fixed bottom-6 right-6 bg-ink text-white px-5 py-3 rounded-[10px] text-[13px] z-50 shadow-xl">{toastMsg}</div>
      )}
    </div>
  )
}
