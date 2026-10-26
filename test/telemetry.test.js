import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTelemetry, TELEMETRY_VERSION } from '../lib/telemetry.js'

const NOV = Date.UTC(2026, 10, 3, 9, 0, 0)
const WEEK_MS = 7 * 24 * 3600 * 1000

/** Private temp directory, removed after the test. */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'model-router-telemetry-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function telemetryFiles(dir) {
  return readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort()
}

function jsonLines(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

function onlyFile(dir) {
  const files = telemetryFiles(dir)
  assert.equal(files.length, 1, 'exactly one telemetry file exists')
  return join(dir, files[0])
}

test('writeDecision + flush appends exactly one JSON line and keeps no object reference', async (t) => {
  const dir = tempDir(t)
  const tel = createTelemetry({ dir, now: () => NOV + 1000 })
  const event = {
    ts: NOV,
    session: 'sha256:0123456789abcdef',
    turn: 3,
    step: 7,
    policy: '0.15.0',
    score: 64,
    stepClass: 'engineering',
    chosen: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'high', tier: 'cheap', cost: 1, costSource: 'builtin' },
    manualOverride: false,
    applied: true,
    usage: { tokens: 2000, costUnits: 0.008 },
  }
  assert.equal(TELEMETRY_VERSION, 1)
  assert.equal(tel.writeDecision(event), true)

  // The event is serialized on write: later mutation must not reach the file.
  event.score = 999
  assert.equal(typeof event.ts, 'number', 'the caller object is not mutated')

  await tel.flush()
  const file = onlyFile(dir)
  assert.equal(file.endsWith('decisions-2026-11.jsonl'), true)
  const raw = readFileSync(file, 'utf8')
  assert.equal(raw.endsWith('\n'), true, 'one line per event, newline terminated')
  assert.equal(raw.split('\n').filter((line) => line.length > 0).length, 1)
  const parsed = JSON.parse(raw.trim())
  assert.equal(parsed.v, TELEMETRY_VERSION)
  assert.equal(parsed.ts, '2026-11-03T09:00:00.000Z')
  assert.equal(parsed.score, 64)
  assert.deepEqual(parsed.chosen, event.chosen)
  assert.deepEqual(parsed.usage, { tokens: 2000, costUnits: 0.008 })

  const status = tel.health()
  assert.equal(status.dir, dir)
  assert.equal(status.enabled, true)
  assert.equal(status.written, 1)
  assert.equal(status.lastError, null)
  assert.deepEqual(status.files, ['decisions-2026-11.jsonl'])
  assert.equal(status.bytes, Buffer.byteLength(raw))
})

test('events written in one tick coalesce into one append batch', async (t) => {
  const dir = join(tempDir(t), 'lazy', 'telemetry')
  const tel = createTelemetry({ dir, now: () => NOV })
  for (let step = 0; step < 5; step += 1) assert.equal(tel.writeDecision({ ts: NOV + step, step }), true)
  assert.equal(existsSync(dir), false, 'the directory is created lazily on the first flush')
  await tel.flush()
  assert.equal(existsSync(dir), true)
  const events = jsonLines(onlyFile(dir))
  assert.deepEqual(events.map((event) => event.step), [0, 1, 2, 3, 4], 'one batch, five lines, written order')
  assert.equal(tel.health().written, 5)
})

test('month file naming follows the event ts and the injected clock for ts-less events', async (t) => {
  const dir = tempDir(t)
  const january = Date.UTC(2026, 0, 15, 12)
  const tel = createTelemetry({ dir, now: () => january })
  assert.equal(tel.writeDecision({ session: 's1', step: 1 }), true)
  assert.equal(tel.writeDecision({ ts: Date.UTC(2026, 11, 31, 23, 59), session: 's2', step: 2 }), true)
  await tel.flush()
  assert.deepEqual(telemetryFiles(dir), ['decisions-2026-01.jsonl', 'decisions-2026-12.jsonl'])
  const jan = jsonLines(join(dir, 'decisions-2026-01.jsonl'))
  const dec = jsonLines(join(dir, 'decisions-2026-12.jsonl'))
  assert.equal(jan.length, 1)
  assert.equal(jan[0].ts, undefined, 'writeDecision does not invent a timestamp')
  assert.equal(jan[0].v, 1)
  assert.equal(dec[0].ts, '2026-12-31T23:59:00.000Z')
})

test('a batch that crosses maxBytes rotates the current file and starts a new one', async (t) => {
  const dir = tempDir(t)
  const base = Date.UTC(2026, 4, 10, 12)
  const tel = createTelemetry({ dir, maxBytes: 120, now: () => base })
  for (let step = 0; step < 4; step += 1) {
    assert.equal(tel.writeDecision({ ts: base + step, step }), true)
    await tel.flush()
  }
  assert.deepEqual(telemetryFiles(dir), ['decisions-2026-05-1.jsonl', 'decisions-2026-05.jsonl'])
  const rotated = jsonLines(join(dir, 'decisions-2026-05-1.jsonl'))
  const current = jsonLines(join(dir, 'decisions-2026-05.jsonl'))
  assert.deepEqual(rotated.map((event) => event.step), [0, 1, 2])
  assert.deepEqual(current.map((event) => event.step), [3])
  assert.deepEqual(tel.health().files, ['decisions-2026-05-1.jsonl', 'decisions-2026-05.jsonl'])
  assert.deepEqual((await tel.readDecisions()).map((event) => event.step), [0, 1, 2, 3])
})

test('the first write failure is reported once, disables the store and never throws', async (t) => {
  const dir = join(tempDir(t), 'telemetry')
  writeFileSync(dir, 'blocker') // a file where the directory should be
  const errors = []
  const tel = createTelemetry({ dir, now: () => NOV, onError: (error) => errors.push(error) })
  assert.equal(tel.writeDecision({ step: 1 }), true, 'accepted for flush')
  await tel.flush()
  assert.equal(errors.length, 1)
  const status = tel.health()
  assert.equal(status.enabled, false)
  assert.equal(status.lastError.at, NOV)
  assert.equal(typeof status.lastError.code, 'string')
  assert.equal(status.lastError.message.length > 0, true)
  assert.equal(tel.writeDecision({ step: 2 }), false, 'further writes are refused')
  await tel.flush()
  assert.equal(errors.length, 1, 'onError is called at most once')
  assert.deepEqual(await tel.readDecisions(), [])
})

test('a throwing onError never escapes writeDecision or flush', async (t) => {
  const dir = join(tempDir(t), 'telemetry')
  writeFileSync(dir, 'blocker')
  const tel = createTelemetry({
    dir,
    now: () => NOV,
    onError: () => {
      throw new Error('onError boom')
    },
  })
  assert.equal(tel.writeDecision({ step: 1 }), true)
  await tel.flush()
  assert.equal(tel.health().enabled, false)
  assert.equal(tel.health().lastError.message.length > 0, true)
})

test('readDecisions filters the window, skips corrupt lines and returns chronological events', async (t) => {
  const dir = tempDir(t)
  const t1 = Date.UTC(2026, 5, 1, 0, 0, 0)
  const t2 = t1 + 60 * 1000
  const t3 = t2 + 60 * 1000
  const tel = createTelemetry({ dir, now: () => t3 })
  // Written out of chronological order on purpose: the reader sorts by ts.
  assert.equal(tel.writeDecision({ ts: t3, step: 3 }), true)
  assert.equal(tel.writeDecision({ ts: t1, step: 1 }), true)
  assert.equal(tel.writeDecision({ ts: t2, step: 2 }), true)
  await tel.flush()
  appendFileSync(join(dir, 'decisions-2026-06.jsonl'), '{ this is not json\n')

  assert.deepEqual((await tel.readDecisions()).map((event) => event.step), [1, 2, 3])
  assert.deepEqual((await tel.readDecisions({ since: t2, until: t3 })).map((event) => event.step), [2], 'since is inclusive, until exclusive')
  assert.deepEqual((await tel.readDecisions({ since: t2 })).map((event) => event.step), [2, 3])
  assert.deepEqual((await tel.readDecisions({ until: t2 })).map((event) => event.step), [1])
  assert.equal(tel.health().files.includes('decisions-2026-06.jsonl'), true)

  const ordered = createTelemetry({ dir: tempDir(t), now: () => t3 })
  assert.equal(ordered.writeDecision({ ts: t1, step: 1 }), true)
  assert.equal(ordered.writeDecision({ ts: t2, step: 2 }), true)
  assert.equal(ordered.writeDecision({ ts: t3, step: 3 }), true)
  await ordered.flush()
  assert.deepEqual((await ordered.readDecisions({ limit: 2 })).map((event) => event.step), [1, 2], 'limit caps the scan at the oldest matched events')

  const missing = createTelemetry({ dir: join(tempDir(t), 'missing') })
  assert.deepEqual(await missing.readDecisions(), [])
})

test('summarize returns the fixed shape with class/model/effort aggregates', async (t) => {
  const dir = tempDir(t)
  const t1 = Date.UTC(2026, 10, 3, 9, 0, 0)
  const t2 = t1 + 60 * 1000
  const t3 = t2 + 60 * 1000
  const nowMs = t3 + 1000
  const tel = createTelemetry({ dir, now: () => nowMs })
  const events = [
    {
      ts: t1,
      stepClass: 'engineering',
      score: 60,
      manualOverride: false,
      reason: 'engineering cues (2), pool score 81',
      chosen: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'high', tier: 'cheap' },
      usage: { costUnits: 0.008 },
    },
    {
      ts: t2,
      stepClass: 'engineering',
      score: 70,
      manualOverride: true,
      reason: 'escalated on evidence: strong pool',
      chosen: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'high', tier: 'strong' },
      usage: { costUnits: 0.012 },
    },
    {
      ts: t3,
      stepClass: 'standard',
      score: 80,
      manualOverride: false,
      reason: 'standard preset',
      chosen: { provider: 'openrouter', model: 'qwen3', effort: 'low', tier: 'cheap' },
      usage: { costUnits: 0.02 },
    },
  ]
  for (const event of events) assert.equal(tel.writeDecision(event), true)
  await tel.flush()

  const summary = await tel.summarize()
  assert.deepEqual(Object.keys(summary).sort(), ['byClass', 'byEffort', 'byModel', 'shadow', 'totals', 'window'])
  // v0.16.0: no event carries a shadow here, so the block is present and zero.
  assert.deepEqual(summary.shadow, {
    steps: 0, agreeSteps: 0, divergedSteps: 0, agreementRate: 0, pricedSteps: 0,
    currentUsd: 0, candidateUsd: 0, savedUsd: 0, savedRatio: 0,
  })
  assert.deepEqual(Object.keys(summary.window).sort(), ['since', 'steps', 'until'])
  assert.deepEqual(summary.window, { since: nowMs - WEEK_MS, until: nowMs, steps: 3 })
  // Prompt-free events written before 0.15.1 carry no split and no USD cost:
  // they contribute zero tokens and count as unpriced rather than free.
  assert.deepEqual(summary.byClass, [
    { key: 'engineering', steps: 2, avgScore: 65, strongSteps: 1, costUnits: 0.02, tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: 0, pricedSteps: 0, unpricedSteps: 2 },
    { key: 'standard', steps: 1, avgScore: 80, strongSteps: 0, costUnits: 0.02, tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: 0, pricedSteps: 0, unpricedSteps: 1 },
  ])
  assert.deepEqual(summary.byModel, [
    { key: 'deepseek-official/deepseek-flash', steps: 2, avgScore: 65, strongSteps: 1, costUnits: 0.02, tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: 0, pricedSteps: 0, unpricedSteps: 2 },
    { key: 'openrouter/qwen3', steps: 1, avgScore: 80, strongSteps: 0, costUnits: 0.02, tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: 0, pricedSteps: 0, unpricedSteps: 1 },
  ])
  assert.deepEqual(summary.byEffort, [
    { key: 'high', steps: 2, avgScore: 65, strongSteps: 1, costUnits: 0.02, tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: 0, pricedSteps: 0, unpricedSteps: 2 },
    { key: 'low', steps: 1, avgScore: 80, strongSteps: 0, costUnits: 0.02, tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: 0, pricedSteps: 0, unpricedSteps: 1 },
  ])
  assert.deepEqual(Object.keys(summary.totals).sort(), [
    'cacheReadTokens', 'cacheWriteTokens', 'costUnits', 'costUsd', 'failedEscalations', 'failoverSteps', 'inputTokens',
    'outputTokens', 'overrideRate', 'peakCostUsd', 'peakShare', 'peakSteps', 'pricedSteps', 'reasoningTokens',
    'strongSteps', 'tokens', 'unpricedSteps',
  ])
  assert.equal(summary.totals.costUnits, 0.04)
  assert.equal(summary.totals.strongSteps, 1)
  assert.equal(summary.totals.overrideRate, 1 / 3)
  assert.equal(summary.totals.failedEscalations, 1)

  const filtered = await tel.summarize({ since: t2 })
  assert.deepEqual(filtered.window, { since: t2, until: nowMs, steps: 2 })
  assert.equal(filtered.totals.costUnits, 0.032)
  assert.equal(filtered.totals.strongSteps, 1)
  assert.equal(filtered.totals.overrideRate, 0.5)
})

test('summarize sums the token split and USD cost, and counts unpriced steps', async (t) => {
  const dir = tempDir(t)
  const nowMs = Date.UTC(2026, 10, 3, 9)
  const tel = createTelemetry({ dir, now: () => nowMs })
  const events = [
    {
      ts: nowMs - 4000,
      stepClass: 'engineering',
      score: 60,
      chosen: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'high', tier: 'cheap' },
      usage: {
        tokens: 1300,
        costUnits: 0.01,
        split: { input: 1000, output: 200, cacheRead: 100, cacheWrite: 0, reasoning: 0 },
        costUsd: 0.000123,
        price: { currency: 'USD', input: 0.26, output: 1.04, cacheRead: 0.026, cacheWrite: 0.26, peak: null, source: 'catalog', effectiveFrom: '2026-10-01' },
      },
    },
    {
      ts: nowMs - 3000,
      stepClass: 'standard',
      score: 80,
      chosen: { provider: 'google-official', model: 'gemini-3.8-flash', effort: 'high', tier: 'cheap' },
      usage: {
        tokens: 830,
        costUnits: 0.02,
        split: { input: 500, output: 250, cacheRead: 0, cacheWrite: 50, reasoning: 30 },
        costUsd: 0.000456,
      },
    },
    {
      ts: nowMs - 2000,
      stepClass: 'engineering',
      score: 55,
      chosen: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'high', tier: 'cheap' },
      usage: { tokens: 900, costUnits: 0.02 },
    },
    {
      ts: nowMs - 1000,
      stepClass: 'standard',
      score: 70,
      chosen: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'high', tier: 'cheap' },
      usage: { tokens: 40, costUnits: 0, split: { input: 40 }, costUsd: null },
    },
  ]
  for (const event of events) assert.equal(tel.writeDecision(event), true)
  await tel.flush()

  const summary = await tel.summarize()
  assert.deepEqual(summary.totals, {
    costUnits: 0.05,
    strongSteps: 0,
    overrideRate: 0,
    failedEscalations: 0,
    tokens: 2170,
    inputTokens: 1540,
    outputTokens: 450,
    cacheReadTokens: 100,
    cacheWriteTokens: 50,
    reasoningTokens: 30,
    costUsd: 0.000579,
    pricedSteps: 2,
    unpricedSteps: 2,
    // v0.16.1: no event here ran at a peak rate or after a failover.
    peakSteps: 0,
    peakCostUsd: 0,
    peakShare: 0,
    failoverSteps: 0,
  })

  const byEffort = summary.byEffort.find((row) => row.key === 'high')
  assert.equal(byEffort.steps, 4)
  assert.equal(byEffort.tokens, 2170)
  assert.equal(byEffort.costUsd, 0.000579)
  assert.equal(byEffort.pricedSteps, 2)
  assert.equal(byEffort.unpricedSteps, 2)

  const flash = summary.byModel.find((row) => row.key === 'deepseek-official/deepseek-flash')
  assert.equal(flash.steps, 3)
  assert.equal(flash.tokens, 1340, 'a null costUsd keeps the tokens but counts the step as unpriced')
  assert.equal(flash.costUsd, 0.000123)
  assert.equal(flash.pricedSteps, 1)
  assert.equal(flash.unpricedSteps, 2)

  const gemini = summary.byModel.find((row) => row.key === 'google-official/gemini-3.8-flash')
  assert.deepEqual(
    { tokens: gemini.tokens, priced: gemini.pricedSteps, unpriced: gemini.unpricedSteps },
    { tokens: 830, priced: 1, unpriced: 0 },
  )
})

test('summarize counts peak-rate steps and channel failovers (v0.16.1)', async (t) => {
  const dir = tempDir(t)
  const nowMs = Date.UTC(2026, 10, 3, 9)
  const tel = createTelemetry({ dir, now: () => nowMs })
  const events = [
    {
      ts: nowMs - 3000,
      stepClass: 'engineering',
      score: 60,
      chosen: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'high', tier: 'cheap' },
      // Inside the provider's peak window, so the step paid the higher rate.
      peak: true,
      usage: { tokens: 100, costUnits: 0.01, split: { input: 100 }, costUsd: 0.0002 },
    },
    {
      ts: nowMs - 2000,
      stepClass: 'standard',
      score: 70,
      chosen: { provider: 'relay-b', model: 'deepseek-flash', effort: 'high', tier: 'cheap' },
      // Served after the router moved off the channel that had just failed.
      failoverFrom: 'deepseek-official',
      peak: true,
      usage: { tokens: 50, costUnits: 0.01, split: { input: 50 }, costUsd: 0.0001 },
    },
    {
      ts: nowMs - 1000,
      stepClass: 'standard',
      score: 80,
      chosen: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'high', tier: 'cheap' },
      peak: false,
      usage: { tokens: 25, costUnits: 0.01, split: { input: 25 }, costUsd: 0.00005 },
    },
  ]
  for (const event of events) assert.equal(tel.writeDecision(event), true)
  await tel.flush()

  const summary = await tel.summarize()
  assert.equal(summary.totals.peakSteps, 2)
  assert.equal(summary.totals.peakCostUsd, 0.0003)
  assert.equal(summary.totals.peakShare, 0.6667)
  assert.equal(summary.totals.failoverSteps, 1)
  // The pre-0.16.1 totals keep their meaning.
  assert.equal(summary.totals.costUsd, 0.00035)

  // Both numbers follow the window like every other total.
  const recent = (await tel.summarize({ since: nowMs - 2000 })).totals
  assert.equal(recent.peakSteps, 1, 'only the failover step of the window paid the peak rate')
  assert.equal(recent.peakCostUsd, 0.0001)
  assert.equal(recent.peakShare, 0.5)
  assert.equal(recent.failoverSteps, 1, 'the failover step is inside this window too')
})

test('summarize keeps the fixed shape with zero events and accepts no/empty/explicit windows', async (t) => {
  const dir = tempDir(t)
  const nowMs = Date.UTC(2026, 10, 3, 9)
  const tel = createTelemetry({ dir, now: () => nowMs })
  const empty = {
    window: { since: nowMs - WEEK_MS, until: nowMs, steps: 0 },
    byClass: [],
    byModel: [],
    byEffort: [],
    totals: {
      costUnits: 0,
      strongSteps: 0,
      overrideRate: 0,
      failedEscalations: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      pricedSteps: 0,
      unpricedSteps: 0,
      peakSteps: 0,
      peakCostUsd: 0,
      peakShare: 0,
      failoverSteps: 0,
    },
    shadow: {
      steps: 0,
      agreeSteps: 0,
      divergedSteps: 0,
      agreementRate: 0,
      pricedSteps: 0,
      currentUsd: 0,
      candidateUsd: 0,
      savedUsd: 0,
      savedRatio: 0,
    },
  }
  assert.deepEqual(await tel.summarize(), empty)
  assert.deepEqual(await tel.summarize({}), empty)
  assert.deepEqual(await tel.summarize({ since: 1000, until: 2000 }), {
    ...empty,
    window: { since: 1000, until: 2000, steps: 0 },
  })
})

test('the store adds only v and never rewrites the host event', async (t) => {
  const dir = tempDir(t)
  const tel = createTelemetry({ dir, now: () => NOV })
  const input = {
    ts: NOV,
    prompt: 'this is host text and is stored verbatim; the store never adds it',
    messages: [{ role: 'user', content: 'hello' }],
    absolutePath: 'C:\\secret\\file.txt',
    chosen: { provider: 'p', model: 'm' },
    usage: { tokens: 10, costUnits: 0.001 },
  }
  assert.equal(tel.writeDecision(input), true)
  await tel.flush()
  const parsed = JSON.parse(readFileSync(onlyFile(dir), 'utf8').trim())
  assert.deepEqual(Object.keys(parsed).sort(), ['absolutePath', 'chosen', 'messages', 'prompt', 'ts', 'usage', 'v'])
  assert.equal(parsed.prompt, input.prompt)
  assert.deepEqual(parsed.messages, input.messages)
  assert.equal(parsed.absolutePath, input.absolutePath)
  assert.equal(parsed.ts, new Date(NOV).toISOString())

  assert.equal(tel.writeDecision(null), false)
  assert.equal(tel.writeDecision([]), false)
  assert.equal(tel.writeDecision('not an event'), false)
  assert.equal(tel.writeDecision(new Date()), false)
})

test('enabled:false makes the store a read-only no-op', async (t) => {
  const dir = tempDir(t)
  const tel = createTelemetry({ dir, enabled: false, now: () => NOV })
  assert.equal(tel.enabled, false)
  assert.equal(tel.health().enabled, false)
  assert.equal(tel.writeDecision({ step: 1 }), false)
  await tel.flush()
  assert.deepEqual(readdirSync(dir), [])
  assert.deepEqual(await tel.readDecisions(), [])
  assert.equal((await tel.summarize({ since: 0, until: 1000 })).window.steps, 0)
})

test('readRecentSync tails the active file synchronously for replay', async (t) => {
  const dir = tempDir(t)
  const tel = createTelemetry({ dir, now: () => NOV })
  for (let step = 0; step < 5; step += 1) tel.writeDecision({ ts: NOV + step, step })
  await tel.flush()
  assert.deepEqual(tel.readRecentSync().map((event) => event.step), [0, 1, 2, 3, 4], 'newest last')
  assert.deepEqual(tel.readRecentSync(2).map((event) => event.step), [3, 4])
  assert.deepEqual(tel.readRecentSync(0), [])

  // A file whose head is beyond the 256 KiB tail keeps only complete, parseable lines.
  const huge = tempDir(t)
  const filler = 'x'.repeat(300 * 1024)
  const tailLines = [1, 2, 3].map((step) => JSON.stringify({ v: 1, ts: new Date(NOV + step).toISOString(), step }))
  writeFileSync(join(huge, 'decisions-2026-11.jsonl'), filler + '\n' + tailLines.join('\n') + '\n{ broken tail\n')
  const tailTel = createTelemetry({ dir: huge, now: () => NOV })
  assert.deepEqual(tailTel.readRecentSync().map((event) => event.step), [1, 2, 3])
  assert.deepEqual(tailTel.readRecentSync(2).map((event) => event.step), [2, 3])

  // Missing / unusable directories never throw.
  assert.deepEqual(createTelemetry({ dir: join(tempDir(t), 'missing') }).readRecentSync(), [])
  const blocked = join(tempDir(t), 'blocked')
  writeFileSync(blocked, 'not a directory')
  assert.deepEqual(createTelemetry({ dir: blocked }).readRecentSync(), [])
})

test('summarize aggregates the cost-aware shadow and skips malformed ones', async (t) => {
  const dir = tempDir(t)
  const nowMs = Date.UTC(2026, 10, 3, 9)
  const tel = createTelemetry({ dir, now: () => nowMs })
  const base = (over) => ({
    ts: nowMs - 2000,
    stepClass: 'standard',
    score: 70,
    chosen: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high', tier: 'cheap' },
    usage: { costUnits: 0.01 },
    ...over,
  })
  const events = [
    base({ shadow: { candidate: 'deepseek-official/deepseek-flash', current: 'deepseek-official/deepseek-v4-pro', agree: false, currentStepUsd: 0.004, candidateStepUsd: 0.001 } }),
    base({ shadow: { candidate: 'deepseek-official/deepseek-flash', current: 'deepseek-official/deepseek-flash', agree: true, currentStepUsd: 0.001, candidateStepUsd: 0.001 } }),
    // A shadow without a priced pair still counts as a step, but not as money.
    base({ shadow: { agree: false, currentStepUsd: null, candidateStepUsd: 0.0005 } }),
    base({ shadow: 'diverged' }),
    base({}),
  ]
  for (const event of events) assert.equal(tel.writeDecision(event), true)
  await tel.flush()

  const summary = await tel.summarize()
  assert.deepEqual(summary.shadow, {
    steps: 3,
    agreeSteps: 1,
    divergedSteps: 2,
    agreementRate: 0.3333,
    pricedSteps: 2,
    currentUsd: 0.005,
    candidateUsd: 0.002,
    savedUsd: 0.003,
    savedRatio: 0.6,
  })
})
