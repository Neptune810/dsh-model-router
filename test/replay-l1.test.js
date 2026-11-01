import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const FIXTURE = 'test/fixtures/replay-l1.json'
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'))

function replayPool(name, cases) {
  const dir = mkdtempSync(join(tmpdir(), 'mr-l1-'))
  try {
    const configPath = join(dir, 'router.json')
    writeFileSync(configPath, JSON.stringify(fixture.pools[name]), 'utf8')
    const decisionsPath = join(dir, 'decisions.jsonl')
    writeFileSync(decisionsPath, cases.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
    const result = spawnSync('node', ['lib/replay.js', '--file', decisionsPath, '--config', configPath, '--json', '--fail-on-change'], { encoding: 'utf8' })
    return { code: result.status, report: result.status === 0 ? JSON.parse(result.stdout) : null, err: result.stderr || '' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the level-1 label set covers five pools and all four step classes', () => {
  assert.equal(fixture.cases.length, 20)
  assert.deepEqual(Object.keys(fixture.pools).sort(), ['deepseek-only', 'mixed-official', 'price-first', 'relay-plus-official', 'strong-only'])
  for (const name of Object.keys(fixture.pools)) {
    const mine = fixture.cases.filter((row) => row.pool === name)
    assert.deepEqual(mine.map((row) => row.stepClass).sort(), ['engineering', 'hard', 'standard', 'trivial'], name + ' covers every step class once')
    const ids = new Set(fixture.pools[name].pool.map((entry) => entry.id))
    for (const row of mine) assert.ok(ids.has(row.chosen.provider + '/' + row.chosen.model), name + ' expects a model from its own pool')
    assert.ok(fixture.pools[name].pool.length >= 1, name + ' is not empty')
    for (const entry of fixture.pools[name].pool) assert.ok(entry.tier === 'cheap' || entry.tier === 'strong', name + ' only uses the two tier words normalizePool keeps; anything else is silently coerced to cheap')
  }
  const withoutStrong = Object.keys(fixture.pools).filter((name) => !fixture.pools[name].pool.some((entry) => entry.tier === 'strong'))
  assert.deepEqual(withoutStrong, ['price-first'], 'exactly one pool has no strong entry, so the set also proves a cheap-only pool still routes hard work')
})

test('replaying the labelled set reproduces every reviewed route', () => {
  for (const [name, pool] of Object.entries(fixture.pools)) {
    const cases = fixture.cases.filter((row) => row.pool === name)
    const { code, report, err } = replayPool(name, cases)
    assert.equal(code, 0, name + ': a reviewed route moved\n' + err)
    assert.equal(report.summary.steps, cases.length, name + ' replays every case')
    assert.equal(report.summary.modelChanged, 0, name + ' keeps every model')
    assert.equal(report.summary.effortChanged, 0, name + ' keeps every effort')
    assert.equal(report.summary.unroutable, 0, name + ' never leaves a step unrouted')
    assert.equal(pool.pool.length, new Set(pool.pool.map((entry) => entry.id)).size, name + ' has no duplicate entry')
    for (const [index, row] of report.rows.entries()) {
      const expected = cases[index].expect
      assert.equal(row.nowId, expected.model, name + ' ' + row.stepClass + ' model')
      assert.equal(row.nowEffort, expected.effort, name + ' ' + row.stepClass + ' effort')
    }
  }
})

test('the labels record why an effort word had to move, so a ladder change is visible', () => {
  const nearest = fixture.cases.filter((row) => row.expect.why === 'nearest')
  assert.equal(nearest.length, 2, 'two cases ask for an effort word their model does not list')
  for (const row of nearest) {
    assert.equal(row.stepClass, 'hard')
    assert.equal(row.chosen.effort, 'high', 'hard asks for max and the ladder stops at high')
  }
  const exact = fixture.cases.filter((row) => row.expect.why === 'exact')
  assert.equal(exact.length, 18)
})

test('the set pins the two decisions a re-weighting would move first', () => {
  const engineering = fixture.cases.filter((row) => row.stepClass === 'engineering')
  for (const row of engineering) {
    assert.equal(row.expect.model, fixture.cases.find((other) => other.pool === row.pool && other.stepClass === 'trivial').expect.model, 'engineering stays on the tier the pool uses for routine work: the engineering bonus is smaller than the cheap/strong base gap')
  }
  const relay = fixture.cases.filter((row) => row.pool === 'relay-plus-official')
  for (const row of relay) assert.match(row.expect.model, /^deepseek-official\//, 'a relay entry tied on cost never outranks the official one')
})
