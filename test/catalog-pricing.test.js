import test from 'node:test'
import assert from 'node:assert/strict'

import { MODELS } from '../lib/catalog.js'
import {
  dateKey,
  daysUntil,
  isDate,
  isPeak,
  modelMeta,
  normalizeSplit,
  pricesAt,
  tokenCost,
  tokenSplit,
  toUsd,
  upcomingAlerts,
  usdCost,
} from '../lib/catalog-pricing.js'

const shanghai = (iso) => Date.parse(iso + '+08:00')
const deepseek = MODELS.find((model) => model.id === 'deepseek-flash')
const argon = MODELS.find((model) => model.id === 'gemini-4-argon')
const flashPromo = MODELS.find((model) => model.id === 'gemini-3.8-flash')

const usdPricing = {
  currency: 'USD',
  unit: 'per_1m_tokens',
  effectiveFrom: '2026-01-01',
  input: 1,
  output: 2,
  cacheRead: 0.1,
  cacheWrite: null,
  peakOffpeak: null,
}

function customModel(overrides = {}) {
  const { pricing, ...rest } = overrides
  return { id: 'test-model', provider: 'test', display: 'Test Model', pricing: { ...usdPricing, ...(pricing || {}) }, ...rest }
}

test('dateKey and zonedParts follow the schedule time zone, not UTC', () => {
  // 16:30 UTC on the 25th is already 00:30 on the 26th in Shanghai.
  assert.equal(dateKey(Date.parse('2026-10-25T16:30:00Z')), '2026-10-26')
  assert.equal(dateKey(Date.parse('2026-10-26T15:59:59Z')), '2026-10-26')
  assert.equal(dateKey(Date.parse('2026-10-26T16:00:00Z')), '2026-10-27')
  assert.equal(dateKey(Date.parse('2026-10-26T16:00:00Z'), 'UTC'), '2026-10-26')
  assert.equal(isDate('2026-10-26'), true)
  assert.equal(isDate('2026-1-1'), false)
  assert.equal(isDate('unknown'), false)
  assert.equal(isDate(20261026), false)
})

test('isPeak uses half-open windows and skips weekends', () => {
  const monday = '2026-10-26'
  assert.equal(isPeak(shanghai(monday + 'T09:00:00'), deepseek.pricing), true)
  assert.equal(isPeak(shanghai(monday + 'T11:59:00'), deepseek.pricing), true)
  // 12:00 is off-peak: the window is [start, end).
  assert.equal(isPeak(shanghai(monday + 'T12:00:00'), deepseek.pricing), false)
  assert.equal(isPeak(shanghai(monday + 'T13:00:00'), deepseek.pricing), false)
  assert.equal(isPeak(shanghai(monday + 'T14:00:00'), deepseek.pricing), true)
  assert.equal(isPeak(shanghai(monday + 'T17:59:00'), deepseek.pricing), true)
  assert.equal(isPeak(shanghai(monday + 'T18:00:00'), deepseek.pricing), false)
  // Weekend: not peak even at 10:00.
  assert.equal(isPeak(shanghai('2026-10-31T10:00:00'), deepseek.pricing), false)
  // A schedule-free model is never peak, and a malformed schedule fails closed.
  assert.equal(isPeak(shanghai(monday + 'T10:00:00'), argon.pricing), false)
  assert.equal(isPeak(shanghai(monday + 'T10:00:00'), undefined), false)
  assert.equal(isPeak(shanghai(monday + 'T10:00:00'), { peakOffpeak: { peakWindows: ['nonsense'] } }), false)
  // tz is honoured: the same instant can be peak in Shanghai and not in UTC.
  const utcPricing = { peakOffpeak: { tz: 'UTC', peakWindows: ['Mon-Fri 09:00-10:00'] } }
  assert.equal(isPeak(Date.parse('2026-10-26T09:30:00Z'), utcPricing), true)
  assert.equal(isPeak(Date.parse('2026-10-26T10:30:00Z'), utcPricing), false)
})

test('pricesAt returns the base price when no schedule or next price applies', () => {
  const prices = pricesAt(argon, shanghai('2026-10-26T12:00:00'))
  assert.equal(prices.currency, 'USD')
  assert.equal(prices.source, 'base')
  assert.equal(prices.peak, false)
  assert.equal(prices.input, 2)
  assert.equal(prices.output, 10)
  assert.equal(prices.cacheRead, 0.1)
  assert.equal(prices.cacheWrite, null)
  assert.equal(prices.effectiveFrom, '2026-10-13')
  assert.equal(prices.asOf, '2026-10-26')
  assert.equal(prices.usd.input, 2)
  assert.equal(prices.usd.cacheRead, 0.1)
  assert.equal(prices.usd.cacheWrite, null)
})

test('pricesAt applies off-peak rates outside the DeepSeek peak windows', () => {
  const peak = pricesAt(deepseek, shanghai('2026-10-26T10:00:00'))
  assert.equal(peak.source, 'base')
  assert.equal(peak.peak, true)
  assert.equal(peak.input, 2)
  assert.equal(peak.output, 8)
  assert.equal(peak.cacheRead, 0.04)

  const offpeak = pricesAt(deepseek, shanghai('2026-10-26T20:00:00'))
  assert.equal(offpeak.source, 'offpeak')
  assert.equal(offpeak.peak, false)
  assert.equal(offpeak.input, 1)
  assert.equal(offpeak.output, 4)
  assert.equal(offpeak.cacheRead, 0.02)
  // The USD view is converted at the catalog FX rate (7 CNY = 1 USD).
  assert.ok(Math.abs(offpeak.usd.input - 1 / 7) < 1e-12)
  assert.ok(Math.abs(offpeak.usd.output - 4 / 7) < 1e-12)
})

test('pricesAt switches to pricing.next on its effective date and not before', () => {
  const eve = pricesAt(argon, shanghai('2026-11-30T23:59:59'))
  assert.equal(eve.source, 'base')
  assert.equal(eve.input, 2)
  const day = pricesAt(argon, shanghai('2026-12-01T00:00:00'))
  assert.equal(day.source, 'next')
  assert.equal(day.effectiveFrom, '2026-12-01')
  assert.equal(day.input, 4)
  assert.equal(day.output, 20)
  assert.equal(day.cacheRead, 0.2)
  assert.equal(day.usd.input, 4)

  const promo = pricesAt(flashPromo, shanghai('2026-12-31T23:00:00'))
  assert.equal(promo.source, 'base')
  assert.equal(promo.input, 0.825)
  const post = pricesAt(flashPromo, shanghai('2027-01-01T00:00:00'))
  assert.equal(post.source, 'next')
  assert.equal(post.input, 1.5)
})

test('pricesAt refuses unknown pricing shapes instead of guessing', () => {
  assert.equal(pricesAt(null), null)
  assert.equal(pricesAt({}), null)
  assert.equal(pricesAt({ pricing: { unit: 'per_call', currency: 'USD', input: 1, output: 2 } }), null)
  const prices = pricesAt(customModel({ pricing: { input: null, output: 2 } }))
  assert.equal(prices.input, null)
  assert.equal(prices.usd.input, null)
})

test('toUsd converts CNY and passes USD through, unknown currencies stay null', () => {
  assert.equal(toUsd(2, 'USD'), 2)
  assert.equal(toUsd(7, 'CNY'), 1)
  assert.equal(toUsd(2, 'CNY'), 2 / 7)
  assert.equal(toUsd(2, 'EUR'), null)
  assert.equal(toUsd(null, 'USD'), null)
  assert.equal(toUsd(-1, 'USD'), null)
  assert.equal(toUsd(2, 'CNY', { rate: 0 }), null)
  assert.equal(toUsd(2, 'CNY', { rate: 8 }), 0.25)
})

test('tokenCost bills reasoning as output and cache write as input when unpriced', () => {
  const usd = { currency: 'USD', input: 1, output: 2, cacheRead: 0.1, cacheWrite: null }
  const cost = tokenCost({ input: 1000000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, usd)
  assert.deepEqual(cost, { amount: 1, currency: 'USD', usd: 1 })
  // reasoning tokens bill at the output rate
  assert.equal(tokenCost({ reasoning: 1000000 }, usd).amount, 2)
  // cacheWrite is unpriced -> fresh-input rate
  assert.equal(tokenCost({ cacheWrite: 1000000 }, usd).amount, 1)
  // cacheRead has its own rate
  assert.equal(tokenCost({ cacheRead: 1000000 }, usd).amount, 0.1)
  // mixed split
  const mixed = tokenCost({ input: 500000, output: 250000, cacheRead: 200000, cacheWrite: 50000, reasoning: 100000 }, usd)
  assert.equal(mixed.amount, (0.5 * 1 + 0.35 * 2 + 0.2 * 0.1 + 0.05 * 1))
  assert.equal(usdCost({ input: 1000000 }, usd), 1)
})

test('tokenCost converts the native amount to USD', () => {
  const prices = { currency: 'CNY', input: 2, output: 8, cacheRead: 0.04, cacheWrite: null }
  const cost = tokenCost({ input: 1000000, output: 0 }, prices)
  assert.equal(cost.amount, 2)
  assert.equal(cost.currency, 'CNY')
  assert.ok(Math.abs(cost.usd - 2 / 7) < 1e-9)
})

test('tokenCost returns null when a required price is missing or no price snapshot exists', () => {
  assert.equal(tokenCost({ input: 1 }, null), null)
  assert.equal(tokenCost({ input: 1 }, { currency: 'USD', input: null, output: 2 }), null)
  assert.equal(tokenCost({ input: 1 }, { currency: 'USD', input: 1, output: null }), null)
  assert.equal(tokenCost({ input: 1 }, { currency: 'EUR', input: 1, output: 2 }), null)
  // An empty split is a legal 0-cost step, not an error.
  assert.equal(tokenCost({}, { currency: 'USD', input: 1, output: 2 }).amount, 0)
})

test('normalizeSplit and tokenSplit clamp resets and missing keys', () => {
  assert.deepEqual(normalizeSplit({ input: 5, output: 2 }), { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0 })
  assert.deepEqual(normalizeSplit(null), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 })
  assert.deepEqual(normalizeSplit({ input: -3, output: 'x' }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 })
  const delta = tokenSplit({ input: 10, output: 5, cacheRead: 100 }, { input: 15, output: 9, cacheRead: 130, reasoning: 3 })
  assert.deepEqual(delta, { input: 5, output: 4, cacheRead: 30, cacheWrite: 0, reasoning: 3 })
  // The totals shrank (a new session): bill 0, never a negative step.
  assert.deepEqual(tokenSplit({ input: 100 }, { input: 10 }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 })
  // A totals map with only some keys behaves like zeroes for the rest.
  assert.deepEqual(tokenSplit(null, { output: 7 }), { input: 0, output: 7, cacheRead: 0, cacheWrite: 0, reasoning: 0 })
})

test('daysUntil counts whole local days, including negatives', () => {
  assert.equal(daysUntil('2026-11-01', shanghai('2026-10-26T12:00:00')), 6)
  assert.equal(daysUntil('2026-10-26', shanghai('2026-10-26T23:59:00')), 0)
  assert.equal(daysUntil('2026-10-25', shanghai('2026-10-26T00:01:00')), -1)
  assert.equal(daysUntil('2026-10-23', shanghai('2026-10-26T12:00:00')), -3)
  assert.equal(daysUntil('not-a-date'), null)
})

test('upcomingAlerts lists the next 30 days and dedupes calendar vs pricing.next', () => {
  const now = shanghai('2026-10-26T12:00:00')
  const alerts = upcomingAlerts(now)
  assert.deepEqual(alerts.map((alert) => [alert.date, alert.type, alert.source, alert.external]), [
    ['2026-11-01', 'billing_start', 'calendar', false],
  ])
  assert.equal(alerts[0].daysUntil, 6)
  assert.deepEqual(alerts[0].models, ['deepseek-flash', 'deepseek-v4-pro'])
  assert.ok(alerts[0].displays.includes('DeepSeek-V4.1-Flash-1017'))

  // 120 days later: the two announced price increases appear exactly once each,
  // the calendar entry winning over the derived pricing.next alert.
  const later = upcomingAlerts(shanghai('2026-11-15T09:00:00'), { withinDays: 60 })
  const december = later.filter((alert) => alert.date === '2026-12-01')
  assert.equal(december.length, 1)
  assert.equal(december[0].source, 'calendar')
  assert.ok(december[0].description.includes('Gemini 4 Argon'))
})

test('upcomingAlerts reaches the watchlist when the window is long enough', () => {
  const alerts = upcomingAlerts(shanghai('2026-10-26T12:00:00'), { withinDays: 400 })
  const watch = alerts.find((alert) => alert.source === 'watchlist')
  assert.ok(watch)
  assert.equal(watch.date, '2026-12-31')
  assert.equal(watch.type, 'retirement')
  assert.equal(watch.external, true)
  assert.deepEqual(watch.models, ['glm-4.5'])
  assert.equal(watch.daysUntil, 66)
  assert.ok(typeof watch.action === 'string' && watch.action.length > 0)
  // Sorted ascending by date, and the 2026-10-23 release is in the past -> out.
  assert.deepEqual(alerts.map((alert) => alert.date), [...alerts.map((alert) => alert.date)].sort())
  assert.ok(!alerts.some((alert) => alert.date === '2026-10-23'))
})

test('upcomingAlerts can include the past and uses the window as a bound', () => {
  const now = shanghai('2026-10-26T12:00:00')
  const past = upcomingAlerts(now, { includePast: true })
  assert.deepEqual(past.map((alert) => alert.date), ['2026-10-23', '2026-11-01'])
  // Exactly on the alert date it is still upcoming (daysUntil 0), not past.
  const onDate = upcomingAlerts(shanghai('2026-11-01T00:00:00'))
  // The 30-day window counted from 2026-11-01 still reaches 2026-12-01.
  assert.deepEqual(onDate.map((alert) => alert.date), ['2026-11-01', '2026-12-01'])
  const after = upcomingAlerts(shanghai('2026-11-02T00:00:00'))
  // 2026-12-01 is 29 days later, still inside the 30-day window.
  assert.deepEqual(after.map((alert) => alert.date), ['2026-12-01'])
})

test('upcomingAlerts derives retirement alerts from model entries', () => {
  const model = customModel({ id: 'retiring-model', display: 'Retiring Model', retirementAt: '2026-11-20' })
  const catalog = { models: [model], calendar: [], watchlist: [] }
  const alerts = upcomingAlerts(shanghai('2026-10-26T12:00:00'), { catalog })
  assert.deepEqual(alerts.map((alert) => [alert.date, alert.type, alert.source]), [['2026-11-20', 'retirement', 'retirementAt']])
  assert.deepEqual(alerts[0].models, ['retiring-model'])
  assert.equal(alerts[0].daysUntil, 25)
  // A malformed retirementAt is ignored, not treated as today.
  const broken = upcomingAlerts(shanghai('2026-10-26T12:00:00'), { catalog: { models: [{ ...model, retirementAt: 'soon' }] } })
  assert.equal(broken.length, 0)
})

test('upcomingAlerts is stable for an empty catalog', () => {
  assert.deepEqual(upcomingAlerts(shanghai('2026-10-26T12:00:00'), { catalog: {} }), [])
  assert.deepEqual(upcomingAlerts(shanghai('2026-10-26T12:00:00'), { catalog: { models: [], calendar: [], watchlist: [] } }), [])
})

test('modelMeta exposes identity, retirement countdown and current prices', () => {
  const meta = modelMeta(deepseek, shanghai('2026-10-26T10:00:00'))
  assert.equal(meta.id, 'deepseek-flash')
  assert.equal(meta.provider, 'deepseek')
  assert.equal(meta.display, 'DeepSeek-V4.1-Flash-1017')
  assert.equal(meta.contextWindow, 1000000)
  assert.equal(meta.retirementAt, null)
  assert.equal(meta.daysToRetirement, null)
  assert.equal(meta.prices.peak, true)
  assert.equal(meta.prices.input, 2)
  assert.equal(modelMeta(undefined), null)
  const retiring = modelMeta(customModel({ retirementAt: '2026-11-20' }), shanghai('2026-10-26T12:00:00'))
  assert.equal(retiring.retirementAt, '2026-11-20')
  assert.equal(retiring.daysToRetirement, 25)
})
