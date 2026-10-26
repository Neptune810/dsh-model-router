import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ChannelHealth,
  channelOf,
  channelRanks,
  classifyFailure,
  fingerprint,
  orderChannels,
} from '../lib/channels.js'

test('classifyFailure separates rate limits from channel failures', () => {
  assert.equal(classifyFailure({ status: 429 }), 'rotate')
  assert.equal(classifyFailure({ status: 500 }), 'failover')
  assert.equal(classifyFailure({ status: 502 }), 'failover')
  assert.equal(classifyFailure({ status: 503 }), 'failover')
  assert.equal(classifyFailure({ status: 504 }), 'failover')
  assert.equal(classifyFailure({ status: 529 }), 'failover')
  assert.equal(classifyFailure({ status: 408 }), 'failover')
  assert.equal(classifyFailure({ timeout: true }), 'failover')
  // A request-side error must not blame the channel.
  assert.equal(classifyFailure({ status: 400 }), 'none')
  assert.equal(classifyFailure({ status: 401 }), 'none')
  assert.equal(classifyFailure({ status: 404 }), 'none')
  assert.equal(classifyFailure({ status: 200 }), 'none')
  assert.equal(classifyFailure({}), 'none')
  assert.equal(classifyFailure(null), 'none')
})

test('a channel we never saw is assumed healthy', () => {
  const health = new ChannelHealth()
  assert.equal(health.score('relay-a'), 1)
  assert.equal(health.successRate('relay-a'), 1)
  assert.equal(health.available('relay-a'), true)
  assert.equal(health.cooldownUntil('relay-a'), 0)
  assert.equal(health.coolingDown().length, 0)
})

test('three consecutive failures trip a cooldown that expires on the clock', () => {
  const health = new ChannelHealth({ now: 0, failThreshold: 3, cooldownMs: 60000 })
  health.record('relay-a', { ok: false, status: 503, at: 1000 })
  health.record('relay-a', { ok: false, status: 503, at: 2000 })
  assert.equal(health.available('relay-a', 2000), true, 'two failures are not a cooldown')
  assert.equal(health.cooldownUntil('relay-a'), 0)
  health.record('relay-a', { ok: false, status: 503, at: 3000 })
  assert.equal(health.cooldownUntil('relay-a'), 63000)
  assert.equal(health.available('relay-a', 3000), false)
  assert.equal(health.available('relay-a', 62999), false)
  assert.equal(health.available('relay-a', 63000), true)
  assert.deepEqual(health.coolingDown(3000), ['relay-a'])
  assert.deepEqual(health.coolingDown(63000), [])
})

test('a success ends a cooldown immediately and resets the streak', () => {
  const health = new ChannelHealth({ now: 0, failThreshold: 3, cooldownMs: 60000 })
  for (const at of [1, 2, 3]) health.record('relay-a', { ok: false, at })
  assert.equal(health.available('relay-a', 10), false)
  health.record('relay-a', { ok: true, at: 10, status: 200 })
  assert.equal(health.cooldownUntil('relay-a'), 0)
  assert.equal(health.available('relay-a', 10), true)
  const snap = health.snapshot(10)
  assert.equal(snap.channels['relay-a'].streak, 0)
  assert.equal(snap.channels['relay-a'].ok, 1)
  assert.equal(snap.channels['relay-a'].fail, 3)
})

test('a new failure streak is what trips the cooldown, not the raw failure count', () => {
  const health = new ChannelHealth({ now: 0, failThreshold: 2, cooldownMs: 1000 })
  health.record('x', { ok: false, at: 1 })
  health.record('x', { ok: true, at: 2 })
  health.record('x', { ok: false, at: 3 })
  assert.equal(health.available('x', 3), true, 'the streak restarted after the success')
  health.record('x', { ok: false, at: 4 })
  assert.equal(health.cooldownUntil('x'), 1004)
  assert.equal(health.snapshot(4).channels.x.cooldowns, 1)
})

test('the outcome window is bounded and drives the success rate', () => {
  const health = new ChannelHealth({ windowSize: 3, now: 0 })
  health.record('x', { ok: true, at: 1 })
  health.record('x', { ok: true, at: 2 })
  health.record('x', { ok: false, at: 3 })
  assert.equal(health.successRate('x'), 2 / 3)
  health.record('x', { ok: false, at: 4 })
  assert.equal(health.successRate('x'), 1 / 3, 'the oldest outcome fell out of the window')
  assert.equal(health.snapshot(4).channels.x.total, 4, 'the totals stay lifetime counts')
})

test('latency is an EWMA and only nudges a healthy score', () => {
  const health = new ChannelHealth({ now: 0, ewmaAlpha: 0.5, ttftSoftMs: 1000 })
  health.record('x', { ok: true, at: 1, ttftMs: 100 })
  assert.equal(health.snapshot(1).channels.x.ewmaTtftMs, 100)
  health.record('x', { ok: true, at: 2, ttftMs: 300 })
  assert.equal(health.snapshot(2).channels.x.ewmaTtftMs, 200)
  assert.equal(health.score('x'), 1, 'under the soft latency: no penalty')
  health.record('x', { ok: true, at: 3, ttftMs: 2000 })
  assert.equal(health.snapshot(3).channels.x.ewmaTtftMs, 1100)
  assert.equal(health.score('x'), 0.9, 'over the soft latency: a 10% nudge')
  health.record('x', { ok: false, at: 4 })
  assert.equal(Math.round(health.score('x') * 1000) / 1000, 0.675, 'failure rate and latency compound')
})

test('advance moves the ledger clock forward only', () => {
  const health = new ChannelHealth({ now: 100 })
  assert.equal(health.advance(50), 100)
  assert.equal(health.advance(200), 200)
  assert.equal(health.advance(NaN), 200)
  const row = health.record('x', { ok: false })
  assert.equal(row.lastAt, 200, 'a record without a timestamp uses the ledger clock')
})

test('orderChannels keeps the healthy first and drops nothing', () => {
  const health = new ChannelHealth({ now: 0, failThreshold: 2, cooldownMs: 1000 })
  health.record('relay-b', { ok: true, at: 1 })
  health.record('relay-b', { ok: false, at: 2 })
  health.record('relay-b', { ok: false, at: 3 })
  health.record('relay-c', { ok: false, at: 1 })
  health.record('relay-c', { ok: false, at: 2 })
  const ordered = orderChannels(['relay-c', 'relay-b', 'relay-a'], health, 100)
  assert.deepEqual(ordered, ['relay-a', 'relay-c', 'relay-b'],
    'unknown 1.0 first, then the cooling pair in cooldown order (c ended at 1002, b at 1003)')
  assert.equal(ordered.length, 3, 'nothing was dropped')
  assert.deepEqual(orderChannels(['relay-c', 'relay-b', 'relay-a'], health, 5000), ['relay-a', 'relay-b', 'relay-c'],
    'both cooldowns expired, so the better window (b: 1/3) beats c (0/2)')
})

test('orderChannels is stable for ties and accepts entry objects', () => {
  const health = new ChannelHealth()
  assert.deepEqual(orderChannels(['z/channel', 'a/channel', 'm/channel'], health, 0),
    ['z/channel', 'a/channel', 'm/channel'], 'all unknown: the caller order survives')
  const entries = [{ id: 'relay-a/gpt' }, { id: 'relay-b/gpt' }, { id: 'relay-a/other' }]
  assert.deepEqual(orderChannels(entries, health, 0), ['relay-a', 'relay-b', 'relay-a'],
    'ids are returned in the caller order (ties keep their index)')
  assert.equal(channelOf(entries[0]), 'relay-a')
  assert.equal(channelOf('deepseek-official/deepseek-flash'), 'deepseek-official')
  assert.equal(channelOf('bare-id'), 'bare-id')
  assert.equal(channelOf(null), '')
})

test('orderChannels falls back to the ledger clock when no timestamp is given', () => {
  const health = new ChannelHealth({ now: 500, failThreshold: 1, cooldownMs: 1000 })
  health.record('x', { ok: false, at: 500 })
  assert.deepEqual(orderChannels(['x', 'y'], health), ['y', 'x'], 'x is cooling at the ledger time')
  health.advance(2000)
  assert.equal(health.available('x'), true, 'the cooldown expired')
  assert.deepEqual(orderChannels(['x', 'y'], health), ['y', 'x'],
    'a channel with a failed window still scores below an unknown one')
})

test('channelRanks builds the routing signal and marks blocked channels', () => {
  const health = new ChannelHealth({ now: 0, failThreshold: 1, cooldownMs: 5000 })
  health.record('relay-a', { ok: false, at: 1 })
  const { rank, blocked } = channelRanks(['relay-a/x', 'relay-b/x', 'relay-c/x'], health, 1)
  assert.deepEqual(rank, { 'relay-b/x': 1, 'relay-c/x': 2, 'relay-a/x': 1001 })
  assert.deepEqual(blocked, { 'relay-a/x': true })
  assert.equal(channelRanks([], health, 0).rank && Object.keys(channelRanks([], health, 0).rank).length, 0)
})

test('a cooling channel still routes when it is the only one', () => {
  const health = new ChannelHealth({ now: 0, failThreshold: 1, cooldownMs: 60000 })
  health.record('only', { ok: false, at: 1 })
  const { rank, blocked } = channelRanks(['only/model'], health, 2)
  assert.deepEqual(blocked, { 'only/model': true })
  assert.equal(rank['only/model'], 1001, 'ranked, not removed')
  assert.deepEqual(orderChannels(['only/model'], health, 2), ['only/model'])
})

test('fingerprint accepts a response that matches what the channel promised', () => {
  const result = fingerprint(
    { model: 'deepseek-flash', usage: { input: 120, output: 40 }, ttftMs: 800 },
    { model: 'deepseek-flash', maxTtftMs: 30000 },
  )
  assert.deepEqual(result, { ok: true, reasons: [] })
  assert.deepEqual(fingerprint({ usage: { input: 1 } }, {}), { ok: true, reasons: [] })
})

test('fingerprint reports every mismatch it can prove', () => {
  assert.deepEqual(
    fingerprint({ model: 'deepseek-v4-pro', usage: { input: 1 } }, { model: 'deepseek-flash' }).reasons,
    ['model_mismatch'],
  )
  assert.deepEqual(fingerprint({ model: 'deepseek-flash' }, { model: 'deepseek-flash' }).reasons, ['usage_missing'])
  assert.deepEqual(fingerprint({ model: 'deepseek-flash', usage: {} }, { model: 'deepseek-flash' }).reasons, ['usage_missing'])
  assert.deepEqual(
    fingerprint({ model: 'deepseek-flash', usage: { input: 0, output: 0 } }, { model: 'deepseek-flash' }).reasons,
    ['usage_missing'],
  )
  assert.deepEqual(
    fingerprint({ model: 'deepseek-flash', usage: { input: 1 } }, { model: 'deepseek-flash', requireReasoning: true }).reasons,
    ['reasoning_missing'],
  )
  assert.deepEqual(
    fingerprint({ model: 'deepseek-flash', usage: { input: 1 }, reasoningTokens: 12 }, { requireReasoning: true }).reasons,
    [],
  )
  assert.deepEqual(
    fingerprint({ model: 'deepseek-flash', usage: { input: 1 }, ttftMs: 31000 }, { model: 'deepseek-flash' }).reasons,
    ['ttft_outlier'],
  )
  const all = fingerprint(
    { model: 'other', usage: {}, ttftMs: 9000, reasoning: '' },
    { model: 'deepseek-flash', requireReasoning: true, maxTtftMs: 8000 },
  )
  assert.equal(all.ok, false)
  assert.deepEqual(all.reasons, ['model_mismatch', 'usage_missing', 'reasoning_missing', 'ttft_outlier'])
})

test('fingerprint can be told not to require usage', () => {
  assert.deepEqual(fingerprint({ model: 'x' }, { model: 'x', requireUsage: false }), { ok: true, reasons: [] })
  assert.deepEqual(fingerprint({ usage: { input: 1 }, reasoning: 'thinking…' }, { requireReasoning: true }).reasons, [])
})

test('the snapshot is deterministic, JSON-safe and sorted', () => {
  const health = new ChannelHealth({ now: 0, windowSize: 5, failThreshold: 2, cooldownMs: 1000 })
  health.record('b', { ok: true, at: 10, status: 200, ttftMs: 123.4567 })
  health.record('a', { ok: false, at: 11, status: 500, timeout: false, error: 'bad gateway' })
  const snap = health.snapshot(11)
  assert.deepEqual(Object.keys(snap.channels), ['a', 'b'])
  assert.equal(snap.now, 11)
  assert.equal(snap.windowSize, 5)
  assert.equal(snap.failThreshold, 2)
  assert.equal(snap.cooldownMs, 1000)
  assert.deepEqual(snap.coolingDown, [])
  assert.equal(snap.channels.a.lastStatus, 500)
  assert.equal(snap.channels.a.lastError, 'bad gateway')
  assert.equal(snap.channels.b.ewmaTtftMs, 123.457, 'rounded to three decimals')
  assert.equal(snap.channels.b.successRate, 1)
  assert.equal(snap.channels.a.cooldownUntilInMs, 0)
  assert.doesNotThrow(() => JSON.stringify(snap))
  const cooling = new ChannelHealth({ now: 0, failThreshold: 1, cooldownMs: 500 })
  cooling.record('z', { ok: false, at: 0 })
  cooling.record('y', { ok: false, at: 0 })
  const cold = cooling.snapshot(100)
  assert.deepEqual(cold.coolingDown, ['y', 'z'])
  assert.deepEqual(Object.keys(cold.channels), ['y', 'z'])
  assert.equal(cold.channels.z.cooldownUntilInMs, 400)
})

test('a bench moves a channel out of the way without recording a failure', () => {
  const health = new ChannelHealth({ now: 1000, cooldownMs: 60000, failThreshold: 3 })
  assert.equal(health.cool('relay-a', 1000, 5000), 6000)
  assert.equal(health.available('relay-a', 5999), false)
  assert.equal(health.available('relay-a', 6000), true)

  // A longer bench replaces the deadline; a shorter one never shortens it.
  assert.equal(health.cool('relay-a', 6000, 1000), 7000)
  assert.equal(health.cool('relay-a', 7000, 1000), 8000)
  assert.equal(health.cool('relay-a', 1000, 500), 8000)

  const snapshot = health.snapshot(2000)
  const row = snapshot.channels['relay-a']
  assert.equal(row.fail, 0, 'a bench is not a failure record')
  assert.equal(row.cooldowns, 3, 'only benches that pushed the deadline count')
  assert.equal(row.cooldownUntilInMs, 6000)
  assert.deepEqual(snapshot.coolingDown, ['relay-a'])

  // No span falls back to the ledger's own cooldown window.
  assert.equal(health.cool('relay-b', 0), 60000)
  assert.deepEqual(health.snapshot(9000).coolingDown, ['relay-b'], 'relay-a is back by then')

  // A success clears the bench and leaves the count as history.
  health.record('relay-a', { ok: true, at: 3000 })
  assert.equal(health.available('relay-a', 3000), true)
  assert.equal(health.snapshot(3000).channels['relay-a'].cooldowns, 3)
})
