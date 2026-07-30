// Prescribing shortcuts: frequency, food timing, and suggested patient
// instructions.
//
// The instruction suggestions are a CURATED RULE LIBRARY, not a language model
// — they are matched on the drug's generic/class and on keywords in the
// diagnosis. That keeps them deterministic, instant and available offline, and
// means nothing is ever invented. Every suggestion is inserted as editable text
// and the prescriber remains responsible for what is printed.

export const FREQ_PRESETS = [
  { code: 'OD', label: 'OD — once daily', perDay: 1 },
  { code: 'BD', label: 'BD — twice daily', perDay: 2 },
  { code: 'TDS', label: 'TDS — thrice daily', perDay: 3 },
  { code: 'QID', label: 'QID — four times daily', perDay: 4 },
  { code: 'HS', label: 'HS — at bedtime', perDay: 1 },
  { code: 'SOS', label: 'SOS — when required', perDay: 1 },
  { code: 'STAT', label: 'STAT — immediately, once', perDay: 1 },
  { code: '1-0-1', label: '1-0-1 — morning & night', perDay: 2 },
  { code: '1-1-1', label: '1-1-1 — morning, noon & night', perDay: 3 },
  { code: '0-0-1', label: '0-0-1 — night only', perDay: 1 },
  { code: '1-0-0', label: '1-0-0 — morning only', perDay: 1 },
]

export const FOOD_PRESETS = [
  { code: 'after food', label: 'After food' },
  { code: 'before food', label: 'Before food' },
  { code: 'with food', label: 'With food' },
  { code: 'empty stomach', label: 'Empty stomach' },
  { code: '', label: 'Not specified' },
]

// Sensible defaults per molecule, so picking a drug pre-fills the usual sig.
// Doctor overrides freely; these only save typing on the common case.
const DEFAULTS = [
  { match: /pantoprazole|omeprazole|rabeprazole|esomeprazole/i, freq: 'OD', food: 'before food' },
  { match: /thyroxine|levothyroxine|eltroxin|thyronorm/i, freq: 'OD', food: 'empty stomach' },
  { match: /ibuprofen|diclofenac|aceclofenac|naproxen|brufen/i, freq: 'BD', food: 'after food' },
  { match: /paracetamol|dolo|calpol|crocin/i, freq: 'TDS', food: 'after food' },
  { match: /amoxicillin|augmentin|mox|cefixime|cephalexin/i, freq: 'BD', food: 'after food' },
  { match: /azithromycin|azithral/i, freq: 'OD', food: 'before food' },
  { match: /cetirizine|levocetirizine|cetzine|alerid|montelukast/i, freq: 'HS', food: 'after food' },
  { match: /metformin/i, freq: 'BD', food: 'with food' },
  { match: /atorvastatin|rosuvastatin|simvastatin/i, freq: 'HS', food: 'after food' },
  { match: /amlodipine|telmisartan|losartan|enalapril/i, freq: 'OD', food: 'after food' },
  { match: /ors|electral/i, freq: 'SOS', food: '' },
]

export function defaultSigFor(name = '') {
  const hit = DEFAULTS.find((d) => d.match.test(name))
  return hit ? { freq: hit.freq, food: hit.food } : { freq: '', food: 'after food' }
}

/* ---------------- instruction library ---------------- */
const DRUG_NOTES = [
  { match: /paracetamol|dolo|calpol|crocin/i, text: 'Take only if fever is above 100°F or for pain. Do not exceed 4 tablets in 24 hours.' },
  { match: /amoxicillin|augmentin|mox|cefixime|cephalexin|azithro/i, text: 'Complete the full course even if you feel better. Report any rash immediately.' },
  { match: /ibuprofen|diclofenac|aceclofenac|naproxen|brufen/i, text: 'Always take after food. Stop and report if you get stomach pain, vomiting or black stools.' },
  { match: /pantoprazole|omeprazole|rabeprazole/i, text: 'Take 30 minutes before breakfast, on an empty stomach.' },
  { match: /cetirizine|levocetirizine|cetzine|alerid/i, text: 'May cause drowsiness — avoid driving or operating machinery after taking it.' },
  { match: /thyroxine|eltroxin|thyronorm/i, text: 'Take on an empty stomach, 30–60 minutes before breakfast. Do not take with milk, calcium or iron.' },
  { match: /metformin/i, text: 'Take with or immediately after food to reduce stomach upset.' },
  { match: /ors|electral/i, text: 'Dissolve one sachet in 1 litre of clean drinking water and sip through the day. Discard after 24 hours.' },
  { match: /amlodipine/i, text: 'Take at the same time each day. Report any ankle swelling.' },
  { match: /atorvastatin|rosuvastatin|simvastatin/i, text: 'Take at night. Report unexplained muscle pain or weakness.' },
]

const CONDITION_NOTES = [
  { match: /fever|pyrexia|viral/i, text: 'Plenty of oral fluids and rest. Tepid sponging if fever is above 102°F. Return if fever persists beyond 3 days, or earlier if breathless or drowsy.' },
  { match: /diarrh|gastroenteritis|loose stool/i, text: 'ORS after every loose stool. Avoid outside food. Return urgently if there is blood in stools, persistent vomiting or reduced urine.' },
  { match: /pharyngitis|throat|urti|cold|cough/i, text: 'Warm saline gargles, steam inhalation and adequate fluids. Avoid cold drinks. Return if breathing becomes difficult.' },
  { match: /hypertension|htn|i10/i, text: 'Reduce salt intake. Take medication daily at the same time. Check BP weekly and bring the readings to the next visit.' },
  { match: /diabet|t2dm|dm/i, text: 'Follow the diet plan, walk 30 minutes daily, and check sugars as advised. Report any giddiness, sweating or palpitations.' },
  { match: /migraine|headache/i, text: 'Regular sleep and meals. Identify and avoid triggers. Return if the headache changes in pattern, or with vomiting or visual disturbance.' },
  { match: /gastritis|acidity|dyspepsia|gerd/i, text: 'Avoid spicy and oily food, tea/coffee on an empty stomach, and late-night meals. Do not lie down for 2 hours after eating.' },
  { match: /asthma|wheez|copd/i, text: 'Use the inhaler as demonstrated. Avoid known triggers and smoke. Return urgently if breathlessness increases or speech is broken.' },
  { match: /uti|urinary/i, text: 'Drink plenty of water. Complete the antibiotic course. Return if fever, back pain or blood in urine appears.' },
]

const GENERAL = 'Take medicines exactly as written. Return earlier if symptoms worsen.'

// Suggestions for the whole consult: condition-based first, then one per drug.
export function suggestInstructions({ dx = '', rx = [] } = {}) {
  const out = []
  CONDITION_NOTES.forEach((c) => { if (c.match.test(dx)) out.push({ source: 'condition', text: c.text }) })
  rx.forEach((r) => {
    const name = `${r.generic || ''} ${r.drug || ''}`
    const hit = DRUG_NOTES.find((d) => d.match.test(name))
    if (hit && !out.some((o) => o.text === hit.text)) out.push({ source: r.drug || r.generic, text: hit.text })
  })
  if (!out.length) out.push({ source: 'general', text: GENERAL })
  return out
}

// Per-line instruction for a single drug (shown under the Rx row).
export function suggestLineInstruction(drugName = '') {
  return DRUG_NOTES.find((d) => d.match.test(drugName))?.text || ''
}
