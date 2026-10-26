import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { CATALOG, MODELS, findModel } from '../lib/catalog.js'
import { collectWarnings, validateCatalog } from '../scripts/check-catalog.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXPECTED_IDS = [
  'deepseek-flash',
  'deepseek-v4-pro',
  'gpt-6-astra',
  'gpt-6.1-sol',
  'gpt-6-sol',
  'gpt-6-luna',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'gemini-4-argon',
  'gemini-3.8-flash',
  'grok-4.7',
  'muse-wonder',
  'kimi-k3.1-pro',
  'minimax-m3.1-flash',
  'qwen3.8-max-prime',
  'qwen3.8-flash',
  'glm-5.3-prime',
  'glm-5.3-flashx',
]
const EFFORT_LEVELS = ['none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const DATE = /^\d{4}-\d{2}-\d{2}$/
/** Dates may be explicitly unknown instead of guessed at. */
const isDateOrUnknown = (value) => value === 'unknown' || DATE.test(value)

/** A deep copy so a test can break the data without touching the real catalog. */
const clone = () => JSON.parse(JSON.stringify(CATALOG))

test('catalog header describes a dated evidence snapshot', () => {
  assert.equal(CATALOG.schemaVersion, '1.0.0')
  assert.equal(CATALOG.evidenceDate, '2026-10-26')
  assert.match(CATALOG.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  assert.equal(CATALOG.aaVersion, 'v4.3.2')
  assert.equal(CATALOG.fxRate.base, 'CNY')
  assert.equal(CATALOG.fxRate.quote, 'USD')
  assert.equal(CATALOG.fxRate.rate, 7)
  assert.equal(CATALOG.modelCount, EXPECTED_IDS.length)
  assert.equal(MODELS.length, EXPECTED_IDS.length)
})

test('model list is complete, ordered, and unique', () => {
  assert.deepEqual(MODELS.map((model) => model.id), EXPECTED_IDS)
  assert.equal(new Set(EXPECTED_IDS).size, EXPECTED_IDS.length)
})

test('channel registry covers official, account pool, relay, and aggregator kinds', () => {
  assert.deepEqual(Object.keys(CATALOG.channels).sort(), [
    'aliyun-bailian',
    'aliyun-bailian-singapore',
    'anthropic-official',
    'deepseek-account',
    'deepseek-official',
    'google-official',
    'minimax-official',
    'moonshot-official',
    'openai-official',
    'openrouter',
    'qiyue',
    'qy',
    'sub2',
    'xai-official',
    'zhipu-official',
  ])
  assert.equal(CATALOG.channels['deepseek-official'].kind, 'official')
  assert.equal(CATALOG.channels['deepseek-account'].kind, 'accountPool')
  assert.equal(CATALOG.channels.openrouter.kind, 'aggregator')
  for (const relay of ['qiyue', 'qy', 'sub2']) {
    assert.equal(CATALOG.channels[relay].kind, 'relay')
    // Relay economics are resale: never recorded as a known multiplier.
    assert.equal(CATALOG.channels[relay].billingMode, 'unknown')
  }
  // Vendor direct channels: token billed, priced in their own currency, but no
  // machine-readable price API -> the cost engine reads prices from the catalog.
  for (const official of [
    'openai-official',
    'anthropic-official',
    'google-official',
    'xai-official',
    'moonshot-official',
    'minimax-official',
    'aliyun-bailian',
    'zhipu-official',
  ]) {
    assert.equal(CATALOG.channels[official].kind, 'official', official)
    assert.equal(CATALOG.channels[official].billingMode, 'token', official)
    assert.equal(CATALOG.channels[official].machineReadablePricing, false, official)
  }
  // Alibaba's regional endpoint is a separate channel, not a resale relay.
  assert.equal(CATALOG.channels['aliyun-bailian-singapore'].kind, 'regionalOfficial')
  // Bailian prices in both CNY and USD depending on model/region, so the
  // channel-level currency stays unknown instead of guessing one.
  assert.equal(CATALOG.channels['aliyun-bailian'].currency, 'unknown')
})

test('every model carries the fields the router needs to route on', () => {
  for (const model of MODELS) {
    assert.equal(typeof model.provider, 'string')
    assert.equal(typeof model.display, 'string')
    assert.ok(Number.isInteger(model.contextWindow) && model.contextWindow > 0, model.id + ': contextWindow')
    assert.ok(Array.isArray(model.input) && model.input.length > 0, model.id + ': input modalities')
    assert.ok(Array.isArray(model.output) && model.output.length > 0, model.id + ': output modalities')
    assert.ok(isDateOrUnknown(model.releasedAt), model.id + ': releasedAt')
    assert.ok(Array.isArray(model.sources) && model.sources.length > 0, model.id + ': sources')
    for (const source of model.sources) {
      assert.match(source.url, /^https?:\/\//, model.id + ': source url')
      assert.ok(['high', 'medium', 'low'].includes(source.confidence), model.id + ': source confidence')
    }
  }
  // Only one release date is unknown, and only one pricing basis is unknown.
  assert.deepEqual(MODELS.filter((model) => model.releasedAt === 'unknown').map((model) => model.id), ['qwen3.8-flash'])
  assert.deepEqual(MODELS.filter((model) => model.pricing.effectiveFrom === 'unknown').map((model) => model.id), ['qwen3.8-flash'])
})

test('prices are per million tokens in a single currency with a dated basis', () => {
  for (const model of MODELS) {
    const pricing = model.pricing
    assert.equal(pricing.unit, 'per_1m_tokens', model.id + ': unit')
    assert.ok(['USD', 'CNY'].includes(pricing.currency), model.id + ': currency')
    assert.ok(typeof pricing.input === 'number' && pricing.input >= 0, model.id + ': input price')
    assert.ok(typeof pricing.output === 'number' && pricing.output >= 0, model.id + ': output price')
    assert.ok(isDateOrUnknown(pricing.effectiveFrom), model.id + ': effectiveFrom')
    if (pricing.cacheRead !== null) {
      assert.ok(pricing.cacheRead >= 0 && pricing.cacheRead < pricing.input, model.id + ': cache read must be cheaper than fresh input')
    }
    for (const tier of pricing.longContext) {
      assert.ok(tier.thresholdTokens > 0, model.id + ': long-context threshold')
      assert.ok(['whole_request', 'excess'].includes(tier.mode), model.id + ': long-context mode')
    }
    for (const call of pricing.perCall) {
      assert.ok(call.price >= 0, model.id + ': perCall price')
      assert.ok(['per_1000_calls', 'per_call', 'per_container_hour', 'per_mtoken_hour'].includes(call.unit), model.id + ': perCall unit')
      assert.ok(isDateOrUnknown(call.effectiveFrom), model.id + ': perCall effectiveFrom')
    }
    if (pricing.next) {
      assert.match(pricing.next.effectiveFrom, DATE, model.id + ': next.effectiveFrom')
      assert.ok(pricing.next.effectiveFrom > pricing.effectiveFrom, model.id + ': next price must follow the current one')
      assert.ok(pricing.next.input > pricing.input, model.id + ': next prices are announced increases only')
    }
  }
})

test('scheduled price changes match the published calendar', () => {
  const pending = MODELS.filter((model) => model.pricing.next).map((model) => [model.id, model.pricing.next.effectiveFrom])
  assert.deepEqual(pending, [
    ['gemini-4-argon', '2026-12-01'],
    ['gemini-3.8-flash', '2027-01-01'],
  ])
  const argon = CATALOG.models.find((model) => model.id === 'gemini-4-argon')
  assert.equal(argon.pricing.input, 2)
  assert.equal(argon.pricing.next.input, 4)
  assert.equal(argon.pricing.next.output, 20)
  const flash = CATALOG.models.find((model) => model.id === 'gemini-3.8-flash')
  assert.equal(flash.pricing.input, 0.825)
  assert.equal(flash.pricing.next.input, 1.5)
})

test('peak/off-peak pricing is recorded with its time zone and multiplier', () => {
  const peak = MODELS.filter((model) => model.pricing.peakOffpeak !== null)
  assert.deepEqual(peak.map((model) => model.id), ['deepseek-flash', 'deepseek-v4-pro'])
  for (const model of peak) {
    const schedule = model.pricing.peakOffpeak
    assert.equal(schedule.tz, 'Asia/Shanghai')
    assert.equal(schedule.offpeakMultiplier, 0.5)
    assert.ok(schedule.peakWindows.length > 0)
    for (const key of ['input', 'output', 'cacheRead']) {
      assert.ok(Math.abs(schedule.offpeakRates[key] - model.pricing[key] * 0.5) < 1e-9, model.id + ': off-peak ' + key + ' must be half the list price')
    }
  }
})

test('reasoning effort vocabularies use the router-wide level names', () => {
  for (const model of MODELS) {
    const effort = model.effort
    assert.ok(Array.isArray(effort.vocab), model.id + ': vocab')
    for (const level of effort.vocab) {
      assert.ok(EFFORT_LEVELS.includes(level), model.id + ': unexpected level ' + level)
    }
    assert.ok(['none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'unknown', 'always_on'].includes(effort.default), model.id + ': default')
    if (EFFORT_LEVELS.includes(effort.default)) {
      assert.ok(effort.vocab.includes(effort.default), model.id + ': default must be reachable')
    }
    for (const [alias, target] of Object.entries(effort.aliases)) {
      assert.ok(EFFORT_LEVELS.includes(alias), model.id + ': alias key ' + alias)
      assert.ok(effort.vocab.includes(target), model.id + ': alias target ' + target + ' must be in vocab')
    }
    assert.ok(['supported', 'levelGated', 'never', 'unknown'].includes(effort.disable), model.id + ': disable')
    assert.equal(effort.reasoningBilling, 'included_in_output', model.id + ': reasoning tokens bill as output')
  }
  // Thinking that cannot be switched off must not advertise a disable mode.
  for (const model of MODELS) {
    if (model.effort.alwaysReasoning === true) assert.equal(model.effort.disable, 'never', model.id + ': alwaysReasoning needs disable=never')
  }
})

test('DeepSeek collapses unsupported levels instead of dropping the request', () => {
  for (const id of ['deepseek-flash', 'deepseek-v4-pro']) {
    const effort = CATALOG.models.find((model) => model.id === id).effort
    assert.deepEqual(effort.vocab, ['none', 'low', 'high', 'max'])
    assert.deepEqual(effort.aliases, { minimal: 'low', medium: 'high', xhigh: 'high', ultra: 'max' })
    assert.equal(effort.param, 'reasoning_effort')
  }
})

test('Artificial Analysis scores carry the variant they were measured at', () => {
  for (const model of MODELS) {
    if (!model.quality) continue
    if (model.quality.aaIndex === null) continue
    assert.ok(Number.isInteger(model.quality.aaIndex), model.id + ': aaIndex')
    // Known gap: claude-sonnet-5-5 has a score but no variant recorded; every
    // other scored model names one. Fix the YAML and this list shrinks.
    if (model.quality.aaVariant === undefined) {
      assert.equal(model.id, 'claude-sonnet-5-5')
      continue
    }
    assert.equal(typeof model.quality.aaVariant, 'string')
    assert.ok(model.quality.aaVariant.length > 0)
  }
  const scored = MODELS.filter((model) => model.quality && model.quality.aaIndex !== null).map((model) => model.id)
  assert.deepEqual(scored, ['deepseek-flash', 'gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5-5', 'claude-sonnet-5-5', 'gemini-4-argon', 'gemini-3.8-flash', 'muse-wonder', 'kimi-k3.1-pro'])
})

test('every model names at least one addressable channel', () => {
  for (const model of MODELS) {
    const channels = model.channels
    assert.ok(channels.official || channels.accountPool.length > 0 || channels.relay.length > 0, model.id + ': no channel')
    for (const entry of [...channels.accountPool, ...channels.relay]) {
      assert.equal(typeof entry.channel, 'string')
      assert.ok(CATALOG.channels[entry.channel], model.id + ': unregistered channel ' + entry.channel)
      assert.equal(typeof entry.qualifiedId, 'string', model.id + ': qualifiedId')
    }
  }
  // muse-wonder is relay-only: the honest representation is a null official block.
  const muse = CATALOG.models.find((model) => model.id === 'muse-wonder')
  assert.equal(muse.channels.official.channel, null)
  assert.equal(muse.channels.relay.length, 3)
})

test('OpenRouter ids exist for everything the aggregator actually lists', () => {
  const without = MODELS.filter((model) => model.channels.openrouterId === null).map((model) => model.id)
  assert.deepEqual(without, ['deepseek-v4-pro'])
  for (const model of MODELS) {
    if (model.channels.openrouterId === null) continue
    assert.match(model.channels.openrouterId, /^[a-z0-9-]+\/[a-z0-9._-]+$/, model.id + ': openrouter id')
    // The OpenRouter listing price is the USD reference for relay pricing.
    if (model.pricing.currency === 'USD') assert.equal(typeof model.pricing.input, 'number')
  }
})

test('the calendar records dated releases and price changes', () => {
  assert.deepEqual(
    CATALOG.calendar.map((entry) => [entry.date, entry.type]),
    [
      ['2026-10-23', 'release'],
      ['2026-11-01', 'billing_start'],
      ['2026-12-01', 'price_increase'],
      ['2027-01-01', 'price_increase'],
    ]
  )
  for (const entry of CATALOG.calendar) {
    assert.ok(entry.models.length > 0, entry.date + ': models')
    for (const id of entry.models) assert.ok(EXPECTED_IDS.includes(id), entry.date + ': unknown model ' + id)
  }
})

test('the watchlist records hard dates for models the catalog deliberately excludes', () => {
  // The mirror image of calendar: calendar points at models in the routing pool,
  // watchlist at models that are not candidates but whose dates still matter.
  assert.ok(Array.isArray(CATALOG.watchlist))
  assert.deepEqual(
    CATALOG.watchlist.map((entry) => [entry.id, entry.provider, entry.date, entry.type]),
    [['glm-4.5', 'zhipu', '2026-12-31', 'retirement']]
  )
  for (const entry of CATALOG.watchlist) {
    assert.ok(!EXPECTED_IDS.includes(entry.id), entry.id + ': watchlist models must not be routable')
    assert.match(entry.date, DATE, entry.id + ': date')
    assert.equal(typeof entry.display, 'string')
    assert.ok(entry.display.length > 0, entry.id + ': display')
    assert.equal(typeof entry.action, 'string')
    assert.ok(entry.action.length > 0, entry.id + ': action')
    assert.ok(Array.isArray(entry.sources) && entry.sources.length > 0, entry.id + ': sources')
    for (const source of entry.sources) {
      assert.match(source.url, /^https?:\/\//, entry.id + ': source url')
      assert.ok(['high', 'medium', 'low'].includes(source.confidence), entry.id + ': source confidence')
      assert.ok(isDateOrUnknown(source.checkedAt), entry.id + ': source checkedAt')
    }
  }
})

test('validateCatalog accepts the shipped catalog', () => {
  assert.deepEqual(validateCatalog(CATALOG), [])
})

test('validateCatalog rejects structurally broken catalogs', () => {
  const cases = [
    ['pricing.currency', (catalog) => { catalog.models[0].pricing.currency = 'EUR' }],
    ['pricing.unit', (catalog) => { catalog.models[0].pricing.unit = 'per_1k_tokens' }],
    ['effort.vocab', (catalog) => { catalog.models[0].effort.vocab = ['none', 'turbo'] }],
    ['effort.default', (catalog) => { catalog.models[0].effort.default = 'ultra' }],
    ['.id: duplicate id', (catalog) => { catalog.models[1].id = catalog.models[0].id }],
    ['modelCount', (catalog) => { catalog.modelCount = 20 }],
    ['contextWindow', (catalog) => { catalog.models[0].contextWindow = 0 }],
    ['releasedAt', (catalog) => { catalog.models[0].releasedAt = '2026-13-01' }],
    ['alwaysReasoning', (catalog) => { catalog.models[2].effort.disable = 'supported' }],
    ['calendar[0].models', (catalog) => { catalog.calendar[0].models = ['nope'] }],
    ['next.effectiveFrom', (catalog) => { catalog.models[9].pricing.next.effectiveFrom = '2026-10-01' }],
    ['channels.official.qualifiedId', (catalog) => { catalog.models[12].channels.official.qualifiedId = 'x/y' }],
    ['catalog.watchlist', (catalog) => { catalog.watchlist = 'glm-4.5' }],
    ['catalog.watchlist[0].id', (catalog) => { catalog.watchlist[0].id = 'deepseek-flash' }],
    ['catalog.watchlist[0].date', (catalog) => { catalog.watchlist[0].date = '2026-13-01' }],
    ['catalog.watchlist[0].type', (catalog) => { catalog.watchlist[0].type = 'expiry' }],
    ['catalog.watchlist[0].sources', (catalog) => { catalog.watchlist[0].sources = [] }],
  ]
  for (const [needle, mutate] of cases) {
    const broken = clone()
    mutate(broken)
    const errors = validateCatalog(broken)
    assert.ok(errors.length > 0, 'expected an error for ' + needle)
    assert.ok(
      errors.some((error) => error.includes(needle)),
      'expected an error mentioning ' + needle + ', got:\n' + errors.join('\n')
    )
  }
})

test('the shipped catalog has exactly the known completeness warnings', () => {
  const warnings = collectWarnings(CATALOG)
  assert.equal(warnings.length, 1, warnings.join('\n'))
  // Registry gap: closed on 2026-10-26 - every channel label a model references
  // is now registered, including the Bailian Singapore regional endpoint.
  const unregistered = warnings.filter((warning) => warning.startsWith('catalog.channels:')).map((warning) => warning.match(/channel "([^"]+)"/)[1])
  assert.deepEqual(unregistered, [])
  // Remaining data gap: one AA score without the variant it was measured at.
  // Kept on purpose - no public source pins which effort variant was scored.
  assert.deepEqual(
    warnings.filter((warning) => warning.includes('aaVariant')).map((warning) => warning.match(/models\("([^"]+)"\)/)[1]),
    ['claude-sonnet-5-5']
  )
})

test('findModel resolves every addressable form', () => {
  assert.equal(findModel('deepseek-flash').id, 'deepseek-flash')
  assert.equal(findModel('deepseek', 'deepseek-flash').id, 'deepseek-flash')
  assert.equal(findModel('deepseek-official', 'deepseek-flash').id, 'deepseek-flash')
  assert.equal(findModel('deepseek/deepseek-v4.1-flash-1017').id, 'deepseek-flash')
  assert.equal(findModel('qiyue', 'qiyue/deepseek-flash').id, 'deepseek-flash')
  assert.equal(findModel('qiyue/deepseek-flash').id, 'deepseek-flash')
  assert.equal(findModel('deepseek-account/deepseek-flash').id, 'deepseek-flash')
  assert.equal(findModel('gpt-6.1-sol').id, 'gpt-6.1-sol')
  assert.equal(findModel('openrouter', 'anthropic/claude-opus-5.5').id, 'claude-opus-5-5')
  assert.equal(findModel(undefined, 'gpt-6.1-sol').id, 'gpt-6.1-sol')
  assert.equal(findModel('nope'), undefined)
  assert.equal(findModel(), undefined)
  // Case-insensitive, and whitespace tolerant.
  assert.equal(findModel('  DEEPSEEK-FLASH  ').id, 'deepseek-flash')
})

test('the generated module is frozen, JSON-safe, and marked generated', () => {
  assert.ok(Object.isFrozen(MODELS))
  assert.deepEqual(JSON.parse(JSON.stringify(CATALOG)), CATALOG)
  const source = readFileSync(new URL('../lib/catalog.js', import.meta.url), 'utf8')
  assert.ok(source.slice(0, 500).includes('GENERATED FILE - DO NOT EDIT'))
  assert.match(source, /export const CATALOG = \{/)
  assert.match(source, /export const MODELS = Object\.freeze\(CATALOG\.models\)/)
  assert.match(source, /export function findModel\(provider, id\)/)
  // Deterministic bytes: LF endings, no BOM, exactly one trailing newline.
  assert.ok(!source.startsWith('\uFEFF'), 'unexpected BOM')
  assert.ok(!source.includes('\r'), 'unexpected CRLF')
  assert.ok(source.endsWith('}\n'))
  assert.ok(!source.endsWith('\n\n'))
  const yaml = readFileSync(new URL('../catalog/model-catalog.yaml', import.meta.url), 'utf8')
  assert.match(yaml, /^evidenceDate: "2026-10-26"$/m)
  assert.match(yaml, /^schemaVersion: "1\.0\.0"$/m)
})

test('the catalog never invents a value: unknowns stay explicit', () => {
  const serialised = JSON.stringify(CATALOG)
  assert.ok(!serialised.includes('NaN'))
  assert.ok(!serialised.includes('undefined'))
  for (const model of MODELS) {
    const pricing = model.pricing
    assert.ok(typeof pricing.input === 'number' || pricing.priceUnknown === true, model.id + ': missing input price must be flagged')
  }
})

test('run-gating facts the router depends on are present per model', () => {
  const expected = {
    'deepseek-flash': { contextWindow: 1000000, currency: 'CNY' },
    'gpt-6-astra': { currency: 'USD' },
    'claude-opus-5-5': { currency: 'USD' },
    'kimi-k3.1-pro': { currency: 'USD' },
  }
  for (const [id, fields] of Object.entries(expected)) {
    const model = CATALOG.models.find((entry) => entry.id === id)
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'currency') assert.equal(model.pricing.currency, value, id + ': ' + key)
      else assert.equal(model[key], value, id + ': ' + key)
    }
  }
})
