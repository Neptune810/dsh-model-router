/**
 * dsh-model-router — catalog-driven pricing.
 *
 * The catalog is data, not a cost engine: it records dated list prices
 * (pricing, pricing.next), the DeepSeek peak/off-peak schedule and the hard
 * calendar of releases, price changes and retirements. This module turns that
 * data into the three things the router actually needs:
 *
 *   1. the price in effect at a given instant  (pricesAt)
 *   2. the USD cost of one token split          (tokenCost / usdCost)
 *   3. the reminders that matter for the next N days (upcomingAlerts)
 *
 * Everything is pure and dependency-free. Dates are local calendar dates in
 * the schedule's own time zone (Asia/Shanghai for DeepSeek); instants are
 * Date/ms values. An unknown price is null, never zero: a missing cache-write
 * price falls back to the fresh-input price (that is how implicit caching is
 * billed), and a missing input/output price makes the cost null instead of
 * inventing a number.
 *
 * Exported map (package.json): "./catalog-pricing".
 */

import { CATALOG } from './catalog.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_TZ = 'Asia/Shanghai'
const DAY_MS = 24 * 60 * 60 * 1000
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
/** "Mon-Fri 09:00-12:00" — the only window syntax the catalog uses. */
const WINDOW_RE = /^\s*([A-Za-z, -]+?)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/
/** The token split a step can produce; reasoning tokens bill as output. */
const SPLIT_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']

/** True for a well-formed YYYY-MM-DD calendar date (no time zone, no time). */
export function isDate(value) {
  return typeof value === 'string' && DATE_RE.test(value)
}

const formatters = new Map()

function formatterFor(timeZone) {
  let formatter = formatters.get(timeZone)
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
    } catch {
      // An unknown IANA zone must not take routing down: degrade to UTC and
      // keep going (the catalog is the only source of zones and it is static).
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
    }
    formatters.set(timeZone, formatter)
  }
  return formatter
}

function toDate(atMs) {
  const date = atMs instanceof Date ? atMs : new Date(atMs === undefined ? Date.now() : atMs)
  if (Number.isNaN(date.getTime())) throw new RangeError('invalid timestamp: ' + String(atMs))
  return date
}

/**
 * Wall-clock pieces of an instant in a time zone.
 * @param {number|Date} [atMs]
 * @param {string} [timeZone]
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,weekday:number}} weekday 0=Sunday
 */
export function zonedParts(atMs, timeZone = DEFAULT_TZ) {
  const parts = formatterFor(timeZone).formatToParts(toDate(atMs))
  const fields = {}
  for (const part of parts) {
    if (part.type !== 'literal') fields[part.type] = part.value
  }
  const weekday = DAY_NAMES.indexOf(String(fields.weekday || '').toLowerCase())
  return {
    year: Number(fields.year),
    month: Number(fields.month),
    day: Number(fields.day),
    hour: Number(fields.hour) % 24,
    minute: Number(fields.minute),
    weekday: weekday < 0 ? 0 : weekday,
  }
}

/**
 * The local calendar date at an instant, as YYYY-MM-DD.
 * @param {number|Date} [atMs]
 * @param {string} [timeZone]
 * @returns {string}
 */
export function dateKey(atMs, timeZone = DEFAULT_TZ) {
  const p = zonedParts(atMs, timeZone)
  return String(p.year).padStart(4, '0') + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0')
}

function dateToMs(key) {
  const [year, month, day] = key.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/**
 * Whole days from the local date at atMs to a catalog date (negative = past).
 * @param {string} date YYYY-MM-DD
 * @param {number|Date} [atMs]
 * @param {string} [timeZone]
 * @returns {number|null} null for a malformed date
 */
export function daysUntil(date, atMs, timeZone = DEFAULT_TZ) {
  if (!isDate(date)) return null
  const local = dateKey(atMs, timeZone)
  return Math.round((dateToMs(date) - dateToMs(local)) / DAY_MS)
}

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function parseWindow(spec) {
  if (typeof spec !== 'string') return null
  const match = WINDOW_RE.exec(spec)
  if (!match) return null
  const days = new Set()
  for (const chunk of match[1].split(',')) {
    const piece = chunk.trim()
    if (piece.length === 0) continue
    const bounds = piece.split('-').map((part) => part.trim())
    if (bounds.length === 1) {
      const day = DAY_NAMES.indexOf(bounds[0].toLowerCase())
      if (day >= 0) days.add(day)
      continue
    }
    if (bounds.length !== 2) continue
    const from = DAY_NAMES.indexOf(bounds[0].toLowerCase())
    const to = DAY_NAMES.indexOf(bounds[1].toLowerCase())
    if (from < 0 || to < 0) continue
    for (let day = from; ; day = (day + 1) % 7) {
      days.add(day)
      if (day === to) break
    }
  }
  const start = Number(match[2]) * 60 + Number(match[3])
  const end = Number(match[4]) * 60 + Number(match[5])
  if (days.size === 0 || !(start >= 0 && start < 1440) || !(end > start && end <= 1440)) return null
  return { days, start, end }
}

/**
 * Is the instant inside one of the pricing schedule's peak windows?
 *
 * The windows are treated as half-open [start, end): 12:00 is already
 * off-peak. Weekends and Chinese public holidays are not special-cased; the
 * catalog lists them in peakOffpeak.excludes for humans, and a catalog that
 * needs machine-checked holidays would grow an explicit holiday list.
 *
 * @param {number|Date} [atMs]
 * @param {object} [pricing] a model.pricing entry
 * @returns {boolean}
 */
export function isPeak(atMs, pricing) {
  const schedule = pricing && pricing.peakOffpeak
  if (!schedule || !Array.isArray(schedule.peakWindows) || schedule.peakWindows.length === 0) return false
  const timeZone = typeof schedule.tz === 'string' && schedule.tz.length > 0 ? schedule.tz : DEFAULT_TZ
  const parts = zonedParts(atMs, timeZone)
  const minuteOfDay = parts.hour * 60 + parts.minute
  for (const spec of schedule.peakWindows) {
    const window = parseWindow(spec)
    if (!window) continue
    if (!window.days.has(parts.weekday)) continue
    if (minuteOfDay >= window.start && minuteOfDay < window.end) return true
  }
  return false
}

/**
 * Convert an amount of the catalog's currency to USD.
 *
 * The catalog's fxRate is {base: CNY, quote: USD, rate: 7}: rate is how many
 * units of base one quote unit buys, so CNY amounts divide by it.
 *
 * @param {number} amount
 * @param {string} currency 'USD' | 'CNY'
 * @param {{base:string,quote:string,rate:number}} [fxRate]
 * @returns {number|null}
 */
export function toUsd(amount, currency, fxRate = CATALOG.fxRate) {
  const value = toNumber(amount)
  if (value === null) return null
  if (currency === 'USD') return value
  if (currency !== 'CNY') return null
  const rate = fxRate && typeof fxRate.rate === 'number' && Number.isFinite(fxRate.rate) ? fxRate.rate : 0
  if (!(rate > 0)) return null
  return value / rate
}

/**
 * The per-1M-token prices in effect at an instant.
 *
 * Resolution order: pricing.next wins once its effectiveFrom date arrives;
 * otherwise a schedule with peakOffpeak uses the off-peak rates outside the
 * peak windows. cacheWrite stays null when the catalog does not price it —
 * tokenCost() charges it at the fresh-input rate.
 *
 * @param {object} model a catalog model
 * @param {number|Date} [atMs]
 * @returns {null | {
 *   currency: string, unit: string, effectiveFrom: string, asOf: string,
 *   peak: boolean, source: 'base'|'next'|'offpeak',
 *   input: number|null, output: number|null, cacheRead: number|null, cacheWrite: number|null,
 *   usd: {input:number|null, output:number|null, cacheRead:number|null, cacheWrite:number|null}|null
 * }}
 */
export function pricesAt(model, atMs = Date.now()) {
  const pricing = model && model.pricing
  if (!pricing || pricing.unit !== 'per_1m_tokens') return null
  const asOf = dateKey(atMs)
  const rates = {
    input: toNumber(pricing.input),
    output: toNumber(pricing.output),
    cacheRead: toNumber(pricing.cacheRead),
    cacheWrite: toNumber(pricing.cacheWrite),
  }
  let effectiveFrom = pricing.effectiveFrom
  let source = 'base'
  let peak = false
  const next = pricing.next
  if (next && isDate(next.effectiveFrom) && asOf >= next.effectiveFrom) {
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
      if (toNumber(next[key]) !== null) rates[key] = toNumber(next[key])
    }
    effectiveFrom = next.effectiveFrom
    source = 'next'
  } else if (pricing.peakOffpeak) {
    peak = isPeak(atMs, pricing)
    if (!peak) {
      const offpeak = pricing.peakOffpeak.offpeakRates || {}
      for (const key of ['input', 'output', 'cacheRead']) {
        if (toNumber(offpeak[key]) !== null) rates[key] = toNumber(offpeak[key])
      }
      source = 'offpeak'
    }
  }
  const currency = pricing.currency
  return {
    currency,
    unit: pricing.unit,
    effectiveFrom,
    asOf,
    peak,
    source,
    input: rates.input,
    output: rates.output,
    cacheRead: rates.cacheRead,
    cacheWrite: rates.cacheWrite,
    usd: {
      input: toUsd(rates.input, currency),
      output: toUsd(rates.output, currency),
      cacheRead: toUsd(rates.cacheRead, currency),
      cacheWrite: toUsd(rates.cacheWrite, currency),
    },
  }
}

function roundAmount(value) {
  return Math.round(value * 1e10) / 1e10
}

/** Coerce a token split / token totals object into the five known keys. */
export function normalizeSplit(split) {
  const source = split && typeof split === 'object' ? split : {}
  const normalized = {}
  for (const key of SPLIT_KEYS) {
    const value = toNumber(source[key])
    normalized[key] = value === null ? 0 : value
  }
  return normalized
}

/**
 * Per-key token delta between two cumulative token totals.
 *
 * A session that restarts resets its totals; clamping the delta at zero keeps
 * the accounting honest instead of billing a negative step.
 *
 * @param {object|null|undefined} previous
 * @param {object|null|undefined} current
 * @returns {{input:number,output:number,cacheRead:number,cacheWrite:number,reasoning:number}}
 */
export function tokenSplit(previous, current) {
  const before = normalizeSplit(previous)
  const after = normalizeSplit(current)
  const split = {}
  for (const key of SPLIT_KEYS) split[key] = Math.max(0, after[key] - before[key])
  return split
}

/**
 * Cost of one token split at the given prices, in native currency and USD.
 *
 * Reasoning tokens are billed as output (that is what every model in the
 * catalog declares via effort.reasoningBilling). cacheWrite falls back to the
 * fresh-input rate when the catalog leaves it null.
 *
 * @param {object} split {input,output,cacheRead,cacheWrite,reasoning}
 * @param {object|null} prices the result of pricesAt()
 * @returns {null | {amount:number,currency:string,usd:number}}
 */
export function tokenCost(split, prices) {
  if (!prices) return null
  const input = toNumber(prices.input)
  const output = toNumber(prices.output)
  if (input === null || output === null) return null
  const cacheRead = toNumber(prices.cacheRead)
  const cacheWrite = toNumber(prices.cacheWrite)
  const tokens = normalizeSplit(split)
  const amount =
    (tokens.input * input +
      (tokens.output + tokens.reasoning) * output +
      tokens.cacheRead * (cacheRead === null ? input : cacheRead) +
      tokens.cacheWrite * (cacheWrite === null ? input : cacheWrite)) /
    1e6
  const usd = toUsd(amount, prices.currency)
  if (usd === null) return null
  return { amount: roundAmount(amount), currency: prices.currency, usd: roundAmount(usd) }
}

/**
 * USD cost of one token split, or null when the model has no usable price.
 * @param {object} split
 * @param {object|null} prices
 * @returns {number|null}
 */
export function usdCost(split, prices) {
  const cost = tokenCost(split, prices)
  return cost === null ? null : cost.usd
}

function modelLookup(catalog) {
  const lookup = new Map()
  for (const model of catalog.models || []) {
    if (model && typeof model.id === 'string') lookup.set(model.id, model)
  }
  return lookup
}

function displaysOf(models) {
  return models.map((model) => {
    if (model && typeof model.display === 'string' && model.display.length > 0) return model.display
    if (model && typeof model.id === 'string') return model.id
    return String(model)
  })
}

function nextPriceDescription(model, next, prices) {
  const display = model.display || model.id
  const before = prices ? prices.input + '/' + prices.output : 'current'
  const after = (next.input === undefined ? '?' : next.input) + '/' + (next.output === undefined ? '?' : next.output)
  return display + ': ' + before + ' -> ' + after + ' per 1M tokens (' + (prices ? prices.currency : 'list') + ')'
}

/**
 * Hard dates worth showing in the panel/stats for the next withinDays days.
 *
 * Sources, in this order (first wins when two sources describe the same date,
 * type and model set — the calendar description is the human-written one):
 *   1. catalog.calendar  (dated releases, billing starts, price changes)
 *   2. catalog.watchlist (hard dates for models deliberately outside the pool)
 *   3. models[].pricing.next (price change derived from the model entry)
 *   4. models[].retirementAt (retirement date)
 *
 * @param {number|Date} [atMs]
 * @param {object} [options]
 * @param {number} [options.withinDays] default 30
 * @param {object} [options.catalog] alternate catalog (tests)
 * @param {string} [options.timeZone] local date zone, default Asia/Shanghai
 * @param {boolean} [options.includePast] include dates up to withinDays in the past
 * @returns {Array<{date:string,type:string,source:string,external:boolean,models:string[],displays:string[],
 *   description:string,action:string|null,daysUntil:number}>}
 */
export function upcomingAlerts(atMs = Date.now(), options = {}) {
  const catalog = options.catalog || CATALOG
  const withinDays = Number.isInteger(options.withinDays) ? options.withinDays : 30
  const timeZone = typeof options.timeZone === 'string' && options.timeZone ? options.timeZone : DEFAULT_TZ
  const includePast = options.includePast === true
  const lookup = modelLookup(catalog)
  const today = dateKey(atMs, timeZone)
  const alerts = []
  const seen = new Set()

  const inWindow = (date) => {
    if (!isDate(date)) return false
    const delta = Math.round((dateToMs(date) - dateToMs(today)) / DAY_MS)
    if (delta > withinDays) return false
    if (includePast) return delta >= -withinDays
    return delta >= 0
  }

  const push = (alert, key) => {
    if (seen.has(key)) return
    seen.add(key)
    alerts.push(alert)
  }

  for (const entry of catalog.calendar || []) {
    if (!entry || !inWindow(entry.date) || !Array.isArray(entry.models) || entry.models.length === 0) continue
    const ids = entry.models.slice()
    const models = ids.map((id) => lookup.get(id) || { id })
    push(
      {
        date: entry.date,
        type: entry.type,
        source: 'calendar',
        external: false,
        models: ids,
        displays: displaysOf(models),
        description: typeof entry.description === 'string' ? entry.description : '',
        action: null,
        daysUntil: daysUntil(entry.date, atMs, timeZone),
      },
      entry.date + '|' + entry.type + '|' + ids.slice().sort().join(',')
    )
  }

  for (const entry of catalog.watchlist || []) {
    if (!entry || !inWindow(entry.date)) continue
    const id = entry.id
    push(
      {
        date: entry.date,
        type: entry.type,
        source: 'watchlist',
        external: true,
        models: [id],
        displays: [typeof entry.display === 'string' && entry.display.length > 0 ? entry.display : id],
        description: typeof entry.note === 'string' ? entry.note : '',
        action: typeof entry.action === 'string' ? entry.action : null,
        daysUntil: daysUntil(entry.date, atMs, timeZone),
      },
      entry.date + '|' + entry.type + '|' + id
    )
  }

  for (const model of catalog.models || []) {
    if (!model || typeof model.id !== 'string') continue
    const pricing = model.pricing || {}
    const next = pricing.next
    if (next && isDate(next.effectiveFrom) && inWindow(next.effectiveFrom)) {
      push(
        {
          date: next.effectiveFrom,
          type: 'price_increase',
          source: 'pricing.next',
          external: false,
          models: [model.id],
          displays: displaysOf([model]),
          description: nextPriceDescription(model, next, pricesAt(model, atMs)),
          action: null,
          daysUntil: daysUntil(next.effectiveFrom, atMs, timeZone),
        },
        next.effectiveFrom + '|price_increase|' + model.id
      )
    }
    if (isDate(model.retirementAt) && inWindow(model.retirementAt)) {
      push(
        {
          date: model.retirementAt,
          type: 'retirement',
          source: 'retirementAt',
          external: false,
          models: [model.id],
          displays: displaysOf([model]),
          description: (model.display || model.id) + ' retires on ' + model.retirementAt,
          action: null,
          daysUntil: daysUntil(model.retirementAt, atMs, timeZone),
        },
        model.retirementAt + '|retirement|' + model.id
      )
    }
  }

  alerts.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.type !== b.type) return a.type < b.type ? -1 : 1
    return a.models.join(',').localeCompare(b.models.join(','))
  })
  return alerts
}

/**
 * Catalog metadata for a routed model, used to annotate /stats rows and the
 * panel: identity, context window, retirement countdown and the prices in
 * effect at atMs.
 *
 * @param {object|undefined} model
 * @param {number|Date} [atMs]
 * @returns {null | {id:string,provider:string,display:string,contextWindow:number|null,
 *   retirementAt:string|null,daysToRetirement:number|null,prices:object|null}}
 */
export function modelMeta(model, atMs = Date.now()) {
  if (!model || typeof model.id !== 'string') return null
  const retirementAt = isDate(model.retirementAt) ? model.retirementAt : null
  return {
    id: model.id,
    provider: typeof model.provider === 'string' ? model.provider : '',
    display: typeof model.display === 'string' && model.display.length > 0 ? model.display : model.id,
    contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : null,
    retirementAt,
    daysToRetirement: retirementAt === null ? null : daysUntil(retirementAt, atMs),
    prices: pricesAt(model, atMs),
  }
}
