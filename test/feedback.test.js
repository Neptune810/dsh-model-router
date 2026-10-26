import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  FEEDBACK_LABELS,
  aggregateFeedback,
  labelOf,
  normalizeFeedback,
  normalizeOutcome,
  parseFeedback,
} from '../lib/feedback.js'
import { createFeedbackLog } from '../lib/feedback-store.js'

test('the three labels accept the spellings an older panel might send', () => {
  assert.deepEqual([...FEEDBACK_LABELS], ['too-expensive', 'too-weak', 'just-right'])
  assert.equal(labelOf(' expensive '), 'too-expensive')
  assert.equal(labelOf('TOO_WEAK'), 'too-weak')
  assert.equal(labelOf('ok'), 'just-right')
  assert.equal(labelOf('cheap'), 'too-weak')
  assert.equal(labelOf('excellent'), null)
  assert.equal(labelOf(7), null)
  assert.equal(labelOf(''), null)
})

test('a label record carries the route it judged and never the prompt', () => {
  const record = normalizeFeedback({ label: 'expensive', note: '  the   same   answer  ' }, {
    at: 1700000000000,
    session: 's1',
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    effort: 'max',
    stepClass: 'engineering',
  })
  assert.deepEqual(record, {
    v: 1,
    kind: 'label',
    at: 1700000000000,
    label: 'too-expensive',
    session: 's1',
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    effort: 'max',
    stepClass: 'engineering',
    note: 'the same answer',
  })
  assert.equal(normalizeFeedback({ label: 'meh' }), null)
  assert.equal(normalizeFeedback(undefined), null)
})

test('long notes and sessions are clipped, and the outcome keeps one bit', () => {
  const record = normalizeFeedback({ label: 'too-weak', note: 'x'.repeat(400), session: 'y'.repeat(100) }, { at: 5 })
  assert.equal(record.note.length, 200)
  assert.equal(record.session.length, 64)
  assert.equal(record.provider, null)
  assert.equal(record.effort, null)
  assert.deepEqual(normalizeOutcome({ at: 9, label: 'weak', changed: true, provider: 'relay-a', model: 'deepseek-flash' }), {
    v: 1,
    kind: 'outcome',
    at: 9,
    of: 'too-weak',
    changed: true,
    provider: 'relay-a',
    model: 'deepseek-flash',
  })
  assert.equal(normalizeOutcome({ label: 'nope' }), null)
})

test('parseFeedback skips what it cannot read', () => {
  const text = [
    JSON.stringify({ kind: 'label', label: 'weak', at: 1, stepClass: 'standard' }),
    'not json at all',
    '[1,2,3]',
    JSON.stringify({ kind: 'outcome', of: 'weak', at: 2, changed: false }),
    JSON.stringify({ kind: 'note', body: 'ignored' }),
    JSON.stringify({ kind: 'label', label: 'meh' }),
    '',
  ].join('\n')
  const records = parseFeedback(text)
  assert.equal(records.length, 2)
  assert.equal(records[0].label, 'weak')
  assert.equal(records[1].of, 'weak')
  assert.deepEqual(parseFeedback(undefined), [])
})

test('aggregateFeedback sums labels, per class, and the override share', () => {
  const records = [
    { kind: 'label', label: 'too-expensive', at: 1, stepClass: 'standard' },
    { kind: 'label', label: 'too-weak', at: 2, stepClass: 'standard' },
    { kind: 'label', label: 'just-right', at: 3, stepClass: 'engineering' },
    { kind: 'outcome', of: 'just-right', at: 4, changed: false },
    { kind: 'outcome', of: 'too-weak', at: 5, changed: true },
  ]
  const summary = aggregateFeedback(records)
  assert.equal(summary.total, 3)
  assert.deepEqual(summary.labels, { 'too-expensive': 1, 'too-weak': 1, 'just-right': 1 })
  assert.equal(summary.overrides, 2)
  assert.equal(summary.overrideShare, 0.6667)
  assert.equal(summary.lastAt, 5)
  assert.deepEqual(summary.outcomes, { recorded: 2, changed: 1, unchanged: 1, changedShare: 0.5 })
  assert.deepEqual(summary.byClass.standard, { 'too-expensive': 1, 'too-weak': 1, 'just-right': 0, total: 2 })
  assert.deepEqual(summary.byClass.engineering, { 'too-expensive': 0, 'too-weak': 0, 'just-right': 1, total: 1 })
  assert.deepEqual(aggregateFeedback(null), {
    total: 0,
    labels: { 'too-expensive': 0, 'too-weak': 0, 'just-right': 0 },
    byClass: {},
    overrides: 0,
    overrideShare: 0,
    outcomes: { recorded: 0, changed: 0, unchanged: 0, changedShare: 0 },
    lastAt: null,
  })
})

test('a label without a class lands under unknown instead of disappearing', () => {
  const summary = aggregateFeedback([{ kind: 'label', label: 'just-right' }])
  assert.deepEqual(summary.byClass, { unknown: { 'too-expensive': 0, 'too-weak': 0, 'just-right': 1, total: 1 } })
})

test('the feedback log appends, reads back and reports its own health', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mr-feedback-'))
  try {
    const log = createFeedbackLog({ dir, enabled: true })
    assert.equal(log.append({ kind: 'label', label: 'too-weak', at: 1, stepClass: 'standard' }), true)
    assert.equal(log.append({ kind: 'outcome', of: 'too-weak', at: 2, changed: true }), true)
    assert.equal(log.read().length, 2)
    assert.equal(log.read(1).length, 1)
    const health = log.health()
    assert.equal(health.enabled, true)
    assert.equal(health.file, 'feedback.v1.jsonl')
    assert.equal(health.written, 2)
    const onDisk = readFileSync(join(dir, 'feedback.v1.jsonl'), 'utf8').trim().split('\n')
    assert.equal(onDisk.length, 2)
    assert.equal(JSON.parse(onDisk[0]).label, 'too-weak')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a disabled log writes nothing and never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mr-feedback-off-'))
  try {
    const errors = []
    const log = createFeedbackLog({ dir, enabled: false, onError: (error) => errors.push(error) })
    assert.equal(log.append({ kind: 'label', label: 'just-right' }), false)
    assert.deepEqual(log.read(), [])
    assert.equal(log.health().enabled, false)
    assert.equal(log.health().written, 0)
    assert.deepEqual(errors, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})