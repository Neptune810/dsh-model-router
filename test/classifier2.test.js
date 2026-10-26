import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLASSIFIER_DEFAULTS,
  CircuitBreaker,
  decideVerdict,
  firstJsonObject,
  parseVerdict,
} from '../lib/classifier2.js'

const NAMES = ['trivial', 'standard', 'engineering', 'hard']

test('firstJsonObject takes the first balanced object and ignores trailing prose', () => {
  assert.equal(firstJsonObject('prefix {"a":1} suffix'), '{"a":1}')
  assert.equal(firstJsonObject('{"a":{"b":2}} tail'), '{"a":{"b":2}}')
  assert.equal(firstJsonObject('{"a":"}"} done'), '{"a":"}"}')
  assert.equal(firstJsonObject('no json here'), null)
  assert.equal(firstJsonObject(undefined), null)
})

test('parseVerdict reads the structured v2 answer', () => {
  const verdict = parseVerdict('{"class":"hard","confidence":0.82,"family":"refactor","evidence":"rewrite the parser","signals":["verb:rewrite","scope:multi-file"]}', NAMES)
  assert.deepEqual(verdict, {
    class: 'hard',
    confidence: 0.82,
    family: 'refactor',
    evidence: 'rewrite the parser',
    signals: ['verb:rewrite', 'scope:multi-file'],
    source: 'json',
  })
  // The v1 key and the alias keys still parse.
  assert.equal(parseVerdict('{"type":"trivial","confidence":1.7}', NAMES).confidence, 1)
  const alias = parseVerdict('{"taskType":"engineering","conf":0.5,"group":"tooling","why":"touch ci","markers":["ci"]}', NAMES)
  assert.equal(alias.class, 'engineering')
  assert.equal(alias.confidence, 0.5)
  assert.equal(alias.family, 'tooling')
  assert.equal(alias.evidence, 'touch ci')
  assert.deepEqual(alias.signals, ['ci'])
})

test('parseVerdict rejects what it cannot name and falls back to prose', () => {
  assert.equal(parseVerdict('{"class":"nonsense","confidence":0.9}', NAMES), null)
  assert.equal(parseVerdict('{"confidence":0.9}', NAMES), null)
  assert.equal(parseVerdict('', NAMES), null)
  const prose = parseVerdict('This looks like a HARD one to me.', NAMES)
  assert.deepEqual(prose, { class: 'hard', confidence: null, family: null, evidence: null, signals: [], source: 'prose' })
  // "none" is a valid JSON answer but never a class.
  const none = parseVerdict('{"class":"none","confidence":0.9}', NAMES)
  assert.equal(none.class, 'none')
  assert.equal(decideVerdict(none, 'standard').value, 'standard')
})

test('decideVerdict keeps the rules when the answer is unsure, and lifts the step', () => {
  const sure = decideVerdict({ class: 'hard', confidence: 0.9 }, 'standard', 0.6)
  assert.equal(sure.value, 'hard')
  assert.equal(sure.source, 'llm')
  assert.equal(sure.escalate, false)

  const unsure = decideVerdict({ class: 'hard', confidence: 0.42 }, 'standard', 0.6)
  assert.equal(unsure.value, 'standard', 'the rules decide the preset')
  assert.equal(unsure.source, 'low-confidence')
  assert.equal(unsure.escalate, true, 'and the step is lifted one tier instead')
  assert.match(unsure.why, /0.42 < 0.60/)

  const prose = decideVerdict({ class: 'engineer' + 'ing', confidence: null }, 'standard', 0.6)
  assert.equal(prose.value, 'engineering')
  assert.equal(prose.source, 'prose')
  assert.equal(prose.escalate, true)

  const nothing = decideVerdict(null, 'standard', 0.6)
  assert.equal(nothing.value, 'standard')
  assert.equal(nothing.source, 'rules')
  assert.equal(nothing.escalate, false)

  // The floor is configurable, and a floor of 0 accepts anything scored.
  assert.equal(decideVerdict({ class: 'trivial', confidence: 0.1 }, 'standard', 0).value, 'trivial')
  assert.equal(decideVerdict({ class: 'trivial', confidence: 0.1 }, 'standard', 0.5).source, 'low-confidence')
  assert.equal(CLASSIFIER_DEFAULTS.minConfidence, 0.6)
})

test('the breaker opens after consecutive failures and lets one call through after the cooldown', () => {
  const breaker = new CircuitBreaker({ fails: 3, cooldownMs: 600000 })
  assert.equal(breaker.allow(0), true)
  breaker.recordFailure(10)
  breaker.recordFailure(20)
  assert.equal(breaker.allow(30), true, 'two failures are not enough')
  const opened = breaker.recordFailure(30)
  assert.equal(opened.opened, true)
  assert.equal(opened.openUntil, 600030)
  assert.equal(breaker.allow(600029), false)
  const snapshot = breaker.snapshot(600029)
  assert.equal(snapshot.open, true)
  assert.equal(snapshot.openForMs, 1)
  assert.equal(snapshot.opens, 1)
  assert.equal(breaker.allow(600030), true, 'the cooldown expires')
  assert.equal(breaker.snapshot(600030).open, false)
  // A failure right after the cooldown re-opens it, because the count never reset.
  assert.equal(breaker.recordFailure(600031).opened, true)
  // One success resets everything.
  breaker.recordSuccess()
  assert.equal(breaker.snapshot(600032).fails, 0)
  assert.equal(breaker.allow(600032), true)
})

test('the breaker defaults come from CLASSIFIER_DEFAULTS', () => {
  const breaker = new CircuitBreaker()
  const snapshot = breaker.snapshot(0)
  assert.equal(snapshot.threshold, CLASSIFIER_DEFAULTS.breakerFails)
  assert.equal(snapshot.cooldownMs, CLASSIFIER_DEFAULTS.breakerMs)
  assert.equal(snapshot.open, false)
  assert.equal(CLASSIFIER_DEFAULTS.timeoutMs, 2000)
  assert.equal(CLASSIFIER_DEFAULTS.attempts, 2)
})
