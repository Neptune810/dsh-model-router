import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const FIXTURE = 'test/fixtures/replay-decisions.jsonl'

function run(args) {
  const result = spawnSync('node', ['lib/replay.js', ...args], { encoding: 'utf8' })
  return { code: result.status, out: result.stdout || '', err: result.stderr || '' }
}

function withConfig(config, body) {
  const dir = mkdtempSync(join(tmpdir(), 'mr-replay-'))
  try {
    const path = join(dir, 'router.json')
    writeFileSync(path, JSON.stringify(config), 'utf8')
    return body(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('replaying the same pool keeps every recorded route', () => {
  const result = run(['--file', FIXTURE])
  assert.equal(result.code, 0, result.err)
  assert.match(result.out, /steps\s+6/)
  assert.match(result.out, /replay: 6 steps, 2 model changes, 0 effort changes, 4 unchanged/)
  assert.match(result.out, /config\s+derived from traffic/)
  assert.match(result.out, /stepClass|standard/)
})

test('a step that today would pick another model is reported, and --fail-on-change exits 1', () => {
  const result = run(['--file', FIXTURE, '--fail-on-change'])
  assert.equal(result.code, 1)
  assert.match(result.out, /model deepseek-official\/deepseek-v4-pro -> deepseek-official\/deepseek-flash/)
  const quiet = run(['--file', FIXTURE, '--quiet'])
  assert.equal(quiet.out.trim(), 'replay: 6 steps, 2 model changes, 0 effort changes, 4 unchanged')
})

test('a config with a different ladder exposes alias collapses', () => {
  const config = {
    pool: [
      { id: 'deepseek-official/deepseek-flash', tier: 'cheap', cost: 1 },
      { id: 'deepseek-official/deepseek-v4-pro', tier: 'strong', cost: 3 },
    ],
    routes: { standard: { effort: 'medium' }, engineering: { effort: 'medium' } },
  }
  withConfig(config, (path) => {
    const result = run(['--file', FIXTURE, '--config', path, '--json'])
    assert.equal(result.code, 0, result.err)
    const report = JSON.parse(result.out)
    assert.equal(report.poolMode, 'config')
    assert.equal(report.summary.why.alias, 5, 'medium is an alias of high on both DeepSeek models')
    assert.equal(report.summary.why.exact, 1, 'the hard step asked for max and got max')
    assert.equal(report.summary.effortChanged, 3)
    const pairs = report.summary.pairs
    assert.equal(pairs['medium->high'], 5)
    const text = run(['--file', FIXTURE, '--config', path])
    assert.match(text.out, /ladder collapses:/)
    assert.match(text.out, /medium->high x5/)
  })
})

test('--since and --until narrow the window', () => {
  const result = run(['--file', FIXTURE, '--since', '2026-10-25T03:30:00Z', '--json'])
  const report = JSON.parse(result.out)
  assert.equal(report.summary.steps, 3)
  assert.equal(report.stats.outsideWindow, 3)
  const until = JSON.parse(run(['--file', FIXTURE, '--until', '2026-10-25T02:00:00Z', '--json']).out)
  assert.equal(until.summary.steps, 2)
})

test('a missing directory and a bad flag both exit 2 with a message', () => {
  const missing = run(['--dir', join(tmpdir(), 'mr-replay-does-not-exist')])
  assert.equal(missing.code, 2)
  assert.match(missing.err, /no decisions\*\.jsonl found/)
  const bad = run(['--nonsense'])
  assert.equal(bad.code, 2)
  assert.match(bad.err, /unknown argument/)
})

test('signal recovery is recorded, counted, and malformed fields fall back to defaults', () => {
  const config = {
    pool: [
      { id: 'deepseek-official/deepseek-flash', tier: 'cheap', cost: 1 },
      { id: 'deepseek-official/deepseek-v4-pro', tier: 'strong', cost: 3 },
      { id: 'moonshot-official/kimi-k3.1-pro', tier: 'cheap', cost: 2, tags: ['vision'] },
      { id: 'google-official/gemini-4-argon', tier: 'strong', cost: 4, tags: ['vision'] },
    ],
  }
  withConfig(config, (path) => {
    const decisions = [
      { ts: 1793001300000, stepClass: 'standard', chosen: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'low', tier: 'cheap', cost: 1 } },
      { ts: 1793001360000, stepClass: 'standard', chosen: { provider: 'moonshot-official', model: 'kimi-k3.1-pro', effort: 'low', tier: 'cheap', cost: 2 }, signals: { hasImage: true } },
      { ts: 1793001420000, stepClass: 'standard', chosen: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'low', tier: 'strong', cost: 3 }, signals: { escalations: 2 } },
      { ts: 1793001480000, stepClass: 'standard', chosen: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'low', tier: 'strong', cost: 3 }, signals: { channelBlocked: ['deepseek-official/deepseek-flash', 'moonshot-official/kimi-k3.1-pro'] } },
      { ts: 1793001540000, stepClass: 'standard', chosen: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'low', tier: 'cheap', cost: 1 }, signals: { hasImage: 'yes', escalations: -1, preferCheap: 1, channelBlocked: 'x' } },
      { ts: 1793001600000, stepClass: 'standard', chosen: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'low', tier: 'cheap', cost: 1 }, signals: { preferCheap: true } },
    ]
    const decisionsPath = join(dirname(path), 'decisions.jsonl')
    writeFileSync(decisionsPath, decisions.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
    const result = run(['--file', decisionsPath, '--config', path, '--json'])
    assert.equal(result.code, 0, result.err)
    const report = JSON.parse(result.out)
    assert.deepEqual(report.rows[0].signals, { hasImage: false, escalations: 0, preferCheap: false, channelBlocked: 0 }, 'a step without signals replays with the old defaults')
    assert.deepEqual(report.rows[1].signals, { hasImage: true, escalations: 0, preferCheap: false, channelBlocked: 0 })
    assert.equal(report.rows[1].nowId, 'moonshot-official/kimi-k3.1-pro', 'an image step skips the untagged entry')
    assert.equal(report.rows[2].signals.escalations, 2)
    assert.equal(report.rows[2].nowId, 'deepseek-official/deepseek-v4-pro', 'escalation evidence lifts the strong entry')
    assert.equal(report.rows[3].signals.channelBlocked, 2)
    assert.equal(report.rows[3].nowId, 'deepseek-official/deepseek-v4-pro', 'a cooling channel sinks behind its healthy sibling')
    assert.deepEqual(report.rows[4].signals, { hasImage: false, escalations: 0, preferCheap: false, channelBlocked: 0 }, 'malformed signal fields fall back to the old defaults')
    assert.equal(report.rows[5].signals.preferCheap, true)
    assert.deepEqual(report.summary.bySignal, { vision: 1, escalation: 1, preferCheap: 1, channelBlocked: 1 })
  })
})
