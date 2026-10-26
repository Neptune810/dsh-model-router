#!/usr/bin/env node
/**
 * Offline replay of recorded decisions (v0.17.0).
 *
 * Telemetry keeps one JSON object per routed step. This script reads those
 * objects, re-runs the scoring and the ladder mapping with the code and the
 * pool you have *now*, and prints the steps whose route or effort would
 * differ. Nothing is sent to a provider and nothing is written.
 *
 *   node lib/replay.js                      # ~/.dsh/storages/model-router
 *   node lib/replay.js --dir <dir> --since 2026-10-20
 *   node lib/replay.js --config router.json --json
 *   node lib/replay.js --fail-on-change     # exit 1 when anything moved
 *
 * What it can and cannot answer: classification needs the prompt text, which
 * telemetry never stores, so the recorded stepClass is taken as given. Presets
 * need the text too, so they are not re-applied (presetName is always null).
 * Everything downstream of (stepClass, config, catalog) is reproducible.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { findModel } from '../lib/catalog.js'
import { normalizeRuntimeConfig } from '../lib/config.js'
import { explainMapping } from '../lib/effort.js'
import { chooseEntry, effortTierForClass, mapEffort } from '../lib/routing.js'

const NL = String.fromCharCode(10)
const MAX_TABLE = 20

function parseArgs(argv) {
  const options = { dir: null, file: null, config: null, since: null, until: null, json: false, quiet: false, failOnChange: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      index += 1
      if (index >= argv.length) throw new Error('missing value after ' + arg)
      return argv[index]
    }
    if (arg === '--dir') options.dir = next()
    else if (arg === '--file') options.file = next()
    else if (arg === '--config') options.config = next()
    else if (arg === '--since') options.since = next()
    else if (arg === '--until') options.until = next()
    else if (arg === '--json') options.json = true
    else if (arg === '--quiet') options.quiet = true
    else if (arg === '--fail-on-change') options.failOnChange = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error('unknown argument ' + arg)
  }
  return options
}

const HELP = [
  'Usage: node lib/replay.js [options]',
  '',
  '  --dir <path>        directory holding decisions*.jsonl (default ~/.dsh/storages/model-router)',
  '  --file <path>       a single jsonl file instead of a directory',
  '  --config <path>     router config JSON to replay against (default: derived from traffic)',
  '  --since <iso|ms>    only decisions at or after this instant',
  '  --until <iso|ms>    only decisions at or before this instant',
  '  --json              machine readable report',
  '  --quiet             only the summary line',
  '  --fail-on-change    exit 1 when any step would route or reason differently',
].join(NL) + NL + NL

function storageDir() {
  const home = process.env.DSH_HOME && String(process.env.DSH_HOME).trim()
  const root = home || join(homedir(), '.dsh')
  return join(root, 'storages', 'model-router')
}

function inputFiles(options) {
  if (options.file) return [resolve(options.file)]
  const dir = options.dir ? resolve(options.dir) : storageDir()
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((name) => /^decisions.*[.]jsonl$/.test(name))
    .sort()
    .map((name) => join(dir, name))
}

function instant(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) throw new Error('cannot read the instant ' + String(value))
  return parsed
}

/** Every decision object in the given files, oldest first. */
function loadDecisions(files, options) {
  const since = instant(options.since, -Infinity)
  const until = instant(options.until, Infinity)
  const decisions = []
  const stats = { files: 0, lines: 0, bad: 0, notDecisions: 0, outsideWindow: 0 }
  for (const file of files) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    stats.files += 1
    for (const line of text.split(NL)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      stats.lines += 1
      let event
      try {
        event = JSON.parse(trimmed)
      } catch {
        stats.bad += 1
        continue
      }
      if (!event || typeof event !== 'object' || !event.chosen || typeof event.chosen !== 'object') {
        stats.notDecisions += 1
        continue
      }
      if (typeof event.chosen.model !== 'string' || !event.chosen.model) {
        stats.notDecisions += 1
        continue
      }
      const ts = Number(event.ts)
      if (!Number.isFinite(ts) || ts < since || ts > until) {
        stats.outsideWindow += 1
        continue
      }
      decisions.push(event)
    }
  }
  decisions.sort((left, right) => Number(left.ts) - Number(right.ts))
  return { decisions, stats }
}

/** The pool the recorded traffic actually used, when no config is supplied. */
function poolFromTraffic(decisions) {
  const seen = new Map()
  for (const event of decisions) {
    const provider = typeof event.chosen.provider === 'string' && event.chosen.provider ? event.chosen.provider : null
    const model = event.chosen.model
    if (!provider) continue
    const id = provider + '/' + model
    if (seen.has(id)) continue
    const tier = event.chosen.tier === 'strong' ? 'strong' : 'cheap'
    const cost = Number.isFinite(Number(event.chosen.cost)) && Number(event.chosen.cost) > 0 ? Number(event.chosen.cost) : 1
    seen.set(id, { id, provider, model, tier, cost })
  }
  return [...seen.values()]
}

function loadConfig(options, decisions) {
  if (!options.config) {
    const pool = poolFromTraffic(decisions)
    return { cfg: normalizeRuntimeConfig({ pool }), source: 'derived from traffic', poolMode: 'traffic', poolSize: pool.length }
  }
  const path = resolve(options.config)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const row = raw && typeof raw === 'object' ? raw : {}
  const cfg = normalizeRuntimeConfig(row)
  return { cfg, source: path, poolMode: Array.isArray(row.pool) ? 'config' : 'model', poolSize: cfg.pool.length }
}

function replayOne(event, cfg) {
  const stepClass = typeof event.stepClass === 'string' && event.stepClass ? event.stepClass : 'standard'
  const signals = { stepClass, escalations: 0, hasImage: false, presetName: null }
  const pick = chooseEntry(cfg.pool, cfg, signals, undefined)
  const wasId = String(event.chosen.provider || '?') + '/' + String(event.chosen.model)
  const nowId = pick ? pick.entry.id : null
  const tier = effortTierForClass(cfg, stepClass)
  const meta = pick ? findModel(pick.entry.provider, pick.entry.model) : null
  const vocab = meta && meta.effort && Array.isArray(meta.effort.vocab) ? meta.effort.vocab : null
  const applied = vocab && vocab.length > 0 ? mapEffort(tier, vocab) : tier
  const mapped = explainMapping(tier, applied, meta)
  const wasEffort = typeof event.chosen.effort === 'string' && event.chosen.effort ? event.chosen.effort : null
  return {
    ts: Number(event.ts),
    stepClass,
    wasId,
    nowId,
    modelChanged: nowId !== null && nowId !== wasId,
    wasEffort,
    nowEffort: applied === undefined ? null : applied,
    effortChanged: wasEffort !== null && applied !== undefined && applied !== null && String(applied) !== wasEffort,
    why: mapped.why,
    pair: mapped.why === 'exact' ? null : mapped.from + '->' + String(mapped.to),
  }
}

function summarise(rows) {
  const summary = {
    steps: rows.length,
    modelChanged: 0,
    effortChanged: 0,
    unchanged: 0,
    unroutable: 0,
    why: { exact: 0, alias: 0, nearest: 0, none: 0 },
    byClass: {},
    pairs: {},
  }
  for (const row of rows) {
    if (row.nowId === null) summary.unroutable += 1
    if (row.modelChanged) summary.modelChanged += 1
    else if (row.effortChanged) summary.effortChanged += 1
    else summary.unchanged += 1
    if (Object.prototype.hasOwnProperty.call(summary.why, row.why)) summary.why[row.why] += 1
    const bucket = summary.byClass[row.stepClass] || { steps: 0, modelChanged: 0, effortChanged: 0 }
    bucket.steps += 1
    if (row.modelChanged) bucket.modelChanged += 1
    if (row.effortChanged) bucket.effortChanged += 1
    summary.byClass[row.stepClass] = bucket
    if (row.pair) summary.pairs[row.pair] = (summary.pairs[row.pair] || 0) + 1
  }
  return summary
}

function topPairs(pairs, limit) {
  return Object.entries(pairs)
    .sort((left, right) => (right[1] - left[1]) || (left[0] < right[0] ? -1 : 1))
    .slice(0, limit)
    .map(([pair, count]) => ({ pair, count }))
}

function stamp(ms) {
  if (!Number.isFinite(ms)) return '?'
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
}

function render(report, options) {
  const lines = []
  const summary = report.summary
  if (!options.quiet) {
    lines.push('model-router replay - ' + new Date(report.now).toISOString())
    lines.push('source   ' + report.source + ' (' + report.stats.files + ' files, ' + report.stats.lines + ' lines, ' + report.stats.notDecisions + ' not decisions, ' + report.stats.bad + ' unreadable, ' + report.stats.outsideWindow + ' outside the window)')
    lines.push('config   ' + report.configSource + ' (pool ' + report.poolMode + ', ' + report.poolSize + ' entries)')
    lines.push('window   ' + stamp(report.window.since) + ' .. ' + stamp(report.window.until))
    lines.push('steps    ' + summary.steps + '   same model ' + (summary.steps - summary.modelChanged) + '   same effort ' + (summary.steps - summary.effortChanged))
    if (summary.unroutable > 0) lines.push('WARNING  ' + summary.unroutable + ' steps have no routable entry in this pool')
    lines.push('effort   exact ' + summary.why.exact + ' · alias ' + summary.why.alias + ' · nearest ' + summary.why.nearest + ' · none ' + summary.why.none)
    for (const [stepClass, bucket] of Object.entries(summary.byClass).sort()) {
      lines.push('  ' + stepClass.padEnd(12) + ' steps ' + bucket.steps + ' · model ' + bucket.modelChanged + ' · effort ' + bucket.effortChanged)
    }
    const changed = report.rows.filter((row) => row.modelChanged || row.effortChanged)
    if (changed.length > 0) {
      lines.push('')
      lines.push('changed steps (first ' + Math.min(changed.length, MAX_TABLE) + ' of ' + changed.length + '):')
      for (const row of changed.slice(0, MAX_TABLE)) {
        const move = row.modelChanged
          ? 'model ' + row.wasId + ' -> ' + row.nowId
          : 'effort ' + String(row.wasEffort) + ' -> ' + String(row.nowEffort)
        lines.push('  ' + stamp(row.ts) + '  ' + row.stepClass.padEnd(12) + ' ' + move)
      }
    }
    const pairs = topPairs(summary.pairs, 8)
    if (pairs.length > 0) {
      lines.push('')
      lines.push('ladder collapses:')
      for (const entry of pairs) lines.push('  ' + entry.pair + ' x' + entry.count)
    }
  }
  lines.push('replay: ' + summary.steps + ' steps, ' + summary.modelChanged + ' model changes, ' + summary.effortChanged + ' effort changes, ' + summary.unchanged + ' unchanged')
  return lines.join(NL)
}

export function replay(options) {
  const files = inputFiles(options)
  const { decisions, stats } = loadDecisions(files, options)
  const loaded = loadConfig(options, decisions)
  const rows = decisions.map((event) => replayOne(event, loaded.cfg))
  return {
    now: Date.now(),
    source: options.file ? resolve(options.file) : (options.dir ? resolve(options.dir) : storageDir()),
    files,
    stats,
    configSource: loaded.source,
    poolMode: loaded.poolMode,
    poolSize: loaded.poolSize,
    window: { since: instant(options.since, rows.length > 0 ? rows[0].ts : NaN), until: instant(options.until, rows.length > 0 ? rows[rows.length - 1].ts : NaN) },
    summary: summarise(rows),
    rows,
  }
}

function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    process.stderr.write(String(error.message) + NL)
    return 2
  }
  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }
  let report
  try {
    report = replay(options)
  } catch (error) {
    process.stderr.write('replay: ' + String(error && error.message ? error.message : error) + NL)
    return 2
  }
  if (report.stats.files === 0 && (options.file || options.dir)) {
    process.stderr.write('replay: no decisions*.jsonl found in ' + report.source + NL)
    return 2
  }
  if (options.json) {
    const payload = { ...report, rows: report.rows }
    delete payload.files
    process.stdout.write(JSON.stringify(payload, null, 2) + NL)
  } else {
    process.stdout.write(render(report, options) + NL)
  }
  if (options.failOnChange && (report.summary.modelChanged > 0 || report.summary.effortChanged > 0)) return 1
  return 0
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
if (isMain || process.env.REPLAY_FORCE_MAIN === '1') process.exitCode = main(process.argv.slice(2))
