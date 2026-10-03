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
  activeTodoText,
  chooseEntry,
  contextPressureRatio,
  effortTierForClass,
  manualOverridePolicy,
  mapEffort,
  matchPreset,
  sessionTokensOf,
  stabilize,
} from './routing.js'
import { normalizeRuntimeConfig, withPool, withPresets, withSettings } from './config.js'
import { createStore } from './store.js'
import { mountRoutes } from './routes.js'
import { routeProjection } from './route-projection.js'

export const name = 'dsh-model-router'
export const inject = []

/** How many recent decisions a session keeps for the UI. */
const DECISION_LOG_LIMIT = 20
/** Effort vocabulary assumed for the configured DeepSeek family. */
const DEEPSEEK_EFFORTS = Object.freeze(['off', 'low', 'high', 'max'])

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

/** Hysteresis over an arbitrary ranked value (used for the model choice). */
function stabilizeRanked(desired, previous, streak, downAfter, rank) {
  const limit = Number.isFinite(downAfter) && downAfter > 0 ? downAfter : 1
  if (previous === undefined || previous === null) return { value: desired, streak: 0 }
  if (desired === previous) return { value: previous, streak: 0 }
  if (rank(desired) >= rank(previous)) return { value: desired, streak: 0 }
  const next = (Number(streak) || 0) + 1
  return next >= limit ? { value: desired, streak: 0 } : { value: previous, streak: next }
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
  const store = createStore()
  if (Array.isArray(store.pool) && store.pool.length > 0) cfg = withPool(cfg, store.pool)
  if (isObject(store.presets)) cfg = withPresets(cfg, store.presets)
  if (isObject(store.settings)) cfg = withSettings(cfg, store.settings)
  const override = manualOverridePolicy(cfg)

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
      // Which routing plan this conversation has confirmed. Always empty on a new
      // conversation, so the panel highlights the plan again every time.
      confirmedPlan: '',
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
      delegationDepth: depthOf(agent),
      frugal: false,
    }
    const projections = service('sessionProjections')
    if (projections && typeof projections.stateOf === 'function' && agent && agent.session) {
      const read = (key) => { try { return projections.stateOf(agent.session, key) } catch (_unreadable) { return undefined } }
      if (cfg.signals.todos) out.todoText = activeTodoText(read('todos'))
      out.pressure = contextPressureRatio(read('contextPressure'))
      out.sessionTokens = sessionTokensOf(read('tokenUsage'))
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
   * operator opted into `classifier: llm` — one small model call per turn,
   * falling back to the rules on any failure.
   */
  async function resolveTaskType(state, text, signals) {
    if (state.pinnedTaskType) return state.pinnedTaskType
    const names = Object.keys(cfg.presets)
    if (cfg.classifier !== 'llm' || names.length === 0) return matchPreset(cfg, text)
    if (state.turnType && state.turnType.turn === signals.turn) return state.turnType.value
    const classified = await classifyWithLlm(text, names)
    const value = classified !== null ? classified : matchPreset(cfg, text)
    state.turnType = { turn: signals.turn, value }
    return value
  }

  /** One bounded classifier call; any failure means "use the rules". */
  async function classifyWithLlm(text, names) {
    const runtime = llm()
    if (!runtime || typeof runtime.stream !== 'function') return null
    const entry = (cfg.classifierModel && cfg.pool.find((candidate) => candidate.id === cfg.classifierModel)) || cfg.pool[0]
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined
    const timer = controller ? setTimeout(() => controller.abort(), cfg.classifierTimeoutMs) : undefined
    let answer = ''
    try {
      const prompt = 'Pick the single best task type for the step below, or answer none.\n'
        + 'Types: ' + names.join(', ') + '\n'
        + 'Step: ' + String(text).slice(0, 1200) + '\n'
        + 'Answer with one type name only.'
      const stream = runtime.stream({
        provider: entry ? entry.provider : cfg.provider,
        model: entry ? entry.model : cfg.model,
        reasoningEffort: 'off',
        maxTokens: 24,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        ...(controller ? { signal: controller.signal } : {}),
      })
      for await (const chunk of stream) {
        if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') answer += chunk.text
        if (answer.length > 200) break
      }
    } catch (_classifierFailed) {
      return null
    } finally {
      if (timer) clearTimeout(timer)
    }
    const lower = answer.toLowerCase()
    for (const name of names) {
      if (lower.includes(name.toLowerCase())) return name
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
    return { ...base, ...projectionSignals(agent, state), stepClass, score: scored.score, reason }
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

  function record(state, payload, decision) {
    state.current = decision
    state.decisions.push({ turn: payload.turn, step: payload.step, ...decision })
    if (state.decisions.length > DECISION_LOG_LIMIT) state.decisions.shift()
  }

  /** Build the request the router wants to send. */
  async function decide(resolved, signals, state, scope, preset, plan) {
    const choiceSignals = {
      ...signals,
      presetName: preset,
      stepClass: signals.stepClass,
      preferCheap: plan.frugal,
      visionModel: cfg.visionModel,
    }
    const choice = chooseEntry(cfg.pool, cfg, choiceSignals, state.usage)
    const reason = [...signals.reason]
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
        const stable = plan.visionEntry
          ? { value: entry.id, streak: 0 }
          : stabilizeRanked(entry.id, state.hysteresis.model.value, state.hysteresis.model.streak, cfg.hysteresis.downAfter, rank)
        state.hysteresis.model = stable
        const stableEntry = cfg.pool.find((candidate) => candidate.id === stable.value)
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
    const clamped = clampEffort(tier, cfg)
    if (clamped.changed) reason.push(clamped.why)
    tier = clamped.effort
    if (tier === 'off' && !cfg.allowThinkingOff) {
      tier = 'low'
      reason.push('thinking stays on for tool-call continuity')
    }
    if (signals.poisonedHistory && !cfg.allowThinkingOff) {
      tier = 'off'
      reason.push('history already contains a tool call without thinking')
      if (!state.warned.poisoned) {
        state.warned.poisoned = true
        logger.warn('conversation already contains a tool call without a thinking block; keeping effort off for this session (thinking would be rejected). Start a new session to get thinking back.')
      }
    }
    const effortStable = stabilize(tier, state.hysteresis.effort.value, state.hysteresis.effort.streak, cfg.hysteresis.downAfter)
    state.hysteresis.effort = effortStable
    tier = effortStable.value

    let effort
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
    }

    // Count the task's strong-tier spend only for the model actually applied.
    if (entry && entry.tier === 'strong' && scope !== 'effort') {
      state.usage[entry.id] = (state.usage[entry.id] || 0) + 1
    }

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
      if (!managed || !state.engaged) return legacyGuards(resolved, signals)
      const presetText = cfg.signals.todos && signals.todoText ? signals.text + '\n' + signals.todoText : signals.text
      const preset = await resolveTaskType(state, presetText, signals)
      const visionEntry = signals.hasImage && cfg.imagePolicy === 'vision' ? visionEntryFor() : null
      const plan = {
        frugal: signals.frugal && !visionEntry,
        frugalWhy: signals.delegationDepth > 0 ? 'subagent' : (signals.pressure !== null && cfg.signals.contextPressure > 0 && signals.pressure >= cfg.signals.contextPressure ? 'context pressure' : 'session budget'),
        visionEntry,
      }
      const nextConfig = await decide(resolved, signals, state, scope, preset, plan)

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
      })
      return nextConfig
    } catch (error) {
      logger.warn('router listener failed: ' + String((error && error.message) || error))
      return resolved
    }
  }

  // ---- host API used by the composer UI ------------------------------------

  const api = {
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
        pool: cfg.pool.map((entry) => ({ id: entry.id, provider: entry.provider, model: entry.model, cost: entry.cost, tier: entry.tier, tags: entry.tags })),
        presets: cfg.presets,
        current: state ? state.current : null,
        decisions: state ? state.decisions : [],
        classifier: cfg.classifier,
        settings: {
          imagePolicy: cfg.imagePolicy,
          classifier: cfg.classifier,
          panelBg: cfg.panelBg,
          control: cfg.control,
          signals: cfg.signals,
          subagent: cfg.subagent,
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
        stateFile: store.file,
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
        panelBg: cfg.panelBg,
        signals: cfg.signals,
        subagent: cfg.subagent,
        // A settings save from the panel must not silently unbind the effort
        // scope's chosen model.
        effortModel: cfg.effortModel,
      }
      return { ok: true, settings: store.settings }
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

  // Listeners auto-dispose with this plugin's fiber (ctx.on owns the effect).
  // prepend keeps the router outermost on the waterfall, so while engaged it has
  // the final word over the host's own model-selection listener.
  ctx.on('agent/inbox/claimed', onClaimed)
  ctx.on('agent/request', onRequest, { prepend: true })

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
      handler: (commandCtx, invocation) => ({
        kind: 'success',
        text: describeRoute(invocation && invocation.agent ? stateOf(invocation.agent) : undefined),
      }),
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
    ' effortModel=' + (cfg.effortModel || 'unset') +
    ' yieldOnManual=' + (override.yieldOnManual ? 'yes' : 'no')
  )
}
