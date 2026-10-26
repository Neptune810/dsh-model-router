import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOG } from '../lib/catalog.js'
import { diffCatalog, parseOpenRouterPayload, renderMarkdown } from '../scripts/catalog-diff.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE = join(ROOT, 'test', 'fixtures', 'openrouter-sample.json')
const NOW = '2026-10-26'
const SECTION_HEADERS = [
  '## Summary',
  '## Price changes',
  '## Context changes',
  '## Missing upstream',
  '## New upstream models',
  '## Calendar due',
  '## Source health',
]

function catalogModel (overrides) {
  return {
    id: 'test-model',
    provider: 'openai',
    contextWindow: 1000,
    channels: {
      openrouterId: 'openai/test-model',
      openrouterPriceUsd: { input: 10, output: 10, cacheRead: 10, cacheWrite: 10 },
    },
    ...overrides,
  }
}

function miniCatalog (models, extra) {
  return { models, calendar: [], ...extra }
}

function readFixture () {
  return JSON.parse(readFileSync(FIXTURE, 'utf8'))
}

test('parseOpenRouterPayload converts per-token USD into per-million USD', () => {
  const parsed = parseOpenRouterPayload({
    data: [{
      id: 'openai/example',
      context_length: 200000,
      pricing: {
        prompt: '0.000002',
        completion: '0.00001',
        input_cache_read: '0.0000001',
        input_cache_write: '0.00000025',
      },
    }],
  })
  assert.deepEqual(parsed, [{
    id: 'openai/example',
    contextLength: 200000,
    pricing: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0.25 },
  }])
})

test('parseOpenRouterPayload peaks time-window overrides and ignores long-context tiers', () => {
  const parsed = parseOpenRouterPayload([{
    id: 'deepseek/example',
    context_length: 1048576,
    pricing: {
      prompt: '0.00000015',
      completion: '0.0000006',
      input_cache_read: '0.000000003',
      overrides: [
        {
          utc_days: ['monday', 'tuesday'],
          utc_start: 100,
          utc_end: 400,
          prompt: '0.0000003',
          completion: '0.0000012',
          input_cache_read: '0.000000006',
        },
        {
          min_prompt_tokens: 100000,
          prompt: '0.0000006',
          completion: '0.0000024',
        },
      ],
    },
  }])
  assert.deepEqual(parsed[0].pricing, { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: null })
})

test('parseOpenRouterPayload treats missing fields as null and rejects invalid payloads', () => {
  const parsed = parseOpenRouterPayload({
    data: [
      { id: 'a/no-pricing', context_length: 1000, pricing: {} },
      { id: 'a/no-context', pricing: { prompt: '0.000001' } },
    ],
  })
  assert.deepEqual(parsed, [
    { id: 'a/no-pricing', contextLength: 1000, pricing: { input: null, output: null, cacheRead: null, cacheWrite: null } },
    { id: 'a/no-context', contextLength: null, pricing: { input: 1, output: null, cacheRead: null, cacheWrite: null } },
  ])
  assert.throws(() => parseOpenRouterPayload({ models: [] }), /invalid OpenRouter payload/)
  assert.throws(() => parseOpenRouterPayload(null), /invalid OpenRouter payload/)
})

test('diffCatalog reports no drift when the snapshot matches the catalog', () => {
  const model = structuredClone(CATALOG.models.find((entry) => entry.id === 'claude-sonnet-5-5'))
  const report = diffCatalog(miniCatalog([model]), [{
    id: 'anthropic/claude-sonnet-5.5',
    contextLength: model.contextWindow,
    pricing: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  }], { now: NOW })
  assert.equal(report.drift, false)
  assert.equal(report.summary.drift, false)
  assert.deepEqual(report.priceChanges, [])
  assert.deepEqual(report.contextChanges, [])
  assert.deepEqual(report.missingUpstream, [])
  assert.deepEqual(report.newUpstream, [])
  assert.equal(report.source.status, 'ok')
  assert.equal(report.source.models, 1)
  assert.match(renderMarkdown(report), /No drift detected/)
})

test('diffCatalog flags price changes above the ten percent threshold', () => {
  const model = catalogModel({
    id: 'price-model',
    channels: {
      openrouterId: 'openai/price-model',
      openrouterPriceUsd: { input: 10, output: 10, cacheRead: 10 },
    },
  })
  const report = diffCatalog(miniCatalog([model]), [{
    id: 'openai/price-model',
    contextLength: 1000,
    pricing: { input: 12, output: 10.5, cacheRead: 10.5 },
  }], { now: NOW })
  assert.deepEqual(report.priceChanges, [{
    model: 'price-model',
    openrouterId: 'openai/price-model',
    field: 'input',
    old: 10,
    new: 12,
    percent: 20,
  }])
  assert.equal(report.drift, true)
})

test('diffCatalog ignores changes at or below ten percent because the boundary is exclusive', () => {
  const model = catalogModel()
  const report = diffCatalog(miniCatalog([model]), [{
    id: 'openai/test-model',
    contextLength: 1000,
    pricing: { input: 11, output: 9.5, cacheRead: 10, cacheWrite: 10 },
  }], { now: NOW })
  assert.deepEqual(report.priceChanges, [])
  assert.equal(report.drift, false)
})

test('diffCatalog reports context window changes', () => {
  const model = catalogModel()
  const report = diffCatalog(miniCatalog([model]), [{
    id: 'openai/test-model',
    contextLength: 2000,
    pricing: { input: 10, output: 10, cacheRead: 10, cacheWrite: 10 },
  }], { now: NOW })
  assert.deepEqual(report.contextChanges, [{
    model: 'test-model',
    openrouterId: 'openai/test-model',
    old: 1000,
    new: 2000,
  }])
  assert.equal(report.drift, true)
})

test('diffCatalog reports catalog models missing upstream only when they have an OpenRouter id', () => {
  const catalog = miniCatalog([
    catalogModel({
      id: 'retiring',
      channels: { openrouterId: 'openai/retiring', openrouterPriceUsd: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 } },
    }),
    catalogModel({ id: 'direct-only', channels: { openrouterId: null, openrouterPriceUsd: null } }),
  ])
  const report = diffCatalog(catalog, [], { now: NOW })
  assert.deepEqual(report.missingUpstream, [{ model: 'retiring', openrouterId: 'openai/retiring' }])
  assert.equal(report.drift, true)
})

test('diffCatalog reports new upstream models only for providers tracked in the catalog', () => {
  const model = catalogModel({
    id: 'gpt-6-astra',
    contextWindow: 1050000,
    channels: {
      openrouterId: 'openai/gpt-6-astra',
      openrouterPriceUsd: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    },
  })
  const upstream = [
    { id: 'openai/gpt-6-astra', contextLength: 1050000, pricing: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 } },
    { id: 'openai/gpt-6.2-astra', contextLength: 1050000, pricing: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 } },
    { id: 'vendor/new-model', contextLength: 131072, pricing: { input: 0.2, output: 0.8, cacheRead: null, cacheWrite: null } },
    { id: 'google/gemini-9', contextLength: 1000, pricing: { input: 1, output: 2, cacheRead: null, cacheWrite: null } },
  ]
  const report = diffCatalog(miniCatalog([model]), upstream, { now: NOW })
  assert.deepEqual(report.newUpstream, [{
    id: 'openai/gpt-6.2-astra',
    provider: 'openai',
    contextLength: 1050000,
    pricing: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  }])
})

test('diffCatalog lists calendar entries within the window and tolerates a missing watchlist', () => {
  const catalog = miniCatalog([], {
    calendar: [
      { date: '2026-10-23', type: 'release', description: 'Past release', models: ['a'] },
      { date: '2026-11-01', type: 'billing_start', description: 'Future billing', models: ['b'] },
      { date: '2026-12-01', type: 'price_increase', description: 'Inside window', models: ['c'] },
      { date: '2027-01-01', type: 'price_increase', description: 'Outside window', models: ['d'] },
      { date: 'not-a-date', type: 'release', description: 'Invalid date', models: [] },
    ],
  })
  const report = diffCatalog(catalog, [], { now: NOW, days: 45 })
  assert.deepEqual(report.calendar.map((entry) => entry.date), ['2026-10-23', '2026-11-01', '2026-12-01'])
  assert.deepEqual(report.calendar.map((entry) => entry.daysLeft), [-3, 6, 36])
  assert.equal(report.calendar[0].origin, 'calendar')
  assert.equal(report.summary.calendar, 3)
  assert.equal(report.drift, false)
})

test('diffCatalog includes watchlist entries in the calendar section', () => {
  const catalog = miniCatalog([], {
    watchlist: [{ date: '2026-10-28', description: 'Watchlist review', models: ['watch-model'] }],
  })
  const report = diffCatalog(catalog, [], { now: NOW })
  assert.deepEqual(report.calendar.map((entry) => [entry.date, entry.origin, entry.type]), [
    ['2026-10-28', 'watchlist', 'watchlist'],
  ])
})

test('renderMarkdown contains every section header and no absolute paths', () => {
  const report = diffCatalog(CATALOG, readFixture(), { now: NOW, mode: 'offline' })
  const markdown = renderMarkdown(report)
  for (const header of SECTION_HEADERS) {
    assert.ok(markdown.includes(header), 'missing header: ' + header)
  }
  assert.ok(!markdown.includes(ROOT), 'markdown must not contain absolute paths')
  assert.ok(markdown.includes('offline snapshot'))
  assert.ok(markdown.includes('gpt-6-astra'))
})

test('fixture snapshot exercises price, context, missing, new and calendar drift', () => {
  const report = diffCatalog(CATALOG, readFixture(), { now: NOW, mode: 'offline' })
  assert.equal(report.drift, true)
  assert.deepEqual(report.priceChanges.map((change) => [change.model, change.field, change.percent]), [
    ['gpt-6-astra', 'input', 20],
  ])
  assert.deepEqual(report.contextChanges.map((change) => [change.model, change.old, change.new]), [
    ['deepseek-flash', 1000000, 1048576],
  ])
  assert.ok(report.missingUpstream.some((missing) => missing.model === 'claude-opus-5-5'))
  assert.deepEqual(report.newUpstream.map((model) => model.id), ['openai/gpt-6.2-astra'])
  assert.deepEqual(report.calendar.map((entry) => entry.date), ['2026-10-23', '2026-11-01', '2026-12-01'])
})

test('CLI offline run writes the markdown report and honours exit codes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-diff-'))
  try {
    const out = join(dir, 'catalog-pending.diff.md')
    const baseArgs = ['scripts/catalog-diff.mjs', '--offline', 'test/fixtures/openrouter-sample.json', '--now', NOW, '--out', out]
    const ok = spawnSync(process.execPath, baseArgs, { cwd: ROOT, encoding: 'utf8' })
    assert.equal(ok.status, 0)
    assert.match(ok.stdout, /drift detected/)
    const markdown = readFileSync(out, 'utf8')
    assert.ok(markdown.includes('## Summary'))
    assert.ok(markdown.includes('## Price changes'))
    assert.ok(markdown.includes('gpt-6-astra'))
    assert.ok(!markdown.includes(ROOT))
    const failing = spawnSync(process.execPath, baseArgs.concat('--fail-on-drift'), { cwd: ROOT, encoding: 'utf8' })
    assert.equal(failing.status, 1)
    const asJson = spawnSync(process.execPath, baseArgs.concat('--json', '--quiet'), { cwd: ROOT, encoding: 'utf8' })
    assert.equal(asJson.status, 0)
    const parsed = JSON.parse(asJson.stdout)
    assert.equal(parsed.drift, true)
    assert.equal(parsed.summary.price, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI fails with exit code 2 on bad arguments and unreadable snapshots', () => {
  const badFlag = spawnSync(process.execPath, ['scripts/catalog-diff.mjs', '--bogus'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(badFlag.status, 2)
  const badSnapshot = spawnSync(process.execPath, ['scripts/catalog-diff.mjs', '--offline', 'test/fixtures/does-not-exist.json'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(badSnapshot.status, 2)
  const badDate = spawnSync(process.execPath, ['scripts/catalog-diff.mjs', '--offline', 'test/fixtures/openrouter-sample.json', '--now', '2026-13-01'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(badDate.status, 2)
})
