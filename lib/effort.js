/**
 * Effort economics (v0.17.0) - the ladder, the mapping explanation and the
 * thinking-budget table, as pure functions with no imports.
 *
 * The router has always had an internal tier (routing.js EFFORT_RANK) and a
 * per-model wire id (mapEffort). What 0.17.0 adds is the third piece the
 * roadmap asked for: when a tier is NOT the id that runs, say why, so a
 * collapse can never be silent. explainMapping() classifies every translation
 * into exact / alias / nearest / none, and the decision event carries it.
 *
 * The budget table is documentation of what each tier means in thinking
 * tokens. It is used when a provider expresses depth as a token budget; when
 * it does not (DeepSeek and OpenAI take a level name), the table is only
 * reported, never sent.
 */

/** The canonical ladder, ascending. Words here are the internal tiers. */
export const LADDER = Object.freeze([
  'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
])

/** Documented ladder points (policy.js EFFORT_POINTS mirrors these). */
export const LADDER_POINTS = Object.freeze({
  off: 0, none: 0, minimal: 25, low: 50, medium: 62, high: 75, xhigh: 86, max: 100, ultra: 105,
})

/** Where a tier sits on the ladder; unknown words rank as high (quality-first). */
export function ladderRank(word) {
  const rank = LADDER.indexOf(word)
  if (rank >= 0) return rank
  return LADDER.indexOf('high')
}

/**
 * Thinking-token budget per tier. Shipped defaults; a catalog entry may
 * override them with effort.budgets, and maxOutput caps the result.
 */
export const DEFAULT_BUDGETS = Object.freeze({
  low: 2048, medium: 6144, high: 12288, xhigh: 24576, max: 32768, ultra: 32768,
})

/**
 * The budget table a model exposes: its own effort.budgets merged over the
 * defaults, with unknown keys ignored and non-positive values dropped.
 */
export function budgetTable(meta) {
  const table = { ...DEFAULT_BUDGETS }
  const own = meta && meta.effort && meta.effort.budgets
  if (own && typeof own === 'object') {
    for (const key of Object.keys(own)) {
      const value = own[key]
      if (LADDER_POINTS[key] !== undefined && Number.isFinite(value) && value > 0) table[key] = value
    }
  }
  return table
}

/**
 * Budget for one tier, capped by the model's maxOutput when it is finite.
 * A tier with no entry (off / minimal) gets 0, which is a valid answer: it
 * tells the caller to send no budget at all.
 */
export function budgetForTier(tier, meta) {
  const table = budgetTable(meta)
  const wanted = table[tier]
  if (!Number.isFinite(wanted) || wanted <= 0) return 0
  const cap = meta && Number.isFinite(meta.maxOutput) ? meta.maxOutput : 0
  return cap > 0 ? Math.min(wanted, cap) : wanted
}

/**
 * Why the tier and the wire id differ.
 * @returns {{from: string, to: string|null, why: 'exact'|'alias'|'nearest'|'none'}}
 *
 * - exact: the tier is the id the model runs (no information is lost)
 * - alias: the catalog itself documents the collapse (DeepSeek medium -> high)
 * - nearest: the model does not advertise the tier and the ladder picked the
 *   closest one it does (this is an inference, so it must be visible)
 * - none: the target advertises no reasoning effort at all
 */
export function explainMapping(tier, applied, meta) {
  const from = typeof tier === 'string' ? tier : 'high'
  if (applied === undefined || applied === null) return { from, to: null, why: 'none' }
  const to = String(applied)
  if (to === from) return { from, to, why: 'exact' }
  const aliases = meta && meta.effort && meta.effort.aliases
  if (aliases && typeof aliases === 'object' && aliases[from] === to) return { from, to, why: 'alias' }
  return { from, to, why: 'nearest' }
}

/**
 * Roll a list of decision events into the effort picture the roadmap asks
 * for: how often the tier actually survived to the wire, and which collapses
 * dominate. Reads events defensively; a malformed event counts as no mapping.
 */
export function effortSummary(events) {
  const list = Array.isArray(events) ? events : []
  const byClass = {}
  const pairs = {}
  let mappedSteps = 0
  let pricedTiers = 0
  for (const event of list) {
    if (!event || typeof event !== 'object') continue
    const applied = event.chosen && event.chosen.effort
    if (typeof applied !== 'string' || applied.length === 0) continue
    pricedTiers += 1
    const cls = typeof event.stepClass === 'string' ? event.stepClass : 'unknown'
    if (!byClass[cls]) byClass[cls] = { steps: 0, mapped: 0 }
    byClass[cls].steps += 1
    const mapped = event.effortMapped
    if (mapped && typeof mapped === 'object' && mapped.why && mapped.why !== 'exact') {
      mappedSteps += 1
      byClass[cls].mapped += 1
      const key = String(mapped.from) + '->' + String(mapped.to) + ':' + String(mapped.why)
      pairs[key] = (pairs[key] || 0) + 1
    }
  }
  const rows = Object.keys(byClass).sort().map((cls) => ({
    stepClass: cls,
    steps: byClass[cls].steps,
    mapped: byClass[cls].mapped,
    mappedShare: byClass[cls].steps > 0 ? Math.round((byClass[cls].mapped / byClass[cls].steps) * 1e4) / 1e4 : 0,
  }))
  const top = Object.keys(pairs)
    .map((key) => ({ pair: key, count: pairs[key] }))
    .sort((left, right) => (right.count - left.count) || (left.pair < right.pair ? -1 : 1))
    .slice(0, 8)
  return {
    steps: pricedTiers,
    mappedSteps,
    mappedShare: pricedTiers > 0 ? Math.round((mappedSteps / pricedTiers) * 1e4) / 1e4 : 0,
    byClass: rows,
    top: top,
  }
}
