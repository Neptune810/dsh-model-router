/**
 * dsh-model-router — host plugin (v0.5).
 *
 * The router owns up to three decisions per step: WHICH pooled model runs it,
 * HOW HARD it should think, and whether it is allowed to decide at all.
 *
 * Authorization scopes (per session, default from the profile row):
 *   full   — model + effort, manual picks are overridden while engaged
 *   effort — effort only, and only for the ONE model the user bound to the scope
 *            in the panel; until one is bound the router stays out, because a
 *            thinking level means nothing without knowing the model it is for
 *   model  — model only; the thinking level stays whatever the session chose
 *
 * Manual override: the user picking a model in the composer is observed through
 * the session's `modelSelection` projection (this plugin never writes it). Only
 * the dimension the active scope owns counts as an override: in effort scope a
 * model switch is not one (the router may only touch the effort), and in model
 * scope an effort change is not one. A real override makes the router yield
 * immediately — the user's choice stands — and it re-engages on the next command
 * (`agent/inbox/claimed`) or when the UI's "resume" action calls the host route.
 *
 * Registered with `prepend: true` on the `agent/request` waterfall: cordis runs
 * the first-registered listener outermost, so this plugin keeps the final word
 * over the host's own model-selection listener while it is engaged.
 *
 * Effort ladder v0.5 (see lib/policy.js and lib/routing.js for the rationale):
 *   trivial     -> low    (thinking stays on; "off" poisons tool loops)
 *   standard    -> low
 *   engineering -> high
 *   hard        -> max    (opt-in only; clamped to maxFallback otherwise)
 */

import { createHash, randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import {
  EFFORT_POINTS,
  classifyStep,
  clampEffort,
  contentHasImage,
  escalateClass,
  isFlashFamily,
  scoreOf,
  textOfContent,
  toolCallWithoutReasoning,
  toolCallsOf,
  toolErrorsOf,
} from './policy.js'
import {
  CONTROL_SCOPES,
  CROSS_MODES,
  activeTodoText,
  chooseEntry,
  contextPressureRatio,
  effortTierForClass,
  manualOverridePolicy,
  mapEffort,
  matchPreset,
  scoreEntry,
  sessionTokensOf,
  splitModelId,
  stabilize,
} from './routing.js'
import { PRICE_LEVELS, autoPricePool, parseOpenRouter } from './pricing.js'
import { normalizeRuntimeConfig, withPool, withPresets, withSettings } from './config.js'
import { createStore } from './store.js'
import { mountRoutes } from './routes.js'
import { routeProjection } from './route-projection.js'
import { createTelemetry } from './telemetry.js'
import { CATALOG, findModel } from './catalog.js'
import { modelMeta, pricesAt, tokenCost, tokenSplit, upcomingAlerts } from './catalog-pricing.js'
import { DEFAULT_MIX, blendedUsdPerMTok, mixFromSplit } from './pricing2.js'
import {
  ChannelHealth,
  channelKey,
  channelOf,
  channelRanks,
  classifyFailure,
  fingerprint,
} from './channels.js'
import { budgetLine, budgetReport, formatBudgetRow, localDayStart, localMonthStart } from './budget.js'
import { LADDER, LADDER_POINTS, effortSummary, explainMapping } from './effort.js'
import { CLASSIFIER_DEFAULTS, CircuitBreaker, decideVerdict, parseVerdict } from './classifier2.js'
import { FEEDBACK_LABELS, aggregateFeedback, normalizeFeedback, normalizeOutcome } from './feedback.js'
import { createFeedbackLog } from './feedback-store.js'
import { planExperiment, seededRandom } from './experiments.js'

export const name = 'dsh-model-router'
export const inject = []

/** How many recent decisions a session keeps for the UI. */
const DECISION_LOG_LIMIT = 20
/** Effort vocabulary assumed for the configured DeepSeek family. */
const DEEPSEEK_EFFORTS = Object.freeze(['off', 'low', 'high', 'max'])
/** Version stamped into every telemetry event (bumped with routing policy). */
const ROUTER_POLICY = '0.16.1'
/** Routed steps /router replay shows when the caller gives no number. */
const REPLAY_LIMIT = 10
/** The five token buckets the host tokenUsage projection reports. */
const TOKEN_KEYS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'])

/** Plain text of one claimed user message (content may be blocks or a string). */
function claimedText(message) {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    const text = textOfContent(message.content)
    return contentHasImage(message.content) ? text + ' [image attached]' : text
  }
  return ''
}

/** Last user message text, as a fallback when no claim was observed yet. */
function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (!msg) continue
    const role = typeof msg.role === 'string' ? msg.role : msg.type
    if (role === 'user') {
      if (Array.isArray(msg.content)) {
        const text = textOfContent(msg.content)
        if (text.trim()) return text
      } else if (typeof msg.content === 'string' && msg.content.trim()) {
        return msg.content
      }
    }
    if (i < Math.max(0, messages.length - 8)) break
  }
  return ''
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Five-bucket token totals from a `tokenUsage` projection, zero-filled. */
function tokenTotalsOf(state) {
  const totals = isObject(state) && isObject(state.totals) ? state.totals : state
  const out = {}
  for (const key of TOKEN_KEYS) out[key] = isObject(totals) && Number.isFinite(totals[key]) ? totals[key] : 0
  return out
}

/** Hysteresis over an arbitrary ranked value (used for the model choice). */
function stabilizeRanked(desired, previous, streak, downAfter, rank) {
  const limit = Number.isFinite(downAfter) && downAfter > 0 ? downAfter : 1
  if (previous === undefined || previous === null) return { value: desired, streak: 0 }
  if (desired === previous) return { value: previous, streak: 0 }
  if (rank(desired) >= rank(previous)) return { value: desired, streak: 0 }
  const next = (Number(streak) || 0) + 1
  return next >= limit ? { value: desired, streak: 0 } : { value: previous, streak: next }
}

/** sha256-prefixed, non-reversible session id used in telemetry (privacy). */
function hashSessionId(sessionId) {
  return 'sha256:' + createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 16)
}

/** Window + limit of a GET /stats query, in epoch ms where possible. */
function normalizeWindow(query) {
  const asMs = (raw) => {
    if (raw === undefined || raw === null || raw === '') return undefined
    const numeric = Number(raw)
    if (Number.isFinite(numeric) && numeric > 1e11) return numeric
    const parsed = Date.parse(String(raw))
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const limit = Number(query && query.limit)
  return {
    since: asMs(query && query.since),
    until: asMs(query && query.until),
    limit: Number.isFinite(limit) && limit > 0 ? Math.floor(Math.min(limit, 50000)) : undefined,
  }
}

/** Argument words of a `/router ...` invocation, tolerating host shapes. */
function commandArgs(invocation) {
  const raw = invocation && (invocation.args ?? invocation.text ?? invocation.input ?? invocation.raw ?? invocation.line ?? '')
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') {
    const words = raw.trim().split(/\s+/).filter(Boolean)
    if (words[0] === '/router' || words[0] === 'router') words.shift()
    return words
  }
  return []
}

export function apply(ctx, config) {
  const logger = typeof ctx.logger === 'function'
    ? ctx.logger('model-router')
    : (ctx.logger && typeof ctx.logger.info === 'function' ? ctx.logger : console)

  let cfg = normalizeRuntimeConfig(config && typeof config === 'object' ? config : {})

  // Environment escape hatch (read at boot; row config wins for other keys).
  const envMode = typeof process !== 'undefined' ? process.env.DSH_MODEL_ROUTER : undefined
  if (envMode === 'off' || envMode === 'auto') cfg.mode = envMode

  // UI state (pool / presets / per-session choices) overrides the row config.
  // A failed write is advisory, but it must be visible instead of silent: the
  // panel reads storeHealth from /state, and the host log gets one warning.
  const store = createStore(undefined, {
    onError: (error) => logger.warn('model-router state file could not be written: ' + String((error && error.message) || error)),
    onWarn: (message) => logger.warn(message),
  })
  if (Array.isArray(store.pool) && store.pool.length > 0) cfg = withPool(cfg, store.pool)
  if (isObject(store.presets)) cfg = withPresets(cfg, store.presets)
  if (isObject(store.settings)) cfg = withSettings(cfg, store.settings)
  if (isObject(store.settings) && store.settings.imagePolicy === 'flash') {
    logger.warn('stored imagePolicy "flash" was retired in 0.14.3; using "vision" (image steps go to the vision model)')
  }
  const override = manualOverridePolicy(cfg)

  // ---- observation baseline (v0.15) ---------------------------------------
  // Every routed step is appended to a JSONL file beside the state file, so the
  // "which effort is worth its price" questions can be answered from data
  // instead of from the memory of one live session. A write failure disables
  // telemetry for the process and is surfaced once; routing never blocks on it.
  // DSH_MODEL_ROUTER_TELEMETRY=0 is the kill switch for tests and for an
  // operator who does not want the files.
  const telemetryEnabled = !(typeof process !== 'undefined' && process.env.DSH_MODEL_ROUTER_TELEMETRY === '0')
  const telemetry = createTelemetry({
    dir: join(dirname(store.file), 'telemetry'),
    enabled: telemetryEnabled,
    onError: (error) => logger.warn('model-router telemetry could not be written: ' + String((error && error.message) || error)),
  })
  // ---- feedback loop (v0.17.1) -------------------------------------------
  // The panel's three labels are the only quality evidence the router has that
  // was not produced by the router. They live in their own file beside the
  // decision telemetry, so a label can be joined to a decision without either
  // store having to know about the other; the kill switch is shared.
  const feedbackLog = createFeedbackLog({
    dir: join(dirname(store.file), 'telemetry'),
    enabled: telemetryEnabled,
    onError: (error) => logger.warn('model-router feedback could not be written: ' + String(error && error.message ? error.message : error)),
  })
  // ε-greedy exploration draws from one seedable source so a shadow decision can
  // be replayed in a test (and so an operator can pin it in the row config).
    const experimentRandom = Number.isFinite(cfg.experiments.seed)
      ? seededRandom(cfg.experiments.seed)
      : () => Math.random()
  // Classifier health: a semantic classifier that keeps falling back to the
  // rules looks like a working router, so the counters are part of /state.
  // v0.17.1: v2 counts retries, skipped calls and breaker openings too, because
  // "the classifier is down" and "the classifier is unsure" are different
  // operational states and only the second one is about routing quality.
  const classifierStats = { calls: 0, fails: 0, fallbacks: 0, retries: 0, skipped: 0, breakerOpens: 0, tokens: 0, durationMs: 0, lastError: null }
  const classifierBreaker = new CircuitBreaker({ fails: CLASSIFIER_DEFAULTS.breakerFails, cooldownMs: CLASSIFIER_DEFAULTS.breakerMs })
  // Diagnostic revision counter for the panel; the ETag on /state is the real
  // change signal, this one only makes "did the host record anything" visible.
  let stateVersion = 1
  const bumpStateVersion = () => { stateVersion += 1; return stateVersion }
  // Telemetry status without the absolute directory: /state and /stats are read
  // over the same-origin panel API, and the path is not part of the contract.
  const telemetryStatus = () => {
    const health = telemetry.health()
    return {
      enabled: health.enabled,
      written: health.written,
      bytes: health.bytes,
      files: health.files.length,
      lastError: health.lastError,
    }
  }

  // ---- channel health (v0.16.1) -------------------------------------------
  // One health ledger per process, keyed by channel: a pool entry's own
  // `channel` label when it has one (two accounts of the same provider are two
  // channels) and the provider otherwise. Failures come from the host's
  // request-error waterfall, successes from the token usage the next step
  // reports — the only usage evidence this seam offers. channels.failover
  // decides whether a cooling channel is steered around: with it off the ledger
  // is still kept (so /state can show it) but routing is exactly 0.16.0's.
  const channelLedger = new ChannelHealth({
    now: Date.now(),
    windowSize: cfg.channels.windowSize,
    failThreshold: cfg.channels.failThreshold,
    cooldownMs: cfg.channels.cooldownMs,
    ewmaAlpha: cfg.channels.ewmaAlpha,
    ttftSoftMs: cfg.channels.ttftSoftMs,
  })
  // A relay that keeps answering without usable usage is not slow, it is
  // unreliable in a way a cooldown cannot express: it stays out for a day.
  const quarantined = new Map()
  /** The channel a pool entry is served through. */
  function channelNameOf(entry) {
    return entry && typeof entry === 'object' ? channelKey(entry) : channelOf(entry)
  }
  /** The channel behind a pool entry id — decisions record the entry id. */
  function channelNameOfId(id) {
    const found = cfg.pool.find((candidate) => candidate.id === id)
    return found ? channelKey(found) : channelOf(String(id))
  }
  /** A channel is quarantined while its deadline is in the future. */
  function isQuarantined(channel, at) {
    const until = quarantined.get(channel)
    if (until === undefined) return false
    if (until > at) return true
    quarantined.delete(channel)
    return false
  }
  /**
   * Ranks and cooldowns handed to chooseEntry through signals. An empty pair
   * unless channels.failover is on, which is what makes the shipped 0.16.1
   * ordering byte-identical to 0.16.0's.
   */
  function channelSignals() {
    const at = Date.now()
    const blocked = {}
    const rank = {}
    if (!cfg.channels.failover || cfg.pool.length === 0) return { channelRank: rank, channelBlocked: blocked }
    const ranked = channelRanks(cfg.pool, channelLedger, at)
    for (const [id, value] of Object.entries(ranked.rank)) rank[id] = value
    for (const [id, value] of Object.entries(ranked.blocked)) blocked[id] = value
    for (const entry of cfg.pool) {
      if (isQuarantined(channelNameOf(entry), at)) blocked[entry.id] = true
    }
    return { channelRank: rank, channelBlocked: blocked }
  }
  /**
   * Whether a retry has somewhere to go. A candidate channel must be neither
   * cooling down nor quarantined, and the router must know what it costs: an
   * unpriced relay is never entered automatically, the one exception being
   * another account of the provider the step already ran on, where the price
   * cannot have changed.
   */
  function healthyAlternative(failedChannel, failedProvider) {
    const at = Date.now()
    for (const entry of cfg.pool) {
      const channel = channelNameOf(entry)
      if (channel === failedChannel) continue
      if (isQuarantined(channel, at)) continue
      if (!channelLedger.available(channel, at)) continue
      if (entry.provider !== failedProvider && !findModel(entry.provider, entry.model)) continue
      return true
    }
    return false
  }
  /** What /state reports about the channels behind the pool; never throws. */
  function channelsReport() {
    const at = Date.now()
    const snapshot = channelLedger.snapshot(at)
    const names = [...new Set(cfg.pool.map((entry) => channelNameOf(entry)))]
    return {
      enabled: !!cfg.channels.failover,
      fingerprint: !!cfg.channels.fingerprint,
      failThreshold: cfg.channels.failThreshold,
      cooldownMs: cfg.channels.cooldownMs,
      maxFailoversPerStep: cfg.channels.maxFailoversPerStep,
      coolingDown: snapshot.coolingDown,
      quarantined: [...quarantined]
        .filter(([, until]) => until > at)
        .map(([channel, until]) => ({ channel, inMs: until - at })),
      channels: names.map((channel) => {
        const row = snapshot.channels[channel] || {}
        return {
          channel,
          available: row.available !== false,
          score: typeof row.score === 'number' ? row.score : 1,
          cooldownUntilInMs: Number.isFinite(row.cooldownUntilInMs) ? row.cooldownUntilInMs : 0,
          successRate: Number.isFinite(row.successRate) ? row.successRate : 1,
          total: Number.isFinite(row.total) ? row.total : 0,
          fail: Number.isFinite(row.fail) ? row.fail : 0,
          streak: Number.isFinite(row.streak) ? row.streak : 0,
          ewmaTtftMs: Number.isFinite(row.ewmaTtftMs) ? row.ewmaTtftMs : null,
          lastStatus: row.lastStatus === undefined ? null : row.lastStatus,
          lastError: typeof row.lastError === 'string' ? row.lastError : null,
          entries: cfg.pool.filter((entry) => channelNameOf(entry) === channel).map((entry) => entry.id),
        }
      }),
    }
  }
  /** True when any pool entry the catalog prices is on its peak rate right now. */
  function poolAtPeak() {
    const at = Date.now()
    for (const entry of cfg.pool) {
      const found = findModel(entry.provider, entry.model)
      const price = found ? pricesAt(found, at) : null
      if (price && price.peak === true) return true
    }
    return false
  }

  // ---- budget ledger (v0.16.1) --------------------------------------------
  // Day and month spend live in the persisted telemetry, so reading them costs
  // two file scans. The result is cached for a minute: a guard that re-read the
  // ledger on every step would cost more than it saves. The step path awaits a
  // refresh, /state only reports the cache and kicks one off in the background.
  const budgetCache = { at: 0, dayUsd: null, monthUsd: null, pending: null }
  const BUDGET_CACHE_MS = 60 * 1000
  const summaryUsd = (summary) => {
    const totals = summary && summary.totals
    return totals && Number.isFinite(totals.costUsd) ? totals.costUsd : null
  }
  function refreshBudgetLedger(at) {
    const now = at || Date.now()
    if (now - budgetCache.at < BUDGET_CACHE_MS) return Promise.resolve(budgetCache)
    if (budgetCache.pending) return budgetCache.pending
    budgetCache.pending = (async () => {
      try {
        const [day, month] = await Promise.all([
          telemetry.summarize({ since: localDayStart(now), until: now }),
          telemetry.summarize({ since: localMonthStart(now), until: now }),
        ])
        budgetCache.dayUsd = summaryUsd(day)
        budgetCache.monthUsd = summaryUsd(month)
        budgetCache.at = now
      } catch (error) {
        logger.warn('model-router budget ledger could not be read: ' + String((error && error.message) || error))
        budgetCache.at = now
      } finally {
        budgetCache.pending = null
      }
      return budgetCache
    })()
    return budgetCache.pending
  }
  /**
   * The spend picture for one session. Day and month come from the cached
   * ledger; session spend is summed as it happens. A limit the operator never
   * set is inactive, so an unconfigured router reports zeros.
   */
  function budgetReportFor(state) {
    const at = Date.now()
    if ((cfg.budget.dayUsd > 0 || cfg.budget.monthUsd > 0) && at - budgetCache.at >= BUDGET_CACHE_MS) {
      refreshBudgetLedger(at).catch(() => { /* refreshBudgetLedger already logs */ })
    }
    const report = budgetReport({
      mode: cfg.budget.mode,
      softRatio: cfg.budget.softRatio,
      limits: {
        sessionTokens: cfg.budget.sessionTokens,
        sessionUsd: cfg.budget.sessionUsd,
        dayUsd: cfg.budget.dayUsd,
        monthUsd: cfg.budget.monthUsd,
      },
      used: {
        sessionTokens: state && state.cost ? state.cost.sessionTokens : 0,
        sessionUsd: state && state.cost && Number.isFinite(state.cost.sessionUsd) ? state.cost.sessionUsd : 0,
        dayUsd: budgetCache.dayUsd,
        monthUsd: budgetCache.monthUsd,
      },
      ledgerAgeMs: budgetCache.at > 0 ? at - budgetCache.at : null,
    })
    report.once = !!(state && state.budgetOnce)
    report.blocked = state && state.budgetBlocked ? state.budgetBlocked : null
    return report
  }
  // Services are wired around apply(), so the host-contract self-check runs one
  // macrotask later. A missing service degrades the router; it never throws.
  const degraded = { missing: [], optional: [], checkedAt: null }
  const checkTimer = setTimeout(() => {
    try {
      degraded.missing = ['sessionProjections'].filter((name) => service(name) === undefined)
      degraded.optional = ['webServer', 'commands', 'llm'].filter((name) => service(name) === undefined)
      degraded.checkedAt = Date.now()
      if (degraded.missing.length > 0) {
        logger.warn('model-router is degraded: missing host service(s) ' + degraded.missing.join(', ') + '; routing may pass through untouched')
      }
    } catch (_checkFailed) { /* a self-check must never break the plugin */ }
  }, 0)
  if (checkTimer && typeof checkTimer.unref === 'function') checkTimer.unref()
  // Route words outside the router's own ladder are accepted verbatim (0.15) and
  // reported once at boot, so a typo in a profile's routes does not look like a
  // working configuration.
  for (const warning of cfg.effortWarnings || []) logger.warn(warning)

  // Per-process nonce for panel mutations. The panel learns it from the
  // same-origin /state read, so a cross-site page cannot forge a POST; a local
  // process that can read the routes can read the token too, which is the same
  // trust level the host API already gives local code. DSH_MODEL_ROUTER_NO_TOKEN=1
  // keeps the old behaviour for a panel build that does not send the header yet.
  const clientToken = typeof process !== 'undefined' && process.env.DSH_MODEL_ROUTER_NO_TOKEN === '1'
    ? null
    : randomBytes(16).toString('hex')

  const service = (name) => { try { return ctx.get(name) } catch (_missingService) { return undefined } }
  const llm = () => service('llm')

  const states = new WeakMap()
  const sessions = new Map()
  const effortCache = new Map()

  /** A control scope that may be stored, or null. */
  const knownControl = (value) => (CONTROL_SCOPES.includes(value) ? value : null)
  /** A non-empty string that may be stored, or null. */
  const knownText = (value) => (typeof value === 'string' && value.length > 0 ? value : null)

  /**
   * The routing plan the user picked last. It is the default a conversation
   * opens with, so a fresh window (or a brand-new conversation) keeps the
   * choice instead of dropping back to the shipped defaults. Per-session picks
   * stay per-session: a conversation that made its own pick never reads this
   * one back, and never writes into another conversation.
   */
  function lastChoice() {
    const last = store.last
    return last && typeof last === 'object' ? last : {}
  }

  /** Remember one picked key as the default for the conversations that follow. */
  function remember(patch) {
    const next = { ...lastChoice() }
    for (const key of Object.keys(patch)) {
      const value = patch[key]
      if (value === undefined || value === null || value === '') delete next[key]
      else next[key] = value
    }
    store.last = next
    // Keep the live config in step, so the routing pipeline uses the same default
    // a conversation created later inherits from the store. withSettings only
    // assigns the keys it is handed, so the effort binding is always stated —
    // otherwise clearing it would leave the old binding live in cfg.
    cfg = withSettings(cfg, { ...next, effortModel: knownText(next.effortModel) })
  }

  /** Per-agent state. One entry per live agent; nothing is shared across agents. */
  function stateOf(agent) {
    let state = states.get(agent)
    if (state !== undefined) return state
    const sessionId = (agent && (agent.sessionId || (agent.session && agent.session.id))) || undefined
    const saved = sessionId ? store.session(sessionId) : undefined
    const last = lastChoice()
    state = {
      agent,
      sessionId,
      claimed: new Map(),
      lastTurn: -1,
      seenMessages: 0,
      taskOpen: false,
      taskToolCalls: 0,
      taskErrors: 0,
      taskRepeats: 0,
      seenCalls: new Map(),
      hasImage: false,
      carry: 0,
      lastKey: '',
      poisonedHistory: false,
      warnedPoisoned: false,
      // v0.5 — this conversation's own pick first, then the plan the user chose
      // last (that is how a new conversation inherits the previous one).
      control: knownControl(saved && saved.control) || knownControl(last.control) || null,
      engaged: true,
      disengageReason: '',
      pinnedTaskType: knownText(saved && saved.pinnedTaskType) || knownText(last.pinnedTaskType) || null,
      // The one model the effort scope may steer (bound by the user in the panel).
      effortModel: knownText(saved && saved.effortModel) || knownText(last.effortModel) || null,
      // Which routing plan this conversation has confirmed. A conversation the
      // user already answered keeps it across requests and restarts; only one
      // with no record of its own starts empty, which is what asks once. Seeding
      // this from the store matters because the panel can confirm before the
      // first request creates this state, and because a restarted host rebuilds
      // every state from the store — dropping the record there made the panel
      // highlight the plan (and pulse its amber dot) again on every open.
      confirmedPlan: knownText(saved && saved.confirmedPlan) || '',
      // Cross-provider policy for THIS conversation (v0.14): once the user allows
      // a brand switch here, the guard stops applying; crossOnce is a one-shot
      // approval of the model the panel proposed.
      crossAllow: false,
      crossOnce: null,
      crossProposal: null,
      // What the router last applied, so a manual pick can be told apart from our
      // own route; and the pending pick already accounted for, so an unchanged
      // one is not counted as a second override.
      appliedKeys: undefined,
      pendingKeys: undefined,
      usage: {},
      hysteresis: { model: { value: undefined, streak: 0 }, effort: { value: undefined, streak: 0 } },
      current: null,
      turnType: null,
      decisions: [],
      // v0.15 observation state: token mark for per-step cost attribution, and
      // the running spend the panel shows.
      tokensAtLastStep: undefined,
      cost: { sessionTokens: 0, lastStepCostUnits: 0, sessionCostUnits: 0, taskCostUnits: 0, sessionUsd: 0, taskUsd: 0 },
      // v0.16.0: the trailing token mix of this session (a cost estimate built
      // on the shipped default mix would overstate a session that reads cache
      // 97% of the time) and the cost-aware choice the router would have made.
      lastSplit: null,
      lastShadow: null,
      // v0.16.1: the route the last step took (channel health is recorded one
      // step late, from the usage this step reveals), the failure the host
      // reported for it, how the channel verified, and the spend guard's memory.
      lastRoute: null,
      lastFailure: null,
      lastVerify: null,
      lastError: null,
      budgetOnce: false,
      budgetBlocked: null,
      failovers: new Map(),
      // v0.17.1: the ε-greedy draw for the last step (null when experiments are
      // off or the step was not explorable), the label the user last gave the
      // route, and the label still waiting for the next route to compare against.
      lastExperiment: null,
      feedback: null,
      pendingFeedback: null,
      warned: {},
    }
    states.set(agent, state)
    if (sessionId) sessions.set(sessionId, state)
    return state
  }

  /** Collect messages through the session projection (never the raw log). */
  function messagesOf(agent) {
    try {
      if (agent && agent.session && typeof agent.session.deriveMessages === 'function') {
        return agent.session.deriveMessages()
      }
    } catch (error) {
      logger.warn('deriveMessages failed: ' + String((error && error.message) || error))
    }
    return []
  }

  /**
   * Does the whole projection already contain a tool call with no thinking?
   * Used after a shrink (compaction can summarize the offending turn away).
   */
  function poisonedIn(messages) {
    for (const msg of messages) {
      if (!msg || !Array.isArray(msg.content)) continue
      const role = typeof msg.role === 'string' ? msg.role : msg.type
      if (role === 'assistant' && toolCallWithoutReasoning(msg.content)) return true
    }
    return false
  }

  /**
   * Fold newly appended messages into the current task's evidence counters.
   * Tool results are user-role messages carrying { type: "tool-result" } blocks.
   */
  function scanFresh(state, messages) {
    if (messages.length < state.seenMessages) {
      // The projection shrank (compaction, branch switch): resync, and re-derive
      // the continuity flag because the poisoned turn may be gone.
      state.seenMessages = messages.length
      state.poisonedHistory = poisonedIn(messages)
      return
    }
    if (messages.length === state.seenMessages) return
    const fresh = messages.slice(state.seenMessages)
    state.seenMessages = messages.length
    for (const msg of fresh) {
      const content = msg && Array.isArray(msg.content) ? msg.content : null
      if (!content) continue
      const role = typeof msg.role === 'string' ? msg.role : msg.type
      if (role === 'assistant') {
        if (toolCallWithoutReasoning(content)) state.poisonedHistory = true
        for (const call of toolCallsOf(content)) {
          state.taskToolCalls += 1
          const seen = state.seenCalls.get(call.key) || 0
          state.seenCalls.set(call.key, seen + 1)
          if (seen >= 1) state.taskRepeats += 1
        }
      } else if (role === 'user') {
        state.taskErrors += toolErrorsOf(content)
        if (contentHasImage(content)) state.hasImage = true
      }
    }
  }

  /** Keep the claimed-text map bounded over long sessions. */
  function prune(state, turn) {
    for (const key of state.claimed.keys()) {
      if (key < turn - 4) state.claimed.delete(key)
    }
  }

  /**
   * A claimed user message opens a new task: retire evidence, reset the task's
   * strong-tier budget, and re-engage after a manual override.
   */
  function onClaimed(payload) {
    const agent = payload && payload.agent
    const message = payload && payload.message
    if (!agent || !message) return
    const text = claimedText(message)
    if (!text) return
    const state = stateOf(agent)
    const turn = typeof payload.turn === 'number' ? payload.turn : state.lastTurn

    if (state.taskOpen) {
      state.carry = cfg.carryUnresolved && state.taskErrors > 0 ? 1 : 0
    }
    state.taskOpen = true
    state.taskToolCalls = 0
    state.taskErrors = 0
    state.taskRepeats = 0
    state.seenCalls = new Map()
    state.hasImage = false
    state.usage = {}
    state.cost.taskCostUnits = 0
    state.cost.taskUsd = 0
    // A new command is also a new chance for a channel that failed: the one-shot
    // budget release and the failure marker belong to the task that made them.
    state.lastFailure = null
    state.failovers.clear()
    // Hysteresis dampens flapping inside one task; a new command is a new call.
    state.hysteresis = { model: { value: undefined, streak: 0 }, effort: { value: undefined, streak: 0 } }
    if (!state.engaged && override.resumeOnNextCommand) {
      state.engaged = true
      state.disengageReason = ''
      logger.info('a new command resumed routing for session ' + (state.sessionId || 'unknown'))
    }
    state.claimed.set(turn, (state.claimed.get(turn) || '') + '\n' + text)
    if (turn > state.lastTurn) state.lastTurn = turn
    prune(state, turn)
  }

  /** How many classes of escalation the current task's evidence has earned. */
  function escalationsFor(state) {
    let n = 0
    if (state.taskErrors >= cfg.escalateOnErrors) n = Math.max(n, 1)
    if (state.taskErrors >= cfg.escalateOnErrors * 2) n = Math.max(n, 2)
    if (state.taskRepeats >= cfg.escalateOnRepeats) n = Math.max(n, 1)
    return Math.min(cfg.maxEscalations, n)
  }

  /** Session-header facts this plugin can read without a service. */
  function depthOf(agent) {
    const header = agent && agent.session && agent.session.header
    if (header && Number.isFinite(header.delegationDepth)) return header.delegationDepth
    if (agent && agent.parentAgent !== undefined) return 1
    return 0
  }

  /**
   * Optional session projections that sharpen the decision: the active todo,
   * context occupancy and the session token total. Every read is advisory — a
   * missing service or an unreadable unit degrades to "no signal".
   */
  function projectionSignals(agent, state) {
    const out = {
      todoText: '',
      pressure: null,
      sessionTokens: 0,
      usageTotals: tokenTotalsOf(null),
      delegationDepth: depthOf(agent),
      frugal: false,
    }
    const projections = service('sessionProjections')
    if (projections && typeof projections.stateOf === 'function' && agent && agent.session) {
      const read = (key) => { try { return projections.stateOf(agent.session, key) } catch (_unreadable) { return undefined } }
      if (cfg.signals.todos) out.todoText = activeTodoText(read('todos'))
      out.pressure = contextPressureRatio(read('contextPressure'))
      const tokenUsage = read('tokenUsage')
      out.sessionTokens = sessionTokensOf(tokenUsage)
      out.usageTotals = tokenTotalsOf(tokenUsage)
    }
    if (cfg.subagent.preferCheap && out.delegationDepth > 0) out.frugal = true
    const threshold = Number(cfg.signals.contextPressure)
    if (threshold > 0 && out.pressure !== null && out.pressure >= threshold) out.frugal = true
    const budget = Number(cfg.signals.sessionTokens)
    if (budget > 0 && out.sessionTokens >= budget) out.frugal = true
    return out
  }

  /** The pool entry an image step must use, when image routing is enabled. */
  function visionEntryFor() {
    if (cfg.visionModel) {
      const explicit = cfg.pool.find((entry) => entry.id === cfg.visionModel)
      if (explicit) return explicit
    }
    return cfg.pool.find((entry) => entry.tags.includes('vision')) || null
  }

  /**
   * Task type: the UI pin always wins; otherwise the rules run, or — when the
   * operator opted into `classifier: llm` — one small model call per turn.
   *
   * v0.17.1 (classifier v2) makes the fallback direction explicit: an answer the
   * model itself is unsure about is not a classification, so the rules pick the
   * preset AND the step is lifted one tier, because a cheap model on a step
   * nobody could read is the expensive mistake. A prose answer (no confidence)
   * keeps its class but is lifted the same way, and a failed call is just the
   * rules. All of it is recorded so the panel can distinguish the four outcomes.
   */
  async function resolveTaskType(state, text, signals) {
    if (state.pinnedTaskType) return state.pinnedTaskType
    const names = Object.keys(cfg.presets)
    if (cfg.classifier !== 'llm' || names.length === 0) return matchPreset(cfg, text)
    let cached = state.turnType && state.turnType.turn === signals.turn ? state.turnType : null
    if (!cached) {
      const rules = matchPreset(cfg, text)
      const verdict = await classifyWithLlm(text, names)
      const decided = decideVerdict(verdict, rules, cfg.classifierMinConfidence)
      cached = {
        turn: signals.turn,
        value: decided.value,
        used: decided.used,
        source: decided.source,
        type: verdict ? verdict.class : null,
        confidence: decided.confidence,
        escalate: decided.escalate,
        why: decided.why,
        rules,
        family: verdict ? verdict.family : null,
        evidence: verdict ? verdict.evidence : null,
        signals: verdict ? verdict.signals : [],
      }
      state.turnType = cached
      classifierStats.last = { at: Date.now(), source: decided.source, confidence: decided.confidence, type: verdict ? verdict.class : null }
    }
    applyClassifierLift(cached, signals)
    return cached.value
  }

  /**
   * An unsure classifier lifts the step one tier. The lift is applied to the
   * signals object the request listener owns, so the decision, the reasons, the
   * effort mapping and the telemetry all see the same class.
   */
  function applyClassifierLift(turnType, signals) {
    if (!turnType || turnType.escalate !== true) return false
    if (!signals || typeof signals !== 'object') return false
    const from = signals.stepClass
    const lifted = escalateClass(from, 1)
    if (lifted === from) return false
    if (!Array.isArray(signals.reason)) signals.reason = []
    const how = turnType.confidence === null || turnType.confidence === undefined
      ? 'the answer carried no confidence'
      : 'confidence ' + Number(turnType.confidence).toFixed(2) + ' < ' + Number(cfg.classifierMinConfidence).toFixed(2)
    signals.reason.push('classifier unsure (' + how + '): lifting one tier, ' + from + ' -> ' + lifted)
    signals.stepClass = lifted
    signals.classifierLift = { from, to: lifted, confidence: turnType.confidence ?? null, source: turnType.source }
    return true
  }

  /**
   * One bounded classifier call, retried once, behind a circuit breaker. The
   * answer is structured JSON so a real classification is distinguishable from a
   * fallback; the breaker stops paying for a classifier that keeps failing and
   * leaves the rules in charge until the cooldown passes.
   */
  async function classifyWithLlm(text, names) {
    const runtime = llm()
    if (!runtime || typeof runtime.stream !== 'function') return null
    if (!classifierBreaker.allow(Date.now())) {
      classifierStats.skipped += 1
      classifierStats.fallbacks += 1
      classifierStats.lastError = 'the classifier circuit breaker is open'
      return null
    }
    const attempts = Number.isFinite(cfg.classifierAttempts) && cfg.classifierAttempts > 0 ? cfg.classifierAttempts : CLASSIFIER_DEFAULTS.attempts
    let failure = 'the classifier named no task type'
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      classifierStats.calls += 1
      if (attempt > 0) classifierStats.retries += 1
      const entry = (cfg.classifierModel && cfg.pool.find((candidate) => candidate.id === cfg.classifierModel)) || cfg.pool[0]
      const controller = typeof AbortController === 'function' ? new AbortController() : undefined
      const timer = controller ? setTimeout(() => controller.abort(), cfg.classifierTimeoutMs) : undefined
      const startedAt = Date.now()
      let answer = ''
      let failed = false
      try {
        const prompt = 'Classify one step of a coding session.\n'
          + 'Types: ' + names.join(', ') + '\n'
          + 'Step: ' + String(text).slice(0, 1200) + '\n'
          + 'Answer with JSON only: {"class":"<one of the types above, or none>","confidence":0.0-1.0,"family":"<short label>","evidence":"<short quote from the step>","signals":["<what you used>"]}'
        const stream = runtime.stream({
          provider: entry ? entry.provider : cfg.provider,
          model: entry ? entry.model : cfg.model,
          reasoningEffort: 'off',
          maxTokens: 160,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          ...(controller ? { signal: controller.signal } : {}),
        })
        for await (const chunk of stream) {
          if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') answer += chunk.text
          if (answer.length > 400) break
        }
      } catch (_classifierFailed) {
        failed = true
        failure = 'the classifier call failed'
      } finally {
        if (timer) clearTimeout(timer)
        classifierStats.durationMs += Date.now() - startedAt
      }
      if (failed) continue
      const verdict = parseVerdict(answer, names)
      if (!verdict) continue
      classifierBreaker.recordSuccess()
      return verdict
    }
    const opened = classifierBreaker.recordFailure(Date.now())
    classifierStats.fails += 1
    classifierStats.fallbacks += 1
    classifierStats.lastError = failure
    if (opened.opened) {
      classifierStats.breakerOpens += 1
      logger.warn('model-router classifier failed ' + opened.fails + ' times in a row; rules only for the next '
        + Math.round(classifierBreaker.cooldownMs / 60000) + ' min')
    }
    return null
  }

  /** Signals for the current step, computed from claims + session projection. */
  function signalsOf(agent, payload) {
    const state = stateOf(agent)
    const messages = messagesOf(agent)
    const turn = typeof payload.turn === 'number' ? payload.turn : state.lastTurn
    scanFresh(state, messages)
    if (turn > state.lastTurn) state.lastTurn = turn

    let text = state.claimed.get(turn)
    if (text === undefined) {
      // Claim events may not cover resumed windows; fall back to the projection.
      text = lastUserText(messages)
    }
    const base = {
      text: text || '',
      turn,
      toolCalls: state.taskToolCalls,
      hasImage: state.hasImage || /\[image attached\]/.test(text || ''),
      escalations: escalationsFor(state),
      carry: state.carry,
      poisonedHistory: state.poisonedHistory,
    }
    const scored = scoreOf(base, cfg)
    const classified = classifyStep(base, cfg)
    let stepClass = classified.stepClass
    const reason = [...classified.reason]
    if (stepClass === 'engineering' && scored.score >= cfg.scoring.hardScore) {
      stepClass = 'hard'
      reason.push('score ' + scored.score + ' >= hardScore')
    }
    const evidence = Math.max(0, Math.min(cfg.maxEscalations, base.escalations))
    const carry = base.carry && (stepClass === 'engineering' || stepClass === 'hard') ? 1 : 0
    const bumps = Math.max(evidence, carry)
    if (bumps > 0) {
      const lifted = escalateClass(stepClass, bumps)
      if (lifted !== stepClass) {
        reason.push((carry && carry >= evidence ? 'carried from unresolved failure' : 'escalated on evidence') + ' x' + bumps)
        stepClass = lifted
      }
    }
    return { ...base, ...projectionSignals(agent, state), stepClass, score: scored.score, scoreParts: scored.scoreParts || null, reason }
  }

  /** The `provider/model` id of a resolved request or a selection object. */
  function modelIdOf(value) {
    if (!value || typeof value.provider !== 'string' || typeof value.model !== 'string') return ''
    return value.provider + '/' + value.model
  }

  /**
   * Whether this resolved route is one the router is allowed to steer. `bound` is
   * the effort scope's one chosen model: it stays steerable even when it sits
   * outside the pool, because the user may bind any model the catalog offers.
   */
  function manages(resolved, bound) {
    if (!resolved || !resolved.provider || !resolved.model) return false
    if (bound && bound === modelIdOf(resolved)) return true
    if (resolved.provider === cfg.provider) return cfg.familyRe.test(resolved.model)
    for (const entry of cfg.pool) if (entry.provider === resolved.provider && entry.model === resolved.model) return true
    return false
  }

  /**
   * The user's explicit pick inside the `modelSelection` projection.
   *
   * The state is `{ lastUsed, pending }`: `lastUsed` is the header of the last
   * request — i.e. whatever this router just chose — while `pending` is a pick that
   * has not been used yet. Only `pending` is a manual override. Comparing the whole
   * projection made our own routing look like a user pick and stood the router down
   * for no reason (the amber dot with no manual pick).
   */
  function pendingSelectionOf(raw) {
    if (!raw || typeof raw !== 'object') return null
    if ('pending' in raw) return raw.pending === undefined ? null : raw.pending
    // A bare { provider, model } value is an explicit selection.
    return typeof raw.provider === 'string' && typeof raw.model === 'string' ? raw : null
  }

  /** Read the session's `modelSelection` projection, best effort. */
  function modelSelectionOf(agent) {
    const projections = service('sessionProjections')
    if (!projections || typeof projections.stateOf !== 'function' || !agent || !agent.session) return undefined
    try { return projections.stateOf(agent.session, 'modelSelection') } catch (_unreadable) { return undefined }
  }

  /** { model, effort } identity of a selection object; 'none' when it has no model. */
  function selectionKeys(selection) {
    if (!selection || typeof selection !== 'object') return { model: 'none', effort: 'none' }
    const model = modelIdOf(selection)
    if (!model) return { model: 'none', effort: 'none' }
    return { model, effort: selection.reasoningEffort ? String(selection.reasoningEffort) : 'default' }
  }

  /**
   * The baseline a manual pick is compared against: what the router applied last,
   * else what the projection says was used before, else the route the host
   * resolved. It must belong to the router, never to the user's own pending pick —
   * otherwise every step of a session would look like a manual override.
   */
  function appliedKeysOf(state, agent, resolved) {
    if (state.appliedKeys) return state.appliedKeys
    const raw = modelSelectionOf(agent)
    const used = raw && typeof raw === 'object' ? selectionKeys(raw.lastUsed) : null
    if (used && used.model !== 'none') return used
    return selectionKeys(resolved)
  }

  /**
   * The provider this conversation is running on — the one a cross-provider
   * switch would leave. It follows the router's own last route first, then the
   * session projection (a manual pick counts), then the resolved request.
   */
  function crossAnchor(state, resolved) {
    const keys = appliedKeysOf(state, state && state.agent, resolved)
    const split = splitModelId(keys && keys.model, resolved && resolved.provider)
    if (split && split.provider) return split.provider
    return (resolved && resolved.provider) || ''
  }

  /** Catalog display names keyed by "provider/model", for price matching. */
  async function catalogNames() {
    const runtime = llm()
    const names = {}
    if (runtime && typeof runtime.listProviders === 'function') {
      for (const provider of runtime.listProviders()) {
        try {
          const models = typeof runtime.listModels === 'function' ? await runtime.listModels(provider.id) : []
          for (const model of models || []) names[provider.id + '/' + model.id] = model.name || model.id
        } catch (_unlistable) {
          // A provider that cannot list models keeps its raw ids, which the
          // built-in rules still classify.
        }
      }
    }
    return names
  }

  /** Pull the OpenRouter catalog and cache a compact price snapshot. */
  async function refreshPrices() {
    if (typeof fetch !== 'function') return { ok: false, error: 'this host cannot fetch' }
    try {
      const timeout = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(20000)
        : undefined
      const response = await fetch('https://openrouter.ai/api/v1/models', { headers: { accept: 'application/json' }, signal: timeout })
      if (!response.ok) return { ok: false, error: 'openrouter responded ' + response.status }
      const snapshot = parseOpenRouter(await response.json())
      store.prices = snapshot
      return { ok: true, count: snapshot.models.length, fetchedAt: snapshot.fetchedAt }
    } catch (error) {
      return { ok: false, error: 'price refresh failed: ' + String((error && error.message) || error) }
    }
  }

  /** Remember the pick the user already made so it is not read as a fresh override. */
  function adoptPending(state, agent) {
    const keys = selectionKeys(pendingSelectionOf(modelSelectionOf(agent)))
    state.pendingKeys = keys.model === 'none' ? undefined : keys
  }

  /**
   * True when the user just made a pick this router must respect — scope-aware.
   *
   * Only the dimension the active scope owns counts: effort scope reacts to a
   * changed thinking level and never to a model switch, model scope reacts to a
   * changed model and never to an effort change, and full scope reacts to either.
   * A pending pick that has not changed since it was last seen is already
   * accounted for, so it is not a second override.
   */
  function noteManualSelection(agent, state, scope, resolved) {
    const raw = modelSelectionOf(agent)
    if (raw === undefined) return false
    const keys = selectionKeys(pendingSelectionOf(raw))
    if (keys.model === 'none') {
      // The pick was used up: the next one counts again.
      state.pendingKeys = undefined
      return false
    }
    if (state.pendingKeys && state.pendingKeys.model === keys.model && state.pendingKeys.effort === keys.effort) return false
    state.pendingKeys = keys
    const applied = appliedKeysOf(state, agent, resolved)
    const modelChanged = keys.model !== applied.model
    const effortChanged = keys.effort !== applied.effort
    if (!modelChanged && !effortChanged) return false
    if (scope === 'effort') return effortChanged
    if (scope === 'model') return modelChanged
    return true
  }

  /** Effort ids the target model can actually accept. */
  async function supportedEfforts(entry) {
    if (entry.efforts && entry.efforts.length > 0) return entry.efforts
    const cached = effortCache.get(entry.id)
    if (cached !== undefined) return cached
    const known = entry.provider === cfg.provider && cfg.familyRe.test(entry.model)
    let supported = known ? DEEPSEEK_EFFORTS : []
    try {
      const runtime = llm()
      if (runtime && typeof runtime.resolveModel === 'function') {
        const info = await runtime.resolveModel(entry.provider, entry.model)
        const ids = info && info.reasoning && Array.isArray(info.reasoning.efforts)
          ? info.reasoning.efforts.map((effort) => effort && effort.id).filter((id) => typeof id === 'string')
          : []
        if (ids.length > 0) supported = ids
      }
    } catch (_unresolvedModel) { /* keep the documented fallback */ }
    effortCache.set(entry.id, supported)
    return supported
  }

  /** Legacy guards applied whenever the router is not steering the request. */
  function legacyGuards(resolved, signals) {
    if (cfg.demoteManualMax && !cfg.allowMax && resolved.reasoningEffort === 'max' && isFlashFamily(resolved.model, cfg)) {
      logger.warn('managed model ' + resolved.model + ' asked for effort max; demoted to ' + cfg.maxFallback + ' (set allowMax: true to keep it)')
      return { ...resolved, reasoningEffort: cfg.maxFallback }
    }
    if (cfg.mode === 'auto' && !cfg.allowThinkingOff && !signals.poisonedHistory && resolved.reasoningEffort === 'off' && isFlashFamily(resolved.model, cfg)) {
      logger.warn('managed model ' + resolved.model + ' asked for effort off; raised to low (thinking is required for tool-call continuity; set allowThinkingOff: true to keep it)')
      return { ...resolved, reasoningEffort: 'low' }
    }
    return resolved
  }

  /**
   * Remember one routed step: the UI's short in-memory log AND the persisted
   * telemetry event. The two are separate on purpose — the UI log is a ring that
   * dies with the process, telemetry is the record the iteration reviews read.
   */
  function record(state, payload, decision, event) {
    state.current = decision
    state.decisions.push({ turn: payload.turn, step: payload.step, ...decision })
    if (state.decisions.length > DECISION_LOG_LIMIT) state.decisions.shift()
    bumpStateVersion()
    if (event) telemetry.writeDecision(event)
    // v0.17.1: a label is only half a signal. The next routed step answers the
    // other half — did the conversation stay on the route the user judged, or
    // did it move? One outcome record per label, and only once.
    if (state.pendingFeedback) {
      const pending = state.pendingFeedback
      const same = pending.provider === decision.provider && pending.model === decision.model
      const outcome = normalizeOutcome({
        at: Number.isFinite(event && event.at) ? event.at : Date.now(),
        label: pending.label,
        changed: !same,
        provider: decision.provider,
        model: decision.model,
      })
      if (outcome) feedbackLog.append(outcome)
      state.pendingFeedback = null
      if (state.feedback) state.feedback.outcome = same ? 'stayed' : 'moved'
    }
  }

  /** Build the request the router wants to send. */
  async function decide(resolved, signals, state, scope, preset, plan, payload) {
    // ---- token-level cost (v0.16.0) ----------------------------------------
    // Every pool entry is priced at its own catalog rate for this instant, so a
    // score can be adjusted by what the step would really cost rather than by
    // the pool's coarse 1-4 cost units. The basis is computed once per decision
    // and handed to the scorers through signals.
    const basis = costBasis(state)
    const health = channelSignals()
    const peakAvoid = peakShiftList(signals, basis)
    const choiceSignals = {
      ...signals,
      ...health,
      peakAvoid,
      presetName: preset,
      stepClass: signals.stepClass,
      preferCheap: plan.frugal,
      visionModel: cfg.visionModel,
      costRates: basis.rates,
      costFloor: basis.floor,
    }
    const costSignals = choiceSignals
    // ---- cross-provider guard (v0.14) --------------------------------------
    // A conversation stays on the brand it is already running: leaving one
    // provider for another is more consequential than swapping models inside a
    // provider, so it is off / confirmed / allowed by its own setting. The guard
    // only applies while the conversation's own provider is in the pool — a pool
    // that contains nothing else must keep working.
    const anchor = scope === 'effort' ? '' : crossAnchor(state, resolved)
    const samePool = anchor ? cfg.pool.filter((candidate) => candidate.provider === anchor) : []
    const crossMode = state.crossAllow ? 'allow' : cfg.crossProvider
    let allowedPool = cfg.pool
    state.crossProposal = null
    const reason = [...signals.reason]
    if (anchor && samePool.length > 0 && crossMode !== 'allow') {
      // A brand whose every channel is benched — cooling down after a failure or
      // quarantined for bad usage reporting — has nothing usable left. Failing
      // over is then not a downgrade to be approved, it is the only way this step
      // runs, so it bypasses the review. The alternative must be priced: a relay
      // of unknown cost is never entered automatically, and "never" still wins,
      // because an operator who forbade cross-provider routing meant it.
      const isBlocked = (id) => !!(costSignals.channelBlocked && costSignals.channelBlocked[id])
      let failoverId = null
      if (cfg.channels.failover && samePool.every((candidate) => isBlocked(candidate.id))) {
        const alt = chooseEntry(cfg.pool, cfg, costSignals, state.usage)
        if (alt && alt.entry.provider !== anchor && !isBlocked(alt.entry.id) && Number.isFinite(basis.rates[alt.entry.id])) {
          failoverId = alt.entry.id
        }
      }
      if (failoverId && crossMode !== 'never') {
        allowedPool = cfg.pool
        reason.push('failing over from ' + anchor + ': every channel it has is benched, so ' + failoverId + ' takes this step')
      } else if (crossMode === 'never') {
        allowedPool = samePool
        reason.push('cross-provider routing is off; staying on ' + anchor)
      } else {
        // v0.16.1: leaving the brand costs the user a review, so it is only
        // asked for when there is a reason — the in-provider best is far more
        // expensive, or the candidate is clearly the better fit for this step —
        // or when the conversation's own provider has nothing usable left.
        const wanted = chooseEntry(cfg.pool, cfg, costSignals, state.usage)
        if (wanted && wanted.entry.provider !== anchor) {
          const sameBest = chooseEntry(samePool, cfg, costSignals, state.usage)
          const wantedRate = basis.rates[wanted.entry.id]
          const sameRate = sameBest ? basis.rates[sameBest.entry.id] : null
          // How many times cheaper the cross-provider candidate is, per unit of
          // this step's own token mix. The review is worth asking for when the
          // user would save a multiple, not a few percent.
          const ratio = Number.isFinite(wantedRate) && Number.isFinite(sameRate) && wantedRate > 0
            ? sameRate / wantedRate
            : null
          const cheaper = ratio !== null && ratio >= cfg.crossCost.maxMultiple
          const betterFit = !sameBest || (wanted.score - sameBest.score) >= cfg.crossCost.scoreMargin
          if (cheaper || betterFit) {
            state.crossProposal = {
              id: wanted.entry.id,
              provider: wanted.entry.provider,
              model: wanted.entry.model,
              tier: wanted.entry.tier,
              cost: wanted.entry.cost,
              score: Math.round(wanted.score),
              sameId: sameBest ? sameBest.entry.id : null,
              scoreDelta: sameBest ? Math.round(wanted.score - sameBest.score) : null,
              usdPerMTok: Number.isFinite(wantedRate) ? wantedRate : null,
              sameUsdPerMTok: Number.isFinite(sameRate) ? sameRate : null,
              savingMultiple: cheaper ? Math.round(ratio * 10) / 10 : null,
              why: cheaper ? 'cost' : 'fit',
            }
            allowedPool = samePool
            reason.push('cross-provider switch to ' + wanted.entry.id + ' awaits confirmation (' + (cheaper ? 'cost' : 'fit') + ')')
          } else {
            allowedPool = samePool
            reason.push('staying on ' + anchor + ': switch to ' + wanted.entry.id + ' is not worth a review')
          }
        }
      }
    }
    if (scope !== 'effort' && state.crossOnce) {
      const once = cfg.pool.find((candidate) => candidate.id === state.crossOnce)
      if (once && !allowedPool.some((candidate) => candidate.id === once.id)) allowedPool = allowedPool.concat([once])
      state.crossOnce = null
      if (once) reason.push('cross-provider switch to ' + once.id + ' allowed once')
    }
    // ---- ε-greedy exploration (v0.17.1) -------------------------------------
    // The router is deterministic on purpose, and exploration is the single
    // deliberate exception: with probability ε a non-hard step may try a
    // different arm. It ships shadow-first — the draw is recorded and reported
    // but does not move the route unless experiments.apply is set — so the
    // quarterly review can see how often exploration would have fired before
    // anyone lets it fire for real.
    const incumbent = scope === 'effort' || !state.lastRoute ? null : modelIdOf(state.lastRoute)
    const draw = planExperiment({
      enabled: cfg.experiments.enabled,
      apply: cfg.experiments.apply,
      epsilon: cfg.experiments.epsilon,
      stepClass: signals.stepClass,
      current: incumbent,
      arms: allowedPool.map((candidate) => candidate.id),
      random: experimentRandom,
    })
    state.lastExperiment = draw.allowed ? draw : null
    let experimentPool = allowedPool
    if (draw.applied && draw.explore && draw.arm) {
      const forced = allowedPool.filter((candidate) => candidate.id === draw.arm)
      if (forced.length > 0) {
        experimentPool = forced
        reason.push('epsilon-greedy exploration: trying ' + draw.arm + ' this step')
      }
    }
    const choice = chooseEntry(experimentPool, cfg, costSignals, state.usage)
    if (preset) reason.push('task type "' + preset + '"')
    if (plan.frugal) reason.push('frugal signal (' + plan.frugalWhy + ')')

    // ---- model -------------------------------------------------------------
    let entry = choice ? choice.entry : undefined
    let provider = resolved.provider
    let model = resolved.model
    if (scope !== 'effort') {
      // An image step with image routing enabled always lands on the vision model.
      if (plan.visionEntry) {
        entry = plan.visionEntry
        provider = entry.provider
        model = entry.model
        reason.push('image step -> vision model')
      } else if (entry) {
        const rank = (id) => {
          const found = cfg.pool.find((candidate) => candidate.id === id)
          return found && found.tier === 'strong' ? 2 : 1
        }
        // A model the cross-provider guard excluded must not come back through
        // the hysteresis memory, so only an allowed entry is carried over.
        const remembered = allowedPool.some((candidate) => candidate.id === state.hysteresis.model.value)
          ? state.hysteresis.model.value
          : undefined
        const stable = plan.visionEntry
          ? { value: entry.id, streak: 0 }
          : stabilizeRanked(entry.id, remembered, state.hysteresis.model.streak, cfg.hysteresis.downAfter, rank)
        state.hysteresis.model = stable
        // An applied exploration is not a downgrade to be damped: the arm was
        // drawn on purpose, so the memory is set to it before hysteresis runs.
        if (draw.applied && draw.explore && draw.arm && entry && entry.id === draw.arm) {
          state.hysteresis.model = { value: entry.id, streak: 0 }
        }
        const stableEntry = allowedPool.find((candidate) => candidate.id === stable.value)
        if (stableEntry) entry = stableEntry
        provider = entry.provider
        model = entry.model
        if (choice && choice.score !== undefined) reason.push('pool score ' + Math.round(choice.score))
      } else {
        reason.push('no eligible pool model; keeping the session route')
      }
    }

    // ---- effort ------------------------------------------------------------
    let tier = effortTierForClass(cfg, signals.stepClass)
    // v0.15 accepts the full nine-word vocabulary in routes, while the guards
    // below reason in wire terms (off / max). Classify first so "none", "xhigh"
    // and "ultra" cannot bypass the thinking-continuity and allowMax checks
    // before mapEffort() translates the tier for the target model.
    const effortClassOf = (value) => ({ none: 'off', minimal: 'low', medium: 'high', xhigh: 'max', ultra: 'max' }[value] || value)
    // Only an actually configured max-class word is clamped; when max is opted
    // in the word is kept as written so a target that advertises "xhigh" gets it.
    const clamped = effortClassOf(tier) === 'max' && !cfg.allowMax
      ? clampEffort('max', cfg)
      : { effort: tier, changed: false, why: '' }
    if (clamped.changed) reason.push(clamped.why)
    tier = clamped.effort
    if (effortClassOf(tier) === 'off' && !cfg.allowThinkingOff) {
      tier = 'low'
      reason.push('thinking stays on for tool-call continuity')
    }
    let effortStable
    if (signals.poisonedHistory && !cfg.allowThinkingOff) {
      // Safety beats hysteresis: a session whose history already contains a
      // thinking-off tool call must run this very step with thinking off, or the
      // provider rejects the whole history. The downgrade guard would otherwise
      // keep the previous high/max tier for downAfter steps.
      tier = 'off'
      effortStable = { value: 'off', streak: 0 }
      reason.push('history already contains a tool call without thinking')
      if (!state.warned.poisoned) {
        state.warned.poisoned = true
        logger.warn('conversation already contains a tool call without a thinking block; keeping effort off for this session (thinking would be rejected). Start a new session to get thinking back.')
      }
    } else {
      effortStable = stabilize(tier, state.hysteresis.effort.value, state.hysteresis.effort.streak, cfg.hysteresis.downAfter)
    }
    state.hysteresis.effort = effortStable
    tier = effortStable.value

    let effort
    // v0.17.0: the ladder tier and the wire id are not always the same word.
    // explainMapping() names the translation so a collapse is never silent.
    let effortMapped = null
    if (scope === 'model') {
      effort = resolved.reasoningEffort
      if (effort === 'off' && !cfg.allowThinkingOff && isFlashFamily(model, cfg)) {
        effort = 'low'
        reason.push('thinking stays on for tool-call continuity')
      }
    } else {
      // The effort must be worded for the model that will really run the step.
      // In effort scope that is the session's own model — the router never swaps
      // it — so look the pool entry up by that id instead of reusing whatever
      // chooseEntry() scored highest, which could be a different model entirely.
      const resolvedId = modelIdOf(resolved) || 'unknown'
      const target = scope === 'effort'
        ? (cfg.pool.find((candidate) => candidate.id === resolvedId)
          || { id: resolvedId, provider: resolved.provider, model: resolved.model, efforts: undefined })
        : (entry || { id: resolvedId, provider: resolved.provider, model: resolved.model, efforts: undefined })
      const supported = await supportedEfforts(target)
      effort = mapEffort(tier, supported)
      if (effort === undefined) reason.push('target model advertises no reasoning effort')
      effortMapped = explainMapping(tier, effort, modelMeta(target.provider, target.model))
      if (effortMapped.why !== 'exact') {
        reason.push('effort ' + effortMapped.from + ' -> ' + String(effortMapped.to) + ' (' + effortMapped.why + ')')
      }
    }

    // Count the task's strong-tier spend only for the model actually applied.
    if (entry && entry.tier === 'strong' && scope !== 'effort') {
      state.usage[entry.id] = (state.usage[entry.id] || 0) + 1
    }

    // ---- observation event (v0.15) -----------------------------------------
    // One event per routed step, assembled once the decision is final. It is the
    // raw material of the effort-economics reviews and of /router replay: which
    // class/effort/model ran, what it cost in the pool's cost units, and why it
    // was chosen. No prompt text, no message text, no absolute paths.
    const chosenEntry = entry || cfg.pool.find((candidate) => candidate.provider === provider && candidate.model === model)
    const marked = Number.isFinite(state.tokensAtLastStep) ? state.tokensAtLastStep : signals.sessionTokens
    const tokenDelta = Math.max(0, signals.sessionTokens - marked)
    state.tokensAtLastStep = signals.sessionTokens
    const unitCost = chosenEntry && Number.isFinite(chosenEntry.cost) ? chosenEntry.cost : 1
    const costUnits = Math.round((tokenDelta * unitCost / 1e6) * 1e6) / 1e6
    // Token split and USD cost from the model catalog (v0.15.1). The first
    // observed step bills nothing, exactly like tokenDelta; a model the catalog
    // cannot price keeps costUsd null instead of guessing a rate.
    const usageTotals = signals.usageTotals || tokenTotalsOf(null)
    const split = tokenSplit(state.lastUsageTotals || usageTotals, usageTotals)
    state.lastUsageTotals = usageTotals
    const eventAt = Date.now()
    // ---- channel health for the step that just finished (v0.16.1) ----------
    // A step's outcome is visible one step later: the host's token projection
    // grew, which is the only usage evidence this seam offers. The same read
    // verifies the answer's shape, and a channel that keeps answering without
    // usage is quarantined instead of merely cooled down.
    if (state.lastRoute && state.lastRoute.channel) {
      const previous = state.lastRoute
      if (tokenDelta > 0) {
        channelLedger.record(previous.channel, { ok: true, at: eventAt })
        if (cfg.channels.fingerprint) {
          const check = fingerprint({ usage: split }, { requireUsage: true })
          state.lastVerify = {
            channel: previous.channel,
            at: eventAt,
            ok: check.ok,
            reasons: check.reasons,
            atIso: new Date(eventAt).toISOString(),
          }
          if (!check.ok) {
            channelLedger.record(previous.channel, { ok: false, error: check.reasons.join(', '), at: eventAt })
            const row = channelLedger.snapshot(eventAt).channels[previous.channel]
            if (row && row.streak >= cfg.channels.failThreshold && cfg.channels.quarantineMs > 0) {
              quarantined.set(previous.channel, eventAt + cfg.channels.quarantineMs)
              logger.warn('model-router channel ' + previous.channel + ' answered without usable usage ' + row.streak +
                ' times in a row; keeping it out of the pool for ' + Math.round(cfg.channels.quarantineMs / 3600000) + 'h')
            }
          }
        }
      }
    }
    const catalogModel = findModel(provider, model)
    const priceAtStep = catalogModel ? pricesAt(catalogModel, eventAt) : null
    const pricedStep = priceAtStep ? tokenCost(split, priceAtStep) : null
    const price = priceAtStep
      ? {
        currency: priceAtStep.currency,
        unit: priceAtStep.unit,
        effectiveFrom: priceAtStep.effectiveFrom,
        peak: priceAtStep.peak,
        source: priceAtStep.source,
        input: priceAtStep.input,
        output: priceAtStep.output,
        cacheRead: priceAtStep.cacheRead,
        cacheWrite: priceAtStep.cacheWrite,
      }
      : null
    const costUsd = pricedStep ? pricedStep.usd : null
    state.lastSplit = split
    state.cost.sessionTokens = signals.sessionTokens
    state.cost.lastStepCostUnits = costUnits
    state.cost.sessionCostUnits = Math.round((state.cost.sessionCostUnits + costUnits) * 1e6) / 1e6
    state.cost.taskCostUnits = Math.round((state.cost.taskCostUnits + costUnits) * 1e6) / 1e6
    // USD is summed the same way, but only for steps the catalog could price:
    // an unpriced step must not silently look free in the budget guard.
    if (Number.isFinite(costUsd)) {
      state.cost.sessionUsd = Math.round((state.cost.sessionUsd + costUsd) * 1e8) / 1e8
      state.cost.taskUsd = Math.round((state.cost.taskUsd + costUsd) * 1e8) / 1e8
    }
    // ---- shadow decision (v0.16.0) -----------------------------------------
    // costAware ships off, so the router keeps choosing exactly as 0.15.1 did
    // and records what a cost-aware router WOULD have chosen for this same step.
    // The pair (applied, candidate) over real traffic is the evidence that flips
    // the default later; nothing here changes the route.
    let shadow = null
    if (!cfg.costAware && basis.floor !== null) {
      const costChoice = chooseEntry(allowedPool, { ...cfg, costAware: true }, costSignals, state.usage)
      if (costChoice) {
        const appliedId = chosenEntry ? chosenEntry.id : null
        const appliedRate = appliedId ? basis.rates[appliedId] : null
        const candidateRate = basis.rates[costChoice.entry.id]
        const comparable = Number.isFinite(appliedRate) && appliedRate > 0 && Number.isFinite(candidateRate)
        shadow = {
          candidate: costChoice.entry.id,
          current: appliedId,
          agree: costChoice.entry.id === appliedId,
          currentUsdPerMTok: Number.isFinite(appliedRate) ? appliedRate : null,
          candidateUsdPerMTok: Number.isFinite(candidateRate) ? candidateRate : null,
          savedRatio: comparable ? Math.round((1 - candidateRate / appliedRate) * 1e4) / 1e4 : null,
          currentStepUsd: Number.isFinite(costUsd) ? costUsd : null,
          candidateStepUsd: comparable && Number.isFinite(costUsd)
            ? Math.round(costUsd * (candidateRate / appliedRate) * 1e8) / 1e8
            : null,
          costFallback: costChoice.costFallback === true,
        }
      }
    }
    state.lastShadow = shadow
    state.effortMapped = effortMapped
    // The route this step took, so the next step can credit or blame the right
    // channel; and the failover marker when it is leaving a channel that just
    // failed. Both are cleared with the step they describe.
    const routeChannel = chosenEntry ? channelNameOf(chosenEntry) : channelOf(String(provider) + '/' + String(model))
    const failed = state.lastFailure && state.lastFailure.channel ? state.lastFailure.channel : null
    const failoverFrom = failed && failed !== routeChannel ? failed : null
    const peakNow = priceAtStep ? priceAtStep.peak === true : false
    state.lastRoute = {
      entryId: chosenEntry ? chosenEntry.id : null,
      channel: routeChannel,
      provider,
      model,
      at: eventAt,
    }
    state.lastFailure = null
    let cross = 'same'
    if (state.crossProposal) cross = 'proposed'
    else if (anchor && samePool.length > 0 && cfg.crossProvider === 'never') cross = 'never'
    else if (anchor && provider !== anchor) cross = 'switched'
    state.pendingEvent = {
      ts: eventAt,
      session: state.sessionId ? hashSessionId(state.sessionId) : null,
      turn: signals.turn === undefined ? null : signals.turn,
      step: payload && typeof payload.step === 'number' ? payload.step : null,
      policy: ROUTER_POLICY,
      score: signals.score,
      scoreParts: signals.scoreParts || null,
      stepClass: signals.stepClass,
      preset: preset || null,
      frugal: !!plan.frugal,
      candidates: allowedPool
        .map((candidate) => ({ id: candidate.id, score: Math.round(scoreEntry(candidate, preset, cfg, choiceSignals) * 10) / 10 }))
        .sort((left, right) => (right.score - left.score) || (left.id < right.id ? -1 : 1))
        .slice(0, 5),
      chosen: {
        provider,
        model,
        effort: effort === undefined ? null : String(effort),
        tier: (chosenEntry && chosenEntry.tier) || 'unknown',
        cost: chosenEntry ? chosenEntry.cost : null,
        costSource: chosenEntry ? chosenEntry.costSource || 'manual' : null,
      },
      // v0.17.0: how the ladder tier reached the wire (exact / alias / nearest /
      // none) - the raw material of /stats.mapped and the effort-economics review.
      effortMapped,
      reason: [...new Set(reason)].join(', '),
      // v0.16.1: which channel served the step, whether the provider was
      // charging a peak rate for it, whether the peak policy demoted anything,
      // and the channel this step left after a failure.
      channel: routeChannel,
      peak: peakNow,
      peakShifted: peakAvoid.length > 0,
      failoverFrom,
      manualOverride: false,
      cross,
      applied: true,
      costAware: !!cfg.costAware,
      shadow,
      experiment: state.lastExperiment,
      usage: { tokens: tokenDelta, costUnits, split, costUsd, price },
      classifier: state.turnType && state.turnType.turn === signals.turn
        ? {
          used: !!state.turnType.used,
          source: state.turnType.source || null,
          type: state.turnType.type || null,
          confidence: state.turnType.confidence ?? null,
          escalate: state.turnType.escalate === true,
          family: state.turnType.family || null,
          evidence: state.turnType.evidence || null,
        }
        : { used: false, source: null, type: null, confidence: null, escalate: false, family: null, evidence: null },
    }

    // Hand the accumulated reasons back through the signals object the request
    // listener owns, so the panel and /router explain this decision from the UI
    // alone (preset, pool score, a cross-provider review, a failover, clamps).
    // Telemetry already logged the same list.
    signals.reason = [...new Set(reason)]
    const next = { ...resolved, provider, model }
    if (effort === undefined) delete next.reasoningEffort
    else next.reasoningEffort = effort
    return next
  }

  /** Waterfall hook: next() resolves the proposed request, we may reroute. */
  async function onRequest(payload, next) {
    const resolved = await next()
    const agent = payload && payload.agent
    if (!agent) return resolved
    try {
      const state = stateOf(agent)
      const signals = signalsOf(agent, payload)

      const scope = state.control || cfg.control

      // A manual pick always wins immediately and makes the router stand down —
      // but only in the dimension this scope owns (see noteManualSelection).
      if (noteManualSelection(agent, state, scope, resolved) && override.yieldOnManual) {
        state.engaged = false
        state.disengageReason = 'manual'
        if (!state.warned.manual) {
          state.warned.manual = true
          logger.warn('manual model selection detected; routing stands down for this session until the next command or the UI resume action')
        }
      }

      // The effort scope is bound to ONE model the user chose in the panel. Until
      // that pick exists there is nothing to adjust (a level only means something
      // for a known model), and on any other model the router leaves the step
      // completely alone — a model switch is not an override, so it does not stand
      // the router down either.
      const bound = state.effortModel || cfg.effortModel
      let effortReady = true
      if (scope === 'effort') {
        effortReady = bound !== null && bound === modelIdOf(resolved)
        if (!effortReady && cfg.mode === 'auto') {
          if (bound === null) {
            if (!state.warned.effortUnbound) {
              state.warned.effortUnbound = true
              logger.warn('effort scope has no model bound yet; pick exactly one model in the composer panel — the router only adjusts the thinking level of that model')
            }
          } else if (state.warned.effortMismatch !== modelIdOf(resolved)) {
            state.warned.effortMismatch = modelIdOf(resolved)
            logger.info('effort scope is bound to ' + bound + '; this session is on ' + (modelIdOf(resolved) || 'unknown') + ', leaving the step alone')
          }
        }
      }

      const imageLeave = signals.hasImage && cfg.leaveImageSteps && cfg.imagePolicy === 'keep'
      const managed = cfg.mode === 'auto' && manages(resolved, scope === 'effort' ? bound : null) && !imageLeave && effortReady
      if (!managed || !state.engaged) {
        // Nothing is being routed, so any proposal from an earlier step is stale.
        state.crossProposal = null
        return legacyGuards(resolved, signals)
      }
      const presetText = cfg.signals.todos && signals.todoText ? signals.text + '\n' + signals.todoText : signals.text
      const preset = await resolveTaskType(state, presetText, signals)
      const visionEntry = signals.hasImage && cfg.imagePolicy === 'vision' ? visionEntryFor() : null
      const plan = {
        frugal: signals.frugal && !visionEntry,
        frugalWhy: signals.delegationDepth > 0 ? 'subagent' : (signals.pressure !== null && cfg.signals.contextPressure > 0 && signals.pressure >= cfg.signals.contextPressure ? 'context pressure' : 'session budget'),
        visionEntry,
      }
      const nextConfig = await decide(resolved, signals, state, scope, preset, plan, payload)

      // Remember what we applied: the next manual-pick comparison uses it as its
      // baseline, so the router's own route never looks like a user override.
      state.appliedKeys = {
        model: modelIdOf(nextConfig),
        effort: nextConfig.reasoningEffort ? String(nextConfig.reasoningEffort) : 'default',
      }

      const key = nextConfig.provider + '/' + nextConfig.model + '/' + (nextConfig.reasoningEffort ?? '-')
      if (state.lastKey !== key) {
        state.lastKey = key
        logger.info(
          'route turn ' + payload.turn + ' step ' + payload.step +
          ' scope ' + scope + ' class ' + signals.stepClass +
          ' score ' + signals.score +
          ' -> ' + nextConfig.provider + '/' + nextConfig.model +
          ' effort ' + (nextConfig.reasoningEffort ?? 'default') +
          ' (' + (EFFORT_POINTS[nextConfig.reasoningEffort] ?? '?') + ')' +
          (signals.reason.length ? ' [' + signals.reason.join(', ') + ']' : '')
        )
      }
      record(state, payload, {
        scope,
        provider: nextConfig.provider,
        model: nextConfig.model,
        effort: nextConfig.reasoningEffort ?? null,
        stepClass: signals.stepClass,
        score: signals.score,
        preset: preset || null,
        reason: signals.reason.join(', '),
        signals: {
          frugal: plan.frugal,
          pressure: signals.pressure === null ? null : Math.round(signals.pressure * 100) / 100,
          sessionTokens: signals.sessionTokens,
          depth: signals.delegationDepth,
          todo: signals.todoText ? signals.todoText.slice(0, 80) : null,
        },
      }, state.pendingEvent)
      state.pendingEvent = null
      return nextConfig
    } catch (error) {
      logger.warn('router listener failed: ' + String((error && error.message) || error))
      return resolved
    }
  }

  /**
   * Catalog evidence date plus every hard date inside the panel window
   * (v0.15.1): billing changes, price moves and retirements the catalog already
   * knows about. Read-only, and the panel renders a dot when it is not empty.
   */
  function catalogAlerts(withinDays = 30) {
    return {
      evidenceDate: CATALOG.evidenceDate || null,
      withinDays,
      alerts: upcomingAlerts(Date.now(), { withinDays }),
    }
  }

  /**
   * The token-level cost basis of the current pool (v0.16.0).
   *
   * Every pool entry is priced at its own catalog rate, blended over a token
   * mix. The mix is the trailing one this session actually produced when there
   * is one — a DeepSeek session reads cache for ~97% of its tokens, so the
   * shipped default mix would overstate every rate — and the frozen default
   * otherwise. `floor` is the cheapest finite rate in the pool, the reference
   * costGuard.maxMultiple is measured against; it stays null when nothing in
   * the pool can be priced, which turns the cost machinery off rather than
   * guessing.
   *
   * @returns {{rates:Object<string,number|null>,floor:number|null,mix:object,at:number}}
   */
  function costBasis(state) {
    const mix = state && state.lastSplit ? mixFromSplit(state.lastSplit) : DEFAULT_MIX
    const at = Date.now()
    const rates = {}
    const peaks = {}
    let floor = null
    for (const candidate of cfg.pool) {
      const found = findModel(candidate.provider, candidate.model)
      const blended = found ? blendedUsdPerMTok(found, at, mix) : null
      const priceNow = found ? pricesAt(found, at) : null
      rates[candidate.id] = blended ? blended.usdPerMTok : null
      peaks[candidate.id] = !!(priceNow && priceNow.peak === true)
      if (blended && (floor === null || blended.usdPerMTok < floor)) floor = blended.usdPerMTok
    }
    return { rates, floor, peaks, mix, at }
  }

  /**
   * The panel's view of cost-aware routing (v0.16.0): whether it is enabled,
   * what each pool entry costs per million tokens right now, and the shadow
   * decision of the last routed step. Read-only; never throws.
   */
  /**
   * The effort ladder as this host can see it (v0.17.0): the eight tiers, their
   * documented points, and how the last decision's tier reached the wire. The
   * panel uses it to explain a collapse; /stats aggregates the same field over
   * the traffic window.
   */
  function effortReport(state) {
    return {
      ladder: LADDER,
      points: LADDER_POINTS,
      last: state && state.effortMapped ? state.effortMapped : null,
    }
  }

  /**
   * Classifier v2 report (v0.17.1): what the classifier decided for the latest
   * turn, which of the four outcomes it was, and whether the breaker is open.
   * Read-only, so the panel can explain a fallback instead of hiding it.
   */
  function classifierReport(state) {
    const turnType = state && state.turnType && typeof state.turnType === 'object' ? state.turnType : null
    return {
      enabled: cfg.classifier === 'llm',
      minConfidence: cfg.classifierMinConfidence,
      timeoutMs: cfg.classifierTimeoutMs,
      attempts: cfg.classifierAttempts,
      turn: turnType ? turnType.turn : null,
      value: turnType ? turnType.value : null,
      used: !!(turnType && turnType.used),
      source: turnType ? turnType.source || null : null,
      type: turnType ? turnType.type || null : null,
      confidence: turnType && turnType.confidence !== undefined ? turnType.confidence : null,
      escalate: !!(turnType && turnType.escalate),
      family: turnType ? turnType.family || null : null,
      evidence: turnType ? turnType.evidence || null : null,
      signals: turnType && Array.isArray(turnType.signals) ? turnType.signals : [],
      rules: turnType ? turnType.rules || null : null,
      why: turnType ? turnType.why || null : null,
      breaker: classifierBreaker.snapshot(Date.now()),
    }
  }

  /** ε-greedy state (v0.17.1): the config, and the last draw. */
  function experimentsReport(state) {
    return {
      enabled: !!cfg.experiments.enabled,
      apply: !!cfg.experiments.apply,
      epsilon: cfg.experiments.epsilon,
      seed: Number.isFinite(cfg.experiments.seed) ? cfg.experiments.seed : null,
      last: state && state.lastExperiment ? state.lastExperiment : null,
    }
  }

  /** Feedback state for the panel: what it can send, and what was sent last. */
  function feedbackSnapshot(state) {
    const health = feedbackLog.health()
    return {
      enabled: health.enabled,
      labels: [...FEEDBACK_LABELS],
      written: health.written,
      lastError: health.lastError,
      last: state && state.feedback ? state.feedback : null,
      pending: !!(state && state.pendingFeedback),
    }
  }

  /**
   * Record one label for the route the session is running. The route is taken
   * from this session's own last decision, never from the request, so a label
   * can only ever describe what the router actually did.
   */
  function submitFeedback(sessionId, body) {
    const state = sessionId ? sessions.get(sessionId) : undefined
    if (!state) return { ok: false, error: 'no live session with that id yet' }
    const route = state.lastRoute || null
    const current = state.current || null
    const at = Date.now()
    const record = normalizeFeedback(body, {
      at,
      session: state.sessionId ? hashSessionId(state.sessionId) : null,
      provider: route ? route.provider : null,
      model: route ? route.model : null,
      effort: current ? current.effort : null,
      stepClass: current ? current.stepClass : null,
    })
    if (!record) return { ok: false, error: 'label must be one of ' + FEEDBACK_LABELS.join(', ') }
    if (!feedbackLog.append(record)) return { ok: false, error: 'the feedback log could not be written' }
    state.feedback = {
      at: record.at,
      label: record.label,
      provider: record.provider,
      model: record.model,
      effort: record.effort,
      stepClass: record.stepClass,
      outcome: null,
    }
    state.pendingFeedback = {
      at: record.at,
      label: record.label,
      provider: record.provider,
      model: record.model,
    }
    bumpStateVersion()
    return { ok: true, feedback: feedbackSnapshot(state) }
  }

  function costAwareReport(state) {
    const basis = costBasis(state)
    return {
      enabled: !!cfg.costAware,
      costWeight: cfg.scoring.costWeight,
      guard: cfg.costGuard,
      mix: basis.mix,
      floorUsdPerMTok: basis.floor,
      entries: cfg.pool.map((candidate) => {
        const found = findModel(candidate.provider, candidate.model)
        const blended = found ? blendedUsdPerMTok(found, basis.at, basis.mix) : null
        return {
          id: candidate.id,
          tier: candidate.tier,
          priced: !!blended,
          usdPerMTok: blended ? blended.usdPerMTok : null,
          currency: blended ? blended.currency : null,
          peak: blended ? blended.peak : null,
        }
      }),
      shadow: state ? state.lastShadow : null,
    }
  }

  /**
   * The entries the peak policy wants demoted for THIS step (v0.16.1).
   *
   * Shift applies to work that can wait — a delegated or subagent step — and
   * never to a step the user is sitting in front of, which is why the plan calls
   * deferral a scheduling question and not a quality one. The list stays empty
   * unless peakPolicy is "shift" and the catalog is actually charging a peak
   * rate right now, so the shipped policy costs nothing.
   */
  function peakShiftList(signals, basis) {
    if (cfg.peakPolicy !== 'shift') return []
    if (!signals || !(signals.delegationDepth > 0)) return []
    const out = []
    for (const entry of cfg.pool) if (basis.peaks && basis.peaks[entry.id]) out.push(entry.id)
    return out
  }

  /**
   * Waterfall hook: the spend guard (v0.16.1).
   *
   * The one place the router refuses to run at all. It only fires when
   * budget.mode is "block", the ledger says a limit is crossed, and the step
   * carries no fresh user input — swallowing a user's message is worse than a
   * costly call — so an unconfigured router behaves exactly as before. A
   * PreStepDecision carries no text of its own, which is why /state exposes the
   * same numbers and the panel offers the one-shot release.
   */
  async function onPreStep(payload, next) {
    try {
      const agent = payload && payload.agent
      if (agent) {
        const state = stateOf(agent)
        if (state.budgetOnce) {
          state.budgetOnce = false
          state.budgetBlocked = null
          bumpStateVersion()
        } else if (cfg.mode === 'auto' && cfg.budget.mode === 'block') {
          const carriesUserText = Array.isArray(payload.messages)
            && payload.messages.some((message) => message && message.role === 'user')
          if (!carriesUserText) {
            await refreshBudgetLedger(Date.now())
            const report = budgetReportFor(state)
            if (report.exceeded) {
              state.budgetBlocked = { at: Date.now(), over: report.over, line: budgetLine(report) }
              bumpStateVersion()
              if (!state.warned.budget) {
                state.warned.budget = true
                logger.warn('model-router budget is over its hard limit (' + budgetLine(report) +
                  '); this step was refused. Raise the limit, set budget.mode to inform, or allow one more step from the panel (/router budget once).')
              }
              return { kind: 'reject' }
            }
            if (report.soft && !state.warned.budgetSoft) {
              state.warned.budgetSoft = true
              logger.warn('model-router budget is near its limit (' + budgetLine(report) + ')')
            }
          }
        }
      }
    } catch (error) {
      logger.warn('model-router budget gate failed: ' + String((error && error.message) || error))
    }
    return next()
  }

  /**
   * Waterfall hook: channel health and failover (v0.16.1).
   *
   * The host reports a failed request here before it throws. The router records
   * the failure against the channel the step went to — which is how the next
   * step learns to avoid it — and, only when channels.failover is on and a
   * better channel exists, asks for one retry; the host then re-runs the request
   * waterfall, so the retry is routed again and lands elsewhere. With failover
   * off this listener observes and calls next(): the step ends exactly as it did
   * in 0.16.0.
   */
  async function onRequestError(payload, next) {
    try {
      const agent = payload && payload.agent
      const state = agent ? stateOf(agent) : undefined
      const failure = (payload && payload.failure) || {}
      const at = Date.now()
      const provider = payload && typeof payload.provider === 'string' && payload.provider.length > 0
        ? payload.provider
        : (state && state.lastRoute ? state.lastRoute.provider : '')
      const channel = state && state.lastRoute && state.lastRoute.channel
        ? state.lastRoute.channel
        : channelOf(String(provider) + '/')
      const action = classifyFailure({
        status: failure.status,
        code: failure.code,
        timeout: failure.code === 'TIMEOUT',
      })
      channelLedger.record(channel, {
        ok: false,
        status: failure.status,
        timeout: failure.code === 'TIMEOUT',
        error: failure.code || failure.message,
        at,
      })
      if (state) {
        state.lastFailure = {
          channel,
          at,
          code: failure.code || null,
          status: Number.isFinite(failure.status) ? failure.status : null,
          action,
        }
        state.lastError = {
          at,
          channel,
          code: failure.code || null,
          status: Number.isFinite(failure.status) ? failure.status : null,
          action,
          message: String(failure.message || '').slice(0, 160),
        }
        bumpStateVersion()
      }
      // A failed request benches the channel for the retry this listener is
      // about to ask for, so the re-decision cannot land on the same one. Only
      // read by the routing layer when failover is on, so an observe-only router
      // still routes exactly as 0.16.0 did.
      if (cfg.channels.failover && action !== 'none') channelLedger.cool(channel, at, cfg.channels.cooldownMs)
      if (state && cfg.channels.failover && cfg.mode === 'auto' && action !== 'none') {
        const key = String(payload && payload.turn) + ':' + String(payload && payload.step)
        const used = state.failovers.get(key) || 0
        if (used < cfg.channels.maxFailoversPerStep && healthyAlternative(channel, provider)) {
          state.failovers.set(key, used + 1)
          logger.warn('model-router channel ' + channel + ' failed (' + (failure.code || failure.status || 'unknown') +
            '); retrying on another channel')
          return { kind: 'retry' }
        }
      }
    } catch (error) {
      logger.warn('model-router request-error listener failed: ' + String((error && error.message) || error))
    }
    return next()
  }

  // ---- host API used by the composer UI ------------------------------------

  const api = {
    // The panel token the route layer checks on mutations (null = disabled).
    clientToken,
    state(sessionId) {
      const state = sessionId ? sessions.get(sessionId) : undefined
      // A session the UI has already configured may not have run a request yet, so its
      // per-session pick lives only in the store until the first request creates state.
      const saved = sessionId ? store.session(sessionId) : undefined
      const last = lastChoice()
      const savedControl = knownControl(saved && saved.control) || knownControl(last.control)
      const savedTask = knownText(saved && saved.pinnedTaskType) || knownText(last.pinnedTaskType)
      const savedEffortModel = knownText(saved && saved.effortModel) || knownText(last.effortModel)
      const effectiveControl = (state && state.control) || savedControl || cfg.control
      const effectiveEffortModel = (state && state.effortModel) || savedEffortModel || cfg.effortModel
      const effectiveTask = state ? state.pinnedTaskType : savedTask
      // The routing plan, as one comparable key: what the panel highlights until
      // the user confirms it, and what makes an edited plan ask again.
      const poolIds = cfg.pool.map((entry) => entry.id).slice().sort()
      const planKey = [effectiveControl, effectiveEffortModel || '', effectiveTask || '', poolIds.join(',')].join('|')
      const confirmedPlan = state
        ? state.confirmedPlan
        : (saved && typeof saved.confirmedPlan === 'string' ? saved.confirmedPlan : '')
      return {
        ok: true,
        control: state ? state.control : savedControl,
        effectiveControl,
        // The effort scope works on exactly one model, and it is the user's to
        // choose: `effortModel` is this session's own pick (null = inherit) and
        // `effortModelPending` tells the panel to ask before the router engages.
        effortModel: state ? state.effortModel : savedEffortModel,
        effectiveEffortModel,
        effortModelPending: effectiveControl === 'effort' && !effectiveEffortModel,
        // The plan this conversation opens with, plus whether it still needs a
        // confirmation. A conversation inherits the last pick only while it has
        // no entry of its own, so the flag documents where the value came from.
        plan: {
          control: effectiveControl,
          effortModel: effectiveEffortModel,
          taskType: effectiveTask,
          pool: poolIds.length,
          poolIds: poolIds,
        },
        planKey: planKey,
        planConfirmed: confirmedPlan === planKey,
        inherited: !saved && !!(last.control || last.effortModel || last.pinnedTaskType),
        engaged: state ? state.engaged : null,
        disengageReason: state ? state.disengageReason : '',
        pinnedTaskType: state ? state.pinnedTaskType : savedTask,
        pool: cfg.pool.map((entry) => ({ id: entry.id, provider: entry.provider, model: entry.model, cost: entry.cost, costSource: entry.costSource, tier: entry.tier, tags: entry.tags })),
        presets: cfg.presets,
        current: state ? state.current : null,
        decisions: state ? state.decisions : [],
        classifier: cfg.classifier,
        settings: {
          imagePolicy: cfg.imagePolicy,
          classifier: cfg.classifier,
          classifierMinConfidence: cfg.classifierMinConfidence,
          panelBg: cfg.panelBg,
          control: cfg.control,
          crossProvider: cfg.crossProvider,
          signals: cfg.signals,
          subagent: cfg.subagent,
        },
        // Where the panel stands on leaving this conversation's provider (v0.14).
        cross: {
          mode: state && state.crossAllow ? 'allow' : cfg.crossProvider,
          defaultMode: cfg.crossProvider,
          anchor: state ? crossAnchor(state, null) : null,
          allowed: !!(state && state.crossAllow),
          proposal: state ? state.crossProposal : null,
          // v0.16.1: what makes a cross-provider switch worth a review.
          costMultiple: cfg.crossCost.maxMultiple,
          scoreMargin: cfg.crossCost.scoreMargin,
        },
        prices: {
          levels: PRICE_LEVELS,
          remote: store.prices && Array.isArray(store.prices.models)
            ? { fetchedAt: store.prices.fetchedAt || 0, count: store.prices.models.length }
            : null,
          file: basename(store.file),
        },
        hysteresis: cfg.hysteresis,
        maxPerTask: cfg.maxPerTask,
        imagePolicy: cfg.imagePolicy,
        visionModel: cfg.visionModel,
        signals: {
          configured: cfg.signals,
          subagent: cfg.subagent,
          pressure: state && state.current && state.current.signals ? state.current.signals.pressure : null,
          sessionTokens: state && state.current && state.current.signals ? state.current.signals.sessionTokens : 0,
          delegationDepth: state && state.current && state.current.signals ? state.current.signals.depth : 0,
          todo: state && state.current && state.current.signals ? state.current.signals.todo : null,
        },
        sessions: [...sessions.keys()].slice(-20),
        // v0.15 observation surface: revision counter, the session's running
        // spend, classifier health, host-compat self-check and telemetry status.
        stateVersion,
        cost: state ? { ...state.cost } : { sessionTokens: 0, lastStepCostUnits: 0, sessionCostUnits: 0, taskCostUnits: 0 },
        costAware: costAwareReport(state),
        effort: effortReport(state),
        // v0.16.1 surfaces: the channels behind the pool, the spend guard and the
        // peak window. All read-only, so the panel polls them with /state.
        channels: channelsReport(),
        budget: budgetReportFor(state),
        peak: { policy: cfg.peakPolicy, atPeak: poolAtPeak() },
        lastError: state ? state.lastError : null,
        lastVerify: state ? state.lastVerify : null,
        classifier: classifierReport(state),
        experiments: experimentsReport(state),
        feedback: feedbackSnapshot(state),
        classifierStats: { ...classifierStats, breaker: classifierBreaker.snapshot(Date.now()) },
        compat: degraded,
        telemetry: telemetryStatus(),
        catalog: catalogAlerts(),
        storeHealth: store.health(),
        // Bare name only: the panel shows where state lives, not the profile path.
        stateFile: basename(store.file),
      }
    },
    /**
     * Model catalog for the composer UI, built from the live LLM registry the
     * same way the host builds the model selector's catalog: every provider,
     * then its models. A provider that cannot list models is skipped instead of
     * failing the whole request.
     */
    async catalog() {
      const runtime = llm()
      const groups = []
      if (runtime && typeof runtime.listProviders === 'function') {
        for (const provider of runtime.listProviders()) {
          try {
            const models = typeof runtime.listModels === 'function' ? await runtime.listModels(provider.id) : []
            const entries = []
            for (const model of models || []) entries.push({ id: model.id, name: model.name || model.id })
            if (entries.length > 0) groups.push({ id: provider.id, name: provider.name || provider.id, models: entries })
          } catch (error) {
            // A provider whose models cannot be listed is simply left out.
          }
        }
      }
      return { ok: true, groups: groups, pool: cfg.pool.map((entry) => entry.id) }
    },
    /**
     * Aggregated decisions for the panel and for the iteration reviews. The
     * numbers come from the persisted JSONL, not from this process's memory, so
     * they survive a restart and cover sessions no longer open.
     */
    async stats(query) {
      const window = normalizeWindow(query)
      const summary = await telemetry.summarize(window)
      // Attach the catalog's identity/prices to every model row (v0.15.1), so
      // /stats answers "what did this model cost at the catalog rate" and not
      // only in pool cost units. A model outside the catalog is left as-is.
      const now = Date.now()
      summary.byModel = (Array.isArray(summary.byModel) ? summary.byModel : []).map((row) => {
        if (!row || typeof row.key !== 'string') return row
        const slash = row.key.indexOf('/')
        if (slash <= 0) return row
        const model = findModel(row.key.slice(0, slash), row.key.slice(slash + 1))
        const meta = model ? modelMeta(model, now) : null
        return meta ? { ...row, catalog: meta } : row
      })
      summary.catalog = catalogAlerts()
      // Feedback is local and tiny, so /stats reads it directly instead of
      // keeping a second cache in step with the file.
      summary.feedback = aggregateFeedback(feedbackLog.read())
      return { ok: true, ...summary, telemetry: telemetryStatus() }
    },
    setControl(sessionId, control) {
      const next = control === null ? null : (CONTROL_SCOPES.includes(control) ? control : undefined)
      if (next === undefined) return { ok: false, error: 'control must be full, effort, model or null' }
      if (!sessionId) {
        // A brand-new conversation has no session id yet, so the pick becomes the
        // default instead of being dropped on the floor (the UI looked dead there).
        cfg = { ...cfg, control: next === null ? 'full' : next }
        store.settings = { ...(store.settings || {}), control: cfg.control }
        remember({ control: next === null ? 'full' : next })
        return { ok: true, control: null, effectiveControl: cfg.control, defaultScope: true }
      }
      const state = sessionId ? sessions.get(sessionId) : undefined
      if (state) state.control = next
      if (sessionId) store.patchSession(sessionId, { control: next === null ? undefined : next })
      // The conversations that come after this one open on the same scope.
      remember({ control: next })
      return { ok: true, control: next, effectiveControl: next || cfg.control }
    },
    resume(sessionId) {
      const state = sessionId ? sessions.get(sessionId) : undefined
      if (!state) return { ok: false, error: 'unknown session' }
      state.engaged = true
      state.disengageReason = ''
      state.warned.manual = false
      // The pick the user already made stays where it is; adopting it keeps the
      // very next request from reading it as a fresh override and standing
      // straight back down again.
      adoptPending(state, state.agent)
      return { ok: true, engaged: true }
    },
    /**
     * Bind the effort scope to exactly ONE model, or clear the binding. Without a
     * session id this is the deployment default, which is what a brand-new
     * conversation sees.
     */
    setEffortModel(sessionId, model) {
      if (model !== null && model !== undefined && (typeof model !== 'string' || model.length === 0)) {
        return { ok: false, error: 'model must be a non-empty string or null' }
      }
      const next = typeof model === 'string' && model.length > 0 ? model : null
      if (!sessionId) {
        remember({ effortModel: next })
        store.settings = { ...(store.settings || {}), effortModel: next }
        return { ok: true, effortModel: null, effectiveEffortModel: cfg.effortModel, defaultScope: true }
      }
      const state = sessions.get(sessionId)
      if (state) {
        state.effortModel = next
        if (next !== null) {
          // Choosing the model is the user opting back in to effort routing.
          state.engaged = true
          state.disengageReason = ''
          state.warned.manual = false
          adoptPending(state, state.agent)
        }
      }
      store.patchSession(sessionId, { effortModel: next === null ? undefined : next })
      // The bound model is part of the plan the next conversation inherits.
      remember({ effortModel: next })
      return { ok: true, effortModel: next, effectiveEffortModel: next || cfg.effortModel }
    },
    setTaskType(sessionId, preset) {
      const known = preset === null || Object.prototype.hasOwnProperty.call(cfg.presets, preset)
      if (!known) return { ok: false, error: 'unknown task type' }
      const state = sessionId ? sessions.get(sessionId) : undefined
      // A session the UI knows about before its first request still persists the pin.
      if (state) state.pinnedTaskType = preset
      if (sessionId) store.patchSession(sessionId, { pinnedTaskType: preset === null ? undefined : preset })
      // A pinned task type is part of the plan the next conversation inherits.
      remember({ pinnedTaskType: preset })
      return { ok: true, pinnedTaskType: preset }
    },
    /**
     * Mark the plan this conversation is running on as confirmed, which is what
     * clears the panel's highlight. A conversation that never confirmed one
     * (and every conversation the user opens after this) asks again.
     */
    confirmPlan(sessionId, plan) {
      const key = typeof plan === 'string' ? plan : ''
      const state = sessionId ? sessions.get(sessionId) : undefined
      if (state) state.confirmedPlan = key
      if (sessionId) store.patchSession(sessionId, { confirmedPlan: key })
      return { ok: true, planKey: key, planConfirmed: true }
    },
    setPool(pool) {
      if (!Array.isArray(pool)) return { ok: false, error: 'pool must be an array' }
      cfg = withPool(cfg, pool)
      store.pool = pool
      return { ok: true, pool: cfg.pool.map((entry) => entry.id) }
    },
    /**
     * The panel's answer to a cross-provider proposal (v0.14): carry the switch
     * out once, allow this conversation to cross freely, or turn the feature off.
     */
    setCross(sessionId, action) {
      const state = sessionId ? sessions.get(sessionId) : undefined
      if (action === 'allow') {
        if (state) {
          state.crossAllow = true
          state.crossOnce = null
          state.crossProposal = null
        } else {
          // No live conversation yet: make it the deployment default instead of
          // dropping the click on the floor.
          cfg = { ...cfg, crossProvider: 'allow' }
          store.settings = { ...(store.settings || {}), crossProvider: 'allow' }
        }
        return { ok: true, mode: 'allow', session: !!state }
      }
      if (action === 'once') {
        const proposal = state && state.crossProposal
        if (!proposal) return { ok: false, error: 'nothing to approve' }
        state.crossOnce = proposal.id
        state.crossProposal = null
        return { ok: true, once: proposal.id }
      }
      if (action === 'never') {
        cfg = { ...cfg, crossProvider: 'never' }
        store.settings = { ...(store.settings || {}), crossProvider: 'never' }
        for (const candidate of sessions.values()) {
          candidate.crossProposal = null
          candidate.crossAllow = false
          candidate.crossOnce = null
        }
        return { ok: true, mode: 'never' }
      }
      return { ok: false, error: 'action must be allow, once or never' }
    },
    /** Refresh the OpenRouter price snapshot the auto-pricer reads. */
    async refreshPrices() {
      const result = await refreshPrices()
      if (result.ok) return result
      return { ok: false, error: result.error }
    },
    /**
     * Estimate every pool entry's cost label from the built-in family rules and
     * the cached OpenRouter snapshot. Hand-labelled entries are left alone.
     */
    async autoPrice(options) {
      let remote = store.prices || null
      let fetched = null
      if (options && options.fetch === true) {
        const result = await refreshPrices()
        if (!result.ok) return result
        remote = store.prices
        fetched = result.count
      }
      const names = await catalogNames()
      const priced = autoPricePool(cfg.pool, { names: names, remote: remote })
      cfg = withPool(cfg, priced.pool)
      store.pool = priced.pool
      return {
        ok: true,
        source: priced.source,
        changed: priced.changed,
        skipped: priced.skipped,
        fetched: fetched,
        remote: remote && Array.isArray(remote.models) ? { fetchedAt: remote.fetchedAt || 0, count: remote.models.length } : null,
      }
    },
    setPresets(presets) {
      if (!isObject(presets)) return { ok: false, error: 'presets must be an object' }
      cfg = withPresets(cfg, presets)
      store.presets = presets
      return { ok: true, presets: Object.keys(cfg.presets) }
    },
    setSettings(settings) {
      if (!isObject(settings)) return { ok: false, error: 'settings must be an object' }
      cfg = withSettings(cfg, settings)
      store.settings = {
        imagePolicy: cfg.imagePolicy,
        classifier: cfg.classifier,
        classifierMinConfidence: cfg.classifierMinConfidence,
        panelBg: cfg.panelBg,
        crossProvider: cfg.crossProvider,
        signals: cfg.signals,
        subagent: cfg.subagent,
        // A settings save from the panel must not silently unbind the effort
        // scope's chosen model.
        effortModel: cfg.effortModel,
      }
      return { ok: true, settings: store.settings }
    },
    /**
     * The panel's one-shot release for a hard budget stop (v0.16.1): the next
     * step of that session may run, and the gate re-arms after it.
     */
    /** One feedback label from the panel (v0.17.1). */
    feedback(sessionId, body) {
      return submitFeedback(sessionId, body)
    },
    budgetAllowOnce(sessionId, once) {
      const state = sessionId ? sessions.get(sessionId) : undefined
      if (!state) return { ok: false, error: 'no live session with that id yet' }
      state.budgetOnce = once !== false
      state.budgetBlocked = null
      bumpStateVersion()
      return { ok: true, budget: state.budgetOnce }
    },
  }

  /** Human-readable state for the /router command. */
  function describeRoute(state) {
    if (!state) return 'model-router: no live routing state for this session yet.'
    const lines = []
    lines.push('model-router — session ' + (state.sessionId || 'unknown'))
    lines.push('scope: ' + (state.control || (cfg.control + ' (default)')) + ' · ' + (state.engaged ? 'engaged' : 'stood down (' + (state.disengageReason || 'manual') + ')'))
    lines.push('pool: ' + (cfg.pool.length > 0 ? cfg.pool.map((entry) => entry.id).join(', ') : 'none (falling back to ' + cfg.model + ')'))
    lines.push('presets: ' + (Object.keys(cfg.presets).join(', ') || 'none') + ' · classifier: ' + cfg.classifier + ' · images: ' + cfg.imagePolicy)
    const budget = budgetReportFor(state)
    if (budget.rows.some((row) => row.active)) {
      lines.push('budget (' + budget.mode + '): ' + (budgetLine(budget) || 'within limits') + (budget.once ? ' · one step allowed' : ''))
    }
    const health = channelsReport()
    const busy = health.channels.filter((row) => row.total > 0 || !row.available)
    if (busy.length > 0) {
      lines.push('channels: ' + busy.map((row) => row.channel + ' ' + Math.round(row.successRate * 100) + '%' +
        (row.available ? '' : ' cooling') + (row.streak > 0 ? ' streak ' + row.streak : '')).join(' · '))
    }
    if (health.quarantined.length > 0) {
      lines.push('quarantined: ' + health.quarantined.map((row) => row.channel + ' (' + Math.round(row.inMs / 60000) + ' min left)').join(', '))
    }
    if ((state.control || cfg.control) === 'effort') {
      const bound = state.effortModel || cfg.effortModel
      lines.push('effort scope model: ' + (bound || 'none yet — pick exactly one model in the composer panel'))
    }
    if (state.pinnedTaskType) lines.push('pinned task type: ' + state.pinnedTaskType)
    if (state.current) {
      lines.push('current: ' + state.current.provider + '/' + state.current.model +
        ' · effort ' + (state.current.effort || 'default') +
        ' · class ' + state.current.stepClass +
        (state.current.preset ? ' · type ' + state.current.preset : ''))
    }
    for (const decision of state.decisions.slice(-5)) {
      lines.push('  t' + decision.turn + 's' + decision.step + ' ' + decision.provider + '/' + decision.model +
        ' ' + (decision.effort || 'default') + ' [' + decision.stepClass + '] ' + (decision.reason || ''))
    }
    const spent = Object.entries(state.usage || {}).filter(([, count]) => count > 0)
    if (spent.length > 0) lines.push('strong-tier spend this task: ' + spent.map(([id, count]) => id + '×' + count).join(', '))
    return lines.join('\n')
  }

  /**
   * Human-readable replay of the persisted decisions for /router replay [n].
   * Reads the JSONL synchronously so the command handler stays synchronous.
   */
  function describeReplay(args) {
    if (!telemetry.enabled) {
      return 'model-router: telemetry is disabled (DSH_MODEL_ROUTER_TELEMETRY=0), so there is nothing to replay.'
    }
    const requested = args && args.length > 0 ? Number(args[0]) : REPLAY_LIMIT
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(50, Math.floor(requested))) : REPLAY_LIMIT
    const events = telemetry.readRecentSync(limit)
    if (events.length === 0) {
      return 'model-router: no persisted decisions yet — send a message, then run /router replay again.'
    }
    const health = telemetry.health()
    const lines = []
    lines.push('model-router — last ' + events.length + ' persisted decision(s) · ' +
      join(dirname(store.file), 'telemetry') + ' · ' + health.files.length + ' file(s), ' + health.bytes + ' B')
    for (const event of events) {
      const chosen = (event && event.chosen) || {}
      const usage = (event && event.usage) || {}
      const at = typeof event.ts === 'number' ? new Date(event.ts).toISOString() : String(event.ts || '?')
      lines.push('  ' + at +
        ' t' + (event.turn === undefined ? '?' : event.turn) + 's' + (event.step === undefined ? '?' : event.step) +
        ' ' + (chosen.provider || '?') + '/' + (chosen.model || '?') +
        ' ' + (chosen.effort || 'default') +
        ' [' + (event.stepClass || '?') + ']' +
        ' score ' + (event.score === undefined ? '?' : event.score) +
        ' · ' + (usage.tokens === undefined ? 0 : usage.tokens) + ' tok' +
        ' · ' + (usage.costUnits === undefined ? 0 : usage.costUnits) + ' u' +
        (event.reason ? ' · ' + event.reason : ''))
    }
    return lines.join('\n')
  }

  // Listeners auto-dispose with this plugin's fiber (ctx.on owns the effect).
  // prepend keeps the router outermost on the waterfall, so while engaged it has
  // the final word over the host's own model-selection listener.
  ctx.on('agent/inbox/claimed', onClaimed)
  ctx.on('agent/request', onRequest, { prepend: true })
  // v0.16.1: the two hooks the spend guard and channel health need. Both are
  // waterfalls that call next() unless they have a reason not to, so a router
  // with budget.mode "off" and channels.failover false behaves as it did in
  // 0.16.0.
  ctx.on('agent/pre-step', onPreStep)
  ctx.on('agent/request-error', onRequestError)

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => mountRoutes(scope.webServer, api), 'model-router: composer routes')
  })

  // Optional: the per-tool-call route projection the conversation row reads.
  // Without it the router still works; the row simply has nothing to show.
  ctx.inject(['sessionProjections'], (scope) => {
    scope.effect(
      () => scope.sessionProjections.register(routeProjection),
      'model-router: route projection',
    )
  })

  // Optional: an argument-free /router command for the same picture in chat.
  ctx.inject(['commands'], (scope) => {
    scope.effect(() => scope.commands.register({
      definitionId: 'dsh-model-router/router',
      name: 'router',
      description: "Show the model router's scope, pool and recent decisions",
      handler: (commandCtx, invocation) => {
        const args = commandArgs(invocation)
        if (args[0] === 'budget') {
          const state = invocation && invocation.agent ? stateOf(invocation.agent) : undefined
          if (args[1] === 'once') {
            if (!state) return { kind: 'success', text: 'model-router: no live routing state for this session yet.' }
            state.budgetOnce = true
            state.budgetBlocked = null
            bumpStateVersion()
            return { kind: 'success', text: 'model-router: the next step of this session may run even though the budget is over.' }
          }
          const report = budgetReportFor(state)
          const lines = ['model-router — budget ' + report.mode + (report.once ? ' · one step allowed' : '')]
          const active = report.rows.filter((row) => row.active)
          if (active.length === 0) lines.push('  no limits configured (budget.sessionTokens / sessionUsd / dayUsd / monthUsd)')
          for (const row of active) lines.push('  ' + formatBudgetRow(row))
          if (report.blocked) lines.push('  last refusal: ' + (report.blocked.line || '') + ' at ' + new Date(report.blocked.at).toISOString())
          if (report.over.length > 0) lines.push('  over: ' + report.over.join(', ') + ' — /router budget once allows one more step')
          return { kind: 'success', text: lines.join('\n') }
        }
        if (args[0] === 'replay') {
          return { kind: 'success', text: describeReplay(args.slice(1)) }
        }
        return {
          kind: 'success',
          text: describeRoute(invocation && invocation.agent ? stateOf(invocation.agent) : undefined),
        }
      },
    }), 'model-router: /router command')
  })

  logger.info(
    'model-router ready: policy=pool-v0.5 mode=' + cfg.mode +
    ' control=' + cfg.control +
    ' pool=' + cfg.pool.length + ' (' + cfg.pool.map((entry) => entry.id).join(', ') + ')' +
    ' presets=' + Object.keys(cfg.presets).length +
    ' allowMax=' + (cfg.allowMax ? 'yes' : 'no') +
    ' allowThinkingOff=' + (cfg.allowThinkingOff ? 'yes' : 'no') +
    ' classifier=' + cfg.classifier +
    ' telemetry=' + (telemetry.enabled ? 'on' : 'off') +
    ' channels=' + (cfg.channels.failover ? 'failover' : 'observe-only') +
    ' budget=' + cfg.budget.mode +
    ' peak=' + cfg.peakPolicy +
    ' effortModel=' + (cfg.effortModel || 'unset') +
    ' yieldOnManual=' + (override.yieldOnManual ? 'yes' : 'no')
  )
}
