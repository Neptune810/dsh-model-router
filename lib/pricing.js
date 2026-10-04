/**
 * dsh-model-router — relative price estimation (v0.14).
 *
 * The pool's `cost` is a coarse 1 / 4 / 8 label ("便宜 / 中 / 贵") used only as a
 * tie-breaker in scoring, so an estimate is enough: with a pool that spans
 * providers nobody should have to hand-label every model. Two sources, in order:
 *
 *   1. the built-in classification below (offline, always available)
 *   2. an optional OpenRouter snapshot the user refreshes from the panel
 *
 * Everything here is pure and import-free so it can be unit tested anywhere.
 * index.js owns the network call and the on-disk cache.
 */

/** The cost levels the panel exposes, cheapest first. */
export const PRICE_LEVELS = Object.freeze([1, 4, 8])

/**
 * Normalize one model id or display name for matching.
 * "anthropic/claude-3.5-sonnet" -> "anthropic-claude-3-5-sonnet"
 */
export function priceKey(value) {
  return String(value === undefined || value === null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Drop every separator, the loosest form two ids can be compared in. */
function compactKey(value) {
  return String(value === undefined || value === null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// Word boundaries that also work inside "deepseek-v4-flash" and "qwen2.5-max".
const CHEAP_RE = /(^|[-/ .])(flash|lite|mini|nano|small|tiny|haiku|turbo|free|edge|3b|4b|7b|8b|9b)(?=$|[-/ .0-9])/
const RICH_RE = /(^|[-/ .])(opus|ultra|max|reasoner|thinking|o1|o3|o4|405b)(?=$|[-/ .0-9])/
const MID_RE = /(^|[-/ .])(pro|plus|sonnet|medium|32b|34b|70b|72b|123b)(?=$|[-/ .0-9])/

/**
 * Families the keyword rule reads wrong, or that deserve a fixed label.
 * First match wins; a null level means "fall through to the keywords".
 */
const OVERRIDES = Object.freeze([
  { re: /deepseek-(reasoner|r1)(?=$|[-/ .0-9])/, level: 4 },
  { re: /deepseek-(flash|chat|coder|v3)(?=$|[-/ .0-9])/, level: 1 },
  { re: /deepseek-(v4|v4-1|v41)(?=$|[-/ .0-9])/, level: null },
  { re: /gpt-3\.5/, level: 1 },
])

/**
 * Classify one model into a 1 / 4 / 8 cost label from its own name.
 * @param entry - { provider, model, name }, any of which may be missing.
 * @returns { level, note } — the note is what the panel shows in a tooltip.
 */
export function classifyModel(entry = {}) {
  // The provider is deliberately left out: "openrouter-pro" must not turn every
  // model of that provider into a mid-tier one.
  const parts = [entry.model, entry.name].filter((part) => typeof part === 'string' && part.length > 0)
  if (parts.length === 0) return { level: 4, note: 'unknown model' }
  const text = priceKey(parts.join('/'))
  for (const rule of OVERRIDES) {
    if (rule.re.test(text)) {
      if (rule.level === null) break
      return { level: rule.level, note: 'built-in family rule' }
    }
  }
  if (CHEAP_RE.test(text)) return { level: 1, note: 'small / fast class' }
  if (RICH_RE.test(text)) return { level: 8, note: 'flagship class' }
  if (MID_RE.test(text)) return { level: 4, note: 'mid class' }
  return { level: 4, note: 'default (unknown class)' }
}

/**
 * Map a blended USD price (per million tokens) onto a cost level.
 * Thresholds are deliberately generous: the label only orders the pool.
 */
export function levelFromUsd(perMillion) {
  const usd = Number(perMillion)
  if (!Number.isFinite(usd) || usd <= 0) return 1
  if (usd < 0.8) return 1
  if (usd < 10) return 4
  return 8
}

/** Blend input and output prices; agentic traffic is input-heavy. */
export function blendedUsd(promptPerToken, completionPerToken) {
  const prompt = Number(promptPerToken)
  const completion = Number(completionPerToken)
  const input = Number.isFinite(prompt) ? prompt : 0
  const output = Number.isFinite(completion) ? completion : input
  return (input * 0.75 + output * 0.25) * 1e6
}

/**
 * Turn an OpenRouter /api/v1/models payload into a compact, storable snapshot.
 * @returns { fetchedAt, models } with one { id, name, level } per priced model.
 */
export function parseOpenRouter(payload, now = Date.now()) {
  const list = payload && Array.isArray(payload.data) ? payload.data : []
  const models = []
  for (const item of list) {
    if (!item || typeof item.id !== 'string' || item.id.length === 0) continue
    const pricing = item.pricing && typeof item.pricing === 'object' ? item.pricing : {}
    const level = levelFromUsd(blendedUsd(pricing.prompt, pricing.completion))
    models.push({ id: item.id, name: typeof item.name === 'string' ? item.name : item.id, level })
  }
  return { fetchedAt: now, models }
}

/**
 * Index a stored snapshot so an entry can be looked up by id, short id or name.
 * @returns { Map<string, level> } keyed with priceKey and its compact form.
 */
export function buildPriceIndex(remote) {
  const index = new Map()
  const models = remote && Array.isArray(remote.models) ? remote.models : []
  for (const model of models) {
    if (!model || !Number.isFinite(model.level)) continue
    const short = String(model.id).split('/').pop()
    for (const raw of [model.id, short, model.name]) {
      const key = priceKey(raw)
      if (key) {
        index.set(key, model.level)
        index.set(compactKey(raw), model.level)
      }
    }
  }
  return index
}

/** Look one model up in a snapshot index; null when nothing matches. */
export function lookupRemote(index, entry) {
  if (!index || index.size === 0) return null
  const candidates = [entry.id, entry.provider && entry.model ? entry.provider + '/' + entry.model : '', entry.model, entry.name]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue
    const key = priceKey(candidate)
    if (index.has(key)) return { level: index.get(key), via: candidate }
    const compact = compactKey(candidate)
    if (compact && index.has(compact)) return { level: index.get(compact), via: candidate }
  }
  return null
}

/**
 * Fill in `cost` for the pool entries that have not been hand-labelled.
 *
 * `names` maps "provider/model" to the catalog's display name, which is what
 * makes the OpenRouter lookup work for adapters whose ids differ from the
 * upstream ones. Entries with `costSource === 'manual'` are never touched: a
 * value the user set by hand outlives every refresh.
 *
 * @returns { pool, changed, skipped, source } — changed rows carry their source.
 */
export function autoPricePool(pool, options = {}) {
  const list = Array.isArray(pool) ? pool : []
  const names = options.names && typeof options.names === 'object' ? options.names : {}
  const index = options.remote ? buildPriceIndex(options.remote) : null
  const changed = []
  const skipped = []
  const out = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.costSource === 'manual') {
      skipped.push({ id: entry.id, cost: entry.cost })
      out.push(entry)
      continue
    }
    const named = { id: entry.id, provider: entry.provider, model: entry.model, name: names[entry.id] }
    let level
    let source
    let note
    const remote = lookupRemote(index, named)
    if (remote) {
      level = remote.level
      source = 'openrouter'
      note = 'OpenRouter: ' + remote.via
    } else {
      const guess = classifyModel(named)
      level = guess.level
      source = 'builtin'
      note = guess.note
    }
    if (entry.cost !== level || entry.costSource !== source) {
      changed.push({ id: entry.id, from: entry.cost, to: level, source: source, note: note })
    }
    out.push({ ...entry, cost: level, costSource: source })
  }
  return {
    pool: out,
    changed: changed,
    skipped: skipped,
    source: index && index.size > 0 ? 'openrouter+builtin' : 'builtin',
  }
}
