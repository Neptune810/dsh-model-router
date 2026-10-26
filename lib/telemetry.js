/**
 * dsh-model-router — persisted decision telemetry.
 *
 * Every routed step is appended to a monthly JSONL file (`decisions-YYYY-MM.jsonl`)
 * so cost/effort questions can be answered from data instead of a 20-entry
 * in-memory ring that dies on restart. The store is passive: it does not validate
 * or rewrite the host's event (it only stamps `v` when absent and normalizes a
 * numeric `ts` to an ISO string), serializes each event exactly once, and never
 * holds the caller's object reference.
 *
 * Writes happen off the caller's stack: events written in one tick coalesce into
 * one queued batch and one append per target file. A batch that would cross
 * `maxBytes` is appended and the now-full file is rotated to
 * `decisions-YYYY-MM-<seq>.jsonl`; the next write starts a fresh current file.
 * The first write failure is reported through `onError` once, disables the store
 * for the process and leaves `health().lastError` behind — nothing in here ever
 * throws. Paths are the directory's business; the module adds no event fields,
 * so prompt/message text and absolute paths never enter a record unless the host
 * put them there itself.
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { effortSummary } from './effort.js'

/** On-disk event schema version stamped onto events that omit `v`. */
export const TELEMETRY_VERSION = 1

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const READ_LIMIT = 50000
const RECENT_LIMIT = 20
/** Only the tail of the active file is needed for the synchronous replay reader. */
const TAIL_BYTES = 256 * 1024
const WEEK_MS = 7 * 24 * 3600 * 1000
const STRONG_TIER = 'strong'
const ESCALATION_MARK = 'escalated on evidence'
/** The five token counters a priced decision records in `usage.split`. */
const SPLIT_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']
const FILE_RE = /^decisions-(\d{4})-(\d{2})(?:-(\d+))?\.jsonl$/

/** Only actual plain objects are accepted as events. */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Accept epoch milliseconds (and, leniently, ISO strings / Date) as ms. */
function toMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : undefined
  }
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : undefined
  }
  return undefined
}

/** `YYYY-MM` (UTC) for a lookback fallback used when an event carries no ts. */
function monthOf(ms) {
  const date = new Date(ms)
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0')
}

/** Month file an event belongs to: its own ts, else the injected clock. */
function monthFor(ts, fallbackMs) {
  const ms = toMs(ts)
  return monthOf(ms === undefined ? fallbackMs : ms)
}

/** Round for display-friendly stats without float noise. */
function roundTo(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Token split and USD cost carried by one event's `usage` block. Events recorded
 * before 0.15.1 have no split/costUsd: they contribute zero tokens and count as
 * unpriced, so a summary over mixed old/new JSONL stays honest instead of
 * pretending the old steps were free.
 *
 * @param {object|undefined} usage
 * @returns {{tokens:number,inputTokens:number,outputTokens:number,cacheReadTokens:number,
 *   cacheWriteTokens:number,reasoningTokens:number,costUsd:number,priced:boolean}}
 */
function usageLedger(usage) {
  const ledger = {
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    priced: false,
  }
  if (!isPlainObject(usage)) return ledger
  const split = usage.split
  if (isPlainObject(split)) {
    for (const key of SPLIT_KEYS) {
      const value = split[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      ledger[key + 'Tokens'] += value
      ledger.tokens += value
    }
  }
  if (typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)) {
    ledger.costUsd = usage.costUsd
    ledger.priced = true
  }
  return ledger
}

/** Telemetry files in the directory, chronologically ordered (current file last). */
function listTelemetryFiles(dir) {
  let names
  try {
    names = readdirSync(dir)
  } catch (_ignore) {
    return []
  }
  const files = []
  for (const name of names) {
    const match = FILE_RE.exec(name)
    if (!match) continue
    files.push({
      name,
      month: match[1] + '-' + match[2],
      // A rotated file has a seq; the plain current file is always the newest.
      seq: match[3] === undefined ? Infinity : Number(match[3]),
    })
  }
  files.sort((a, b) => {
    if (a.month !== b.month) return a.month < b.month ? -1 : 1
    return a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0
  })
  return files
}

/** Parse the last `maxBytes` of one JSONL file. Never throws. */
function readTailEvents(file, maxBytes = TAIL_BYTES) {
  let fd
  try {
    fd = openSync(file, 'r')
    const size = fstatSync(fd).size
    const start = size > maxBytes ? size - maxBytes : 0
    const length = size - start
    const buffer = Buffer.alloc(length)
    if (length > 0) readSync(fd, buffer, 0, length, start)
    let text = buffer.toString('utf8')
    if (start > 0) {
      // The tail may begin mid-line; drop the partial first line.
      const newline = text.indexOf('\n')
      text = newline === -1 ? '' : text.slice(newline + 1)
    }
    const events = []
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch (_ignore) {
        continue
      }
      if (isPlainObject(parsed)) events.push(parsed)
    }
    return events
  } catch (_ignore) {
    return []
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch (_ignore) {
        /* advisory */
      }
    }
  }
}

/**
 * Open the decision store. Never throws: an unavailable directory or a failing
 * disk is reported through `onError` (once) and `health()`, and the store either
 * becomes a no-op or disables itself.
 *
 * @param {object} [options]
 * @param {string} [options.dir] absolute directory; created lazily on first write
 * @param {number} [options.maxBytes] rotate the current file above this size (default 8 MiB)
 * @param {boolean} [options.enabled] false makes the store a read-only no-op
 * @param {() => number} [options.now] clock injection (default Date.now)
 * @param {(error: {at:number, code:string|null, message:string}) => void} [options.onError]
 *   called at most once, for the first write failure; never throws
 */
export function createTelemetry(options = {}) {
  const opts = isPlainObject(options) ? options : {}
  const dir = typeof opts.dir === 'string' ? opts.dir : ''
  const maxBytes = typeof opts.maxBytes === 'number' && Number.isFinite(opts.maxBytes) && opts.maxBytes > 0
    ? Math.floor(opts.maxBytes)
    : DEFAULT_MAX_BYTES
  const now = typeof opts.now === 'function' ? opts.now : Date.now
  const onError = typeof opts.onError === 'function' ? opts.onError : null

  let enabled = opts.enabled !== false && dir.length > 0
  let lastError = null
  let written = 0
  /** Events serialized and queued for the next flush: `[{ month, line }]`. */
  let pending = []
  let pendingBytes = 0
  let scheduled = null

  // Current-file sizes are tracked per month so the rotation check needs no stat
  // on every batch; an unknown file size is read once from disk.
  const sizes = new Map()
  const fileName = (month) => join(dir, 'decisions-' + month + '.jsonl')
  const sizeOf = (month) => {
    if (sizes.has(month)) return sizes.get(month)
    let size = 0
    try {
      size = statSync(fileName(month)).size
    } catch (_ignore) {
      size = 0
    }
    sizes.set(month, size)
    return size
  }

  /** Move the current month file aside to the first free seq for that month. */
  const rotate = (month) => {
    const base = join(dir, 'decisions-' + month)
    let seq = 1
    while (existsSync(base + '-' + seq + '.jsonl')) seq += 1
    renameSync(base + '.jsonl', base + '-' + seq + '.jsonl')
    sizes.set(month, 0)
  }

  /** Record the first write failure, notify once, and go silent. Never throws. */
  const fail = (error) => {
    if (!enabled) return
    enabled = false
    pending = []
    pendingBytes = 0
    if (scheduled !== null) {
      clearImmediate(scheduled)
      scheduled = null
    }
    lastError = {
      at: now(),
      code: (error && error.code) || null,
      message: String((error && error.message) || error),
    }
    if (onError) {
      try {
        onError({ ...lastError })
      } catch (_ignore) {
        /* advisory */
      }
    }
  }

  /** Append the queued batch, one append per contiguous month run. Never throws. */
  const flushNow = () => {
    if (!enabled || pending.length === 0) {
      pending = []
      pendingBytes = 0
      return
    }
    const batch = pending
    pending = []
    pendingBytes = 0
    let index = 0
    try {
      while (index < batch.length) {
        const month = batch[index].month
        const parts = []
        let chunkBytes = 0
        while (index < batch.length && batch[index].month === month) {
          parts.push(batch[index].line)
          chunkBytes += Buffer.byteLength(batch[index].line) + 1
          index += 1
        }
        mkdirSync(dir, { recursive: true })
        const before = sizeOf(month)
        appendFileSync(fileName(month), parts.join('\n') + '\n', 'utf8')
        written += parts.length
        if (before > 0 && before + chunkBytes > maxBytes) {
          // This batch crossed the cap: append it, then rotate the full file.
          rotate(month)
        } else {
          sizes.set(month, before + chunkBytes)
        }
      }
    } catch (error) {
      fail(error)
    }
  }

  const schedule = () => {
    if (scheduled !== null || !enabled) return
    scheduled = setImmediate(() => {
      scheduled = null
      flushNow()
    })
  }

  /**
   * Queue one decision for persistence. The event is serialized immediately (the
   * caller's object is never retained or mutated); the write itself happens on
   * the next tick. Returns true when the event was accepted for flush.
   */
  const writeDecision = (event) => {
    if (!enabled || !isPlainObject(event)) return false
    const record = { ...event }
    if (record.v === undefined) record.v = TELEMETRY_VERSION
    if (typeof record.ts === 'number') {
      const date = new Date(record.ts)
      record.ts = Number.isNaN(date.getTime()) ? record.ts : date.toISOString()
    }
    let line
    try {
      line = JSON.stringify(record)
    } catch (_ignore) {
      return false
    }
    if (typeof line !== 'string') return false
    pending.push({ month: monthFor(record.ts, now()), line })
    pendingBytes += Buffer.byteLength(line) + 1
    schedule()
    return true
  }

  /** Await the pending batch (tests and shutdown). Never rejects. */
  const flush = async () => {
    if (scheduled !== null) {
      clearImmediate(scheduled)
      scheduled = null
    }
    flushNow()
  }

  /**
   * Read persisted decisions, oldest first. Corrupt lines and unreadable files
   * are skipped; a missing directory yields [].
   */
  const readDecisions = async (readOptions = {}) => {
    const readOpts = isPlainObject(readOptions) ? readOptions : {}
    const since = toMs(readOpts.since)
    const until = toMs(readOpts.until)
    const requested = typeof readOpts.limit === 'number' && Number.isFinite(readOpts.limit)
      ? Math.max(0, Math.floor(readOpts.limit))
      : READ_LIMIT
    const events = []
    if (!dir || requested === 0) return events
    const files = listTelemetryFiles(dir)
    for (const file of files) {
      if (events.length >= requested) break
      let raw
      try {
        raw = readFileSync(join(dir, file.name), 'utf8')
      } catch (_ignore) {
        continue
      }
      for (const text of raw.split('\n')) {
        if (events.length >= requested) break
        if (text.length === 0) continue
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch (_ignore) {
          continue
        }
        if (!isPlainObject(parsed)) continue
        const ts = toMs(parsed.ts)
        if (since !== undefined && (ts === undefined || ts < since)) continue
        if (until !== undefined && (ts === undefined || ts >= until)) continue
        events.push({ event: parsed, ts })
      }
    }
    // Files are in write order, but events may carry out-of-order ts: sort stable.
    events.sort((a, b) => {
      if (a.ts === undefined) return b.ts === undefined ? 0 : 1
      if (b.ts === undefined) return -1
      return a.ts - b.ts
    })
    return events.map((entry) => entry.event)
  }

  /**
   * Synchronous tail read for the host's /router replay command. Returns the
   * newest `limit` parseable decisions of the active file, oldest first (newest
   * last), reading only the last ~256 KiB. Never throws; [] on any error.
   */
  const readRecentSync = (limit = RECENT_LIMIT) => {
    try {
      const cap = typeof limit === 'number' && Number.isFinite(limit)
        ? Math.max(0, Math.floor(limit))
        : RECENT_LIMIT
      if (cap === 0) return []
      const files = listTelemetryFiles(dir)
      if (files.length === 0) return []
      const events = readTailEvents(join(dir, files[files.length - 1].name))
      return events.length > cap ? events.slice(events.length - cap) : events
    } catch (_ignore) {
      return []
    }
  }

  /**
   * Aggregate decisions over a window. Defaults: until = now, since = until - 7d.
   * The shape is fixed even with zero events.
   *
   * Rows and totals carry the score/cost aggregates plus a usage ledger summed
   * from `usage.split` (total tokens and the five per-key counters; zero for
   * events recorded before splits existed) and `usage.costUsd` (summed only for
   * steps that carry a finite USD price; every other step counts as
   * `unpricedSteps`). Tokens are integers and USD rounds to 6 decimals so the
   * panel never shows float noise.
   */
  /**
   * The cost-aware decision an 0.16.0 shadow recorded next to the applied one,
   * or null for an event without a shadow (cost awareness already on, or a pool
   * the catalog cannot price). Kept out of the ledgers: it is a hypothetical,
   * not a cost that was paid.
   *
   * @param {object|undefined} event
   */
  function shadowLedger(event) {
    const shadow = isPlainObject(event) && isPlainObject(event.shadow) ? event.shadow : null
    if (!shadow) return null
    const current = typeof shadow.currentStepUsd === 'number' && Number.isFinite(shadow.currentStepUsd) ? shadow.currentStepUsd : null
    const candidate = typeof shadow.candidateStepUsd === 'number' && Number.isFinite(shadow.candidateStepUsd) ? shadow.candidateStepUsd : null
    return {
      agree: shadow.agree === true,
      current,
      candidate,
      currentId: typeof shadow.current === 'string' ? shadow.current : null,
      candidateId: typeof shadow.candidate === 'string' ? shadow.candidate : null,
    }
  }

  const summarize = async (summaryOptions = {}) => {
    const summaryOpts = isPlainObject(summaryOptions) ? summaryOptions : {}
    const requestedUntil = toMs(summaryOpts.until)
    const until = requestedUntil === undefined ? now() : requestedUntil
    const requestedSince = toMs(summaryOpts.since)
    const since = requestedSince === undefined ? until - WEEK_MS : requestedSince

    const events = await readDecisions({ since, until, limit: READ_LIMIT })
    const byClass = new Map()
    const byModel = new Map()
    const byEffort = new Map()
    const totals = {
      costUnits: 0,
      strongSteps: 0,
      overrides: 0,
      failedEscalations: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      pricedSteps: 0,
      unpricedSteps: 0,
      peakSteps: 0,
      peakCostUsd: 0,
      failoverSteps: 0,
      mappedSteps: 0,
    }
    const shadowTotals = { steps: 0, agreeSteps: 0, divergedSteps: 0, currentUsd: 0, candidateUsd: 0, pricedSteps: 0 }

    const add = (map, key, event, score, cost, strong, ledger) => {
      let bucket = map.get(key)
      if (!bucket) {
        bucket = {
          key,
          steps: 0,
          scoreSum: 0,
          scored: 0,
          strongSteps: 0,
          costUnits: 0,
          tokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          costUsd: 0,
          pricedSteps: 0,
          unpricedSteps: 0,
        }
        map.set(key, bucket)
      }
      bucket.steps += 1
      if (score !== null) {
        bucket.scoreSum += score
        bucket.scored += 1
      }
      if (strong) bucket.strongSteps += 1
      bucket.costUnits += cost
      bucket.tokens += ledger.tokens
      bucket.inputTokens += ledger.inputTokens
      bucket.outputTokens += ledger.outputTokens
      bucket.cacheReadTokens += ledger.cacheReadTokens
      bucket.cacheWriteTokens += ledger.cacheWriteTokens
      bucket.reasoningTokens += ledger.reasoningTokens
      bucket.costUsd += ledger.costUsd
      if (ledger.priced) bucket.pricedSteps += 1
      else bucket.unpricedSteps += 1
    }

    for (const event of events) {
      const chosen = isPlainObject(event.chosen) ? event.chosen : {}
      const usage = isPlainObject(event.usage) ? event.usage : {}
      const score = typeof event.score === 'number' && Number.isFinite(event.score) ? event.score : null
      const cost = typeof usage.costUnits === 'number' && Number.isFinite(usage.costUnits) ? usage.costUnits : 0
      const strong = chosen.tier === STRONG_TIER
      const ledger = usageLedger(usage)
      const classKey = typeof event.stepClass === 'string' && event.stepClass.length > 0 ? event.stepClass : 'unknown'
      const modelKey = typeof chosen.provider === 'string' && chosen.provider.length > 0
        && typeof chosen.model === 'string' && chosen.model.length > 0
        ? chosen.provider + '/' + chosen.model
        : 'unknown'
      const effortKey = typeof chosen.effort === 'string' && chosen.effort.length > 0 ? chosen.effort : 'unknown'

      add(byClass, classKey, event, score, cost, strong, ledger)
      add(byModel, modelKey, event, score, cost, strong, ledger)
      add(byEffort, effortKey, event, score, cost, strong, ledger)
      totals.costUnits += cost
      if (strong) totals.strongSteps += 1
      if (event.manualOverride === true) totals.overrides += 1
      if (typeof event.reason === 'string' && event.reason.includes(ESCALATION_MARK)) totals.failedEscalations += 1
      totals.tokens += ledger.tokens
      totals.inputTokens += ledger.inputTokens
      totals.outputTokens += ledger.outputTokens
      totals.cacheReadTokens += ledger.cacheReadTokens
      totals.cacheWriteTokens += ledger.cacheWriteTokens
      totals.reasoningTokens += ledger.reasoningTokens
      totals.costUsd += ledger.costUsd
      if (ledger.priced) totals.pricedSteps += 1
      else totals.unpricedSteps += 1
      if (event.peak === true) {
        totals.peakSteps += 1
        totals.peakCostUsd += ledger.costUsd
      }
      if (typeof event.failoverFrom === 'string' && event.failoverFrom.length > 0) totals.failoverSteps += 1
      // v0.17.0: a step whose ladder tier did not survive to the wire (an alias
      // collapse or a nearest-rank guess). Silence about these is what made the
      // old effort ladder unauditable.
      const mapped = event.effortMapped
      if (mapped && typeof mapped === 'object' && mapped.why && mapped.why !== 'exact') totals.mappedSteps += 1
      const shadow = shadowLedger(event)
      if (shadow) {
        shadowTotals.steps += 1
        if (shadow.agree) shadowTotals.agreeSteps += 1
        else shadowTotals.divergedSteps += 1
        if (shadow.current !== null && shadow.candidate !== null) {
          shadowTotals.pricedSteps += 1
          shadowTotals.currentUsd += shadow.current
          shadowTotals.candidateUsd += shadow.candidate
        }
      }
    }

    const rows = (map) => [...map.values()]
      .map((bucket) => ({
        key: bucket.key,
        steps: bucket.steps,
        avgScore: roundTo(bucket.scored > 0 ? bucket.scoreSum / bucket.scored : 0, 1),
        strongSteps: bucket.strongSteps,
        costUnits: roundTo(bucket.costUnits, 4),
        tokens: roundTo(bucket.tokens, 0),
        inputTokens: roundTo(bucket.inputTokens, 0),
        outputTokens: roundTo(bucket.outputTokens, 0),
        cacheReadTokens: roundTo(bucket.cacheReadTokens, 0),
        cacheWriteTokens: roundTo(bucket.cacheWriteTokens, 0),
        reasoningTokens: roundTo(bucket.reasoningTokens, 0),
        costUsd: roundTo(bucket.costUsd, 6),
        pricedSteps: bucket.pricedSteps,
        unpricedSteps: bucket.unpricedSteps,
      }))
      .sort((a, b) => b.steps - a.steps || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

    return {
      window: { since, until, steps: events.length },
      byClass: rows(byClass),
      byModel: rows(byModel),
      byEffort: rows(byEffort),
      totals: {
        costUnits: roundTo(totals.costUnits, 4),
        strongSteps: totals.strongSteps,
        overrideRate: events.length > 0 ? totals.overrides / events.length : 0,
        failedEscalations: totals.failedEscalations,
        tokens: roundTo(totals.tokens, 0),
        inputTokens: roundTo(totals.inputTokens, 0),
        outputTokens: roundTo(totals.outputTokens, 0),
        cacheReadTokens: roundTo(totals.cacheReadTokens, 0),
        cacheWriteTokens: roundTo(totals.cacheWriteTokens, 0),
        reasoningTokens: roundTo(totals.reasoningTokens, 0),
        costUsd: roundTo(totals.costUsd, 6),
        pricedSteps: totals.pricedSteps,
        unpricedSteps: totals.unpricedSteps,
        // v0.16.1: how much of this traffic ran while the provider charged its
        // peak rate, and how many steps were served after a channel failover.
        peakSteps: totals.peakSteps,
        peakCostUsd: roundTo(totals.peakCostUsd, 6),
        peakShare: events.length > 0 ? roundTo(totals.peakSteps / events.length, 4) : 0,
        failoverSteps: totals.failoverSteps,
        // v0.17.0: what share of the window ran a tier the model does not really
        // have, and which collapses dominate (top 8, from the same events).
        mappedSteps: totals.mappedSteps,
        mappedShare: events.length > 0 ? roundTo(totals.mappedSteps / events.length, 4) : 0,
        effort: effortSummary(events),
      },
      // v0.16.0: what a cost-aware router would have done with the same steps.
      // agreementRate is the share of steps where the two engines picked the
      // same model; savedRatio prices the divergence at this traffic's own
      // rates, and is 0 until at least one shadow step could be priced.
      shadow: {
        steps: shadowTotals.steps,
        agreeSteps: shadowTotals.agreeSteps,
        divergedSteps: shadowTotals.divergedSteps,
        agreementRate: shadowTotals.steps > 0 ? roundTo(shadowTotals.agreeSteps / shadowTotals.steps, 4) : 0,
        pricedSteps: shadowTotals.pricedSteps,
        currentUsd: roundTo(shadowTotals.currentUsd, 6),
        candidateUsd: roundTo(shadowTotals.candidateUsd, 6),
        savedUsd: roundTo(Math.max(0, shadowTotals.currentUsd - shadowTotals.candidateUsd), 6),
        savedRatio: shadowTotals.currentUsd > 0
          ? roundTo(Math.max(0, 1 - shadowTotals.candidateUsd / shadowTotals.currentUsd), 4)
          : 0,
      },
    }
  }

  /**
   * Cheap, synchronous status for the host's /stats endpoint. Never throws.
   * `written` counts decisions appended by this instance, `bytes` is the total
   * size of the telemetry files currently on disk, `files` is chronological.
   */
  const health = () => {
    const status = {
      dir,
      enabled,
      written,
      bytes: 0,
      lastError: lastError ? { ...lastError } : null,
      files: [],
    }
    for (const file of listTelemetryFiles(dir)) {
      status.files.push(file.name)
      try {
        status.bytes += statSync(join(dir, file.name)).size
      } catch (_ignore) {
        /* advisory */
      }
    }
    return status
  }

  return {
    dir,
    get enabled() {
      return enabled
    },
    writeDecision,
    flush,
    readDecisions,
    readRecentSync,
    summarize,
    health,
  }
}
