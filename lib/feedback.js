/**
 * The feedback loop (v0.17.1) — the one quality signal nobody else can give the
 * router: the person using it.
 *
 * The panel offers three labels (too expensive / too weak / just right) for the
 * route that is running now. Each label is written to a local JSONL file beside
 * the decision telemetry, and the router follows up with one outcome record: did
 * the conversation stay on that route afterwards, or did it move? A label plus
 * its outcome is a weak quality signal per task class, which is exactly what the
 * quarterly "is this tier worth its price" review needs, and it never leaves the
 * machine.
 *
 * Everything here is pure: parsing, normalising, aggregating.
 */

/** The three labels the UI offers. */
export const FEEDBACK_LABELS = Object.freeze(['too-expensive', 'too-weak', 'just-right'])

/** Input spellings accepted from an older panel, a command or a hand edit. */
const ALIASES = Object.freeze({
  'too-expensive': 'too-expensive',
  'too_expansive': 'too-expensive',
  expensive: 'too-expensive',
  costly: 'too-expensive',
  pricey: 'too-expensive',
  'too-weak': 'too-weak',
  'too_weak': 'too-weak',
  weak: 'too-weak',
  dumb: 'too-weak',
  cheap: 'too-weak',
  'just-right': 'just-right',
  'just_right': 'just-right',
  right: 'just-right',
  ok: 'just-right',
  good: 'just-right',
})

/** Canonical label for an input, or null. */
export function labelOf(value) {
  if (typeof value !== 'string') return null
  const key = value.trim().toLowerCase()
  if (key.length === 0) return null
  return ALIASES[key] || null
}

function shortText(value, max) {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length === 0) return null
  return text.length > max ? text.slice(0, max) : text
}

/**
 * One persisted feedback record, or null when the body is not a label.
 *
 * @param {object} input request body ({label, note} plus routing context)
 * @param {object} [context] server-side facts: {at, session, provider, model, effort, stepClass}
 */
export function normalizeFeedback(input, context = {}) {
  const body = input && typeof input === 'object' ? input : {}
  const label = labelOf(body.label !== undefined ? body.label : body.value)
  if (!label) return null
  const ctx = context && typeof context === 'object' ? context : {}
  const at = Number.isFinite(ctx.at) ? ctx.at : Number.isFinite(body.at) ? body.at : 0
  const record = {
    v: 1,
    kind: 'label',
    at,
    label,
    session: shortText(ctx.session, 64) || shortText(body.session, 64),
    provider: shortText(ctx.provider, 64) || null,
    model: shortText(ctx.model, 96) || null,
    effort: shortText(ctx.effort, 24) || null,
    stepClass: shortText(ctx.stepClass, 32) || null,
    note: shortText(body.note, 200),
  }
  return record
}

/** One follow-up record: what happened to the route after a label. */
export function normalizeOutcome(input) {
  const body = input && typeof input === 'object' ? input : {}
  if (!labelOf(body.label)) return null
  return {
    v: 1,
    kind: 'outcome',
    at: Number.isFinite(body.at) ? body.at : 0,
    of: labelOf(body.label),
    changed: body.changed === true,
    provider: shortText(body.provider, 64) || null,
    model: shortText(body.model, 96) || null,
  }
}

/** Parse a feedback JSONL file body into records (bad lines are skipped). */
export function parseFeedback(text) {
  const out = []
  for (const line of String(text === undefined || text === null ? '' : text).split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let parsed = null
    try {
      parsed = JSON.parse(trimmed)
    } catch (_notJson) {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    if (parsed.kind === 'label' && labelOf(parsed.label)) out.push(parsed)
    else if (parsed.kind === 'outcome' && labelOf(parsed.of)) out.push(parsed)
  }
  return out
}

const emptyCounts = () => ({ 'too-expensive': 0, 'too-weak': 0, 'just-right': 0 })

/**
 * Aggregate records for /stats and for the quarterly review.
 *
 * @returns {{total:number, labels:object, byClass:object, overrides:number,
 *   overrideShare:number, outcomes:object, lastAt:number|null}}
 */
export function aggregateFeedback(records) {
  const list = Array.isArray(records) ? records : []
  const labels = emptyCounts()
  const byClass = {}
  const outcomes = { recorded: 0, changed: 0, unchanged: 0, changedShare: 0 }
  let lastAt = null
  for (const record of list) {
    if (!record || typeof record !== 'object') continue
    if (Number.isFinite(record.at) && (lastAt === null || record.at > lastAt)) lastAt = record.at
    if (record.kind === 'outcome') {
      if (!labelOf(record.of)) continue
      outcomes.recorded += 1
      if (record.changed === true) outcomes.changed += 1
      else outcomes.unchanged += 1
      continue
    }
    const label = labelOf(record.label)
    if (!label) continue
    labels[label] += 1
    const stepClass = typeof record.stepClass === 'string' && record.stepClass.length > 0 ? record.stepClass : 'unknown'
    if (!byClass[stepClass]) byClass[stepClass] = { ...emptyCounts(), total: 0 }
    byClass[stepClass][label] += 1
    byClass[stepClass].total += 1
  }
  const total = labels['too-expensive'] + labels['too-weak'] + labels['just-right']
  outcomes.changedShare = outcomes.recorded > 0 ? Math.round((outcomes.changed / outcomes.recorded) * 1e4) / 1e4 : 0
  return {
    total,
    labels,
    byClass,
    overrides: labels['too-expensive'] + labels['too-weak'],
    overrideShare: total > 0 ? Math.round(((labels['too-expensive'] + labels['too-weak']) / total) * 1e4) / 1e4 : 0,
    outcomes,
    lastAt,
  }
}
