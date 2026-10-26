import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_BUDGETS,
  LADDER,
  LADDER_POINTS,
  budgetForTier,
  budgetTable,
  effortSummary,
  explainMapping,
  ladderRank,
} from '../lib/effort.js'

const DEEPSEEK = {
  maxOutput: 8192,
  effort: {
    vocab: ['none', 'low', 'high', 'max'],
    aliases: { medium: 'high', minimal: 'low', ultra: 'max', xhigh: 'high' },
  },
}

test('the ladder is the documented eight tiers with monotone points', () => {
  assert.deepEqual(LADDER, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
  let previous = -1
  for (const word of LADDER) {
    assert.equal(LADDER_POINTS[word] > previous, true, word + ' must sit above the tier before it')
    previous = LADDER_POINTS[word]
  }
  assert.equal(LADDER_POINTS.off, 0)
  assert.equal(ladderRank('off'), 0)
  assert.equal(ladderRank('ultra'), LADDER.length - 1)
  assert.equal(ladderRank('medium'), 3)
})

test('an unknown word ranks as high, never as off', () => {
  assert.equal(ladderRank('medium-ish'), LADDER.indexOf('high'))
  assert.equal(ladderRank(undefined), LADDER.indexOf('high'))
})

test('budgetTable ships defaults and lets a model override them', () => {
  assert.deepEqual(budgetTable(undefined), { ...DEFAULT_BUDGETS })
  const table = budgetTable({ effort: { budgets: { high: 4096, max: 16384, nonsense: 999, low: -3, medium: 'x' } } })
  assert.equal(table.high, 4096)
  assert.equal(table.max, 16384)
  assert.equal(table.low, DEFAULT_BUDGETS.low, 'a negative override is ignored')
  assert.equal(table.medium, DEFAULT_BUDGETS.medium, 'a non-numeric override is ignored')
  assert.equal(table.nonsense, undefined)
})

test('budgetForTier caps at maxOutput and answers 0 when there is no budget', () => {
  assert.equal(budgetForTier('high', DEEPSEEK), 8192, 'the model cap is tighter than the table')
  assert.equal(budgetForTier('low', DEEPSEEK), 2048)
  assert.equal(budgetForTier('high', { maxOutput: 65536 }), DEFAULT_BUDGETS.high)
  assert.equal(budgetForTier('off', DEEPSEEK), 0)
  assert.equal(budgetForTier('none', DEEPSEEK), 0)
  assert.equal(budgetForTier('ultra', { maxOutput: 0 }), DEFAULT_BUDGETS.ultra)
})

test('explainMapping names every way a tier can reach the wire', () => {
  assert.deepEqual(explainMapping('high', 'high', DEEPSEEK), { from: 'high', to: 'high', why: 'exact' })
  assert.deepEqual(explainMapping('medium', 'high', DEEPSEEK), { from: 'medium', to: 'high', why: 'alias' })
  assert.deepEqual(explainMapping('minimal', 'low', DEEPSEEK), { from: 'minimal', to: 'low', why: 'alias' })
  assert.deepEqual(explainMapping('high', 'max', DEEPSEEK), { from: 'high', to: 'max', why: 'nearest' })
  assert.deepEqual(explainMapping('high', undefined, DEEPSEEK), { from: 'high', to: null, why: 'none' })
  assert.deepEqual(explainMapping(undefined, 'low', undefined), { from: 'high', to: 'low', why: 'nearest' })
})

test('effortSummary reports the mapped share, the classes and the top collapses', () => {
  const events = [
    { stepClass: 'standard', chosen: { effort: 'low' }, effortMapped: { from: 'low', to: 'low', why: 'exact' } },
    { stepClass: 'standard', chosen: { effort: 'high' }, effortMapped: { from: 'medium', to: 'high', why: 'alias' } },
    { stepClass: 'engineering', chosen: { effort: 'high' }, effortMapped: { from: 'medium', to: 'high', why: 'alias' } },
    { stepClass: 'engineering', chosen: { effort: 'max' }, effortMapped: { from: 'xhigh', to: 'max', why: 'nearest' } },
    { stepClass: 'hard', chosen: { effort: 'max' } },
  ]
  const summary = effortSummary(events)
  assert.equal(summary.steps, 5)
  assert.equal(summary.mappedSteps, 3)
  assert.equal(summary.mappedShare, 0.6)
  assert.deepEqual(summary.byClass, [
    { stepClass: 'engineering', steps: 2, mapped: 2, mappedShare: 1 },
    { stepClass: 'hard', steps: 1, mapped: 0, mappedShare: 0 },
    { stepClass: 'standard', steps: 2, mapped: 1, mappedShare: 0.5 },
  ])
  assert.deepEqual(summary.top, [
    { pair: 'medium->high:alias', count: 2 },
    { pair: 'xhigh->max:nearest', count: 1 },
  ])
})

test('effortSummary ignores malformed events instead of throwing', () => {
  assert.deepEqual(effortSummary(undefined), { steps: 0, mappedSteps: 0, mappedShare: 0, byClass: [], top: [] })
  const summary = effortSummary([null, 7, {}, { chosen: {} }, { chosen: { effort: '' } }, { chosen: { effort: 'low' }, effortMapped: 'nope' }])
  assert.equal(summary.steps, 1)
  assert.equal(summary.mappedSteps, 0)
  assert.equal(summary.mappedShare, 0)
})
