/**
 * dsh-model-router — pure routing layer (v0.5).
 *
 * Everything here is deterministic and import-free so it can be unit tested
 * anywhere. The host plugin (lib/index.js) supplies session state and the LLM
 * catalog; this module decides WHICH pool model a step should use, HOW HARD it
 * should think, and when a decision is stable enough to apply.
 *
 * Vocabulary
 *   - control scope: "full" (model + effort) | "effort" (effort only) | "model" (model only)
 *   - internal effort tier: off | low | high | max  (the router's own ladder)
 *   - a target model may advertise a different vocabulary; mapEffort() translates.
 *   - task type: a user-defined preset ("novel continuation", "refactor", ...) with
 *     per-model weights. A pinned type (chosen in the UI) always wins over rules.
 */

/** The router's own effort ladder, ascending. */
export const INTERNAL_EFFORTS = Object.freeze(["off", "low", "high", "max"])

/** Known adapter effort identifiers, used to pick the nearest supported one. */
export const EFFORT_RANK = Object.freeze({
  off: 0,
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
  ultra: 7,
})

export const CONTROL_SCOPES = Object.freeze(["full", "effort", "model"])

/**
 * How conservative a switch between model PROVIDERS is, as opposed to a switch
 * between two models of the same provider (v0.14):
 *   "allow"   — a cross-provider pick is a normal routing decision
 *   "confirm" — the router keeps the conversation's provider and proposes the
 *               switch in the panel instead (only when that provider is in the pool)
 *   "never"   — pool entries outside the conversation's provider are not candidates
 */
export const CROSS_MODES = Object.freeze(["allow", "confirm", "never"])

/** Where a pool entry's cost label came from. */
export const COST_SOURCES = Object.freeze(["manual", "builtin", "openrouter"])

/** Shipped defaults for the routing layer. */
export const ROUTING_DEFAULTS = Object.freeze({
  /** Authorization scope: what the router is allowed to choose. */
  control: "full",
  /** Manual-override policy. */
  manualOverride: Object.freeze({
    yieldOnManual: true,
    resumeOnNextCommand: true,
  }),
  /** Whitelist. Models outside it are never selected. Empty = legacy single-model mode. */
  pool: Object.freeze([]),
  /** User-defined task types: { name: { match: [...], weights: { entryId: 0-100 } } }. */
  presets: Object.freeze({}),
  /** Score shaping. */
  scoring: Object.freeze({
    costPenalty: 0.4,
    cheapBase: 65,
    strongBase: 55,
    hardBonus: 15,
    engineeringBonus: 8,
    evidenceBonus: 6,
    visionBonus: 25,
    neutralWeight: 50,
    /** Added to the cheap tier when a signal asks for frugality (pressure, subagent, budget). */
    cheapBonus: 25,
  }),
  /** Optional session signals that sharpen the decision. */
  signals: Object.freeze({
    /** Let the active todo item feed task-type matching. */
    todos: true,
    /** Context pressure ratio (0-1) above which the cheap tier is preferred; 0 disables. */
    contextPressure: 0.75,
    /** Session token total above which the cheap tier is preferred; 0 disables. */
    sessionTokens: 0,
  }),
  /** Subagent handling: delegated work runs cheap unless a preset overrides it. */
  subagent: Object.freeze({ preferCheap: true }),
  /** Image handling: "keep" leaves image steps alone, "vision" routes them to a vision model. */
  imagePolicy: "keep",
  /** Explicit vision model id; the pool's vision-tagged entries are used when unset. */
  visionModel: null,
  /** Cross-provider switch policy; see CROSS_MODES. */
  crossProvider: "confirm",
  /** Panel surface: "solid" paints an opaque menu, "theme" keeps the translucent menu colour + blur. */
  panelBg: "solid",
  /** Model used by the optional LLM task-type classifier. */
  classifierModel: null,
  /** Downgrades need this many consecutive quieter steps before they apply. */
  hysteresis: Object.freeze({ downAfter: 2 }),
  /** Ceiling on how many strong-tier steps one task may spend. */
  maxPerTask: Object.freeze({ strong: 3 }),
  /** Task-type detection: "rules" (keywords) or "pinned" only. "llm" is reserved. */
  classifier: "rules",
})

/** Split "provider/model" into parts; a bare id falls back to the configured provider. */
export function splitModelId(id, fallbackProvider) {
  if (typeof id !== "string" || id.length === 0) return null
  const at = id.indexOf("/")
  if (at < 0) return { provider: String(fallbackProvider ?? ""), model: id }
  return { provider: id.slice(0, at), model: id.slice(at + 1) }
}

/** One pool entry's stable identity. */
export function entryId(entry) {
  return entry.provider + "/" + entry.model
}

/**
 * Normalize configured pool entries. Entries may be bare id strings or objects;
 * unknown fields are dropped so a hand-written config cannot inject behavior.
 * @returns a frozen array of entries.
 */
export function normalizePool(cfg) {
  const fallbackProvider = cfg && cfg.provider ? cfg.provider : "deepseek-official"
  const raw = Array.isArray(cfg && cfg.pool) ? cfg.pool : []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const source = typeof item === "string" ? { id: item } : (item && typeof item === "object" ? item : null)
    if (!source) continue
    const id = typeof source.id === "string" ? source.id : ""
    const split = splitModelId(id, fallbackProvider)
    if (!split || !split.model) continue
    const key = split.provider + "/" + split.model
    if (seen.has(key)) continue
    seen.add(key)
    const tags = Array.isArray(source.tags) ? source.tags.filter((t) => typeof t === "string") : []
    const weights = source.weights && typeof source.weights === "object" ? { ...source.weights } : {}
    out.push(Object.freeze({
      id: key,
      provider: split.provider,
      model: split.model,
      cost: Number.isFinite(source.cost) && source.cost >= 0 ? source.cost : 1,
      // Where that cost label came from: a hand-set one survives an auto-price
      // refresh, an estimated one may be recomputed on the next one.
      costSource: COST_SOURCES.includes(source.costSource) ? source.costSource : undefined,
      tier: source.tier === "strong" ? "strong" : "cheap",
      tags: Object.freeze(tags),
      weights: Object.freeze(weights),
      maxPerTask: Number.isFinite(source.maxPerTask) && source.maxPerTask >= 0 ? source.maxPerTask : undefined,
      efforts: Array.isArray(source.efforts) ? Object.freeze(source.efforts.filter((e) => typeof e === "string")) : undefined,
    }))
  }
  if (out.length === 0 && cfg && typeof cfg.model === "string" && cfg.model) {
    out.push(Object.freeze({
      id: splitModelId(cfg.model, fallbackProvider).provider + "/" + cfg.model,
      provider: fallbackProvider,
      model: cfg.model,
      cost: 1,
      costSource: undefined,
      tier: "cheap",
      tags: Object.freeze([]),
      weights: Object.freeze({}),
      maxPerTask: undefined,
      efforts: undefined,
    }))
  }
  return Object.freeze(out)
}

/** Whether one provider/model pair is inside the pool. */
export function poolContains(pool, provider, model) {
  for (const entry of pool) if (entry.provider === provider && entry.model === model) return true
  return false
}

/** Compile one preset's match list (plain substrings or /regex/ literals). */
function compileMatchers(preset) {
  const raw = Array.isArray(preset && preset.match) ? preset.match : []
  const out = []
  for (const item of raw) {
    if (typeof item !== "string" || item.length === 0) continue
    const regex = /^\/(.*)\/([a-z]*)$/.exec(item)
    if (regex) {
      try { out.push(new RegExp(regex[1], regex[2] || "i")) } catch (_ignored) { /* a bad user regex never breaks routing */ }
      continue
    }
    out.push(item.toLowerCase())
  }
  return out
}

/**
 * Which task-type preset the step text matches, by the user's own rules.
 * @returns the preset name, or null when nothing matches.
 */
export function matchPreset(cfg, text) {
  const presets = cfg && cfg.presets && typeof cfg.presets === "object" ? cfg.presets : {}
  const source = typeof text === "string" ? text : ""
  if (!source) return null
  const lower = source.toLowerCase()
  for (const name of Object.keys(presets)) {
    const matchers = compileMatchers(presets[name])
    for (const matcher of matchers) {
      if (typeof matcher === "string" ? lower.includes(matcher) : matcher.test(source)) return name
    }
  }
  return null
}

/** The weight the user gave one entry for one task type, or undefined. */
export function presetWeight(cfg, entry, presetName) {
  if (!presetName) return undefined
  const presets = cfg && cfg.presets && typeof cfg.presets === "object" ? cfg.presets : {}
  const fromEntry = entry.weights ? entry.weights[presetName] : undefined
  if (Number.isFinite(fromEntry)) return fromEntry
  const preset = presets[presetName]
  const fromPreset = preset && preset.weights ? preset.weights[entry.id] : undefined
  if (Number.isFinite(fromPreset)) return fromPreset
  return undefined
}

/**
 * Score one pool entry for the current step.
 * @param entry - normalized pool entry.
 * @param presetName - matched or pinned task type, or null.
 * @param cfg - normalized config.
 * @param signals - { stepClass, escalations, hasImage }.
 * @returns a number; higher wins.
 */
export function scoreEntry(entry, presetName, cfg, signals) {
  const s = (cfg && cfg.scoring) || ROUTING_DEFAULTS.scoring
  let score = entry.tier === "strong" ? s.strongBase : s.cheapBase
  const weight = presetWeight(cfg, entry, presetName)
  if (Number.isFinite(weight)) score = weight
  const stepClass = signals && signals.stepClass
  if (stepClass === "hard" && entry.tier === "strong") score += s.hardBonus
  else if (stepClass === "engineering" && entry.tier === "strong") score += s.engineeringBonus
  const escalations = Number(signals && signals.escalations) || 0
  if (escalations > 0 && entry.tier === "strong") score += s.evidenceBonus * Math.min(2, escalations)
  if (signals && signals.hasImage && entry.tags.includes("vision")) score += s.visionBonus
  if (signals && signals.visionModel && entry.id === signals.visionModel) score += s.visionBonus
  if (signals && signals.preferCheap && entry.tier === "cheap") score += s.cheapBonus
  score -= entry.cost * s.costPenalty
  return score
}

/**
 * Pick the best entry from the pool.
 * Hard filters: images require a vision-tagged entry when any exists; a per-entry
 * maxPerTask ceiling excludes an entry once the task has spent it.
 * @returns { entry, score, preset } or null when nothing is selectable.
 */
export function chooseEntry(pool, cfg, signals, usage) {
  const presetName = signals && signals.presetName ? signals.presetName : null
  const candidates = []
  for (const entry of pool) {
    if (signals && signals.hasImage) {
      const anyVision = pool.some((e) => e.tags.includes("vision"))
      if (anyVision && !entry.tags.includes("vision")) continue
    }
    const spent = usage && usage[entry.id] ? usage[entry.id] : 0
    const ceiling = entry.maxPerTask !== undefined ? entry.maxPerTask : undefined
    if (ceiling !== undefined && entry.tier === "strong" && spent >= ceiling) continue
    candidates.push({ entry, score: scoreEntry(entry, presetName, cfg, signals) })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => (b.score - a.score) || (a.entry.cost - b.entry.cost) || (a.entry.id < b.entry.id ? -1 : 1))
  return { entry: candidates[0].entry, score: candidates[0].score, preset: presetName }
}

/** The internal effort tier a step class maps to. */
export function effortTierForClass(cfg, stepClass) {
  const routes = (cfg && cfg.routes) || {}
  const route = routes[stepClass]
  const effort = route && typeof route.effort === "string" ? route.effort : "low"
  return INTERNAL_EFFORTS.includes(effort) ? effort : "low"
}

/**
 * Translate an internal tier onto a target model's own advertised vocabulary.
 * @returns the concrete effort id, or undefined when the model exposes none.
 */
export function mapEffort(tier, supported) {
  if (!Array.isArray(supported) || supported.length === 0) return undefined
  if (supported.includes(tier)) return tier
  const want = EFFORT_RANK[tier] !== undefined ? EFFORT_RANK[tier] : EFFORT_RANK.high
  let best
  let bestDistance = Infinity
  for (const id of supported) {
    const rank = EFFORT_RANK[id] !== undefined ? EFFORT_RANK[id] : EFFORT_RANK.high
    const distance = Math.abs(rank - want)
    if (distance < bestDistance || (distance === bestDistance && Number.isFinite(best) && want < rank)) {
      best = id
      bestDistance = distance
    }
  }
  return best
}

/**
 * The active todo item's text, when the session has a plan running.
 * A todo list is the single best statement of what the current step really is,
 * so presets match against it in addition to the user's own words.
 */
export function activeTodoText(todos) {
  if (!Array.isArray(todos)) return ""
  for (const item of todos) {
    if (item && item.status === "in_progress" && typeof item.content === "string") return item.content
  }
  for (const item of todos) {
    if (item && typeof item.content === "string") return item.content
  }
  return ""
}

/** Context occupancy ratio (0-1), or null when the projection has no denominator. */
export function contextPressureRatio(state) {
  if (!state || typeof state !== "object") return null
  const window = state.contextWindow
  const used = state.pressureTokens !== undefined ? state.pressureTokens : state.surfaceTokens
  if (!Number.isFinite(window) || window <= 0 || !Number.isFinite(used)) return null
  return used / window
}

/** Session token total from the core `tokenUsage` projection. */
export function sessionTokensOf(state) {
  const totals = state && state.totals
  if (!totals || typeof totals !== "object") return 0
  let sum = 0
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "reasoning"]) {
    if (Number.isFinite(totals[key])) sum += totals[key]
  }
  return sum
}

/** Rank used by the hysteresis rule. */
function rankOf(effort) {
  return EFFORT_RANK[effort] !== undefined ? EFFORT_RANK[effort] : EFFORT_RANK.high
}

/**
 * Hysteresis: raise immediately, lower only after the step stayed quiet.
 * @returns { value, streak } to store back in session state.
 */
export function stabilize(desired, previous, streak, downAfter) {
  const limit = Number.isFinite(downAfter) && downAfter > 0 ? downAfter : 1
  if (previous === undefined || previous === null) return { value: desired, streak: 0 }
  if (desired === previous) return { value: previous, streak: 0 }
  if (rankOf(desired) >= rankOf(previous)) return { value: desired, streak: 0 }
  const next = (Number(streak) || 0) + 1
  if (next >= limit) return { value: desired, streak: 0 }
  return { value: previous, streak: next }
}

/** Whether a manual pick should make the router yield. */
export function manualOverridePolicy(cfg) {
  const p = (cfg && cfg.manualOverride) || ROUTING_DEFAULTS.manualOverride
  return {
    yieldOnManual: p.yieldOnManual !== false,
    resumeOnNextCommand: p.resumeOnNextCommand !== false,
  }
}
