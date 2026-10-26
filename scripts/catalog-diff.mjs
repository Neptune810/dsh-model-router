#!/usr/bin/env node
// Read-only catalog drift report for model-router.
//
// Compares the committed catalog projection (lib/catalog.js) with the live
// OpenRouter models API and writes a markdown report for maintainers. This
// script never edits catalog/model-catalog.yaml nor lib/catalog.js: a human
// reviews the report and updates the catalog by hand.
//
// Usage:
//   node scripts/catalog-diff.mjs [--out <path>] [--now YYYY-MM-DD] [--days N]
//     [--offline <json>] [--json] [--quiet] [--fail-on-drift]
//
// Exit codes: 0 success (drift is advisory), 1 drift when --fail-on-drift is
// set, 2 internal error (bad arguments, unreadable offline snapshot).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CATALOG, findModel } from '../lib/catalog.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_OUT = resolve(REPO_ROOT, 'catalog-pending.diff.md')
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const NL = String.fromCharCode(10)
const DAY_MS = 24 * 60 * 60 * 1000
const PRICE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite']
const PRICE_KEYS = {
  input: 'prompt',
  output: 'completion',
  cacheRead: 'input_cache_read',
  cacheWrite: 'input_cache_write',
}
const PRICE_THRESHOLD = 10
const DEFAULT_DAYS = 45

// OpenRouter provider prefix -> catalog provider. OpenRouter prefixes differ
// from catalog provider ids for x-ai/xai and z-ai/zhipu; meta is mapped because
// the catalog also tracks a meta model.
const PROVIDER_BY_PREFIX = {
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  google: 'google',
  meta: 'meta',
  minimax: 'minimax',
  moonshotai: 'moonshot',
  openai: 'openai',
  qwen: 'alibaba',
  'x-ai': 'xai',
  xai: 'xai',
  'z-ai': 'zhipu',
  zhipu: 'zhipu',
}

/**
 * Parse an OpenRouter /models payload into per-million-token USD prices.
 *
 * OpenRouter quotes USD strings per token. Some models also publish time-window
 * overrides (DeepSeek peak/off-peak schedules); the catalog records the peak
 * price for those, so time-window overrides participate through a max() while
 * long-context tier overrides (min_prompt_tokens) are ignored because the
 * catalog tracks those separately in pricing.longContext.
 *
 * @param {unknown} payload Raw OpenRouter response or a bare array of models.
 * @returns {{id: string, contextLength: number|null, pricing: {input: number|null, output: number|null, cacheRead: number|null, cacheWrite: number|null}}[]} Normalised models.
 */
export function parseOpenRouterPayload (payload) {
  let entries = null
  if (Array.isArray(payload)) entries = payload
  else if (payload !== null && typeof payload === 'object' && Array.isArray(payload.data)) entries = payload.data
  if (entries === null) throw new Error('invalid OpenRouter payload: expected an object with a data array or an array')
  const normalized = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    if (typeof entry.id !== 'string' || entry.id.length === 0) continue
    const pricing = {}
    for (const field of PRICE_FIELDS) {
      pricing[field] = peakPrice(entry.pricing, field)
    }
    normalized.push({
      id: entry.id,
      contextLength: toFiniteNumber(entry.context_length),
      pricing,
    })
  }
  return normalized
}

function peakPrice (pricing, field) {
  if (pricing === null || pricing === undefined || typeof pricing !== 'object') return null
  const key = PRICE_KEYS[field]
  const values = []
  const base = perMillion(pricing[key])
  if (base !== null) values.push(base)
  const overrides = Array.isArray(pricing.overrides) ? pricing.overrides : []
  for (const override of overrides) {
    if (override === null || typeof override !== 'object') continue
    if (Object.prototype.hasOwnProperty.call(override, 'min_prompt_tokens')) continue
    const value = perMillion(override[key])
    if (value !== null) values.push(value)
  }
  if (values.length === 0) return null
  return Math.max(...values)
}

function perMillion (value) {
  if (value === null || value === undefined) return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.round(number * 1e12) / 1e6
}

function toFiniteNumber (value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function toCatalogPrice (value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function normalizeUpstream (upstream) {
  if (Array.isArray(upstream)) {
    if (upstream.length === 0) return []
    const first = upstream[0]
    const looksNormalized = first !== null && typeof first === 'object' &&
      typeof first.id === 'string' &&
      Object.prototype.hasOwnProperty.call(first, 'contextLength') &&
      Object.prototype.hasOwnProperty.call(first, 'pricing')
    if (looksNormalized) return upstream
    return parseOpenRouterPayload(upstream)
  }
  return parseOpenRouterPayload(upstream)
}

function isIsoDate (value) {
  if (typeof value !== 'string' || value.length !== 10) return false
  if (value[4] !== '-' || value[7] !== '-') return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function todayIso () {
  return new Date().toISOString().slice(0, 10)
}

function utcMs (isoDate) {
  return Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)))
}

function daysBetween (fromIso, toIso) {
  return Math.round((utcMs(toIso) - utcMs(fromIso)) / DAY_MS)
}

function normalizeDays (value) {
  const days = Number(value)
  if (!Number.isInteger(days) || days < 0) throw new Error('invalid --days value: ' + String(value))
  return days
}

/**
 * Compare a catalog projection with an upstream models payload.
 *
 * Calendar entries inside the window are informational only and never count as
 * drift. When the source is unavailable the comparison lists stay empty so a
 * failed fetch cannot masquerade as mass retirement.
 *
 * @param {{models?: object[], calendar?: object[], watchlist?: object[]}} catalog Catalog projection to compare.
 * @param {unknown} upstream Raw OpenRouter payload or an already parsed array.
 * @param {{now?: string, days?: number, mode?: string, sourceStatus?: string, sourceError?: string}} [options] Comparison options.
 * @returns {object} Structured drift report.
 */
export function diffCatalog (catalog, upstream, options) {
  const opts = options === undefined || options === null ? {} : options
  const now = opts.now === undefined || opts.now === null ? todayIso() : opts.now
  if (!isIsoDate(now)) throw new Error('invalid date (expected YYYY-MM-DD): ' + String(now))
  const days = opts.days === undefined || opts.days === null ? DEFAULT_DAYS : normalizeDays(opts.days)
  const models = catalog !== null && typeof catalog === 'object' && Array.isArray(catalog.models) ? catalog.models : []
  const normalized = normalizeUpstream(upstream)
  const upstreamById = new Map()
  for (const entry of normalized) upstreamById.set(entry.id, entry)
  const sourceStatus = opts.sourceStatus || 'ok'
  const source = {
    status: sourceStatus,
    mode: opts.mode || 'live',
    models: normalized.length,
  }
  if (opts.sourceError) source.error = String(opts.sourceError)
  const priceChanges = []
  const contextChanges = []
  const missingUpstream = []
  const newUpstream = []
  if (sourceStatus === 'ok') {
    for (const model of models) {
      if (model === null || typeof model !== 'object') continue
      const channels = model.channels !== null && typeof model.channels === 'object' ? model.channels : {}
      const openrouterId = typeof channels.openrouterId === 'string' && channels.openrouterId.length > 0 ? channels.openrouterId : null
      if (openrouterId === null) continue
      const live = upstreamById.get(openrouterId)
      if (live === undefined) {
        missingUpstream.push({ model: model.id, openrouterId })
        continue
      }
      const catalogPrices = channels.openrouterPriceUsd !== null && typeof channels.openrouterPriceUsd === 'object' ? channels.openrouterPriceUsd : {}
      for (const field of PRICE_FIELDS) {
        const oldPrice = toCatalogPrice(catalogPrices[field])
        const newPrice = live.pricing !== null && typeof live.pricing === 'object' ? toCatalogPrice(live.pricing[field]) : null
        if (oldPrice === null || newPrice === null || oldPrice === newPrice) continue
        if (oldPrice === 0) {
          priceChanges.push({ model: model.id, openrouterId, field, old: oldPrice, new: newPrice, percent: null })
          continue
        }
        const percent = Math.round(((newPrice - oldPrice) / oldPrice) * 1000) / 10
        if (Math.abs(percent) > PRICE_THRESHOLD) {
          priceChanges.push({ model: model.id, openrouterId, field, old: oldPrice, new: newPrice, percent })
        }
      }
      if (typeof model.contextWindow === 'number' && live.contextLength !== null && model.contextWindow !== live.contextLength) {
        contextChanges.push({ model: model.id, openrouterId, old: model.contextWindow, new: live.contextLength })
      }
    }
    const providerSet = new Set()
    const knownIds = new Set()
    for (const model of models) {
      if (model === null || typeof model !== 'object') continue
      if (typeof model.provider === 'string') providerSet.add(model.provider)
      if (typeof model.id === 'string') knownIds.add(model.id)
      const channels = model.channels !== null && typeof model.channels === 'object' ? model.channels : {}
      if (typeof channels.openrouterId === 'string') knownIds.add(channels.openrouterId)
    }
    for (const entry of normalized) {
      if (knownIds.has(entry.id) || findModel(entry.id) !== undefined) continue
      const slash = entry.id.indexOf('/')
      if (slash === -1) continue
      const provider = PROVIDER_BY_PREFIX[entry.id.slice(0, slash)]
      if (provider === undefined || !providerSet.has(provider)) continue
      newUpstream.push({
        id: entry.id,
        provider,
        contextLength: entry.contextLength,
        pricing: entry.pricing,
      })
    }
    newUpstream.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  }
  const calendar = collectCalendarDue(catalog, now, days)
  const summary = {
    price: priceChanges.length,
    context: contextChanges.length,
    missing: missingUpstream.length,
    new: newUpstream.length,
    calendar: calendar.length,
    drift: priceChanges.length + contextChanges.length + missingUpstream.length + newUpstream.length > 0,
  }
  return {
    now,
    days,
    threshold: PRICE_THRESHOLD,
    source,
    summary,
    drift: summary.drift,
    priceChanges,
    contextChanges,
    missingUpstream,
    newUpstream,
    calendar,
  }
}

function collectCalendarDue (catalog, now, days) {
  const due = []
  const containers = [
    { origin: 'calendar', entries: catalog !== null && typeof catalog === 'object' && Array.isArray(catalog.calendar) ? catalog.calendar : [] },
    { origin: 'watchlist', entries: catalog !== null && typeof catalog === 'object' && Array.isArray(catalog.watchlist) ? catalog.watchlist : [] },
  ]
  for (const container of containers) {
    for (const entry of container.entries) {
      if (entry === null || typeof entry !== 'object') continue
      if (!isIsoDate(entry.date)) continue
      const daysLeft = daysBetween(now, entry.date)
      if (Math.abs(daysLeft) > days) continue
      due.push({
        origin: container.origin,
        date: entry.date,
        daysLeft,
        type: typeof entry.type === 'string' ? entry.type : container.origin,
        description: typeof entry.description === 'string' ? entry.description : '',
        models: Array.isArray(entry.models) ? entry.models.slice() : [],
      })
    }
  }
  due.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0))
  return due
}

function formatUsd (value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a'
  return String(Math.round(value * 1e6) / 1e6)
}

function formatPercent (value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a'
  return (value > 0 ? '+' : '') + String(value) + '%'
}

function formatDays (daysLeft) {
  if (daysLeft === 0) return 'today'
  if (daysLeft > 0) return 'in ' + String(daysLeft) + ' days'
  return String(-daysLeft) + ' days ago'
}

function formatCell (value) {
  const text = value === null || value === undefined ? '' : String(value)
  return text.split('|').join('/')
}

/**
 * Render a drift report as markdown.
 *
 * The output is path-free so it is safe to append to a CI job summary or upload
 * as a public artifact.
 *
 * @param {object} report Report produced by diffCatalog.
 * @returns {string} Markdown document.
 */
export function renderMarkdown (report) {
  const lines = []
  lines.push('# Catalog drift report')
  lines.push('')
  lines.push('Read-only advisory report generated by scripts/catalog-diff.mjs. It never edits catalog/model-catalog.yaml; a maintainer reviews it and updates the catalog projection by hand.')
  lines.push('')
  lines.push('- Reference date: ' + report.now)
  lines.push('- Calendar window: +/- ' + String(report.days) + ' days')
  lines.push('- Price threshold: more than ' + String(report.threshold) + '% per field')
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  if (report.source !== null && typeof report.source === 'object' && report.source.status !== 'ok') {
    lines.push('Upstream source unavailable, so no comparison was performed; see the Source health section.')
  } else if (report.drift) {
    lines.push('Drift detected: ' + String(report.summary.price) + ' price change(s), ' + String(report.summary.context) + ' context change(s), ' + String(report.summary.missing) + ' missing upstream model(s), ' + String(report.summary.new) + ' new upstream model(s).')
  } else {
    lines.push('No drift detected in the compared fields.')
  }
  lines.push('')
  lines.push('| Signal | Count |')
  lines.push('| --- | --- |')
  lines.push('| Price changes (more than ' + String(report.threshold) + '%) | ' + String(report.summary.price) + ' |')
  lines.push('| Context changes | ' + String(report.summary.context) + ' |')
  lines.push('| Missing upstream models | ' + String(report.summary.missing) + ' |')
  lines.push('| New upstream models | ' + String(report.summary.new) + ' |')
  lines.push('| Calendar entries due | ' + String(report.summary.calendar) + ' |')
  lines.push('')
  lines.push('## Price changes')
  lines.push('')
  if (report.priceChanges.length === 0) {
    lines.push('None.')
  } else {
    lines.push('| Model | OpenRouter id | Field | Catalog (USD / 1M) | Upstream (USD / 1M) | Change |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const change of report.priceChanges) {
      lines.push('| ' + formatCell(change.model) + ' | ' + formatCell(change.openrouterId) + ' | ' + formatCell(change.field) + ' | ' + formatUsd(change.old) + ' | ' + formatUsd(change.new) + ' | ' + formatPercent(change.percent) + ' |')
    }
  }
  lines.push('')
  lines.push('## Context changes')
  lines.push('')
  if (report.contextChanges.length === 0) {
    lines.push('None.')
  } else {
    lines.push('| Model | OpenRouter id | Catalog contextWindow | Upstream context_length |')
    lines.push('| --- | --- | --- | --- |')
    for (const change of report.contextChanges) {
      lines.push('| ' + formatCell(change.model) + ' | ' + formatCell(change.openrouterId) + ' | ' + formatCell(change.old) + ' | ' + formatCell(change.new) + ' |')
    }
  }
  lines.push('')
  lines.push('## Missing upstream')
  lines.push('')
  if (report.missingUpstream.length === 0) {
    lines.push('None.')
  } else {
    lines.push('Catalog models with an OpenRouter id that no longer appears upstream (retirement risk):')
    lines.push('')
    lines.push('| Model | OpenRouter id |')
    lines.push('| --- | --- |')
    for (const missing of report.missingUpstream) {
      lines.push('| ' + formatCell(missing.model) + ' | ' + formatCell(missing.openrouterId) + ' |')
    }
  }
  lines.push('')
  lines.push('## New upstream models')
  lines.push('')
  if (report.newUpstream.length === 0) {
    lines.push('None.')
  } else {
    lines.push('Upstream models for providers already tracked in the catalog:')
    lines.push('')
    lines.push('| Model id | Catalog provider | Context length | Input (USD / 1M) | Output (USD / 1M) |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const model of report.newUpstream) {
      lines.push('| ' + formatCell(model.id) + ' | ' + formatCell(model.provider) + ' | ' + formatCell(model.contextLength) + ' | ' + formatUsd(model.pricing.input) + ' | ' + formatUsd(model.pricing.output) + ' |')
    }
  }
  lines.push('')
  lines.push('## Calendar due')
  lines.push('')
  if (report.calendar.length === 0) {
    lines.push('None within the window.')
  } else {
    lines.push('| Date | When | Source | Type | Description | Models |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const entry of report.calendar) {
      lines.push('| ' + formatCell(entry.date) + ' | ' + formatDays(entry.daysLeft) + ' | ' + formatCell(entry.origin) + ' | ' + formatCell(entry.type) + ' | ' + formatCell(entry.description) + ' | ' + formatCell(entry.models.join(', ')) + ' |')
    }
  }
  lines.push('')
  lines.push('## Source health')
  lines.push('')
  lines.push('- Mode: ' + (report.source.mode === 'offline' ? 'offline snapshot' : 'live network'))
  lines.push('- Status: ' + formatCell(report.source.status))
  lines.push('- Upstream models seen: ' + String(report.source.models))
  if (report.source.error) lines.push('- Error: ' + formatCell(report.source.error))
  lines.push('')
  return lines.join(NL)
}

function usage () {
  return [
    'Usage: node scripts/catalog-diff.mjs [options]',
    '',
    'Compare the committed catalog projection with the OpenRouter models API and write a',
    'markdown drift report. Read-only: catalog/model-catalog.yaml is never modified.',
    '',
    'Options:',
    '  --out <path>        Report path (default: catalog-pending.diff.md at the repo root)',
    '  --now YYYY-MM-DD    Reference date for the calendar window (default: today)',
    '  --days <n>          Calendar window in days around --now (default: 45)',
    '  --offline <json>    Saved OpenRouter /models response instead of the network',
    '  --json              Also print the structured report as JSON on stdout',
    '  --quiet             Suppress the console summary line',
    '  --fail-on-drift     Exit 1 when drift is detected (default: advisory exit 0)',
    '  --help              Show this help',
  ].join(NL)
}

function parseArgs (argv) {
  const options = {
    out: null,
    now: null,
    days: null,
    offline: null,
    json: false,
    quiet: false,
    failOnDrift: false,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--quiet') {
      options.quiet = true
      continue
    }
    if (arg === '--fail-on-drift') {
      options.failOnDrift = true
      continue
    }
    if (arg === '--out' || arg === '--now' || arg === '--days' || arg === '--offline') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('missing value for ' + arg)
      index += 1
      if (arg === '--out') options.out = value
      else if (arg === '--now') options.now = value
      else if (arg === '--days') options.days = value
      else options.offline = value
      continue
    }
    throw new Error('unknown argument: ' + String(arg))
  }
  return options
}

function describeError (error) {
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error)
}

async function loadUpstream (options) {
  if (options.offline !== null) {
    const path = isAbsolute(options.offline) ? options.offline : resolve(process.cwd(), options.offline)
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch (error) {
      throw new Error('cannot read offline snapshot: ' + describeError(error))
    }
    try {
      return { payload: JSON.parse(text), mode: 'offline', error: null }
    } catch (error) {
      throw new Error('cannot parse offline snapshot JSON: ' + describeError(error))
    }
  }
  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) throw new Error('OpenRouter responded with HTTP ' + String(response.status))
    return { payload: await response.json(), mode: 'live', error: null }
  } catch (error) {
    return { payload: { data: [] }, mode: 'live', error: describeError(error) }
  }
}

async function main (argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error('catalog-diff: ' + describeError(error))
    console.error(usage())
    return 2
  }
  if (options.help) {
    console.log(usage())
    return 0
  }
  let loaded
  try {
    loaded = await loadUpstream(options)
  } catch (error) {
    console.error('catalog-diff: ' + describeError(error))
    return 2
  }
  let report
  try {
    report = diffCatalog(CATALOG, loaded.payload, {
      now: options.now === null ? undefined : options.now,
      days: options.days === null ? undefined : options.days,
      mode: loaded.mode,
      sourceStatus: loaded.error === null ? 'ok' : 'error',
      sourceError: loaded.error === null ? undefined : loaded.error,
    })
  } catch (error) {
    console.error('catalog-diff: ' + describeError(error))
    return 2
  }
  const markdown = renderMarkdown(report)
  const outPath = options.out === null ? DEFAULT_OUT : resolve(process.cwd(), options.out)
  try {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, markdown, 'utf8')
  } catch (error) {
    console.error('catalog-diff: cannot write report: ' + describeError(error))
    return 2
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else if (!options.quiet) {
    const state = report.source.status === 'ok' ? (report.drift ? 'drift detected' : 'no drift') : 'upstream source unavailable'
    console.log('catalog-diff: ' + state + '; report written to ' + outPath)
  }
  if (options.failOnDrift && report.drift) return 1
  return 0
}

if (process.argv[1] !== undefined && process.argv[1].length > 0 && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error('catalog-diff: ' + describeError(error))
    process.exitCode = 2
  })
}
