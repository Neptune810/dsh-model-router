/**
 * dsh-model-router — per-tool-call route projection (v0.8.0).
 *
 * WHY: the user asked to see, next to every tool call, the model and thinking
 * level that actually ran that segment. The conversation surface offers exactly
 * one seam for that: a NEW conversation row. A keyed slot replaces whatever it
 * hits (so decorating the shipped tool row would delete it) and the thinking
 * chain is rendered inside AssistantNodeView without a child slot, so the plugin
 * folds the routing envelope itself and hands the client a per-call table.
 *
 * The shape below is a durable contract with client/client.js — bump
 * stateVersion whenever it changes, and keep it plain JSON: the projection
 * registry structuredClones the state for checkpointing and replays it.
 *
 *   header = { provider, model, effort } | null   from 'request/header'
 *   at     = { turn, step } | null                from 'step/start'
 *   calls  = { [callId]: { turn, step, provider, model, effort } }  from 'tool/call'
 *   order  = [callId, ...]                        oldest first, for the cap
 *
 * 'request/header' is emitted only when the envelope changes and carries no
 * turn/step, while 'tool/call' carries both but not the effort — folding all
 * three (plus the router's own decision, which the client already has) is the
 * only way to label a call exactly.
 */

/** Tool calls kept per session; the oldest are dropped past this. */
const CALL_LIMIT = 200

/** JSON-safe text, or null for a missing value. */
function textOf(value) {
  return value === undefined || value === null ? null : String(value)
}

/** JSON-safe turn/step number, or null. */
function numberOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Session projection: the model + effort in force for every tool call.
 * Registered by lib/index.js with ctx.inject(['sessionProjections'], ...).
 */
export const routeProjection = {
  key: 'modelRouterRoute',
  stateVersion: 1,
  stateSchema: { parse: (value) => value },

  init: () => ({ header: null, at: null, calls: {}, order: [] }),

  apply(state, event) {
    const type = event ? event.type : undefined
    const data = (event && event.data) || {}

    if (type === 'request/header') {
      const config = data.header ? data.header.config : undefined
      if (!config) return state
      const next = {
        provider: textOf(config.provider),
        model: textOf(config.model),
        // The adapter may own the default: it deletes reasoningEffort when
        // adapterDefaults.reasoningEffort is true, so absence is meaningful.
        // An explicit null means the same thing, and must not become "null".
        effort: config.reasoningEffort === undefined || config.reasoningEffort === null
          ? null
          : String(config.reasoningEffort),
      }
      const previous = state.header
      if (
        previous &&
        previous.provider === next.provider &&
        previous.model === next.model &&
        previous.effort === next.effort
      ) {
        return state
      }
      return { ...state, header: next }
    }

    if (type === 'step/start') {
      const next = { turn: numberOf(data.turn), step: numberOf(data.step) }
      const previous = state.at
      if (previous && previous.turn === next.turn && previous.step === next.step) return state
      return { ...state, at: next }
    }

    if (type === 'tool/call') {
      const callId = textOf(data.callId)
      if (callId === null) return state
      const header = state.header || {}
      const at = state.at || {}
      const turn = at.turn === undefined || at.turn === null ? numberOf(data.turn) : at.turn
      const step = at.step === undefined || at.step === null ? numberOf(data.step) : at.step
      const entry = {
        turn,
        step,
        provider: header.provider === undefined ? null : header.provider,
        model: header.model === undefined ? null : header.model,
        effort: header.effort === undefined ? null : header.effort,
      }
      const calls = { ...state.calls, [callId]: entry }
      // Integer-like call ids are ordered numerically by the engine, so the cap
      // follows an explicit oldest-first list instead of Object.keys.
      const known = state.order || []
      const order = known.includes(callId) ? known : known.concat([callId])
      if (order.length <= CALL_LIMIT) return { ...state, calls, order }
      const excess = order.length - CALL_LIMIT
      for (const dropped of order.slice(0, excess)) delete calls[dropped]
      return { ...state, calls, order: order.slice(excess) }
    }

    return state
  },

  wire: {
    viewSchema: { parse: (value) => value },
    view: (state) => ({ calls: state.calls, latest: state.header }),
  },
}
