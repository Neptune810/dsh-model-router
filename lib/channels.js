/**
 * dsh-model-router — channel health, cooldown and relay fingerprints (v0.16.1).
 *
 * A pool entry names a provider/model pair, but the network path behind that pair
 * is a CHANNEL: an official endpoint, a relay, a second account. Two entries can
 * share a channel; one channel can be rate limited while its neighbour is fine.
 * The router therefore keeps a small, deterministic health ledger per channel and
 * orders candidates by it.
 *
 * Design rules:
 *   - Everything is pure and time-explicit: every method that depends on the
 *     clock takes the caller's timestamp (or falls back to the ledger's own
 *     `now`, which advance() sets). No Date.now() inside, so tests are exact.
 *   - A channel we never observed scores 1: absence of evidence is not evidence
 *     of illness, and a brand new pool entry must not be punished.
 *   - Cooldown reorders, it never removes: an unavailable channel is appended
 *     behind the healthy ones but stays a candidate, so a single-provider pool
 *     keeps routing (quality of service first, then quality of the pick).
 */

/** 429 is "slow down", not "this endpoint is broken". */
const ROTATE_STATUS = 429
/** 408/5xx and transport timeouts are the channel's problem, not the request's. */
const FAILOVER_STATUSES = Object.freeze([408, 500, 502, 503, 504, 529])

/**
 * Host failure codes (LlmFailure.code) that mean "this channel is troubled".
 * The loop retries on these by default, which is exactly the set a failover
 * decision may act on.
 */
const FAILOVER_CODES = Object.freeze(["SERVER", "TIMEOUT", "TRANSPORT", "EMPTY_RESPONSE"])
/** "Slow down" rather than "broken": rotate, do not quarantine. */
const ROTATE_CODES = Object.freeze(["RATE_LIMIT"])

/** Clamp a number into [lo, hi]. */
function clamp(value, lo, hi) {
  if (!Number.isFinite(value)) return lo
  return value < lo ? lo : value > hi ? hi : value
}

/** Positive integer or the fallback. */
function positiveInt(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/** How a failure should be treated. */
export const FAILURE_ACTIONS = Object.freeze(["rotate", "failover", "none"])

/**
 * Classify one request outcome.
 * @param outcome - { status?: number, timeout?: boolean }.
 * @returns "rotate" (429: retry on another channel of the same model),
 *          "failover" (5xx/timeout: another channel, and count against health),
 *          "none" (success or a request-side error the channel did not cause).
 */
export function classifyFailure(outcome) {
  const o = outcome && typeof outcome === "object" ? outcome : {}
  if (o.timeout === true) return "failover"
  const status = Number.isFinite(o.status) ? o.status : null
  if (status === ROTATE_STATUS) return "rotate"
  if (status !== null && FAILOVER_STATUSES.includes(status)) return "failover"
  // A provider-neutral code carries the same meaning when no HTTP status
  // survived the adapter (streams, transports, empty responses).
  const code = typeof o.code === "string" ? o.code.trim().toUpperCase() : ""
  if (ROTATE_CODES.includes(code)) return "rotate"
  if (FAILOVER_CODES.includes(code)) return "failover"
  return "none"
}

/**
 * Compare an observed response against what the channel promised (v0.16.1).
 *
 * Relays are the reason this exists: a relay can answer happily, never report
 * usage, silently serve a different model, or stall. None of that is a transport
 * error, so nothing else in the host would notice. Every mismatch is reported;
 * the caller decides whether to cool the channel down.
 *
 * @param observed - { model? , usage?, reasoning?, reasoningTokens?, ttftMs? }.
 * @param expected - { model?, requireUsage?, requireReasoning?, maxTtftMs? }.
 * @returns { ok, reasons } with reasons drawn from REASON_MISMATCH/MISSING/OUTLIER.
 */
export function fingerprint(observed, expected) {
  const o = observed && typeof observed === "object" ? observed : {}
  const e = expected && typeof expected === "object" ? expected : {}
  const reasons = []
  if (typeof e.model === "string" && e.model.length > 0) {
    const seen = typeof o.model === "string" ? o.model.trim() : ""
    if (seen.length > 0 && seen !== e.model.trim()) reasons.push("model_mismatch")
  }
  if (e.requireUsage !== false) {
    const usage = o.usage
    const counts = usage && typeof usage === "object" ? usage : null
    let total = 0
    if (counts) {
      for (const key of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "promptTokens", "completionTokens"]) {
        if (Number.isFinite(counts[key]) && counts[key] > 0) total += counts[key]
      }
    }
    if (total === 0) reasons.push("usage_missing")
  }
  if (e.requireReasoning === true) {
    const hasReasoning = typeof o.reasoning === "string"
      ? o.reasoning.length > 0
      : Number.isFinite(o.reasoningTokens) && o.reasoningTokens > 0
    if (!hasReasoning) reasons.push("reasoning_missing")
  }
  const maxTtft = Number.isFinite(e.maxTtftMs) ? e.maxTtftMs : 30000
  if (Number.isFinite(o.ttftMs) && o.ttftMs > maxTtft) reasons.push("ttft_outlier")
  return { ok: reasons.length === 0, reasons }
}

/**
 * A bounded health ledger for the channels behind the pool.
 *
 * record() is the only writer; score()/available()/snapshot() are reads that
 * never mutate, so the routing path can consult the ledger without changing it.
 */
export class ChannelHealth {
  constructor(options = {}) {
    const o = options && typeof options === "object" ? options : {}
    this.now = Number.isFinite(o.now) ? o.now : 0
    this.windowSize = positiveInt(o.windowSize, 20)
    this.failThreshold = positiveInt(o.failThreshold, 3)
    this.cooldownMs = positiveInt(o.cooldownMs, 60000)
    this.ewmaAlpha = Number.isFinite(o.ewmaAlpha) ? clamp(o.ewmaAlpha, 0, 1) : 0.3
    /** Latency above which a healthy channel is still nudged down (ms). */
    this.ttftSoftMs = positiveInt(o.ttftSoftMs, 30000)
    /** @type {Map<string, object>} */
    this.channels = new Map()
  }

  /** Internal: the ledger row for a channel, created on first use. */
  row(channelId) {
    const id = String(channelId == null ? "" : channelId)
    let row = this.channels.get(id)
    if (!row) {
      row = {
        id,
        window: [],
        total: 0,
        ok: 0,
        fail: 0,
        streak: 0,
        cooldownUntil: 0,
        cooldowns: 0,
        ewmaTtftMs: null,
        lastStatus: null,
        lastAt: null,
        lastError: null,
      }
      this.channels.set(id, row)
    }
    return row
  }

  /** Move the ledger clock forward; a stale timestamp never moves it back. */
  advance(atMs) {
    if (Number.isFinite(atMs) && atMs > this.now) this.now = atMs
    return this.now
  }

  /**
   * Record one outcome for a channel.
   * @param channelId - the channel key (provider or configured channel label).
   * @param outcome - { ok, status?, timeout?, ttftMs?, error?, at? }.
   * @returns the updated row (live reference; treat it as read-only).
   */
  record(channelId, outcome = {}) {
    const o = outcome && typeof outcome === "object" ? outcome : {}
    const at = Number.isFinite(o.at) ? o.at : this.now
    const row = this.row(channelId)
    const ok = o.ok === true
    row.total += 1
    row.lastAt = at
    row.lastStatus = Number.isFinite(o.status) ? o.status : null
    row.lastError = typeof o.error === "string" ? o.error : null
    row.window.push(ok)
    while (row.window.length > this.windowSize) row.window.shift()
    if (Number.isFinite(o.ttftMs) && o.ttftMs >= 0) {
      row.ewmaTtftMs = row.ewmaTtftMs === null ? o.ttftMs : row.ewmaTtftMs + this.ewmaAlpha * (o.ttftMs - row.ewmaTtftMs)
    }
    if (ok) {
      row.ok += 1
      row.streak = 0
      // A real success is the probe that ends a cooldown early.
      row.cooldownUntil = 0
    } else {
      row.fail += 1
      row.streak += 1
      if (row.streak >= this.failThreshold) {
        const until = at + this.cooldownMs
        // Count a cooldown once per failure streak, not once per failed call.
        if (until > row.cooldownUntil) row.cooldowns += 1
        row.cooldownUntil = Math.max(row.cooldownUntil, until)
      }
    }
    return row
  }

  /**
   * Bench a channel for a while without touching its window (v0.16.1).
   *
   * A request that already failed is immediate evidence, so the router benches
   * that channel for the retry it is about to ask for. The rolling window keeps
   * its own threshold for the slower failures (a channel that answers without
   * usage), which is why this is separate from record().
   * @returns when the bench ends (epoch ms).
   */
  cool(channelId, atMs, ms) {
    const span = Number.isFinite(ms) && ms > 0 ? ms : this.cooldownMs
    const at = Number.isFinite(atMs) ? atMs : this.now
    const row = this.row(channelId)
    const until = at + span
    if (until > row.cooldownUntil) {
      row.cooldowns += 1
      row.cooldownUntil = until
    }
    return row.cooldownUntil
  }

  /** Success rate over the recorded window; 1 when nothing was recorded. */
  successRate(channelId) {
    const row = this.channels.get(String(channelId == null ? "" : channelId))
    if (!row || row.window.length === 0) return 1
    let hits = 0
    for (const value of row.window) if (value) hits += 1
    return hits / row.window.length
  }

  /**
   * Health score in [0, 1]; higher is better. Unknown channels score 1.
   * Latency only nudges: a channel slower than ttftSoftMs keeps 90% of its rate.
   */
  score(channelId) {
    const row = this.channels.get(String(channelId == null ? "" : channelId))
    if (!row || row.window.length === 0) return 1
    let s = this.successRate(channelId)
    if (row.ewmaTtftMs !== null && row.ewmaTtftMs > this.ttftSoftMs) s *= 0.9
    return s
  }

  /** Whether a channel may be used now (its cooldown, if any, has expired). */
  available(channelId, at) {
    const row = this.channels.get(String(channelId == null ? "" : channelId))
    if (!row) return true
    const now = Number.isFinite(at) ? at : this.now
    return now >= row.cooldownUntil
  }

  /** When a channel's cooldown ends (0 = not cooling down). */
  cooldownUntil(channelId) {
    const row = this.channels.get(String(channelId == null ? "" : channelId))
    return row ? row.cooldownUntil : 0
  }

  /** The channels currently in cooldown at `at`. */
  coolingDown(at) {
    const now = Number.isFinite(at) ? at : this.now
    const out = []
    for (const row of this.channels.values()) if (row.cooldownUntil > now) out.push(row.id)
    return out.sort()
  }

  /** A deterministic, JSON-safe copy of the ledger (ids sorted). */
  snapshot(at) {
    const now = Number.isFinite(at) ? at : this.now
    const channels = {}
    for (const id of [...this.channels.keys()].sort()) {
      const row = this.channels.get(id)
      channels[id] = {
        score: this.score(id),
        available: now >= row.cooldownUntil,
        cooldownUntil: row.cooldownUntil,
        cooldownUntilInMs: row.cooldownUntil > now ? row.cooldownUntil - now : 0,
        cooldowns: row.cooldowns,
        total: row.total,
        ok: row.ok,
        fail: row.fail,
        streak: row.streak,
        successRate: this.successRate(id),
        ewmaTtftMs: row.ewmaTtftMs === null ? null : Math.round(row.ewmaTtftMs * 1000) / 1000,
        lastStatus: row.lastStatus,
        lastAt: row.lastAt,
        lastError: row.lastError,
      }
    }
    const cooling = Object.keys(channels).filter((id) => !channels[id].available)
    return { now, windowSize: this.windowSize, failThreshold: this.failThreshold, cooldownMs: this.cooldownMs, coolingDown: cooling, channels }
  }
}

/**
 * The channel an entry belongs to: an explicit `channel` label when the pool
 * configuration carries one (two accounts of the same provider are two
 * channels), otherwise the provider id.
 */
export function channelKey(entry) {
  if (entry && typeof entry === "object" && typeof entry.channel === "string" && entry.channel.trim().length > 0) {
    return entry.channel.trim()
  }
  return channelOf(entry)
}

/** The channel an ORDER ITEM maps onto: a string already is a channel id. */
function channelKeyOf(item) {
  return typeof item === "string" ? channelOf(item) : channelKey(item)
}

/** The channel id an entry or bare id maps onto (the part before "/"). */
export function channelOf(entry) {
  const raw = typeof entry === "string" ? entry : entry && typeof entry.id === "string" ? entry.id : ""
  const at = raw.indexOf("/")
  return at < 0 ? raw : raw.slice(0, at)
}

/**
 * Order candidates by channel health. Healthy channels come first (best score),
 * channels in cooldown are appended in cooldown order, and nothing is dropped:
 * ties keep the caller's original order.
 * @returns a new array of ids.
 */
export function orderChannels(channels, health, at) {
  const list = Array.isArray(channels) ? channels : []
  const now = Number.isFinite(at) ? at : (health && Number.isFinite(health.now) ? health.now : 0)
  const rows = list.map((item, index) => ({
    id: typeof item === "string" ? item : channelKeyOf(item),
    index,
    available: health ? health.available(channelKeyOf(item), now) : true,
    score: health ? health.score(channelKeyOf(item)) : 1,
    cooldownUntil: health ? health.cooldownUntil(channelKeyOf(item)) : 0,
  }))
  rows.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1
    if (a.available) return (b.score - a.score) || (a.index - b.index)
    return (a.cooldownUntil - b.cooldownUntil) || (a.index - b.index)
  })
  return rows.map((row) => row.id)
}

/**
 * Rank map for the routing layer: lower is better, unknown channels rank 0.
 * Blocked channels get a rank past every healthy one so score still decides
 * among them but a healthy channel always wins.
 */
export function channelRanks(channels, health, at) {
  const list = Array.isArray(channels) ? channels : []
  const now = Number.isFinite(at) ? at : (health && Number.isFinite(health.now) ? health.now : 0)
  // The LEDGER is consulted under the channel key; the ANSWER is keyed by the
  // caller's own id (the string it passed, or a pool entry's id), because that
  // is what scoreEntry() and chooseEntry() compare.
  const rows = list.map((item, index) => {
    const channel = channelKeyOf(item)
    return {
      key: typeof item === "string" ? item : ((item && item.id) || channel),
      channel,
      index,
      available: health ? health.available(channel, now) : true,
      score: health ? health.score(channel) : 1,
      cooldownUntil: health ? health.cooldownUntil(channel) : 0,
    }
  })
  rows.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1
    if (a.available) return (b.score - a.score) || (a.index - b.index)
    return (a.cooldownUntil - b.cooldownUntil) || (a.index - b.index)
  })
  const rank = {}
  const blocked = {}
  let next = 1
  let cooling = 0
  for (const row of rows) {
    if (!row.available) {
      cooling += 1
      blocked[row.key] = true
      // Past every healthy rank, but still distinct so cooldown order survives.
      rank[row.key] = 1000 + cooling
      continue
    }
    rank[row.key] = next
    next += 1
  }
  return { rank, blocked }
}
