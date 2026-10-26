/**
 * dsh-model-router — the token-level cost basis used for routing (v0.16).
 *
 * 0.15.1 learned to *report* money: lib/catalog-pricing.js turns an observed
 * token split into USD at the catalog's dated rates. 0.16.0 has to *choose* on
 * money, and choosing needs three things the reporting layer never needed:
 *
 *   1. A single number per candidate — a blended USD-per-million-token rate at
 *      a stated token mix — so a cheap model and an expensive one can be
 *      compared on the same axis. lib/catalog-pricing.js deliberately returns
 *      four separate rates, which is right for a ledger and unusable for a
 *      score.
 *   2. Long-context ladders. Some models raise the whole request to a different
 *      rate above a threshold (whole_request) while others bill only the
 *      overflow (excess). A router that ignores that will happily pick a model
 *      whose real price at 300K prompt tokens is ten times the headline rate.
 *   3. Per-call charges. Search and web fetch are billed per thousand calls,
 *      not per token, so a token-only cost model reports them as free.
 *
 * Everything here is a pure function over the catalog and a timestamp: no I/O,
 * no clock reads of its own (the caller passes atMs), no state. That keeps the
 * routing score reproducible and lets the tests pin peak/off-peak and
 * effective dates to fixed instants.
 *
 * Compatibility rule that the rest of the release depends on: for a model with
 * no long-context ladder — which is every DeepSeek model in the catalog, i.e.
 * everything this profile actually runs — stepCost() must return byte-identical
 * amount/usd/currency to catalog-pricing.js tokenCost(). 0.16.0 is a shadow
 * release, so a rerun of a 0.15.1 decision has to reproduce the 0.15.1 number.
 */
import { CATALOG } from './catalog.js'
import { dateKey, pricesAt, toUsd } from './catalog-pricing.js'

/** Token mix assumed when no observed split exists (cache-heavy sessions, as measured in 0.15). */
export const DEFAULT_MIX = Object.freeze({ input: 0.5, cacheRead: 0.35, output: 0.15 })

const MIX_KEYS = ['input', 'cacheRead', 'output']
const RATE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const AMOUNT_DIGITS = 1e10
const RATE_DIGITS = 1e6

function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function roundAmount(value) {
  return Math.round(value * AMOUNT_DIGITS) / AMOUNT_DIGITS
}

function roundRate(value) {
  return Math.round(value * RATE_DIGITS) / RATE_DIGITS
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** "web_fetch" -> "webFetch", so callers may use either spelling. */
function camel(name) {
  const parts = String(name).split(/[_\s-]+/).filter(Boolean)
  if (parts.length === 0) return ''
  return parts[0] + parts.slice(1).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')
}

/**
 * Turn an observed token split into a mix that sums to 1.
 *
 * Reasoning tokens are billed as output and cache writes as fresh input, which
 * is exactly how catalog-pricing.js tokenCost() bills them, so the mix a
 * decision is scored with matches the mix the ledger will charge for.
 *
 * @param {object|null|undefined} split
 * @returns {{input:number,cacheRead:number,output:number}}
 */
export function mixFromSplit(split) {
  const source = isObject(split) ? split : {}
  const input = (num(source.input) || 0) + (num(source.cacheWrite) || 0)
  const cacheRead = num(source.cacheRead) || 0
  const output = (num(source.output) || 0) + (num(source.reasoning) || 0)
  const total = input + cacheRead + output
  if (!(total > 0)) return { ...DEFAULT_MIX }
  return { input: roundRate(input / total), cacheRead: roundRate(cacheRead / total), output: roundRate(output / total) }
}

/** Coerce any mix-shaped object into three non-negative weights summing to 1. */
function normalizeMix(mix) {
  const source = isObject(mix) ? mix : {}
  const raw = MIX_KEYS.map((key) => Math.max(0, num(source[key]) === null ? 0 : num(source[key])))
  const total = raw.reduce((sum, value) => sum + value, 0)
  if (!(total > 0)) return { ...DEFAULT_MIX }
  const out = {}
  MIX_KEYS.forEach((key, index) => { out[key] = roundRate(raw[index] / total) })
  return out
}

/**
 * Blended USD-per-million-token rate for one model at one instant.
 *
 * This is the number the router compares candidates with; it is not a bill.
 * A null rate means "the catalog cannot price this model", which the router
 * treats as a reason to keep it out of a cost-aware choice rather than a
 * reason to guess.
 *
 * @param {object|null} model catalog model
 * @param {number} [atMs]
 * @param {object} [mix]
 * @returns {null | {usdPerMTok:number,currency:string,peak:boolean,source:string,effectiveFrom:(string|null),mix:object}}
 */
export function blendedUsdPerMTok(model, atMs = Date.now(), mix = DEFAULT_MIX) {
  const prices = pricesAt(model, atMs)
  if (!prices) return null
  const input = num(prices.usd && prices.usd.input)
  const output = num(prices.usd && prices.usd.output)
  if (input === null || output === null) return null
  const cacheReadRaw = num(prices.usd && prices.usd.cacheRead)
  const cacheRead = cacheReadRaw === null ? input : cacheReadRaw
  const weights = normalizeMix(mix)
  const rate = weights.input * input + weights.cacheRead * cacheRead + weights.output * output
  return {
    usdPerMTok: roundRate(rate),
    currency: prices.currency,
    peak: !!prices.peak,
    source: prices.source,
    effectiveFrom: prices.effectiveFrom === undefined ? null : prices.effectiveFrom,
    mix: weights,
  }
}

/** The prompt side of a split: what a long-context threshold is measured against. */
export function promptTokensOf(split) {
  const source = isObject(split) ? split : {}
  if (typeof split === 'number') return num(split)
  return (num(source.input) || 0) + (num(source.cacheRead) || 0) + (num(source.cacheWrite) || 0)
}

/**
 * The long-context tier a request falls into, if any.
 *
 * Tiers are read from the catalog (pricing.longContext) and an entry takes
 * effect only from its own effectiveFrom, so a ladder announced for a future
 * date cannot retroactively change today's cost. When several tiers match, the
 * highest threshold wins — ladders are monotonic in practice and the most
 * specific tier is the right one.
 *
 * @param {object|null} model
 * @param {number|object} promptTokens token count, or a split
 * @param {number} [atMs]
 * @returns {null | {thresholdTokens:number,mode:string,input:number|null,output:number|null,cacheRead:number|null,cacheWrite:number|null}}
 */
export function longContextRates(model, promptTokens, atMs = Date.now()) {
  const pricing = model && model.pricing
  const list = pricing && Array.isArray(pricing.longContext) ? pricing.longContext : []
  if (list.length === 0) return null
  const tokens = promptTokensOf(promptTokens)
  if (tokens === null) return null
  const asOf = dateKey(atMs)
  let best = null
  for (const tier of list) {
    if (!isObject(tier)) continue
    const threshold = num(tier.thresholdTokens)
    if (threshold === null || tokens < threshold) continue
    if (typeof tier.effectiveFrom === 'string' && DATE_RE.test(tier.effectiveFrom) && asOf < tier.effectiveFrom) continue
    if (best && threshold <= best.thresholdTokens) continue
    best = {
      thresholdTokens: threshold,
      mode: tier.mode === 'excess' ? 'excess' : 'whole_request',
      input: num(tier.input),
      output: num(tier.output),
      cacheRead: num(tier.cacheRead),
      cacheWrite: num(tier.cacheWrite),
    }
  }
  return best
}

/**
 * Bill a split at a set of native-currency rates.
 *
 * Mirrors catalog-pricing.js tokenCost() exactly: reasoning is billed as
 * output, and a missing cache rate falls back to the fresh-input rate.
 */
function amountOf(split, rates, currency) {
  const tokens = isObject(split) ? split : {}
  const input = (num(tokens.input) || 0)
  const output = (num(tokens.output) || 0) + (num(tokens.reasoning) || 0)
  const cacheRead = num(tokens.cacheRead) || 0
  const cacheWrite = num(tokens.cacheWrite) || 0
  const amount = (input * rates.input + output * rates.output + cacheRead * rates.cacheRead + cacheWrite * rates.cacheWrite) / 1e6
  const usd = toUsd(amount, currency)
  return { amount: roundAmount(amount), currency, usd: usd === null ? null : roundAmount(usd) }
}

/** Native-currency rates of one pricesAt() snapshot, with the documented fallbacks. */
function baseRates(prices) {
  const input = num(prices.input)
  const output = num(prices.output)
  if (input === null || output === null) return null
  const cacheRead = num(prices.cacheRead)
  const cacheWrite = num(prices.cacheWrite)
  return {
    input,
    output,
    cacheRead: cacheRead === null ? input : cacheRead,
    cacheWrite: cacheWrite === null ? input : cacheWrite,
  }
}

/**
 * Cost of one step, long-context aware.
 *
 * @param {object|null} model
 * @param {object} split
 * @param {number} [atMs]
 * @returns {null | {amount:number,currency:string,usd:(number|null),peak:boolean,source:string,longContext:boolean,thresholdTokens:(number|null),basis:string}}
 */
export function stepCost(model, split, atMs = Date.now()) {
  const prices = pricesAt(model, atMs)
  if (!prices) return null
  const base = baseRates(prices)
  if (!base) return null
  const tier = longContextRates(model, promptTokensOf(split), atMs)
  if (!tier) {
    return { ...amountOf(split, base, prices.currency), peak: !!prices.peak, source: prices.source, longContext: false, thresholdTokens: null, basis: 'base' }
  }
  const long = {
    input: tier.input === null ? base.input : tier.input,
    output: tier.output === null ? base.output : tier.output,
    cacheRead: tier.cacheRead === null ? base.cacheRead : tier.cacheRead,
    cacheWrite: tier.cacheWrite === null ? base.cacheWrite : tier.cacheWrite,
  }
  if (tier.mode === 'whole_request') {
    return { ...amountOf(split, long, prices.currency), peak: !!prices.peak, source: prices.source, longContext: true, thresholdTokens: tier.thresholdTokens, basis: 'whole_request' }
  }
  // excess: the first thresholdTokens of the prompt bill at the base rate and
  // everything above it at the long-context rate. The threshold is consumed in
  // billing order — fresh input, then cache reads, then cache writes — because
  // that is the order in which a prompt is normally composed.
  const tokens = isObject(split) ? split : {}
  let budget = tier.thresholdTokens
  const billable = {}
  for (const key of ['input', 'cacheRead', 'cacheWrite']) {
    const count = num(tokens[key]) || 0
    const inside = Math.min(count, budget)
    billable[key] = { inside, outside: count - inside }
    budget -= inside
  }
  const output = (num(tokens.output) || 0) + (num(tokens.reasoning) || 0)
  const amount =
    (billable.input.inside * base.input + billable.input.outside * long.input +
      billable.cacheRead.inside * base.cacheRead + billable.cacheRead.outside * long.cacheRead +
      billable.cacheWrite.inside * base.cacheWrite + billable.cacheWrite.outside * long.cacheWrite +
      output * base.output) / 1e6
  const usd = toUsd(amount, prices.currency)
  return {
    amount: roundAmount(amount),
    currency: prices.currency,
    usd: usd === null ? null : roundAmount(usd),
    peak: !!prices.peak,
    source: prices.source,
    longContext: true,
    thresholdTokens: tier.thresholdTokens,
    basis: 'excess',
  }
}

/**
 * Per-call charges (search, web fetch) for one step.
 *
 * The catalog keeps these as a list of {name, price, unit, currency,
 * effectiveFrom, statusBefore} rows. A row whose effective date is in the
 * future bills nothing yet — statusBefore is "free" for every such row today,
 * but the generic rule is "not charged before effectiveFrom".
 *
 * @param {object|null} model
 * @param {object} counts calls per row name, either snake_case or camelCase
 * @param {number} [atMs]
 * @returns {null | {amount:number,currency:(string|null),usd:(number|null),parts:object}}
 */
export function perCallCost(model, counts = {}, atMs = Date.now()) {
  const pricing = model && model.pricing
  const list = pricing && Array.isArray(pricing.perCall) ? pricing.perCall : []
  if (list.length === 0) return null
  const source = isObject(counts) ? counts : {}
  const asOf = dateKey(atMs)
  const parts = {}
  let amount = 0
  let currency = null
  let billable = false
  for (const row of list) {
    if (!isObject(row) || typeof row.name !== 'string' || row.name.length === 0) continue
    const name = row.name
    const calls = num(source[name]) === null ? (num(source[camel(name)]) || 0) : num(source[name])
    if (!(calls > 0)) {
      parts[name] = 0
      continue
    }
    const price = num(row.price)
    const per = row.unit === 'per_1000_calls' ? 1000 : row.unit === 'per_call' ? 1 : null
    if (price === null || per === null) return null
    const rowCurrency = typeof row.currency === 'string' ? row.currency : CATALOG.currency
    if (currency !== null && rowCurrency !== currency) return null
    currency = rowCurrency
    if (typeof row.effectiveFrom === 'string' && DATE_RE.test(row.effectiveFrom) && asOf < row.effectiveFrom) {
      parts[name] = 0
      continue
    }
    const cost = (calls * price) / per
    amount += cost
    billable = true
    parts[name] = roundAmount(cost)
  }
  if (!billable) return { amount: 0, currency, usd: 0, parts }
  const usd = toUsd(amount, currency)
  return { amount: roundAmount(amount), currency, usd: usd === null ? null : roundAmount(usd), parts }
}
