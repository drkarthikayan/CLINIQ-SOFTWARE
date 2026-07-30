// Printable prescription sheet + WhatsApp share text.
//
// Indian practice needs a real letterhead: clinic name, address, registration
// number, the prescribing doctor's name + council registration, and a signature
// block. Vernacular dosage lines are an ADDITION beneath the English sig, never
// a replacement — the doctor stays responsible for what is printed.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Common OPD frequency patterns → local phrasing. Deliberately limited to
// everyday, unambiguous words; anything unrecognised falls back to English only.
const TIMING = {
  ta: { morning: 'காலை', noon: 'மதியம்', night: 'இரவு', afterFood: 'உணவுக்குப் பிறகு', beforeFood: 'உணவுக்கு முன்', days: 'நாட்கள்' },
  hi: { morning: 'सुबह', noon: 'दोपहर', night: 'रात', afterFood: 'खाने के बाद', beforeFood: 'खाने से पहले', days: 'दिन' },
}

// Returns e.g. "காலை · இரவு · உணவுக்குப் பிறகு · 3 நாட்கள்" or '' when unknown.
export function vernacularSig(freq, days, lang) {
  const t = TIMING[lang]
  if (!t) return ''
  const f = String(freq || '').toUpperCase()
  const slots = []
  const pattern = f.match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/)
  if (pattern) {
    if (+pattern[1]) slots.push(t.morning)
    if (+pattern[2]) slots.push(t.noon)
    if (+pattern[3]) slots.push(t.night)
  } else if (/\bOD\b/.test(f)) slots.push(t.morning)
  else if (/\bBD\b|\bBID\b/.test(f)) slots.push(t.morning, t.night)
  else if (/\bTDS\b|\bTID\b/.test(f)) slots.push(t.morning, t.noon, t.night)
  else if (/\bHS\b/.test(f)) slots.push(t.night)
  if (!slots.length) return ''
  const food = /AFTER/.test(f) ? t.afterFood : /BEFORE/.test(f) ? t.beforeFood : ''
  const parts = [slots.join(' · ')]
  if (food) parts.push(food)
  if (days) parts.push(`${days} ${t.days}`)
  return parts.join(' · ')
}

export function buildRxHtml({ clinic = {}, doctor, patient, visit, consult, lang }) {
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const dx = consult.mode === 'soap' ? consult.a : consult.dx
  const rows = (consult.rx || []).map((r, i) => {
    const vern = vernacularSig(r.freq, r.days, lang)
    return `<tr>
      <td class="n">${i + 1}</td>
      <td><b>${esc(r.drug)}</b>${vern ? `<div class="vern">${esc(vern)}</div>` : ''}</td>
      <td>${esc(r.dose || '')}</td>
      <td>${esc(r.freq || '')}</td>
      <td class="c">${esc(r.days || '')}</td>
    </tr>`
  }).join('')

  const labs = [...(consult.labs || []), consult.labsCustom].filter(Boolean)
  const reviewLine = consult.reviewDays
    ? `Review after ${esc(consult.reviewDays)} days — on or after ${new Date(Date.now() + Number(consult.reviewDays) * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"><title>Prescription — ${esc(patient?.name || visit.patientName)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Inter,system-ui,sans-serif;color:#1E2B31;margin:0;padding:28px 32px;font-size:13px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0E7C6B;padding-bottom:10px}
  .clinic{font-size:19px;font-weight:700;color:#15262E}
  .muted{color:#5C6B70;font-size:11.5px;line-height:1.5}
  .doc{text-align:right}
  .pt{display:flex;justify-content:space-between;gap:16px;margin:14px 0;padding:10px 12px;background:#FAF9F6;border:1px solid #E5E4DE;border-radius:8px}
  .rx{font-size:26px;font-weight:700;color:#0E7C6B;margin:16px 0 6px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#8B9699;border-bottom:1px solid #E5E4DE;padding:5px 6px}
  td{padding:7px 6px;border-bottom:1px solid #F0EFEA;vertical-align:top}
  td.n,td.c{text-align:center;width:38px}
  .vern{font-size:11.5px;color:#0A5F52;margin-top:2px}
  .sec{margin-top:14px}
  .sec h4{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8B9699}
  .sign{margin-top:46px;text-align:right}
  .sign .line{display:inline-block;border-top:1px solid #1E2B31;padding-top:4px;min-width:210px;text-align:center}
  .foot{margin-top:22px;border-top:1px solid #E5E4DE;padding-top:8px;font-size:10.5px;color:#8B9699;text-align:center}
  @media print{body{padding:14px 18px}}
</style></head><body>
  <div class="head">
    <div style="display:flex;gap:12px;align-items:flex-start">
      ${clinic.logoUrl ? `<img src="${esc(clinic.logoUrl)}" alt="" style="height:46px;width:auto;object-fit:contain">` : ''}
      <div>
      <div class="clinic">${esc(clinic.name || 'Clinic')}</div>
      <div class="muted">${esc(clinic.address || '')}${clinic.city ? `, ${esc(clinic.city)}` : ''}${clinic.phone ? `<br>Ph: ${esc(clinic.phone)}` : ''}${clinic.regNo ? `<br>Clinic Reg: ${esc(clinic.regNo)}` : ''}</div>
      </div>
    </div>
    <div class="doc">
      <div style="font-weight:600">${esc(doctor?.name || '')}</div>
      <div class="muted">${esc(doctor?.qualification || '')}${doctor?.regNo ? `<br>Reg. No: ${esc(doctor.regNo)}` : ''}</div>
    </div>
  </div>

  <div class="pt">
    <div><b>${esc(patient?.name || visit.patientName)}</b><div class="muted">${esc(visit.age ?? '')} yrs · ${esc(visit.sex || '')}${patient?.mrn ? ` · MRN ${esc(patient.mrn)}` : ''}</div></div>
    <div class="muted" style="text-align:right">${today}${visit.token ? `<br>Token ${esc(visit.token)}` : ''}</div>
  </div>

  ${patient?.allergies?.length ? `<div class="muted" style="color:#B3261E"><b>⚠ Allergies:</b> ${esc(patient.allergies.join(', '))}</div>` : ''}
  ${dx ? `<div class="sec"><h4>Diagnosis</h4><div>${esc(dx)}</div></div>` : ''}

  <div class="rx">℞</div>
  <table><thead><tr><th></th><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Days</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" class="muted">No medicines prescribed.</td></tr>'}</tbody></table>

  ${labs.length ? `<div class="sec"><h4>Investigations</h4><div>${esc(labs.join(', '))}</div></div>` : ''}
  ${consult.advice ? `<div class="sec"><h4>Advice</h4><div>${esc(consult.advice)}</div></div>` : ''}
  ${reviewLine ? `<div class="sec"><h4>Follow-up</h4><div>${esc(reviewLine)}</div></div>` : ''}

  <div class="sign"><div class="line">${esc(doctor?.name || 'Doctor')}${doctor?.regNo ? `<div class="muted">Reg. No: ${esc(doctor.regNo)}</div>` : ''}</div></div>
  <div class="foot">Generated by CLINIQ · Not valid for medico-legal use without the prescriber's signature.</div>
</body></html>`
}

export function openRxPrint(payload) {
  const w = window.open('', '_blank', 'width=820,height=1000')
  if (!w) return false
  w.document.write(buildRxHtml(payload))
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 350)
  return true
}

// WhatsApp deep link. Sends readable text (a hosted PDF needs storage + a
// public link, which is a later step) — enough for the patient to have the Rx
// on their phone immediately.
export function whatsappRxLink({ clinic = {}, doctor, patient, visit, consult, mobile }) {
  const dx = consult.mode === 'soap' ? consult.a : consult.dx
  const lines = [
    `*${clinic.name || 'Clinic'}*`,
    `${patient?.name || visit.patientName} · ${new Date().toLocaleDateString('en-IN')}`,
    dx ? `\n*Diagnosis:* ${dx}` : '',
    (consult.rx || []).length ? '\n*Prescription:*' : '',
    ...(consult.rx || []).map((r, i) => `${i + 1}. ${r.drug} — ${[r.dose, r.freq, r.days ? `${r.days} days` : ''].filter(Boolean).join(', ')}`),
    (consult.labs || []).length ? `\n*Tests:* ${consult.labs.join(', ')}` : '',
    consult.advice ? `\n*Advice:* ${consult.advice}` : '',
    consult.reviewDays ? `\n*Review after:* ${consult.reviewDays} days` : '',
    doctor?.name ? `\n— ${doctor.name}` : '',
  ].filter(Boolean)
  const digits = String(mobile || '').replace(/\D/g, '').slice(-10)
  const to = digits.length === 10 ? `91${digits}` : ''
  return `https://wa.me/${to}?text=${encodeURIComponent(lines.join('\n'))}`
}


/* ---------------- PDF ----------------
   Rendered by rasterising the same letterhead HTML used for printing, so the
   PDF is pixel-identical to what the doctor signs — and, critically, Tamil and
   Hindi dosage lines come out correct. (Generating text-native PDF via jsPDF
   would need an embedded Unicode font per script; rasterising uses the fonts
   the browser already has.) Both libraries are dynamically imported so they
   never touch the main bundle. */

const A4 = { w: 210, h: 297 }   // mm

async function renderSheetToCanvas(payload) {
  const [{ default: html2canvas }] = await Promise.all([import('html2canvas')])
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;height:1160px;border:0;'
  document.body.appendChild(frame)
  try {
    const doc = frame.contentDocument
    doc.open(); doc.write(buildRxHtml(payload)); doc.close()
    // Give webfonts/logo a moment so they are captured, not missing.
    if (doc.fonts?.ready) await doc.fonts.ready.catch(() => {})
    await new Promise((r) => setTimeout(r, 250))
    // Capture the CONTENT height, not the iframe's. A fixed frame height made
    // a one-page Rx measure a hair over A4 and emit a blank second page.
    const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 200)
    frame.style.height = `${h}px`
    return await html2canvas(doc.body, {
      scale: 2, backgroundColor: '#FFFFFF', useCORS: true, logging: false,
      height: h, windowHeight: h,
    })
  } finally {
    document.body.removeChild(frame)
  }
}

export async function makeRxPdfBlob(payload) {
  const [{ jsPDF }, canvas] = await Promise.all([import('jspdf'), renderSheetToCanvas(payload)])
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const imgH = (canvas.height * A4.w) / canvas.width
  const img = canvas.toDataURL('image/jpeg', 0.92)
  if (imgH <= A4.h + 1) {   // 1mm tolerance so rounding never adds a blank page
    pdf.addImage(img, 'JPEG', 0, 0, A4.w, imgH)
  } else {
    // Long prescription: slice across pages rather than squashing it.
    let left = imgH, page = 0
    while (left > 0) {
      if (page) pdf.addPage()
      pdf.addImage(img, 'JPEG', 0, -page * A4.h, A4.w, imgH)
      left -= A4.h; page++
    }
  }
  return pdf.output('blob')
}

export const rxFileName = ({ patient, visit }) =>
  `Rx-${(patient?.name || visit?.patientName || 'patient').replace(/[^\w]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`

export async function downloadRxPdf(payload) {
  const blob = await makeRxPdfBlob(payload)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = rxFileName(payload)
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return true
}

// Share the PDF itself. On phones (Android/iOS) the Web Share API hands the
// real file to WhatsApp. Desktop browsers cannot attach a local file to a
// wa.me link, so there we download the PDF and open the chat with the text
// version — the doctor attaches the file, which is one tap and honest about
// what the browser allows.
export async function shareRxPdf(payload) {
  const blob = await makeRxPdfBlob(payload)
  const file = new File([blob], rxFileName(payload), { type: 'application/pdf' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Prescription', text: `Prescription — ${payload.patient?.name || payload.visit?.patientName}` })
      return { mode: 'shared' }
    } catch (e) {
      if (e?.name === 'AbortError') return { mode: 'cancelled' }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = rxFileName(payload)
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  window.open(whatsappRxLink(payload), '_blank')
  return { mode: 'downloaded' }
}
