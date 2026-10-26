/**
 * Classifier v2 (v0.17.1) — the semantic classifier's answer format and its
 * reliability guards, kept as pure functions so both the plugin and the tests
 * can reason about "what did the model actually say".
 *
 * Three ideas are new in v2:
 *
 *  1. The answer is structured: a class, a confidence, and - when the model can
 *     give them - a family label, a short evidence quote and the signals it
 *     used. The extra fields are telemetry, never routing input.
 *  2. An unsure answer is not a guess. Below `minConfidence` the rules win and
 *     the step is lifted one tier instead, which is the safe direction: a cheap
 *     model on a step the classifier could not read is the expensive mistake.
 *  3. A classifier that keeps failing is a classifier that is not there. The
 *     circuit breaker counts consecutive failures and, after `breakerFails`,
 *     stops paying for calls for `breakerMs` and runs the rules.
 */

/** Defaults; every one of them is overridable through the plugin config. */
export const CLASSIFIER_DEFAULTS = Object.freeze({
  minConfidence: 0.6,
  timeoutMs: 2000,
  attempts: 2,
  breakerFails: 3,
  breakerMs: 600000,
})

const MAX_TEXT = 60

function shortText(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length === 0) return null
  return text.length > max ? text.slice(0, max) : text
}

function shortList(value, max = 4, maxEach = 40) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    const text = shortText(item, maxEach)
    if (text && !out.includes(text)) out.push(text)
    if (out.length >= max) break
  }
  return out
}

/** The first balanced-brace JSON object in an answer, or null. */
export function firstJsonObject(answer) {
  const text = String(answer === undefined || answer === null ? '' : answer)
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function classFrom(parsed, names) {
  const raw = parsed.class !== undefined ? parsed.class : parsed.type !== undefined ? parsed.type : parsed.taskType
  if (typeof raw !== 'string') return null
  const wanted = raw.trim().toLowerCase()
  if (wanted.length === 0) return null
  if (wanted === 'none') return 'none'
  return names.find((name) => String(name).toLowerCase() === wanted) || null
}

/**
 * Parse one classifier answer.
 *
 * @param {string} answer raw model text
 * @param {string[]} names preset names the answer may use
 * @returns {null | {class:string, confidence:number|null, family:string|null,
 *   evidence:string|null, signals:string[], source:'json'|'prose'}}
 */
export function parseVerdict(answer, names = []) {
  const list = Array.isArray(names) ? names.filter((name) => typeof name === 'string') : []
  const json = firstJsonObject(answer)
  if (json) {
    let parsed = null
    try {
      parsed = JSON.parse(json)
    } catch (_notJson) {
      parsed = null
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const wanted = classFrom(parsed, list)
      if (wanted) {
        const raw = parsed.confidence !== undefined ? parsed.confidence : parsed.conf
        const confidence = Number(raw)
        return {
          class: wanted,
          confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
          family: shortText(parsed.family !== undefined ? parsed.family : parsed.group),
          evidence: shortText(parsed.evidence !== undefined ? parsed.evidence : parsed.why, 120),
          signals: shortList(parsed.signals !== undefined ? parsed.signals : parsed.markers),
          source: 'json',
        }
      }
    }
  }
  // A model that answered in prose still named a type: that is worth using, but
  // it carries no confidence and is therefore never trusted blind (see below).
  const text = String(answer === undefined || answer === null ? '' : answer).toLowerCase()
  const named = list.find((name) => text.includes(String(name).toLowerCase()))
  if (named) {
    return { class: named, confidence: null, family: null, evidence: null, signals: [], source: 'prose' }
  }
  return null
}

/**
 * Turn a verdict into the routing decision's task type.
 *
 * @returns {{value:string, used:boolean, source:'llm'|'prose'|'low-confidence'|'rules',
 *   confidence:number|null, escalate:boolean, why:string}}
 */
export function decideVerdict(verdict, rules, minConfidence = CLASSIFIER_DEFAULTS.minConfidence) {
  const floor = Number.isFinite(minConfidence) ? minConfidence : CLASSIFIER_DEFAULTS.minConfidence
  if (!verdict || typeof verdict.class !== 'string' || verdict.class === 'none') {
    return { value: rules, used: false, source: 'rules', confidence: verdict ? verdict.confidence : null, escalate: false, why: 'the classifier named no type' }
  }
  if (verdict.confidence === null || verdict.confidence === undefined) {
    return {
      value: verdict.class,
      used: true,
      source: 'prose',
      confidence: null,
      escalate: true,
      why: 'the answer named a type without a confidence, so the step is lifted one tier',
    }
  }
  if (verdict.confidence >= floor) {
    return {
      value: verdict.class,
      used: true,
      source: 'llm',
      confidence: verdict.confidence,
      escalate: false,
      why: 'confidence ' + verdict.confidence.toFixed(2) + ' >= ' + floor.toFixed(2),
    }
  }
  return {
    value: rules,
    used: false,
    source: 'low-confidence',
    confidence: verdict.confidence,
    escalate: true,
    why: 'confidence ' + verdict.confidence.toFixed(2) + ' < ' + floor.toFixed(2) + ', so the rules win and the step is lifted one tier',
  }
}

/**
 * Consecutive-failure breaker. `allow(at)` is checked before a call, so an open
 * breaker costs nothing; after the cooldown one call is let through, and a
 * failure right after re-opens it.
 */
export class CircuitBreaker {
  constructor(options = {}) {
    const opts = options && typeof options === 'object' ? options : {}
    this.threshold = Number.isFinite(opts.fails) && opts.fails > 0 ? Math.floor(opts.fails) : CLASSIFIER_DEFAULTS.breakerFails
    this.cooldownMs = Number.isFinite(opts.cooldownMs) && opts.cooldownMs > 0 ? opts.cooldownMs : CLASSIFIER_DEFAULTS.breakerMs
    this.fails = 0
    this.openUntil = 0
    this.opens = 0
    this.lastFailureAt = null
  }

  allow(atMs) {
    const at = Number.isFinite(atMs) ? atMs : 0
    return at >= this.openUntil
  }

  recordFailure(atMs) {
    const at = Number.isFinite(atMs) ? atMs : 0
    this.fails += 1
    this.lastFailureAt = at
    let opened = false
    if (this.fails >= this.threshold) {
      const until = at + this.cooldownMs
      if (until > this.openUntil) this.openUntil = until
      opened = true
      this.opens += 1
    }
    return { opened, fails: this.fails, openUntil: this.openUntil }
  }

  /** A successful call means the classifier is back: close the breaker. */
  recordSuccess() {
    this.fails = 0
    this.openUntil = 0
    return { fails: 0 }
  }

  snapshot(atMs) {
    const at = Number.isFinite(atMs) ? atMs : 0
    return {
      fails: this.fails,
      threshold: this.threshold,
      open: at < this.openUntil,
      openUntil: this.openUntil > 0 ? this.openUntil : null,
      openForMs: at < this.openUntil ? this.openUntil - at : 0,
      cooldownMs: this.cooldownMs,
      opens: this.opens,
      lastFailureAt: this.lastFailureAt,
    }
  }
}
