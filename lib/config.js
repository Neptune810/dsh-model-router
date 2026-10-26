/**
 * dsh-model-router — runtime configuration (v0.5).
 *
 * Layering, lowest first:
 *   1. shipped defaults (policy.js legacy ladder + routing.js pool/preset defaults)
 *   2. the profile row config (cordis.patch.yml)
 *   3. the UI store (.model-router/state.json), which the browser writes through
 *      the host routes
 *   4. per-session overrides held by the plugin
 */
import { normalizeConfig } from './policy.js'
import {
  BUDGET_MODES,
  CONTROL_SCOPES,
  CROSS_MODES,
  EFFORT_WORDS,
  PEAK_POLICIES,
  ROUTING_DEFAULTS,
  isKnownEffort,
  normalizePool,
} from './routing.js'

/** A finite number at or above `min`, else the fallback. */
function numberAtLeast(value, min, fallback) {
  return Number.isFinite(value) && value >= min ? value : fallback
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Route efforts the router cannot rank. routing.js treats each one as the high
 * rank (rankOf()/mapEffort() fall back to EFFORT_RANK.high), so the host can
 * warn once at boot instead of pretending the word was "low". Missing,
 * empty and non-string route values are not warnings: they simply keep the
 * shipped default. Messages are deduplicated in route order.
 */
function collectEffortWarnings(routes) {
  const warnings = []
  const seen = new Set()
  for (const [stepClass, route] of Object.entries(routes)) {
    const effort = route && route.effort
    if (typeof effort !== 'string' || effort.length === 0 || isKnownEffort(effort)) continue
    const message = `routes.${stepClass}.effort ${JSON.stringify(effort)} is not a known effort (known: ${EFFORT_WORDS.join(', ')}); it will be treated as high`
    if (seen.has(message)) continue
    seen.add(message)
    warnings.push(message)
  }
  return warnings
}

/** Merge the legacy 0.4 config with the v0.5 routing layer. */
export function normalizeRuntimeConfig(input = {}) {
  const raw = isObject(input) ? input : {}
  const base = normalizeConfig(raw)
  const manual = isObject(raw.manualOverride) ? raw.manualOverride : {}
  const scoring = { ...base.scoring, ...ROUTING_DEFAULTS.scoring, ...(isObject(raw.scoring) ? raw.scoring : {}) }
  // policy.js accepts only the two documented values for this key; a hand-edited
  // config must not smuggle a third one past the runtime path.
  if (scoring.toolCallClass !== 'engineering') scoring.toolCallClass = 'standard'
  const cfg = {
    ...base,
    control: CONTROL_SCOPES.includes(raw.control) ? raw.control : ROUTING_DEFAULTS.control,
    manualOverride: {
      yieldOnManual: manual.yieldOnManual !== false,
      resumeOnNextCommand: manual.resumeOnNextCommand !== false,
    },
    // policy.js owns the classification weights (lengthCap, trivialTokenCap, hardScore…),
    // routing.js owns the pool scoring weights (costPenalty, tier bases…); keep both.
    scoring: scoring,
    hysteresis: { ...ROUTING_DEFAULTS.hysteresis, ...(isObject(raw.hysteresis) ? raw.hysteresis : {}) },
    maxPerTask: { ...ROUTING_DEFAULTS.maxPerTask, ...(isObject(raw.maxPerTask) ? raw.maxPerTask : {}) },
    classifier: raw.classifier === 'llm' ? 'llm' : 'rules',
    panelBg: raw.panelBg === 'theme' ? 'theme' : 'solid',
    presets: isObject(raw.presets) ? raw.presets : {},
    signals: { ...ROUTING_DEFAULTS.signals, ...(isObject(raw.signals) ? raw.signals : {}) },
    subagent: { ...ROUTING_DEFAULTS.subagent, ...(isObject(raw.subagent) ? raw.subagent : {}) },
    // Only keep/vision exist. "flash" was retired in 0.14.3 and migrates to
    // "vision", which is the behavior it always described.
    imagePolicy: raw.imagePolicy === 'vision' || raw.imagePolicy === 'flash' ? 'vision' : 'keep',
    visionModel: typeof raw.visionModel === 'string' && raw.visionModel.length > 0 ? raw.visionModel : null,
    crossProvider: CROSS_MODES.includes(raw.crossProvider) ? raw.crossProvider : ROUTING_DEFAULTS.crossProvider,
    classifierModel: typeof raw.classifierModel === 'string' && raw.classifierModel.length > 0 ? raw.classifierModel : null,
    classifierTimeoutMs: Number.isFinite(raw.classifierTimeoutMs) && raw.classifierTimeoutMs > 0 ? raw.classifierTimeoutMs : 8000,
    // A classifier answer below this confidence is treated as "no answer" and
    // the keyword rules decide; 0 keeps every answer. Clamped to [0, 1].
    classifierMinConfidence: Number.isFinite(raw.classifierMinConfidence)
      ? Math.max(0, Math.min(1, raw.classifierMinConfidence))
      : ROUTING_DEFAULTS.classifierMinConfidence,
    // The one model the effort scope is allowed to touch. The user picks it in the
    // composer panel; null means "not chosen yet", and then the scope does nothing.
    effortModel: typeof raw.effortModel === 'string' && raw.effortModel.length > 0 ? raw.effortModel : null,
    // v0.16.0 cost-aware routing. Off unless a hand-edited config asks for it:
    // the shipped default keeps 0.15.1's behavior and only records the shadow
    // decision. The guard is normalized here because routing.js trusts it.
    costAware: raw.costAware === true,
    costGuard: {
      maxMultiple: Number.isFinite(raw.costGuard && raw.costGuard.maxMultiple) && raw.costGuard.maxMultiple > 1
        ? raw.costGuard.maxMultiple
        : ROUTING_DEFAULTS.costGuard.maxMultiple,
      unknownPricing: raw.costGuard && raw.costGuard.unknownPricing === 'allow' ? 'allow' : 'exclude',
    },
    // v0.16.1 channel health. Every number is normalized here so routing.js and
    // channels.js can trust their inputs; fingerprinting is opt-out only.
    channels: {
      windowSize: Math.floor(numberAtLeast(raw.channels && raw.channels.windowSize, 1, ROUTING_DEFAULTS.channels.windowSize)),
      failThreshold: Math.floor(numberAtLeast(raw.channels && raw.channels.failThreshold, 1, ROUTING_DEFAULTS.channels.failThreshold)),
      cooldownMs: Math.floor(numberAtLeast(raw.channels && raw.channels.cooldownMs, 0, ROUTING_DEFAULTS.channels.cooldownMs)),
      ewmaAlpha: Number.isFinite(raw.channels && raw.channels.ewmaAlpha)
        ? Math.max(0, Math.min(1, raw.channels.ewmaAlpha))
        : ROUTING_DEFAULTS.channels.ewmaAlpha,
      ttftSoftMs: Math.floor(numberAtLeast(raw.channels && raw.channels.ttftSoftMs, 0, ROUTING_DEFAULTS.channels.ttftSoftMs)),
      fingerprint: !(raw.channels && raw.channels.fingerprint === false),
      // How long a channel that keeps answering without usable usage stays out
      // of the pool; the check itself is the one above.
      quarantineMs: Math.floor(numberAtLeast(raw.channels && raw.channels.quarantineMs, 0, ROUTING_DEFAULTS.channels.quarantineMs)),
      maxTtftMs: Math.floor(numberAtLeast(raw.channels && raw.channels.maxTtftMs, 0, ROUTING_DEFAULTS.channels.maxTtftMs)),
      // Retrying a failed request on another channel is opt-in: with it off the
      // router only observes and reorders, exactly like 0.16.0.
      failover: raw.channels && raw.channels.failover === true,
      maxFailoversPerStep: Math.floor(numberAtLeast(raw.channels && raw.channels.maxFailoversPerStep, 0, ROUTING_DEFAULTS.channels.maxFailoversPerStep)),
    },
    // v0.16.1 spend guard. Default off: the shipped behavior stays 0.16.0's.
    budget: {
      mode: raw.budget && BUDGET_MODES.includes(raw.budget.mode) ? raw.budget.mode : ROUTING_DEFAULTS.budget.mode,
      sessionTokens: numberAtLeast(raw.budget && raw.budget.sessionTokens, 0, ROUTING_DEFAULTS.budget.sessionTokens),
      sessionUsd: numberAtLeast(raw.budget && raw.budget.sessionUsd, 0, ROUTING_DEFAULTS.budget.sessionUsd),
      dayUsd: numberAtLeast(raw.budget && raw.budget.dayUsd, 0, ROUTING_DEFAULTS.budget.dayUsd),
      monthUsd: numberAtLeast(raw.budget && raw.budget.monthUsd, 0, ROUTING_DEFAULTS.budget.monthUsd),
      softRatio: Number.isFinite(raw.budget && raw.budget.softRatio)
        ? Math.max(0, Math.min(1, raw.budget.softRatio))
        : ROUTING_DEFAULTS.budget.softRatio,
    },
    peakPolicy: raw.peakPolicy && PEAK_POLICIES.includes(raw.peakPolicy) ? raw.peakPolicy : ROUTING_DEFAULTS.peakPolicy,
    crossCost: {
      maxMultiple: Number.isFinite(raw.crossCost && raw.crossCost.maxMultiple) && raw.crossCost.maxMultiple > 1
        ? raw.crossCost.maxMultiple
        : ROUTING_DEFAULTS.crossCost.maxMultiple,
      scoreMargin: Number.isFinite(raw.crossCost && raw.crossCost.scoreMargin) && raw.crossCost.scoreMargin >= 0
        ? raw.crossCost.scoreMargin
        : ROUTING_DEFAULTS.crossCost.scoreMargin,
    },
  }
  cfg.pool = normalizePool(cfg)
  // policy.js merges every route row as-is and does not filter effort, so any
  // non-empty string survives normalization; collect the words routing cannot
  // rank so index.js can warn once (defaults are all known => empty array).
  cfg.effortWarnings = collectEffortWarnings(cfg.routes)
  return cfg
}

/** Apply a UI pool edit on top of the current config. */
export function withPool(cfg, pool) {
  return { ...cfg, pool: normalizePool({ ...cfg, pool: Array.isArray(pool) ? pool : [] }) }
}

/** Apply a UI preset edit on top of the current config. */
export function withPresets(cfg, presets) {
  return { ...cfg, presets: isObject(presets) ? presets : {} }
}

/** Apply the UI's "more settings" on top of the current config. */
export function withSettings(cfg, settings) {
  if (!isObject(settings)) return cfg
  const next = { ...cfg }
  if (settings.imagePolicy === 'keep' || settings.imagePolicy === 'vision') next.imagePolicy = settings.imagePolicy
  // Migrate a settings blob written by <= 0.14.2.
  if (settings.imagePolicy === 'flash') next.imagePolicy = 'vision'
  if (settings.classifier === 'rules' || settings.classifier === 'llm') next.classifier = settings.classifier
  if (settings.panelBg === 'solid' || settings.panelBg === 'theme') next.panelBg = settings.panelBg
  if (CONTROL_SCOPES.includes(settings.control)) next.control = settings.control
  if (CROSS_MODES.includes(settings.crossProvider)) next.crossProvider = settings.crossProvider
  if (Number.isFinite(settings.classifierMinConfidence)) {
    next.classifierMinConfidence = Math.max(0, Math.min(1, settings.classifierMinConfidence))
  }
  if (isObject(settings.signals)) next.signals = { ...cfg.signals, ...settings.signals }
  if (isObject(settings.subagent)) next.subagent = { ...cfg.subagent, ...settings.subagent }
  // Only an explicit value may change the bound model, so a settings save from the
  // panel cannot silently unbind the effort scope.
  if (settings.effortModel === null) next.effortModel = null
  else if (typeof settings.effortModel === 'string' && settings.effortModel.length > 0) next.effortModel = settings.effortModel
  return next
}
