// Clinical decision support: drug-class allergy matching (incl. cross-
// reactivity), therapeutic duplication, vitals flagging and pre-completion checks.
// Deliberately conservative and transparent — every warning says WHY, and only
// a true allergy conflict hard-blocks. This is MVP-scale support, not a
// substitute for a licensed drug database (Medispan/FDB) at production scale.

/* ---------------- drug classes ---------------- */
// Generic + common Indian brand stems. Matching is substring-on-token, so
// "Amoxicillin 500 mg" and "Augmentin 625" both resolve to the penicillin class.
export const DRUG_CLASSES = {
  // NB: no bare 'mox' stem — it would match cotri*mox*azole (a sulfonamide) and
  // both misclassify it and mask a genuine sulfa allergy.
  penicillin: ['penicillin', 'amoxicillin', 'amoxycillin', 'ampicillin', 'cloxacillin', 'augmentin', 'co-amoxiclav', 'coamoxiclav', 'piperacillin', 'benzathine'],
  cephalosporin: ['cephalexin', 'cefalexin', 'cefadroxil', 'cefuroxime', 'cefixime', 'cefpodoxime', 'ceftriaxone', 'cefotaxime', 'cefaclor'],
  sulfonamide: ['sulfa', 'sulfamethoxazole', 'cotrimoxazole', 'co-trimoxazole', 'bactrim', 'septran'],
  nsaid: ['ibuprofen', 'diclofenac', 'aceclofenac', 'naproxen', 'ketorolac', 'indomethacin', 'etoricoxib', 'nimesulide', 'aspirin', 'mefenamic'],
  macrolide: ['erythromycin', 'azithromycin', 'clarithromycin', 'roxithromycin'],
  quinolone: ['ciprofloxacin', 'levofloxacin', 'ofloxacin', 'norfloxacin', 'moxifloxacin'],
  tetracycline: ['doxycycline', 'tetracycline', 'minocycline'],
  opioid: ['morphine', 'tramadol', 'codeine', 'fentanyl', 'pethidine'],
  statin: ['atorvastatin', 'rosuvastatin', 'simvastatin'],
}

// Documented cross-reactivity worth a caution (not a hard block).
// Penicillin↔cephalosporin is the classic one (~1–3% with modern agents).
const CROSS_REACTIVE = { penicillin: ['cephalosporin'], cephalosporin: ['penicillin'] }

const norm = (s) => (s || '').toLowerCase()

export function classOf(drugName) {
  const d = norm(drugName)
  for (const [cls, stems] of Object.entries(DRUG_CLASSES)) {
    if (stems.some((st) => d.includes(st))) return cls
  }
  return null
}

// An allergy entry looks like "Penicillin (rash, 2021)" — use its leading token.
const allergyToken = (a) => norm(a).split(/[\s(,]/)[0]

/* ---------------- allergy check ----------------
   Returns null | { level: 'block' | 'caution', allergy, reason }         */
export function checkAllergy(allergies, drugName) {
  if (!allergies?.length || !drugName) return null
  const drug = norm(drugName)
  const drugClass = classOf(drugName)

  for (const a of allergies) {
    const token = allergyToken(a)
    if (!token) continue

    // 1. Direct name match ("Penicillin" vs "Penicillin V")
    if (drug.includes(token)) return { level: 'block', allergy: a, reason: `${drugName} matches the recorded allergy` }

    // 2. Same class ("Penicillin" allergy vs Amoxicillin) — the case a plain
    //    substring match silently misses.
    const allergyClass = classOf(token)
    if (allergyClass && drugClass && allergyClass === drugClass) {
      return { level: 'block', allergy: a, reason: `${drugName} is a ${drugClass} — same class as the recorded allergy` }
    }

    // 3. Cross-reactive class — caution, prescriber decides.
    if (allergyClass && drugClass && (CROSS_REACTIVE[allergyClass] || []).includes(drugClass)) {
      return { level: 'caution', allergy: a, reason: `${drugClass} in a ${allergyClass}-allergic patient — cross-reactivity possible` }
    }
  }
  return null
}

/* ---------------- therapeutic duplication ---------------- */
// Same drug twice, or two drugs of a class where doubling up is a real risk.
const DUP_RISK_CLASSES = ['nsaid', 'opioid', 'quinolone', 'macrolide', 'statin']

export function detectDuplicates(rx = []) {
  const out = []
  const seen = new Map()
  const byClass = new Map()
  rx.forEach((r, i) => {
    const name = norm(r.drug).trim()
    if (!name) return
    if (seen.has(name)) out.push({ index: i, drug: r.drug, reason: `${r.drug} is already on this prescription` })
    else seen.set(name, i)

    const cls = classOf(r.drug)
    if (cls && DUP_RISK_CLASSES.includes(cls)) {
      const prev = byClass.get(cls)
      if (prev != null && norm(rx[prev].drug) !== name) {
        out.push({ index: i, drug: r.drug, reason: `Two ${cls}s together (${rx[prev].drug} + ${r.drug})` })
      } else if (prev == null) byClass.set(cls, i)
    }
  })
  return out
}

/* ---------------- vitals ---------------- */
// Adult ranges. Paediatric pulse/BP differ widely by age, so for under-12s we
// deliberately skip pulse/BP flagging rather than raise false alarms.
export function flagVitals(vitals = {}, age) {
  const flags = {}
  const paediatric = typeof age === 'number' && age < 12

  const bp = String(vitals.bp || '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/)
  if (bp && !paediatric) {
    const sys = +bp[1], dia = +bp[2]
    if (sys >= 180 || dia >= 110) flags.bp = { level: 'high', note: 'Hypertensive crisis range' }
    else if (sys >= 140 || dia >= 90) flags.bp = { level: 'warn', note: 'Raised BP' }
    else if (sys < 90 || dia < 60) flags.bp = { level: 'high', note: 'Hypotensive' }
  }

  const pulse = Number(vitals.pulse)
  if (pulse && !paediatric) {
    if (pulse > 120 || pulse < 50) flags.pulse = { level: 'high', note: pulse > 120 ? 'Marked tachycardia' : 'Marked bradycardia' }
    else if (pulse > 100 || pulse < 60) flags.pulse = { level: 'warn', note: pulse > 100 ? 'Tachycardia' : 'Bradycardia' }
  }

  const temp = Number(vitals.temp)
  if (temp) {
    if (temp >= 103 || temp < 95) flags.temp = { level: 'high', note: temp >= 103 ? 'High fever' : 'Hypothermia' }
    else if (temp >= 100.4) flags.temp = { level: 'warn', note: 'Fever' }
  }

  const spo2 = Number(vitals.spo2)
  if (spo2) {
    if (spo2 <= 90) flags.spo2 = { level: 'high', note: 'Hypoxia — assess urgently' }
    else if (spo2 < 95) flags.spo2 = { level: 'warn', note: 'Borderline saturation' }
  }
  return flags
}

export function bmiOf(vitals = {}) {
  const w = Number(vitals.weight), h = Number(vitals.height)
  if (!w || !h) return null
  const m = h > 3 ? h / 100 : h            // accept cm or m
  const bmi = w / (m * m)
  if (!isFinite(bmi) || bmi <= 0) return null
  const band = bmi < 18.5 ? 'Underweight' : bmi < 23 ? 'Normal' : bmi < 25 ? 'Overweight (Asian)' : 'Obese'
  return { value: Math.round(bmi * 10) / 10, band, level: bmi < 18.5 || bmi >= 25 ? 'warn' : 'ok' }
}

/* ---------------- pre-completion checks ---------------- */
// blockers stop completion; warnings just need an explicit confirm.
export function validateConsult({ consult, allergies, vitalFlags }) {
  const blockers = []
  const warnings = []

  ;(consult.rx || []).forEach((r) => {
    const hit = checkAllergy(allergies, r.drug)
    if (hit?.level === 'block') blockers.push(`${r.drug}: ${hit.reason} (${hit.allergy})`)
    if (hit?.level === 'caution') warnings.push(`${r.drug}: ${hit.reason}`)
  })

  detectDuplicates(consult.rx).forEach((d) => warnings.push(d.reason))

  const dx = (consult.mode === 'soap' ? consult.a : consult.dx) || ''
  if (!dx.trim()) warnings.push('No diagnosis recorded')

  const incomplete = (consult.rx || []).filter((r) => r.drug && (!r.dose?.trim() || !r.freq?.trim() || !r.days))
  if (incomplete.length) warnings.push(`${incomplete.length} prescription line${incomplete.length > 1 ? 's are' : ' is'} missing dose, frequency or duration`)

  Object.entries(vitalFlags || {}).forEach(([k, f]) => {
    if (f.level === 'high') warnings.push(`${k.toUpperCase()} abnormal — ${f.note}`)
  })

  return { blockers, warnings }
}
