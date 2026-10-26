/**
 * dsh-model-router — zero-dependency validator for the model catalog.
 *
 * lib/catalog.js is generated from catalog/model-catalog.yaml, so the runtime
 * needs no YAML parser. This module is the second half of that trade: it
 * re-checks the generated data against the contract in
 * schema/model-catalog.schema.json (a shallow, dependency-free subset of it —
 * no Ajv, no npm additions) and exports validateCatalog() for the tests.
 *
 * A missing or "unknown" value is legal on purpose: the catalog records
 * unverified prices as null / "unknown" / priceUnknown: true instead of
 * inventing a number, and refusing to load such a catalog would be worse than
 * loading it. What is not legal is a *wrongly typed* or *dangling* value.
 *
 * Usage:
 *   node scripts/check-catalog.mjs          # print a summary, exit 1 on problems
 *
 * Exit codes: 0 clean, 1 validation errors, 2 the generated module is missing.
 */
import { pathToFileURL } from 'node:url'
import { CATALOG } from '../lib/catalog.js'

const EFFORT_LEVELS = ['none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const EFFORT_DEFAULTS = [...EFFORT_LEVELS, 'unknown', 'always_on']
const DISABLE_MODES = ['supported', 'levelGated', 'never', 'unknown']
const BILLING_MODES = ['token', 'per_call', 'subscription', 'quota_pack', 'unknown']
const CURRENCIES = ['USD', 'CNY']
const CONFIDENCE = ['high', 'medium', 'low']
const CHANNEL_KINDS = ['official', 'accountPool', 'relay', 'aggregator', 'regionalOfficial']
const LONG_CONTEXT_MODES = ['whole_request', 'excess']
const PER_CALL_UNITS = ['per_1000_calls', 'per_call', 'per_container_hour', 'per_mtoken_hour']
const INPUT_MODALITIES = ['text', 'image', 'audio', 'video', 'pdf']
const OUTPUT_MODALITIES = ['text', 'image']
const CALENDAR_TYPES = ['release', 'price_increase', 'price_decrease', 'billing_start', 'retirement']
const REASONING_BILLING = ['included_in_output', 'separate']
const REASONING_PASSTHROUGH = ['required_with_tools', 'optional', 'encrypted_required', 'none']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/
const SEMVER_RE = /^\d+\.\d+\.\d+$/

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isInteger(value) {
  return Number.isInteger(value)
}

function isDate(value) {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(value))
}

/** Dates may be explicitly unknown instead of guessed. */
function isDateOrUnknown(value) {
  return isDate(value) || value === 'unknown'
}

function show(value) {
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Validate a catalog document.
 * @param {object} catalog - the object exported as CATALOG (or any document of that shape)
 * @returns {string[]} problems as "path: message"; an empty array means valid
 */
export function validateCatalog(catalog) {
  const errors = []
  const fail = (path, message) => errors.push(path + ': ' + message)

  if (!isObject(catalog)) return ['catalog: expected an object']

  // ── top level ────────────────────────────────────────────────────────────
  for (const key of ['schemaVersion', 'generatedAt', 'evidenceDate', 'fxRate', 'aaVersion', 'modelCount', 'channels', 'models']) {
    if (catalog[key] === undefined) fail('catalog', 'missing required key ' + show(key))
  }
  if (typeof catalog.schemaVersion !== 'string' || !SEMVER_RE.test(catalog.schemaVersion)) fail('catalog.schemaVersion', 'expected MAJOR.MINOR.PATCH, got ' + show(catalog.schemaVersion))
  if (typeof catalog.generatedAt !== 'string' || !ISO_RE.test(catalog.generatedAt)) fail('catalog.generatedAt', 'expected an ISO-8601 date-time with offset, got ' + show(catalog.generatedAt))
  if (!isDate(catalog.evidenceDate)) fail('catalog.evidenceDate', 'expected YYYY-MM-DD, got ' + show(catalog.evidenceDate))
  if (typeof catalog.aaVersion !== 'string' || !/^v\d+(\.\d+)*$/.test(catalog.aaVersion)) fail('catalog.aaVersion', 'expected a version like v4.3.2, got ' + show(catalog.aaVersion))
  if (!isObject(catalog.fxRate) || !isFiniteNumber(catalog.fxRate.rate) || catalog.fxRate.rate <= 0) fail('catalog.fxRate.rate', 'expected a positive number, got ' + show(catalog.fxRate && catalog.fxRate.rate))

  const channels = catalog.channels
  if (!isObject(channels) || Object.keys(channels).length === 0) {
    fail('catalog.channels', 'expected a non-empty channel registry')
  } else {
    for (const [name, channel] of Object.entries(channels)) {
      const base = 'catalog.channels.' + name
      if (!isObject(channel)) {
        fail(base, 'expected an object')
        continue
      }
      if (!CHANNEL_KINDS.includes(channel.kind)) fail(base + '.kind', 'unexpected kind ' + show(channel.kind))
      if (!BILLING_MODES.includes(channel.billingMode)) fail(base + '.billingMode', 'unexpected billingMode ' + show(channel.billingMode))
      if (channel.currency !== undefined && ![...CURRENCIES, 'unknown'].includes(channel.currency)) fail(base + '.currency', 'unexpected currency ' + show(channel.currency))
      if (channel.confidence !== undefined && !CONFIDENCE.includes(channel.confidence)) fail(base + '.confidence', 'unexpected confidence ' + show(channel.confidence))
    }
  }

  const models = catalog.models
  if (!Array.isArray(models) || models.length === 0) {
    fail('catalog.models', 'expected a non-empty array')
    return errors
  }
  if (isInteger(catalog.modelCount) && catalog.modelCount !== models.length) fail('catalog.modelCount', 'declares ' + catalog.modelCount + ' but models has ' + models.length)
  if (!isInteger(catalog.modelCount)) fail('catalog.modelCount', 'expected an integer, got ' + show(catalog.modelCount))

  const knownIds = new Set()
  for (const model of models) {
    if (isObject(model) && typeof model.id === 'string') knownIds.add(model.id)
  }

  const seenIds = new Set()
  models.forEach((model, index) => {
    const at = 'catalog.models[' + index + ']'
    if (!isObject(model)) {
      fail(at, 'expected an object')
      return
    }
    const path = at + '(' + show(model.id) + ')'
    for (const key of ['id', 'provider', 'display', 'releasedAt', 'contextWindow', 'pricing', 'effort', 'channels', 'sources']) {
      if (model[key] === undefined) fail(path, 'missing required key ' + show(key))
    }
    if (typeof model.id !== 'string' || !ID_RE.test(model.id)) fail(path + '.id', 'expected a lowercase id, got ' + show(model.id))
    else if (seenIds.has(model.id)) fail(path + '.id', 'duplicate id')
    else seenIds.add(model.id)
    if (typeof model.provider !== 'string' || model.provider.length === 0) fail(path + '.provider', 'expected a non-empty string')
    if (typeof model.display !== 'string' || model.display.length === 0) fail(path + '.display', 'expected a non-empty string')
    if (!isDateOrUnknown(model.releasedAt)) fail(path + '.releasedAt', 'expected YYYY-MM-DD or unknown, got ' + show(model.releasedAt))
    if (!isInteger(model.contextWindow) || model.contextWindow <= 0) fail(path + '.contextWindow', 'expected a positive integer, got ' + show(model.contextWindow))
    if (model.maxOutput !== null && model.maxOutput !== undefined && (!isInteger(model.maxOutput) || model.maxOutput <= 0)) fail(path + '.maxOutput', 'expected a positive integer or null, got ' + show(model.maxOutput))
    for (const modality of model.input || []) {
      if (!INPUT_MODALITIES.includes(modality)) fail(path + '.input', 'unexpected modality ' + show(modality))
    }
    for (const modality of model.output || []) {
      if (!OUTPUT_MODALITIES.includes(modality)) fail(path + '.output', 'unexpected modality ' + show(modality))
    }

    // ── pricing ────────────────────────────────────────────────────────────
    const pricing = model.pricing
    if (!isObject(pricing)) fail(path + '.pricing', 'expected an object')
    else {
      if (!CURRENCIES.includes(pricing.currency)) fail(path + '.pricing.currency', 'expected USD or CNY, got ' + show(pricing.currency))
      if (pricing.unit !== 'per_1m_tokens') fail(path + '.pricing.unit', 'expected per_1m_tokens, got ' + show(pricing.unit))
      for (const key of ['input', 'output']) {
        if (!isFiniteNumber(pricing[key]) || pricing[key] < 0) fail(path + '.pricing.' + key, 'expected a non-negative number, got ' + show(pricing[key]))
      }
      for (const key of ['cacheRead', 'cacheWrite']) {
        const value = pricing[key]
        if (value !== undefined && value !== null && (!isFiniteNumber(value) || value < 0)) fail(path + '.pricing.' + key, 'expected a non-negative number or null, got ' + show(value))
      }
      if (!isDateOrUnknown(pricing.effectiveFrom)) fail(path + '.pricing.effectiveFrom', 'expected YYYY-MM-DD or unknown, got ' + show(pricing.effectiveFrom))
      if (Array.isArray(pricing.longContext)) {
        pricing.longContext.forEach((tier, tierIndex) => {
          const tierPath = path + '.pricing.longContext[' + tierIndex + ']'
          if (!isObject(tier)) return fail(tierPath, 'expected an object')
          if (!isInteger(tier.thresholdTokens) || tier.thresholdTokens <= 0) fail(tierPath + '.thresholdTokens', 'expected a positive integer, got ' + show(tier.thresholdTokens))
          if (!LONG_CONTEXT_MODES.includes(tier.mode)) fail(tierPath + '.mode', 'expected whole_request or excess, got ' + show(tier.mode))
          if ((tier.input === null || tier.output === null) && tier.priceUnknown !== true) fail(tierPath + '.priceUnknown', 'null tier prices must be flagged priceUnknown: true')
        })
      } else if (pricing.longContext !== undefined) fail(path + '.pricing.longContext', 'expected an array')
      if (pricing.peakOffpeak !== undefined && pricing.peakOffpeak !== null) {
        const peakPath = path + '.pricing.peakOffpeak'
        if (!isObject(pricing.peakOffpeak)) fail(peakPath, 'expected an object or null')
        else {
          if (typeof pricing.peakOffpeak.tz !== 'string') fail(peakPath + '.tz', 'expected a tz string')
          if (!isFiniteNumber(pricing.peakOffpeak.offpeakMultiplier) || pricing.peakOffpeak.offpeakMultiplier <= 0) fail(peakPath + '.offpeakMultiplier', 'expected a positive number')
          if (!isObject(pricing.peakOffpeak.offpeakRates)) fail(peakPath + '.offpeakRates', 'expected an object of per-1M rates')
        }
      }
      if (pricing.perCall !== undefined) {
        if (!Array.isArray(pricing.perCall)) fail(path + '.pricing.perCall', 'expected an array')
        else pricing.perCall.forEach((entry, callIndex) => {
          const callPath = path + '.pricing.perCall[' + callIndex + ']'
          if (!isObject(entry)) return fail(callPath, 'expected an object')
          if (typeof entry.name !== 'string' || entry.name.length === 0) fail(callPath + '.name', 'expected a non-empty string')
          if (!PER_CALL_UNITS.includes(entry.unit)) fail(callPath + '.unit', 'unexpected unit ' + show(entry.unit))
          if (!isFiniteNumber(entry.price) || entry.price < 0) fail(callPath + '.price', 'expected a non-negative number')
          if (!CURRENCIES.includes(entry.currency)) fail(callPath + '.currency', 'unexpected currency ' + show(entry.currency))
          if (!isDateOrUnknown(entry.effectiveFrom)) fail(callPath + '.effectiveFrom', 'expected YYYY-MM-DD or unknown, got ' + show(entry.effectiveFrom))
        })
      }
      if (pricing.next !== undefined) {
        const nextPath = path + '.pricing.next'
        if (!isObject(pricing.next)) fail(nextPath, 'expected an object')
        else {
          if (!isDate(pricing.next.effectiveFrom)) fail(nextPath + '.effectiveFrom', 'expected YYYY-MM-DD, got ' + show(pricing.next.effectiveFrom))
          else if (isDate(pricing.effectiveFrom) && pricing.next.effectiveFrom <= pricing.effectiveFrom) fail(nextPath + '.effectiveFrom', 'must be after pricing.effectiveFrom (' + pricing.effectiveFrom + ')')
        }
      }
    }

    // ── effort ─────────────────────────────────────────────────────────────
    const effort = model.effort
    if (!isObject(effort)) fail(path + '.effort', 'expected an object')
    else {
      const vocab = effort.vocab
      if (!Array.isArray(vocab)) fail(path + '.effort.vocab', 'expected an array (possibly empty)')
      else {
        if (new Set(vocab).size !== vocab.length) fail(path + '.effort.vocab', 'duplicate levels')
        for (const level of vocab) {
          if (!EFFORT_LEVELS.includes(level)) fail(path + '.effort.vocab', 'unexpected level ' + show(level))
        }
      }
      if (!isObject(effort.aliases)) fail(path + '.effort.aliases', 'expected an object (possibly empty)')
      else {
        for (const [alias, target] of Object.entries(effort.aliases)) {
          if (!EFFORT_LEVELS.includes(alias)) fail(path + '.effort.aliases.' + alias, 'alias key must be an effort level name')
          if (!EFFORT_LEVELS.includes(target)) fail(path + '.effort.aliases.' + alias, 'alias target must be an effort level, got ' + show(target))
        }
      }
      if (!EFFORT_DEFAULTS.includes(effort.default)) fail(path + '.effort.default', 'unexpected default ' + show(effort.default))
      else if (Array.isArray(vocab) && vocab.length > 0 && EFFORT_LEVELS.includes(effort.default) && !vocab.includes(effort.default)) {
        fail(path + '.effort.default', 'default ' + show(effort.default) + ' is not in vocab ' + show(vocab))
      }
      if (!DISABLE_MODES.includes(effort.disable)) fail(path + '.effort.disable', 'unexpected disable mode ' + show(effort.disable))
      if (effort.alwaysReasoning !== true && effort.alwaysReasoning !== false && effort.alwaysReasoning !== 'unknown') fail(path + '.effort.alwaysReasoning', 'expected boolean or unknown, got ' + show(effort.alwaysReasoning))
      if (effort.alwaysReasoning === true && (effort.disable === 'supported' || effort.disable === 'levelGated')) fail(path + '.effort', 'alwaysReasoning: true contradicts disable: ' + effort.disable)
      if (!REASONING_BILLING.includes(effort.reasoningBilling)) fail(path + '.effort.reasoningBilling', 'unexpected value ' + show(effort.reasoningBilling))
      if (!REASONING_PASSTHROUGH.includes(effort.reasoningPassthrough)) fail(path + '.effort.reasoningPassthrough', 'unexpected value ' + show(effort.reasoningPassthrough))
    }

    // ── channels ───────────────────────────────────────────────────────────
    const modelChannels = model.channels
    if (!isObject(modelChannels)) fail(path + '.channels', 'expected an object')
    else {
      // Channel *registration* is a catalog-completeness matter and is reported by
      // collectWarnings(); a dangling reference here is only a type error.
      const checkChannelRef = (name, channelPath) => {
        if (typeof name !== 'string' || name.length === 0) fail(channelPath, 'expected a non-empty channel name, got ' + show(name))
      }
      const official = modelChannels.official
      if (official !== undefined && official !== null) {
        if (!isObject(official)) fail(path + '.channels.official', 'expected an object or null')
        else if (official.channel === null) {
          // A placeholder official block is legal for models we can only reach
          // through relays (e.g. muse-wonder): no channel unless the id is known.
          if (official.qualifiedId !== null && official.qualifiedId !== undefined) {
            fail(path + '.channels.official.qualifiedId', 'must be null when channels.official.channel is null')
          }
        } else checkChannelRef(official.channel, path + '.channels.official.channel')
      }
      if (!Array.isArray(modelChannels.accountPool)) fail(path + '.channels.accountPool', 'expected an array (possibly empty)')
      else modelChannels.accountPool.forEach((entry, poolIndex) => {
        const poolPath = path + '.channels.accountPool[' + poolIndex + ']'
        if (!isObject(entry)) return fail(poolPath, 'expected an object')
        checkChannelRef(entry.channel, poolPath + '.channel')
        if (entry.billingMode !== undefined && !BILLING_MODES.includes(entry.billingMode)) fail(poolPath + '.billingMode', 'unexpected billingMode ' + show(entry.billingMode))
      })
      if (!Array.isArray(modelChannels.relay)) fail(path + '.channels.relay', 'expected an array (possibly empty)')
      else modelChannels.relay.forEach((entry, relayIndex) => {
        const relayPath = path + '.channels.relay[' + relayIndex + ']'
        if (!isObject(entry)) return fail(relayPath, 'expected an object')
        checkChannelRef(entry.channel, relayPath + '.channel')
        if (entry.billingMode !== undefined && !BILLING_MODES.includes(entry.billingMode)) fail(relayPath + '.billingMode', 'unexpected billingMode ' + show(entry.billingMode))
        if (entry.priceUnknown !== undefined && typeof entry.priceUnknown !== 'boolean') fail(relayPath + '.priceUnknown', 'expected a boolean')
      })
      if (modelChannels.openrouterId !== undefined && modelChannels.openrouterId !== null && (typeof modelChannels.openrouterId !== 'string' || modelChannels.openrouterId.length === 0)) fail(path + '.channels.openrouterId', 'expected a string or null')
    }

    // ── quality / perf ─────────────────────────────────────────────────────
    const quality = model.quality
    if (quality !== undefined) {
      if (!isObject(quality)) fail(path + '.quality', 'expected an object')
      else {
        if (quality.aaIndex !== undefined && quality.aaIndex !== null && (!isFiniteNumber(quality.aaIndex) || quality.aaIndex < 0 || quality.aaIndex > 100)) fail(path + '.quality.aaIndex', 'expected 0..100 or null, got ' + show(quality.aaIndex))
        if (quality.aaVariant !== undefined && quality.aaVariant !== null && (typeof quality.aaVariant !== 'string' || quality.aaVariant.length === 0)) fail(path + '.quality.aaVariant', 'expected a non-empty string when present')
        if (quality.confidence !== undefined && !CONFIDENCE.includes(quality.confidence)) fail(path + '.quality.confidence', 'unexpected confidence ' + show(quality.confidence))
      }
    }
    const perf = model.perf
    if (perf !== undefined && !isObject(perf)) fail(path + '.perf', 'expected an object')

    // ── sources ────────────────────────────────────────────────────────────
    if (!Array.isArray(model.sources) || model.sources.length === 0) fail(path + '.sources', 'expected a non-empty array')
    else model.sources.forEach((source, sourceIndex) => {
      const sourcePath = path + '.sources[' + sourceIndex + ']'
      if (!isObject(source)) return fail(sourcePath, 'expected an object')
      if (typeof source.url !== 'string' || source.url.length === 0) fail(sourcePath + '.url', 'expected a non-empty URL string')
      if (!isDateOrUnknown(source.checkedAt)) fail(sourcePath + '.checkedAt', 'expected YYYY-MM-DD or unknown, got ' + show(source.checkedAt))
      if (!CONFIDENCE.includes(source.confidence)) fail(sourcePath + '.confidence', 'unexpected confidence ' + show(source.confidence))
    })
  })

  // ── calendar ─────────────────────────────────────────────────────────────
  if (!Array.isArray(catalog.calendar)) fail('catalog.calendar', 'expected an array')
  else catalog.calendar.forEach((entry, index) => {
    const at = 'catalog.calendar[' + index + ']'
    if (!isObject(entry)) return fail(at, 'expected an object')
    if (!isDate(entry.date)) fail(at + '.date', 'expected YYYY-MM-DD, got ' + show(entry.date))
    if (!CALENDAR_TYPES.includes(entry.type)) fail(at + '.type', 'unexpected type ' + show(entry.type))
    if (!Array.isArray(entry.models) || entry.models.length === 0) fail(at + '.models', 'expected a non-empty array of model ids')
    else entry.models.forEach((id, idIndex) => {
      if (!knownIds.has(id)) fail(at + '.models[' + idIndex + ']', 'unknown model id ' + show(id))
    })
    if (typeof entry.description !== 'string' || entry.description.length === 0) fail(at + '.description', 'expected a non-empty string')
  })

  return errors
}

/**
 * Report values that are *legal but incomplete*: the catalog can be loaded and
 * routed with them, yet the data behind them is missing. These never fail a
 * build (catalog/model-catalog.yaml is the source of truth and a release may
 * legitimately ship before every channel label is registered), but they are
 * printed so gaps cannot rot silently.
 *
 * Currently two kinds:
 *  - a model points at a channel label that catalog.channels does not register
 *    (only the DeepSeek, relay and OpenRouter labels are registered today);
 *  - a model carries an Artificial Analysis score without the sample variant it
 *    was measured at (AA scores are effort-variant specific).
 * @param {object} catalog
 * @returns {string[]}
 */
export function collectWarnings(catalog) {
  const warnings = []
  const registry = isObject(catalog && catalog.channels) ? Object.keys(catalog.channels) : []
  const unregistered = new Map()
  const models = Array.isArray(catalog && catalog.models) ? catalog.models : []
  const noteChannel = (name, modelId) => {
    if (typeof name !== 'string' || name.length === 0 || registry.includes(name)) return
    if (!unregistered.has(name)) unregistered.set(name, [])
    unregistered.get(name).push(modelId)
  }
  for (const model of models) {
    if (!isObject(model)) continue
    const channels = isObject(model.channels) ? model.channels : {}
    if (isObject(channels.official)) noteChannel(channels.official.channel, model.id)
    for (const entry of Array.isArray(channels.accountPool) ? channels.accountPool : []) {
      if (isObject(entry)) noteChannel(entry.channel, model.id)
    }
    for (const entry of Array.isArray(channels.relay) ? channels.relay : []) {
      if (isObject(entry)) noteChannel(entry.channel, model.id)
    }
    const quality = isObject(model.quality) ? model.quality : {}
    if (quality.aaIndex !== undefined && quality.aaIndex !== null && quality.aaVariant === undefined) {
      warnings.push('catalog.models(' + show(model.id) + ').quality.aaVariant: missing although aaIndex is ' + show(quality.aaIndex) + ' (AA scores are effort-variant specific)')
    }
  }
  for (const name of [...unregistered.keys()].sort()) {
    const ids = unregistered.get(name)
    const listed = ids.slice(0, 4).map(show).join(', ') + (ids.length > 4 ? ', +' + (ids.length - 4) + ' more' : '')
    warnings.push('catalog.channels: channel ' + show(name) + ' is referenced by ' + ids.length + ' model(s) (' + listed + ') but not registered in catalog.channels')
  }
  return warnings
}

/** Count the fields the catalog deliberately leaves unverified. */
export function unknownStats(catalog) {
  const stats = { models: 0, nullPricingFields: 0, unknownEffortVocab: 0, unknownEffortDefaults: 0, relayUnknownBilling: 0 }
  const models = Array.isArray(catalog.models) ? catalog.models : []
  stats.models = models.length
  for (const model of models) {
    const pricing = model.pricing || {}
    for (const key of ['cacheRead', 'cacheWrite', 'cacheWrite1h']) {
      if (pricing[key] === null) stats.nullPricingFields += 1
    }
    if (Array.isArray(model.effort && model.effort.vocab) && model.effort.vocab.length === 0) stats.unknownEffortVocab += 1
    if (model.effort && (model.effort.default === 'unknown' || model.effort.disable === 'unknown')) stats.unknownEffortDefaults += 1
    for (const entry of (model.channels && model.channels.relay) || []) {
      if (entry.billingMode === 'unknown') stats.relayUnknownBilling += 1
    }
  }
  return stats
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  if (CATALOG === undefined) {
    console.error('check-catalog: lib/catalog.js did not export CATALOG (run: python scripts/build-catalog.py)')
    process.exit(2)
  }
  const errors = validateCatalog(CATALOG)
  const warnings = collectWarnings(CATALOG)
  const stats = unknownStats(CATALOG)
  const channels = Object.keys(CATALOG.channels || {}).length
  const calendar = (CATALOG.calendar || []).length
  if (errors.length > 0) {
    console.error('check-catalog: ' + errors.length + ' problem(s) in ' + stats.models + ' models')
    for (const error of errors) console.error('  - ' + error)
    process.exit(1)
  }
  if (warnings.length > 0) {
    console.log('check-catalog: ' + warnings.length + ' warning(s) - incomplete catalog data, not fatal')
    for (const warning of warnings) console.log('  ! ' + warning)
  }
  console.log(
    'check-catalog: OK - ' + stats.models + ' models, ' + channels + ' channels, ' + calendar + ' calendar entries, ' +
      'schemaVersion ' + CATALOG.schemaVersion + ', evidence ' + CATALOG.evidenceDate
  )
  console.log(
    'check-catalog: unverified-by-design - ' + stats.nullPricingFields + ' null price fields, ' +
      stats.unknownEffortVocab + ' empty effort vocabularies, ' + stats.relayUnknownBilling + ' relay entries with billingMode=unknown'
  )
}
