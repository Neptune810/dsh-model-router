import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PRICE_LEVELS,
  priceKey,
  classifyModel,
  levelFromUsd,
  blendedUsd,
  parseOpenRouter,
  buildPriceIndex,
  lookupRemote,
  autoPricePool,
} from '../lib/pricing.js'

test('the levels are the three the panel exposes', () => {
  assert.deepEqual(PRICE_LEVELS, [1, 4, 8])
})

test('priceKey lowercases and collapses separators into dashes', () => {
  assert.equal(priceKey('Anthropic/Claude 3.5 Sonnet'), 'anthropic-claude-3-5-sonnet')
  assert.equal(priceKey('  gpt-4o  '), 'gpt-4o')
  assert.equal(priceKey(undefined), '')
})

test('the built-in rules classify the common families', () => {
  const cases = [
    [{ provider: 'deepseek-official', model: 'deepseek-flash' }, 1],
    [{ provider: 'deepseek-official', model: 'deepseek-chat' }, 1],
    [{ provider: 'deepseek-official', model: 'deepseek-coder' }, 1],
    [{ provider: 'deepseek-official', model: 'deepseek-reasoner' }, 4],
    [{ provider: 'deepseek-official', model: 'deepseek-v4-pro' }, 4],
    [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }, 1],
    [{ provider: 'openai', model: 'gpt-4o' }, 4],
    [{ provider: 'openai', model: 'gpt-4o-mini' }, 1],
    [{ provider: 'openai', model: 'gpt-3.5-turbo' }, 1],
    [{ provider: 'openai', model: 'o3-mini' }, 1],
    [{ provider: 'anthropic', model: 'claude-3-5-sonnet' }, 4],
    [{ provider: 'anthropic', model: 'claude-opus-4' }, 8],
    [{ provider: 'google', model: 'gemini-2.5-flash' }, 1],
    [{ provider: 'google', model: 'gemini-2.5-pro' }, 4],
    [{ provider: 'qwen', model: 'qwen-max' }, 8],
    [{ provider: 'meta', model: 'llama-3.1-405b' }, 8],
    [{ provider: 'zhipu', model: 'glm-4-flash' }, 1],
    [{ provider: 'mystery', model: 'model-xyz' }, 4],
  ]
  for (const [entry, level] of cases) {
    assert.equal(classifyModel(entry).level, level, entry.provider + '/' + entry.model)
  }
})

test('the provider name never leaks into the classification', () => {
  // "openrouter-pro" would otherwise turn every model of that provider mid-tier.
  assert.equal(classifyModel({ provider: 'openrouter-pro', model: 'mystery' }).level, 4)
  assert.equal(classifyModel({ provider: 'openrouter-mini', model: 'mystery' }).level, 4)
  assert.equal(classifyModel({}).level, 4)
})

test('levelFromUsd maps a blended per-million price onto a label', () => {
  assert.equal(levelFromUsd(0), 1)
  assert.equal(levelFromUsd(-1), 1)
  assert.equal(levelFromUsd(NaN), 1)
  assert.equal(levelFromUsd(0.5), 1)
  assert.equal(levelFromUsd(0.79), 1)
  assert.equal(levelFromUsd(0.8), 4)
  assert.equal(levelFromUsd(9.99), 4)
  assert.equal(levelFromUsd(10), 8)
  assert.equal(levelFromUsd(45), 8)
})

test('blendedUsd weights input heavier than output', () => {
  // 2 USD/M in, 6 USD/M out -> (2*0.75 + 6*0.25) = 3 USD/M
  assert.equal(blendedUsd(0.000002, 0.000006), 3)
  assert.equal(blendedUsd('0.000002', '0.000006'), 3)
  assert.equal(blendedUsd(0.000002), 2, 'a missing output price falls back to the input one')
})

test('parseOpenRouter keeps the reachable models and levels them', () => {
  const snapshot = parseOpenRouter({
    data: [
      { id: 'vendor-x/cheap-mini', name: 'Cheap Mini', pricing: { prompt: '0.0000001', completion: '0.0000002' } },
      { id: 'vendor-x/premium-xl', name: 'Premium XL', pricing: { prompt: '0.00002', completion: '0.00006' } },
      { id: '', name: 'broken' },
      { id: 'vendor-x/no-pricing' },
    ],
  }, 1234)
  assert.equal(snapshot.fetchedAt, 1234)
  assert.deepEqual(snapshot.models.map((model) => [model.id, model.level]), [
    ['vendor-x/cheap-mini', 1],
    ['vendor-x/premium-xl', 8],
    ['vendor-x/no-pricing', 1],
  ])
  assert.deepEqual(parseOpenRouter(null).models, [])
})

test('a stored snapshot is looked up by full id, short id and display name', () => {
  const index = buildPriceIndex(parseOpenRouter({
    data: [{ id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } }],
  }, 1))
  assert.equal(lookupRemote(index, { id: 'anthropic/claude-3.5-sonnet', provider: 'anthropic', model: 'claude-3.5-sonnet' }).level, 4)
  assert.equal(lookupRemote(index, { provider: 'anthropic', model: 'claude-3.5-sonnet' }).level, 4, 'short id matches')
  assert.equal(lookupRemote(index, { name: 'Claude 3.5 Sonnet' }).level, 4, 'display name matches')
  assert.equal(lookupRemote(index, { id: 'anthropic/claude35sonnet' }).level, 4, 'the compact form matches')
  assert.equal(lookupRemote(index, { id: 'nobody/unknown' }), null)
  assert.equal(lookupRemote(null, { id: 'anthropic/claude-3.5-sonnet' }), null)
})

test('autoPricePool fills unlabelled rows from the built-in rules', () => {
  const result = autoPricePool([
    { id: 'deepseek-official/deepseek-reasoner', provider: 'deepseek-official', model: 'deepseek-reasoner', cost: 1 },
    { id: 'vendor-x/gpt-4o-mini', provider: 'vendor-x', model: 'gpt-4o-mini', cost: 4, costSource: 'builtin' },
    { id: 'hand/kept', provider: 'hand', model: 'kept', cost: 8, costSource: 'manual' },
  ])
  assert.equal(result.source, 'builtin')
  assert.deepEqual(result.changed.map((row) => [row.id, row.to, row.source]), [
    ['deepseek-official/deepseek-reasoner', 4, 'builtin'],
    ['vendor-x/gpt-4o-mini', 1, 'builtin'],
  ])
  assert.deepEqual(result.skipped, [{ id: 'hand/kept', cost: 8 }])
  const byId = Object.fromEntries(result.pool.map((entry) => [entry.id, entry]))
  assert.equal(byId['deepseek-official/deepseek-reasoner'].cost, 4)
  assert.equal(byId['deepseek-official/deepseek-reasoner'].costSource, 'builtin')
  assert.equal(byId['hand/kept'].cost, 8, 'a manual cost is copied through untouched')
  assert.equal(byId['hand/kept'].costSource, 'manual')
})

test('a snapshot price wins over the built-in rules', () => {
  const remote = parseOpenRouter({
    data: [{ id: 'vendor-x/mystery-model', name: 'Mystery', pricing: { prompt: '0.00002', completion: '0.00006' } }],
  }, 7)
  const result = autoPricePool(
    [{ id: 'vendor-x/mystery-model', provider: 'vendor-x', model: 'mystery-model', cost: 4 }],
    { names: { 'vendor-x/mystery-model': 'Mystery' }, remote },
  )
  assert.equal(result.source, 'openrouter+builtin')
  assert.equal(result.changed.length, 1)
  assert.equal(result.changed[0].source, 'openrouter')
  assert.equal(result.changed[0].to, 8)
  assert.match(result.changed[0].note, /OpenRouter/)
  assert.equal(result.pool[0].costSource, 'openrouter')
})

test('autoPricePool tolerates junk input', () => {
  assert.deepEqual(autoPricePool(null).changed, [])
  assert.deepEqual(autoPricePool([null, 7]).pool, [])
})
