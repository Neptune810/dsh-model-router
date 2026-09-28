/**
 * dsh-model-router — flash-only effort routing for DeepSeek Harness.
 *
 * Host-only bundle plugin. It listens on the agent-scoped request pipeline and,
 * per step, derives what KIND of work the current step is, then sets the
 * reasoning effort of the DeepSeek flash model to match. The model never
 * changes: this router only decides how hard a step should think.
 *
 * Policy v0.3 (see lib/policy.js for the full rationale):
 *   trivial     -> effort low   (cheap intent, short step; thinking stays on)
 *   standard    -> effort low
 *   engineering -> effort high  (the workhorse: code, diffs, tool loops)
 *   hard        -> effort max   (opt-in only; clamped to maxFallback otherwise)
 *
 * What matters in a long session:
 *   - No ratchet. v0.1 accumulated tool calls and turn depth over the whole
 *     session and fed them into the score, so any long agent run drifted to the
 *     most expensive effort. Here, turn depth contributes nothing by default and
 *     tool counts are counted PER TASK, so a long run stays at "high".
 *   - Escalation needs evidence: escalateOnErrors failed tool results, or the
 *     same tool call retried with identical arguments, inside the current task.
 *   - "max" is opt-in, not earned: auto routing stops at maxFallback unless
 *     allowMax is set, and a manual max on a managed model is demoted too.
 *   - Thinking stays on. DeepSeek rejects a thinking-enabled request whose
 *     history contains an assistant tool call produced while thinking was
 *     disabled ("The `content[].thinking` in the thinking mode must be passed
 *     back to the API"). A cheap step can still call a tool, so letting one step
 *     run at effort off and the next at high fails the turn; "off" is reachable
 *     only through the explicit allowThinkingOff escape hatch. A conversation
 *     that already contains such a poisoned turn is detected and pinned to
 *     effort off (the only accepted mode) instead of failing every step.
 *   - Task boundaries come from agent/inbox/claimed, which is what actually
 *     opens a new piece of work; the previous task's failures can carry ONE
 *     hesitant step up, and nothing more.
 *
 * Mode: "auto" (default) routes by step shape; "off" passes requests through
 * (except the manual-max rule). Toggle via the profile row config (mode) or
 * DSH_MODEL_ROUTER=off|auto at boot.
 */

import {
  EFFORT_POINTS,
  normalizeConfig,
  decideRoute,
  textOfContent,
  contentHasImage,
  isFlashFamily,
  toolCallsOf,
  toolErrorsOf,
  toolCallWithoutReasoning,
} from "./policy.js"

export const name = "dsh-model-router"
export const inject = []

/** Plain text of one claimed user message (content may be blocks or a string). */
function claimedText(message) {
  if (!message) return ""
  if (typeof message.content === "string") return message.content
  if (Array.isArray(message.content)) {
    const text = textOfContent(message.content)
    const hasImage = contentHasImage(message.content)
    return hasImage ? text + " [image attached]" : text
  }
  return ""
}

/** Last user message text, as a fallback when no claim was observed yet. */
function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (!msg) continue
    const role = typeof msg.role === "string" ? msg.role : msg.type
    if (role === "user") {
      if (Array.isArray(msg.content)) {
        const text = textOfContent(msg.content)
        if (text.trim()) return text
      } else if (typeof msg.content === "string" && msg.content.trim()) {
        return msg.content
      }
    }
    if (i < Math.max(0, messages.length - 8)) break
  }
  return ""
}

export function apply(ctx, config) {
  const logger = typeof ctx.logger === "function"
    ? ctx.logger("model-router")
    : (ctx.logger && typeof ctx.logger.info === "function" ? ctx.logger : console)
  const cfg = normalizeConfig(config && typeof config === "object" ? config : {})

  // Environment escape hatch (read at boot; row config wins for other keys).
  const envMode = typeof process !== "undefined" ? process.env.DSH_MODEL_ROUTER : undefined
  if (envMode === "off" || envMode === "auto") cfg.mode = envMode

  /** Per-agent state. One entry per live agent; nothing is shared across agents. */
  const states = new WeakMap()
  function stateOf(agent) {
    let state = states.get(agent)
    if (state === undefined) {
      state = {
        claimed: new Map(),   // turn -> accumulated user text
        lastTurn: -1,
        seenMessages: 0,      // projection watermark for incremental scanning
        taskOpen: false,
        taskToolCalls: 0,     // evidence, counted inside the current task only
        taskErrors: 0,
        taskRepeats: 0,
        seenCalls: new Map(), // tool-call key -> times seen in this task
        hasImage: false,
        carry: 0,
        lastKey: "",
        poisonedHistory: false, // a tool call already exists with thinking off
        warnedPoisoned: false,
      }
      states.set(agent, state)
    }
    return state
  }

  /** Collect messages through the session projection (never the raw log). */
  function messagesOf(agent) {
    try {
      if (agent && agent.session && typeof agent.session.deriveMessages === "function") {
        return agent.session.deriveMessages()
      }
    } catch (error) {
      logger.warn("deriveMessages failed: " + String((error && error.message) || error))
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
      const role = typeof msg.role === "string" ? msg.role : msg.type
      if (role === "assistant" && toolCallWithoutReasoning(msg.content)) return true
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
      const role = typeof msg.role === "string" ? msg.role : msg.type
      if (role === "assistant") {
        if (toolCallWithoutReasoning(content)) state.poisonedHistory = true
        for (const call of toolCallsOf(content)) {
          state.taskToolCalls += 1
          const seen = state.seenCalls.get(call.key) || 0
          state.seenCalls.set(call.key, seen + 1)
          if (seen >= 1) state.taskRepeats += 1
        }
      } else if (role === "user") {
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
   * A claimed user message opens a new task. Evidence is retired here, except
   * that a task ending on an unresolved failure carries ONE hesitant step up.
   */
  function onClaimed(payload) {
    const agent = payload && payload.agent
    const message = payload && payload.message
    if (!agent || !message) return
    const text = claimedText(message)
    if (!text) return
    const state = stateOf(agent)
    const turn = typeof payload.turn === "number" ? payload.turn : state.lastTurn

    if (state.taskOpen) {
      state.carry = cfg.carryUnresolved && state.taskErrors > 0 ? 1 : 0
    }
    state.taskOpen = true
    state.taskToolCalls = 0
    state.taskErrors = 0
    state.taskRepeats = 0
    state.seenCalls = new Map()
    state.hasImage = false
    state.claimed.set(turn, (state.claimed.get(turn) || "") + "\n" + text)
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

  /** Signals for the current step, computed from claims + session projection. */
  function signalsOf(agent, payload) {
    const state = stateOf(agent)
    const messages = messagesOf(agent)
    const turn = typeof payload.turn === "number" ? payload.turn : state.lastTurn
    scanFresh(state, messages)
    if (turn > state.lastTurn) state.lastTurn = turn

    let text = state.claimed.get(turn)
    if (text === undefined) {
      // Claim events may not cover resumed windows; fall back to the projection.
      text = lastUserText(messages)
    }
    return {
      text: text || "",
      turn,
      toolCalls: state.taskToolCalls,
      hasImage: state.hasImage || /\[image attached\]/.test(text || ""),
      escalations: escalationsFor(state),
      carry: state.carry,
      poisonedHistory: state.poisonedHistory,
    }
  }

  /** Waterfall hook: next() resolves the proposed request, we may reroute. */
  async function onRequest(payload, next) {
    const resolved = await next()
    const agent = payload && payload.agent
    if (!agent) return resolved
    try {
      const state = stateOf(agent)
      const signals = signalsOf(agent, payload)
      const decision = decideRoute(cfg, resolved, signals)

      if (decision) {
        // Continuity recovery: once the conversation holds a tool call generated
        // with thinking off, the API rejects every thinking-enabled request from
        // then on, so the only way to keep this session alive is to stay off.
        const forcedOff = signals.poisonedHistory && !cfg.allowThinkingOff
        const effort = forcedOff ? "off" : decision.effort
        if (forcedOff && !state.warnedPoisoned) {
          state.warnedPoisoned = true
          logger.warn(
            "conversation already contains a tool call without a thinking block; " +
            "keeping effort off for this session (thinking would be rejected). " +
            "Start a new session to get thinking back."
          )
        }
        const nextConfig = {
          ...resolved,
          provider: cfg.provider,
          model: decision.model,
          reasoningEffort: effort,
        }
        const key = cfg.provider + "/" + decision.model + "/" + effort
        if (state.lastKey !== key) {
          state.lastKey = key
          const why = decision.reason.length ? " [" + decision.reason.join(", ") + "]" : ""
          const moved = resolved.model !== decision.model ? " [moved off " + resolved.model + "]" : ""
          logger.info(
            "route turn " + payload.turn + " step " + payload.step +
            " class " + decision.stepClass + " score " + decision.score +
            " -> " + decision.model + " effort " + effort +
            " (" + (EFFORT_POINTS[effort] ?? "?") + ")" + moved + why
          )
        }
        return nextConfig
      }

      // Rule 5 — a manually selected "off" is refused on a managed model too:
      // the next thinking-enabled step of the conversation would be rejected.
      if (cfg.mode === "auto" && !cfg.allowThinkingOff && !signals.poisonedHistory && resolved.reasoningEffort === "off" && isFlashFamily(resolved.model, cfg)) {
        logger.warn(
          "managed model " + resolved.model + " asked for effort off; raised to low " +
          "(thinking is required for tool-call continuity; set allowThinkingOff: true to keep it)"
        )
        return { ...resolved, reasoningEffort: "low" }
      }

      // Rule 4 — a manually selected max is opt-in as well, but only for the
      // models this router manages; other models are left alone.
      if (cfg.demoteManualMax && !cfg.allowMax && resolved.reasoningEffort === "max" && isFlashFamily(resolved.model, cfg)) {
        logger.warn(
          "managed model " + resolved.model + " asked for effort max; demoted to " +
          cfg.maxFallback + " (set allowMax: true to keep it)"
        )
        return { ...resolved, reasoningEffort: cfg.maxFallback }
      }
      return resolved
    } catch (error) {
      logger.warn("router listener failed: " + String((error && error.message) || error))
      return resolved
    }
  }

  // Listeners auto-dispose with this plugin's fiber (ctx.on owns the effect).
  ctx.on("agent/inbox/claimed", onClaimed)
  ctx.on("agent/request", onRequest)

  logger.info(
    "model-router ready: policy=flash-only-v0.3 mode=" + cfg.mode +
    " provider=" + cfg.provider + " model=" + cfg.model +
    " allowMax=" + (cfg.allowMax ? "yes" : "no") +
    " demoteManualMax=" + (cfg.demoteManualMax ? "yes" : "no") +
    " allowThinkingOff=" + (cfg.allowThinkingOff ? "yes" : "no")
  )
  if (cfg.allowThinkingOff) {
    logger.warn(
      "model-router: allowThinkingOff is on — a non-thinking step that calls a tool " +
      "will fail every later thinking-enabled step of the same conversation"
    )
  }
}
