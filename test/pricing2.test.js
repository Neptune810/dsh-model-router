import test from 'node:test'
import assert from 'node:assert/strict'
import { findModel } from '../lib/catalog.js'
import { pricesAt, tokenCost } from '../lib/catalog-pricing.js'
import {
  DEFAULT_MIX,
  blendedUsdPerMTok,
  longContextRates,
  mixFromSplit,
  perCallCost,
  promptTokensOf,
  stepCost,
} from '../lib/pricing2.js'

// Fixed instants in Asia/Shanghai: 2026-10-26 is a Monday, so 10:00 local is a
// peak window (09:00-12:00) and 22:00 local is off-peak.
const MONDAY_PEAK = Date.parse('2026-10-26T02:00:00Z')
const MONDAY_NIGHT = Date.parse('2026-10-26T14:00:00Z')
const SUNDAY = Date.parse('2026-10-25T02:00:00Z')
const flash = findModel('deepseek', 'deepseek-flash')

function pricedModel(pricing) {
  return { id: 'synthetic/test', provider: 'synthetic', pricing: { unit: 'per_1m_tokens', currency: 'USD', ...pricing } }
}

test('mixFromSplit normalizes a split and folds cache writes into input', () => {
  assert.deepEqual(mixFromSplit({ input: 10, cacheWrite: 10, cacheRead: 70, output: 8, reasoning: 2 }), { input: 0.2, cacheRead: 0.7, output: 0.1 })
})

test('mixFromSplit falls back to the shipped mix when nothing was used', () => {
  assert.deepEqual(mixFromSplit(null), { ...DEFAULT_MIX })
  assert.deepEqual(mixFromSplit({}), { ...DEFAULT_MIX })
  assert.deepEqual(mixFromSplit({ input: 0, cacheRead: 0, output: 0 }), { ...DEFAULT_MIX })
  assert.deepEqual(mixFromSplit({ input: 'nonsense' }), { ...DEFAULT_MIX })
})

test('blendedUsdPerMTok prices deepseek-flash at the peak rate for the default mix', () => {
  // Peak CNY rates: input 2, cacheRead 0.04, output 8; fxRate 7.0 (catalog).
  // (0.5*2 + 0.35*0.04 + 0.15*8) / 7 / 1 = 0.3162857... USD per 1M tokens.
  const blended = blendedUsdPerMTok(flash, MONDAY_PEAK)
  assert.equal(blended.currency, 'CNY')
  assert.equal(blended.peak, true)
  assert.equal(blended.source, 'base')
  assert.equal(blended.usdPerMTok, 0.316286)
  assert.deepEqual(blended.mix, { ...DEFAULT_MIX })
})

test('blendedUsdPerMTok halves into the off-peak rate at night and on weekends', () => {
  const peak = blendedUsdPerMTok(flash, MONDAY_PEAK)
  const night = blendedUsdPerMTok(flash, MONDAY_NIGHT)
  const sunday = blendedUsdPerMTok(flash, SUNDAY)
  assert.equal(night.peak, false)
  assert.equal(night.source, 'offpeak')
  assert.equal(night.usdPerMTok, 0.158143) // (1 + 0.35*0.02 + 0.15*4) / 7
  assert.equal(sunday.source, 'offpeak')
  assert.equal(sunday.usdPerMTok, night.usdPerMTok)
})

test('blendedUsdPerMTok follows the asked-for token mix', () => {
  const cacheHeavy = blendedUsdPerMTok(flash, MONDAY_PEAK, { input: 0, cacheRead: 1, output: 0 })
  const outputHeavy = blendedUsdPerMTok(flash, MONDAY_PEAK, { input: 0, cacheRead: 0, output: 1 })
  assert.equal(cacheHeavy.usdPerMTok, 0.005714) // 0.04 / 7
  assert.equal(outputHeavy.usdPerMTok, 1.142857) // 8 / 7
  assert.ok(outputHeavy.usdPerMTok > cacheHeavy.usdPerMTok * 100)
})

test('blendedUsdPerMTok refuses to price a model the catalog cannot price', () => {
  assert.equal(blendedUsdPerMTok(null, MONDAY_PEAK), null)
  assert.equal(blendedUsdPerMTok({ id: 'x', pricing: { unit: 'subscription' } }, MONDAY_PEAK), null)
  assert.equal(blendedUsdPerMTok(pricedModel({ input: null, output: 8 }), MONDAY_PEAK), null)
})

test('promptTokensOf counts the three prompt buckets and passes numbers through', () => {
  assert.equal(promptTokensOf({ input: 10, cacheRead: 20, cacheWrite: 5, output: 999 }), 35)
  assert.equal(promptTokensOf(1234), 1234)
  assert.equal(promptTokensOf(null), 0)
})

test('longContextRates stays null for every DeepSeek model (their ladders are empty)', () => {
  assert.equal(longContextRates(flash, 500000, MONDAY_PEAK), null)
  assert.equal(longContextRates(findModel('deepseek', 'deepseek-v4-pro'), 500000, MONDAY_PEAK), null)
  assert.equal(longContextRates(null, 500000, MONDAY_PEAK), null)
})

test('longContextRates picks the highest matching tier and respects effectiveFrom', () => {
  const model = pricedModel({
    input: 1,
    output: 2,
    longContext: [
      { thresholdTokens: 1000, mode: 'excess', input: 2, output: 4 },
      { thresholdTokens: 4000, mode: 'whole_request', input: 3, output: 6 },
      { thresholdTokens: 8000, mode: 'whole_request', input: 9, output: 9, effectiveFrom: '2027-01-01' },
    ],
  })
  assert.equal(longContextRates(model, 500, MONDAY_PEAK), null)
  assert.equal(longContextRates(model, 1000, MONDAY_PEAK).thresholdTokens, 1000)
  assert.equal(longContextRates(model, 4000, MONDAY_PEAK).mode, 'whole_request')
  // The 8000-token tier is not in force on 2026-10-26, so 4000 still wins.
  assert.equal(longContextRates(model, 9000, MONDAY_PEAK).thresholdTokens, 4000)
  assert.equal(longContextRates(model, 9000, Date.parse('2027-02-01T02:00:00Z')).thresholdTokens, 8000)
})

test('stepCost reproduces tokenCost byte for byte when there is no long-context tier', () => {
  const split = { input: 1200, output: 340, cacheRead: 56000, cacheWrite: 0, reasoning: 90 }
  for (const at of [MONDAY_PEAK, MONDAY_NIGHT, SUNDAY]) {
    const priced = tokenCost(split, pricesAt(flash, at))
    const step = stepCost(flash, split, at)
    assert.equal(step.amount, priced.amount)
    assert.equal(step.usd, priced.usd)
    assert.equal(step.currency, priced.currency)
    assert.equal(step.basis, 'base')
    assert.equal(step.longContext, false)
  }
})

test('stepCost bills the whole request at the long rate in whole_request mode', () => {
  const model = pricedModel({
    input: 1,
    output: 10,
    longContext: [{ thresholdTokens: 200000, mode: 'whole_request', input: 2, output: 20 }],
  })
  const small = stepCost(model, { input: 1000, output: 1000 }, MONDAY_PEAK)
  assert.equal(small.basis, 'base')
  assert.equal(small.currency, 'USD')
  assert.equal(small.amount, (1000 * 1 + 1000 * 10) / 1e6)
  const big = stepCost(model, { input: 250000, output: 1000 }, MONDAY_PEAK)
  assert.equal(big.basis, 'whole_request')
  assert.equal(big.longContext, true)
  assert.equal(big.thresholdTokens, 200000)
  assert.equal(big.amount, (250000 * 2 + 1000 * 20) / 1e6)
})

test('stepCost bills only the overflow in excess mode, in prompt billing order', () => {
  const model = pricedModel({
    input: 1,
    output: 10,
    longContext: [{ thresholdTokens: 1000, mode: 'excess', input: 3, output: 30, cacheRead: 0.5 }],
  })
  // 800 fresh input + 700 cache reads: 800 bill inside, then 200 of the cache
  // reads finish the threshold and the remaining 500 bill at the long rate.
  const cost = stepCost(model, { input: 800, cacheRead: 700, output: 100 }, MONDAY_PEAK)
  assert.equal(cost.basis, 'excess')
  const expected = (800 * 1 + 200 * 1 + 500 * 0.5 + 100 * 10) / 1e6
  assert.equal(cost.amount, Math.round(expected * 1e10) / 1e10)
})

test('stepCost refuses unknown prices instead of inventing a rate', () => {
  assert.equal(stepCost(null, { input: 1000 }, MONDAY_PEAK), null)
  assert.equal(stepCost({ id: 'x', pricing: { unit: 'per_1m_tokens', currency: 'USD', input: null, output: 1 } }, { input: 1000 }, MONDAY_PEAK), null)
})

test('perCallCost charges search and web fetch from the catalog rows', () => {
  // 2026-11-01 is when DeepSeek starts charging; before it both rows are free.
  const before = perCallCost(flash, { search: 2000, webFetch: 500 }, MONDAY_PEAK)
  assert.equal(before.amount, 0)
  assert.equal(before.usd, 0)
  const after = perCallCost(flash, { search: 2000, webFetch: 500 }, Date.parse('2026-11-05T02:00:00Z'))
  assert.equal(after.currency, 'CNY')
  assert.equal(after.amount, 12.5) // 2*5 + 0.5*5
  assert.equal(after.usd, Math.round((12.5 / 7) * 1e10) / 1e10)
  assert.deepEqual(after.parts, { search: 10, web_fetch: 2.5 })
})

test('perCallCost returns null without per-call rows and tolerates missing counts', () => {
  assert.equal(perCallCost(findModel('deepseek', 'deepseek-v4-pro'), { search: 10 }, MONDAY_PEAK) === null, true)
  const none = perCallCost(flash, {}, MONDAY_PEAK)
  assert.equal(none.amount, 0)
  assert.equal(perCallCost(flash, null, MONDAY_PEAK).amount, 0)
})
