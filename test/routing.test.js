import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTROL_SCOPES,
  EFFORT_WORDS,
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

test('config-level maxPerTask caps strong entries that omit their own limit', () => {
  const c = cfg({
    maxPerTask: { strong: 2 },
    pool: [
      { id: 'deepseek-official/deepseek-v4-pro', tier: 'strong', cost: 8 },
      { id: 'deepseek-official/deepseek-flash', cost: 1 },
    ],
  })
  const pool = normalizePool(c)
  assert.equal(pool[0].maxPerTask, 2)
  // Cheap entries keep no ceiling: the cap is about spending strong models.
  assert.equal(pool[1].maxPerTask, undefined)
  const hard = { stepClass: 'hard', hasImage: false, escalations: 0 }
  assert.equal(chooseEntry(pool, c, hard, {}).entry.model, 'deepseek-v4-pro')
  assert.equal(chooseEntry(pool, c, hard, { 'deepseek-official/deepseek-v4-pro': 2 }).entry.model, 'deepseek-flash')
})

test('entry-level maxPerTask overrides config-level', () => {
  const c = cfg({
    maxPerTask: { strong: 2 },
    pool: [
      { id: 'deepseek-official/deepseek-v4-pro', tier: 'strong', cost: 8, maxPerTask: 0 },
      { id: 'deepseek-official/deepseek-flash', cost: 1 },
    ],
  })
  const pool = normalizePool(c)
  assert.equal(pool[0].maxPerTask, 0, 'an explicit 0 still means "disabled for this task"')
  assert.equal(chooseEntry(pool, c, { stepClass: 'hard' }, {}).entry.model, 'deepseek-flash')
})

test('an empty pool selects nothing', () => {
  assert.equal(chooseEntry(normalizePool({ provider: 'x', model: '' }), cfg({ pool: [] }), { stepClass: 'standard' }, {}), null)
})

test('effortTierForClass reads the route table and only falls back to low when unset', () => {
  assert.equal(effortTierForClass(cfg(), 'engineering'), 'high')
  assert.equal(effortTierForClass(cfg({ routes: {} }), 'hard'), 'low')
  // Since 0.15.0 any configured word passes through verbatim, unknown ones
  // included: the high-rank fallback happens downstream (stabilize/mapEffort),
  // never here, so a hand-edited route is not silently downgraded to "low".
  assert.equal(effortTierForClass(cfg({ routes: { hard: { effort: 'nonsense' } } }), 'hard'), 'nonsense')
  assert.equal(effortTierForClass(cfg({ routes: { hard: { effort: '' } } }), 'hard'), 'low')
  assert.equal(effortTierForClass(cfg({ routes: { hard: { effort: 42 } } }), 'hard'), 'low')
  assert.equal(effortTierForClass(cfg({ routes: { hard: null } }), 'hard'), 'low')
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

test('effortTierForClass passes the full nine-word vocabulary through verbatim', () => {
  for (const word of EFFORT_WORDS) {
    assert.equal(effortTierForClass(cfg({ routes: { trivial: { effort: word } } }), 'trivial'), word)
  }
  // The three words the old router downgraded to "low" are the point of the change.
  for (const word of ['medium', 'xhigh', 'ultra']) {
    assert.equal(effortTierForClass(cfg({ routes: { standard: { effort: word } } }), 'standard'), word)
  }
})

test('stabilize ranks the route vocabulary: medium < high < xhigh, unknown counts as high', () => {
  // medium is below high: a quiet streak is needed before lowering to it.
  assert.deepEqual(stabilize('medium', 'high', 0, 2), { value: 'high', streak: 1 })
  // high is below xhigh: same rule.
  assert.deepEqual(stabilize('high', 'xhigh', 0, 2), { value: 'xhigh', streak: 1 })
  // Raising is immediate across the same ranks.
  assert.deepEqual(stabilize('xhigh', 'high', 0, 2), { value: 'xhigh', streak: 0 })
  assert.deepEqual(stabilize('high', 'medium', 0, 2), { value: 'high', streak: 0 })
  // An unknown route word ranks as high: no downgrade from high, an upgrade from low.
  assert.deepEqual(stabilize('banana', 'high', 0, 2), { value: 'banana', streak: 0 })
  assert.deepEqual(stabilize('banana', 'low', 0, 2), { value: 'banana', streak: 0 })
  assert.deepEqual(stabilize('banana', 'max', 0, 2), { value: 'max', streak: 1 })
})

test('mapEffort resolves the nearest rank, and ties go to the higher effort (quality-first)', () => {
  const deepseek = ['off', 'low', 'high', 'max']
  // Quality-first tie rule: with two equally distant supported ids the
  // higher-ranked one wins, so a mid-ladder intent never collapses downward.
  // medium (rank 3) is equidistant from low (2) and high (4) => high.
  assert.equal(mapEffort('medium', deepseek), 'high')
  assert.equal(mapEffort('medium', ['low', 'high']), 'high')
  assert.equal(mapEffort('medium', ['high', 'low']), 'high', 'supported order must not decide a tie')
  // xhigh (5) is equidistant from high (4) and max (6) => max. Deliberate: an
  // extreme-high intent ties upward; the catalog alias maps it to high instead.
  assert.equal(mapEffort('xhigh', deepseek), 'max')
  assert.equal(mapEffort('xhigh', ['low', 'high']), 'high', 'not a tie: high is strictly nearest')
  // minimal (1) is equidistant from off (0) and low (2) => low.
  assert.equal(mapEffort('minimal', deepseek), 'low')
  // Words without a tie snap to the unique nearest neighbour.
  assert.equal(mapEffort('none', deepseek), 'off')
  assert.equal(mapEffort('ultra', deepseek), 'max')
  // An unknown tier uses the high rank (4), exactly like the old behavior.
  assert.equal(mapEffort('bogus', deepseek), 'high')
  assert.equal(mapEffort('bogus', ['low', 'high']), 'high')
  // Exact matches and the empty vocabulary keep working unchanged.
  assert.equal(mapEffort('xhigh', ['off', 'low', 'xhigh']), 'xhigh')
  assert.equal(mapEffort('medium', []), undefined)
})
