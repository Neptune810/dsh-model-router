import assert from 'node:assert/strict'
import test from 'node:test'

import { EXPERIMENT_DEFAULTS, experimentReport, explorable, planExperiment, seededRandom } from '../lib/experiments.js'

const ON = { enabled: true, apply: false, epsilon: 0.1, stepClass: 'standard', current: 'a/b', arms: ['a/b', 'c/d'] }

test('hard and engineering steps are never explorable', () => {
  assert.equal(explorable('standard'), true)
  assert.equal(explorable('trivial'), true)
  assert.equal(explorable('hard'), false)
  assert.equal(explorable('engineering'), false)
  assert.equal(explorable(undefined), true)
})

test('the seeded draw repeats exactly', () => {
  const first = seededRandom(7)
  const second = seededRandom(7)
  const other = seededRandom(8)
  const a = [first(), first(), first()]
  assert.deepEqual([second(), second(), second()], a)
  assert.notDeepEqual([other(), other(), other()], a)
  for (const value of a) assert.ok(value >= 0 && value < 1)
  assert.equal(typeof seededRandom(), 'function')
})

test('the draw is off unless every precondition holds', () => {
  assert.deepEqual(planExperiment({ ...ON, enabled: false }), {
    allowed: false, explore: false, arm: null, applied: false, epsilon: 0.1, reason: 'experiments are off',
  })
  assert.equal(planExperiment({ ...ON, stepClass: 'hard' }).reason, 'hard steps are never explored')
  assert.equal(planExperiment({ ...ON, stepClass: 'engineering' }).reason, 'engineering steps are never explored')
  assert.equal(planExperiment({ ...ON, arms: ['a/b'] }).reason, 'fewer than two arms in the pool')
  assert.equal(planExperiment({ ...ON, current: null }).reason, 'the incumbent arm is unknown')
  assert.equal(planExperiment({ ...ON, arms: ['a/b'] }).allowed, false)
  assert.equal(planExperiment().allowed, false)
  assert.equal(planExperiment().epsilon, EXPERIMENT_DEFAULTS.epsilon)
})

test('an exploitative roll keeps the incumbent and never applies', () => {
  const draw = planExperiment({ ...ON, apply: true, random: () => 0.5 })
  assert.deepEqual(draw, {
    allowed: true, explore: false, arm: 'a/b', applied: false, epsilon: 0.1, reason: 'exploit the incumbent',
  })
  assert.equal(planExperiment({ ...ON, epsilon: 0, random: () => 0 }).explore, false)
})

test('an exploratory roll picks an alternative and only applies when asked', () => {
  const shadow = planExperiment({ ...ON, epsilon: 0.3, arms: ['a/b', 'c/d', 'e/f'], random: () => 0.1 })
  assert.equal(shadow.allowed, true)
  assert.equal(shadow.explore, true)
  assert.equal(shadow.arm, 'c/d')
  assert.equal(shadow.applied, false)
  assert.match(shadow.reason, /^epsilon draw 0\.100 < 0\.3$/)
  const applied = planExperiment({ ...ON, apply: true, epsilon: 0.3, arms: ['a/b', 'c/d', 'e/f'], random: () => 0.29 })
  assert.equal(applied.arm, 'e/f')
  assert.equal(applied.applied, true)
})

test('epsilon is clamped and the arm index stays inside the alternatives', () => {
  const low = planExperiment({ ...ON, epsilon: -1, random: () => 0.5 })
  assert.equal(low.epsilon, 0)
  assert.equal(low.explore, false)
  const high = planExperiment({ ...ON, epsilon: 4, random: () => 0.999999 })
  assert.equal(high.epsilon, 1)
  assert.equal(high.arm, 'c/d')
  const nan = planExperiment({ ...ON, epsilon: Number.NaN, random: () => 0.5 })
  assert.equal(nan.epsilon, EXPERIMENT_DEFAULTS.epsilon)
  const rogue = planExperiment({ ...ON, epsilon: 1, random: () => Number.NaN })
  assert.equal(rogue.explore, true)
  assert.equal(rogue.arm, 'c/d')
})

test('experimentReport counts draws, applies and arms', () => {
  const events = [
    { experiment: { arm: 'c/d', explore: true, applied: true } },
    { experiment: { arm: 'a/b', explore: false, applied: false } },
    { experiment: { arm: 'c/d', explore: true, applied: false } },
    { experiment: null },
    {},
    { experiment: { arm: 7 } },
    { experiment: 'nope' },
  ]
  assert.deepEqual(experimentReport(events), {
    steps: 3,
    explored: 2,
    exploit: 1,
    applied: 1,
    byArm: { 'c/d': 2, 'a/b': 1 },
    exploredShare: 0.6667,
  })
  assert.deepEqual(experimentReport(null), {
    steps: 0, explored: 0, exploit: 0, applied: 0, byArm: {}, exploredShare: 0,
  })
})