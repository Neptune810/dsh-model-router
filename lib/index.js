/**
 * dsh-model-router — flash-only effort routing for DeepSeek Harness.
 *
 * Host-only bundle plugin. It listens on the agent-scoped request pipeline and,
 * per step, derives what KIND of work the current step is, then sets the
 * reasoning effort of the DeepSeek flash model to match. The model never
 * changes: this router only decides how hard a step should think.
 *
 * Policy v0.3 (see lib/policy.js for the full rationale):
 *   trivial     -> effort off   (cheap intent, short step)
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
   * Fold newly appended messages into the current task's evidence counters.
   * Tool results are user-role messages carrying { type: "tool-result" } blocks.
   */
  function scanFresh(state, messages) {
    if (messages.length < state.seenMessages) {
      // The projection shrank (compaction, branch switch): resync, do not scan.
      state.seenMessages = messages.length
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
        const nextConfig = {
          ...resolved,
          provider: cfg.provider,
          model: decision.model,
          reasoningEffort: decision.effort,
        }
        const key = cfg.provider + "/" + decision.model + "/" + decision.effort
        if (state.lastKey !== key) {
          state.lastKey = key
          const why = decision.reason.length ? " [" + decision.reason.join(", ") + "]" : ""
          const moved = resolved.model !== decision.model ? " [moved off " + resolved.model + "]" : ""
          logger.info(
            "route turn " + payload.turn + " step " + payload.step +
            " class " + decision.stepClass + " score " + decision.score +
            " -> " + decision.model + " effort " + decision.effort +
            " (" + (EFFORT_POINTS[decision.effort] ?? "?") + ")" + moved + why
          )
        }
        return nextConfig
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
    " demoteManualMax=" + (cfg.demoteManualMax ? "yes" : "no")
  )
}
