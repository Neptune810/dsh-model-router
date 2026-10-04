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
import { CONTROL_SCOPES, CROSS_MODES, ROUTING_DEFAULTS, normalizePool } from './routing.js'

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    imagePolicy: raw.imagePolicy === 'vision' || raw.imagePolicy === 'flash' ? raw.imagePolicy : base.imagePolicy,
    visionModel: typeof raw.visionModel === 'string' && raw.visionModel.length > 0 ? raw.visionModel : null,
    crossProvider: CROSS_MODES.includes(raw.crossProvider) ? raw.crossProvider : ROUTING_DEFAULTS.crossProvider,
    classifierModel: typeof raw.classifierModel === 'string' && raw.classifierModel.length > 0 ? raw.classifierModel : null,
    classifierTimeoutMs: Number.isFinite(raw.classifierTimeoutMs) && raw.classifierTimeoutMs > 0 ? raw.classifierTimeoutMs : 8000,
    // The one model the effort scope is allowed to touch. The user picks it in the
    // composer panel; null means "not chosen yet", and then the scope does nothing.
    effortModel: typeof raw.effortModel === 'string' && raw.effortModel.length > 0 ? raw.effortModel : null,
  }
  cfg.pool = normalizePool(cfg)
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
  if (settings.classifier === 'rules' || settings.classifier === 'llm') next.classifier = settings.classifier
  if (settings.panelBg === 'solid' || settings.panelBg === 'theme') next.panelBg = settings.panelBg
  if (CONTROL_SCOPES.includes(settings.control)) next.control = settings.control
  if (CROSS_MODES.includes(settings.crossProvider)) next.crossProvider = settings.crossProvider
  if (isObject(settings.signals)) next.signals = { ...cfg.signals, ...settings.signals }
  if (isObject(settings.subagent)) next.subagent = { ...cfg.subagent, ...settings.subagent }
  // Only an explicit value may change the bound model, so a settings save from the
  // panel cannot silently unbind the effort scope.
  if (settings.effortModel === null) next.effortModel = null
  else if (typeof settings.effortModel === 'string' && settings.effortModel.length > 0) next.effortModel = settings.effortModel
  return next
}
