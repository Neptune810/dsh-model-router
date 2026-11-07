import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const FIXTURE = 'test/fixtures/replay-l1.json'
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const BASE = fixture.cases.filter((row) => !('signals' in row))
const signalCases = fixture.cases.filter((row) => row.signals && typeof row.signals === 'object')
const poolCases = (name) => fixture.cases.filter((row) => row.pool === name)

function replayPool(name, cases) {
  const dir = mkdtempSync(join(tmpdir(), 'mr-l1-'))
  try {
    const configPath = join(dir, 'router.json')
    writeFileSync(configPath, JSON.stringify(fixture.pools[name]), 'utf8')
    const decisionsPath = join(dir, 'decisions.jsonl')
    writeFileSync(decisionsPath, cases.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
    const result = spawnSync('node', ['lib/replay.js', '--file', decisionsPath, '--config', configPath, '--json', '--fail-on-change'], { encoding: 'utf8' })
    let report = null
    try {
      report = JSON.parse(result.stdout)
    } catch {}
    return { code: result.status, report, out: result.stdout || '', err: result.stderr || '' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the level-1 label set covers six pools and all four step classes', () => {
  assert.equal(fixture.cases.length, 60)
  assert.deepEqual(Object.keys(fixture.pools).sort(), ['deepseek-only', 'mixed-official', 'price-first', 'relay-plus-official', 'strong-only', 'vision-mixed'])
  for (const name of Object.keys(fixture.pools)) {
    const mine = poolCases(name)
    assert.deepEqual([...new Set(mine.map((row) => row.stepClass))].sort(), ['engineering', 'hard', 'standard', 'trivial'], name + ' covers every step class')
    const ids = new Set(fixture.pools[name].pool.map((entry) => entry.id))
    for (const row of mine) assert.ok(ids.has(row.chosen.provider + '/' + row.chosen.model), name + ' expects a model from its own pool')
    assert.ok(fixture.pools[name].pool.length >= 1, name + ' is not empty')
    for (const entry of fixture.pools[name].pool) assert.ok(entry.tier === 'cheap' || entry.tier === 'strong', name + ' only uses the two tier words normalizePool keeps; anything else is silently coerced to cheap')
  }
  const visionPool = fixture.pools['vision-mixed'].pool
  assert.ok(visionPool.some((entry) => Array.isArray(entry.tags) && entry.tags.includes('vision')), 'vision-mixed holds a vision-tagged entry')
  assert.ok(visionPool.some((entry) => !Array.isArray(entry.tags) || !entry.tags.includes('vision')), 'vision-mixed also holds an untagged entry, so hasImage can really change the pick')
  const withoutStrong = Object.keys(fixture.pools).filter((name) => !fixture.pools[name].pool.some((entry) => entry.tier === 'strong'))
  assert.deepEqual(withoutStrong, ['price-first'], 'exactly one pool has no strong entry, so the set also proves a cheap-only pool still routes hard work')
})

test('replaying the labelled set reproduces every reviewed route', () => {
  for (const [name, pool] of Object.entries(fixture.pools)) {
    const cases = poolCases(name)
    const { code, report, err } = replayPool(name, cases)
    assert.equal(code, 0, name + ': a reviewed route moved\n' + err)
    assert.equal(report.summary.steps, cases.length, name + ' replays every case')
    assert.equal(report.rows.length, cases.length, name + ' reports every case')
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
  assert.equal(nearest.length, 3, 'three cases ask for an effort word their model does not list')
  for (const row of nearest) {
    assert.equal(row.stepClass, 'hard')
    assert.equal(row.chosen.effort, 'high', 'hard asks for max and the ladder stops at high')
  }
  const exact = fixture.cases.filter((row) => row.expect.why === 'exact')
  assert.equal(exact.length, 57)
})

test('the base set pins the two decisions a re-weighting would move first', () => {
  assert.equal(BASE.length, 20, 'the pre-signal cases stay byte-identical, so the default path is still proven')
  for (const row of BASE.filter((item) => item.stepClass === 'engineering')) {
    const trivial = BASE.find((other) => other.pool === row.pool && other.stepClass === 'trivial')
    assert.equal(row.expect.model, trivial.expect.model, 'engineering stays on the tier the pool uses for routine work: the engineering bonus is smaller than the cheap/strong base gap')
  }
  for (const row of BASE.filter((item) => item.pool === 'relay-plus-official')) assert.match(row.expect.model, /^deepseek-official\//, 'a relay entry tied on cost never outranks the official one')
})

test('image steps only ever route to vision-tagged entries, and the filter is load-bearing', () => {
  const vision = signalCases.filter((row) => row.signals.hasImage === true)
  assert.equal(vision.length, 16, 'sixteen vision cases')
  for (const row of vision) {
    const entry = fixture.pools[row.pool].pool.find((item) => item.id === row.expect.model)
    assert.ok(entry && Array.isArray(entry.tags) && entry.tags.includes('vision'), 'a vision step never lands on an untagged entry')
  }
  const standard = vision.find((row) => row.stepClass === 'standard')
  assert.ok(standard, 'one vision case is a standard step, where the filtered pick differs from the unfiltered one')
  const variant = { pool: standard.pool, ts: standard.ts, stepClass: standard.stepClass, chosen: standard.chosen }
  const { code, report, err } = replayPool(standard.pool, [variant])
  assert.equal(code, 1, 'dropping the image signal moves the pick, so the label set is load-bearing\n' + err)
  assert.equal(report.summary.modelChanged, 1)
  assert.equal(report.rows[0].nowId, 'deepseek-official/deepseek-flash', 'without hasImage the untagged cheap entry wins again')
  assert.notEqual(report.rows[0].nowId, standard.expect.model)
})

test('a cooling channel falls behind its sibling and an all-blocked pool still routes', () => {
  const blocked = signalCases.filter((row) => Array.isArray(row.signals.channelBlocked) && row.signals.channelBlocked.length > 0)
  assert.equal(blocked.length, 12, 'twelve channel-cooldown cases')
  const allBlocked = fixture.cases.filter((row) => Array.isArray(row.signals && row.signals.channelBlocked) && row.signals.channelBlocked.length === fixture.pools[row.pool].pool.length)
  assert.equal(allBlocked.length, 2, 'two cases block every channel in the pool')
  for (const row of blocked) {
    const ids = new Set(fixture.pools[row.pool].pool.map((entry) => entry.id))
    for (const id of row.signals.channelBlocked) assert.ok(ids.has(id), 'a cooling channel is always an entry of the same pool')
    if (row.signals.channelBlocked.length < fixture.pools[row.pool].pool.length) assert.ok(!row.signals.channelBlocked.includes(row.expect.model), 'the recorded route lands on a healthy channel, not the cooling one')
  }
  for (const row of allBlocked) {
    const cases = poolCases(row.pool)
    const index = cases.indexOf(row)
    const { code, report, err } = replayPool(row.pool, cases)
    assert.equal(code, 0, row.pool + ' still routes when every channel is cooling\n' + err)
    assert.equal(report.summary.unroutable, 0, 'a blocked channel is a sort penalty, never a drop')
    assert.equal(report.rows[index].nowId, row.expect.model)
  }
})

test('escalation evidence and the cheap preference are pinned by exact routes', () => {
  const escalated = signalCases.filter((row) => Number(row.signals.escalations) > 0)
  const cheap = signalCases.filter((row) => row.signals.preferCheap === true)
  assert.equal(escalated.length, 10, 'ten escalation cases')
  assert.equal(cheap.length, 2, 'two preferCheap cases')
  assert.equal(escalated.length + cheap.length, 12)
  assert.ok(escalated.some((row) => row.signals.escalations === 1), 'one escalation is exercised')
  assert.equal(escalated.filter((row) => row.signals.escalations === 3).length, 1, 'one case asks for three escalations to prove the evidence bonus stops at two')
  const capTwo = fixture.cases.find((row) => row.pool === 'deepseek-only' && row.stepClass === 'standard' && row.signals && row.signals.escalations === 2)
  const capThree = fixture.cases.find((row) => row.pool === 'deepseek-only' && row.stepClass === 'standard' && row.signals && row.signals.escalations === 3)
  assert.ok(capTwo && capThree, 'the two deepseek-only standard cases pin the cap directly')
  const cases = poolCases('deepseek-only')
  const { code, report, err } = replayPool('deepseek-only', cases)
  assert.equal(code, 0, err)
  assert.equal(report.rows[cases.indexOf(capTwo)].nowId, 'deepseek-official/deepseek-v4-pro')
  assert.equal(report.rows[cases.indexOf(capTwo)].nowId, report.rows[cases.indexOf(capThree)].nowId, 'the evidence bonus caps at two escalations')
  for (const row of cheap) assert.equal(row.pool, 'mixed-official')
})
