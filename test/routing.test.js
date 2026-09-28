import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTROL_SCOPES,
  ROUTING_DEFAULTS,
  chooseEntry,
  effortTierForClass,
  manualOverridePolicy,
  mapEffort,
  matchPreset,
  normalizePool,
  poolContains,
  presetWeight,
  scoreEntry,
  splitModelId,
  stabilize,
} from '../lib/routing.js'

const cfg = (over = {}) => ({
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  routes: {
    trivial: { effort: 'low' },
    standard: { effort: 'low' },
    engineering: { effort: 'high' },
    hard: { effort: 'high' },
  },
  scoring: ROUTING_DEFAULTS.scoring,
  hysteresis: ROUTING_DEFAULTS.hysteresis,
  presets: {},
  ...over,
})

const POOL = [
  { id: 'deepseek-official/deepseek-flash', cost: 1, tier: 'cheap' },
  { id: 'deepseek-official/deepseek-v4-pro', cost: 8, tier: 'strong' },
  { id: 'deepseek-official/deepseek-v4-flash-vision-exp', cost: 1, tier: 'cheap', tags: ['vision'] },
]

test('splitModelId splits provider/model and falls back to the configured provider', () => {
  assert.deepEqual(splitModelId('deepseek-official/deepseek-flash', 'x'), { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.deepEqual(splitModelId('deepseek-flash', 'deepseek-official'), { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.equal(splitModelId('', 'p'), null)
  assert.equal(splitModelId(undefined, 'p'), null)
})

test('normalizePool accepts strings and objects, drops junk, and falls back to the legacy model', () => {
  const pool = normalizePool(cfg({ pool: POOL }))
  assert.equal(pool.length, 3)
  assert.equal(pool[0].id, 'deepseek-official/deepseek-flash')
  assert.equal(pool[0].cost, 1)
  assert.equal(pool[1].tier, 'strong')
  assert.deepEqual(pool[2].tags, ['vision'])
  assert.ok(Object.isFrozen(pool))

  const messy = normalizePool(cfg({ pool: ['a/b', { id: 'a/b' }, null, 42, { nope: true }] }))
  assert.deepEqual(messy.map((e) => e.id), ['a/b'])

  const legacy = normalizePool({ provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.equal(legacy.length, 1)
  assert.equal(legacy[0].id, 'deepseek-official/deepseek-flash')
  assert.equal(poolContains(legacy, 'deepseek-official', 'deepseek-flash'), true)
  assert.equal(poolContains(legacy, 'other', 'deepseek-flash'), false)
})

test('matchPreset honours user rules: substrings, case, and /regex/ literals', () => {
  const c = cfg({
    presets: {
      novel: { match: ['续写', 'novel'] },
      refactor: { match: ['/refactor|重构/i'] },
    },
  })
  assert.equal(matchPreset(c, '帮我续写这一段'), 'novel')
  assert.equal(matchPreset(c, 'continue the NOVEL please'), 'novel')
  assert.equal(matchPreset(c, '重构这个模块'), 'refactor')
  assert.equal(matchPreset(c, '写点别的'), null)
  assert.equal(matchPreset(c, ''), null)
})

test('preset weights come from either the entry or the preset table, entry first', () => {
  const c = cfg({
    presets: { novel: { match: ['续写'], weights: { 'a/b': 90, 'c/d': 80 } } },
    pool: [{ id: 'a/b', weights: { novel: 70 } }, { id: 'c/d' }, { id: 'e/f' }],
  })
  const pool = normalizePool(c)
  assert.equal(presetWeight(c, pool[0], 'novel'), 70) // the entry's own weight wins over the table
  assert.equal(presetWeight(c, pool[1], 'novel'), 80) // from the preset table
  assert.equal(presetWeight(c, pool[2], 'novel'), undefined)
  assert.equal(presetWeight(c, pool[1], null), undefined)
})

test('scores prefer the cheap tier by default and the strong tier for hard work', () => {
  const c = cfg()
  const pool = normalizePool(cfg({ pool: POOL }))
  const standard = chooseEntry(pool, c, { stepClass: 'standard', escalations: 0, hasImage: false }, {})
  assert.equal(standard.entry.model, 'deepseek-flash')

  const hard = chooseEntry(pool, c, { stepClass: 'hard', escalations: 0, hasImage: false }, {})
  assert.equal(hard.entry.model, 'deepseek-v4-pro')

  const strong = pool.find((e) => e.tier === 'strong')
  assert.ok(scoreEntry(strong, null, c, { stepClass: 'hard' }) > scoreEntry(strong, null, c, { stepClass: 'standard' }))
})

test('a user weight overrides the built-in tier preference', () => {
  const c = cfg({
    presets: { novel: { match: ['续写'], weights: { 'deepseek-official/deepseek-flash': 95, 'deepseek-official/deepseek-v4-pro': 40 } } },
    pool: POOL,
  })
  const pool = normalizePool(c)
  const picked = chooseEntry(pool, c, { stepClass: 'standard', presetName: 'novel', hasImage: false, escalations: 0 }, {})
  assert.equal(picked.entry.model, 'deepseek-flash')
  assert.equal(picked.preset, 'novel')
})

test('image steps are restricted to vision entries, and maxPerTask ceilings exclude a spent model', () => {
  const c = cfg({ pool: POOL })
  const pool = normalizePool(c)
  const image = chooseEntry(pool, c, { stepClass: 'standard', hasImage: true, escalations: 0 }, {})
  assert.equal(image.entry.model, 'deepseek-v4-flash-vision-exp')

  const capped = cfg({ pool: [{ id: 'deepseek-official/deepseek-v4-pro', tier: 'strong', cost: 8, maxPerTask: 1 }, { id: 'deepseek-official/deepseek-flash', cost: 1 }] })
  const cappedPool = normalizePool(capped)
  const first = chooseEntry(cappedPool, capped, { stepClass: 'hard', hasImage: false, escalations: 0 }, {})
  assert.equal(first.entry.model, 'deepseek-v4-pro')
  const second = chooseEntry(cappedPool, capped, { stepClass: 'hard', hasImage: false, escalations: 0 }, { 'deepseek-official/deepseek-v4-pro': 1 })
  assert.equal(second.entry.model, 'deepseek-flash')
})

test('an empty pool selects nothing', () => {
  assert.equal(chooseEntry(normalizePool({ provider: 'x', model: '' }), cfg({ pool: [] }), { stepClass: 'standard' }, {}), null)
})

test('effortTierForClass reads the route table and falls back to low', () => {
  assert.equal(effortTierForClass(cfg(), 'engineering'), 'high')
  assert.equal(effortTierForClass(cfg({ routes: {} }), 'hard'), 'low')
  assert.equal(effortTierForClass(cfg({ routes: { hard: { effort: 'nonsense' } } }), 'hard'), 'low')
})

test('mapEffort translates onto the target model vocabulary and degrades gracefully', () => {
  assert.equal(mapEffort('high', ['off', 'low', 'high', 'max']), 'high')
  assert.equal(mapEffort('max', ['low', 'medium', 'high']), 'high')
  assert.equal(mapEffort('low', ['low', 'medium', 'high']), 'low')
  assert.equal(mapEffort('high', ['off', 'low']), 'low')
  assert.equal(mapEffort('high', []), undefined)
  assert.equal(mapEffort('high', undefined), undefined)
})

test('stabilize raises immediately and lowers only after the quiet streak', () => {
  assert.deepEqual(stabilize('high', 'low', 0, 2), { value: 'high', streak: 0 })
  assert.deepEqual(stabilize('low', 'high', 0, 2), { value: 'high', streak: 1 })
  assert.deepEqual(stabilize('low', 'high', 1, 2), { value: 'low', streak: 0 })
  assert.deepEqual(stabilize('high', undefined, 0, 2), { value: 'high', streak: 0 })
  assert.deepEqual(stabilize('low', 'high', 0, 1), { value: 'low', streak: 0 })
})

test('control scopes and manual-override defaults are the documented ones', () => {
  assert.deepEqual(CONTROL_SCOPES, ['full', 'effort', 'model'])
  assert.deepEqual(manualOverridePolicy({}), { yieldOnManual: true, resumeOnNextCommand: true })
  assert.deepEqual(manualOverridePolicy({ manualOverride: { yieldOnManual: false } }), { yieldOnManual: false, resumeOnNextCommand: true })
})
