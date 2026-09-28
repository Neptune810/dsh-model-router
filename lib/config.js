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
import { CONTROL_SCOPES, ROUTING_DEFAULTS, normalizePool } from './routing.js'

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Merge the legacy 0.4 config with the v0.5 routing layer. */
export function normalizeRuntimeConfig(input = {}) {
  const raw = isObject(input) ? input : {}
  const base = normalizeConfig(raw)
  const manual = isObject(raw.manualOverride) ? raw.manualOverride : {}
  const cfg = {
    ...base,
    control: CONTROL_SCOPES.includes(raw.control) ? raw.control : ROUTING_DEFAULTS.control,
    manualOverride: {
      yieldOnManual: manual.yieldOnManual !== false,
      resumeOnNextCommand: manual.resumeOnNextCommand !== false,
    },
    // policy.js owns the classification weights (lengthCap, trivialTokenCap, hardScore…),
    // routing.js owns the pool scoring weights (costPenalty, tier bases…); keep both.
    scoring: { ...base.scoring, ...ROUTING_DEFAULTS.scoring, ...(isObject(raw.scoring) ? raw.scoring : {}) },
    hysteresis: { ...ROUTING_DEFAULTS.hysteresis, ...(isObject(raw.hysteresis) ? raw.hysteresis : {}) },
    maxPerTask: { ...ROUTING_DEFAULTS.maxPerTask, ...(isObject(raw.maxPerTask) ? raw.maxPerTask : {}) },
    classifier: raw.classifier === 'llm' ? 'llm' : 'rules',
    presets: isObject(raw.presets) ? raw.presets : {},
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
