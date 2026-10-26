/**
 * ε-greedy exploration, shadow-first (v0.17.1).
 *
 * The router is deterministic: the same step at the same tier always goes to the
 * same model. That is good for trust and bad for learning, because a tier that
 * looks expensive on paper never gets the step that would have shown it is not.
 *
 * ε-greedy is the smallest honest answer: with probability \`epsilon\` a step is
 * allowed to try a *different* arm than the incumbent, and the outcome is
 * recorded. It ships as a shadow: the draw happens, the arm is written to
 * telemetry and /state, and the route does not move unless \`apply\` is on, which
 * it is not by default and which hard/engineering steps are exempt from either
 * way.
 */

export const EXPERIMENT_DEFAULTS = Object.freeze({
  enabled: false,
  apply: false,
  epsilon: 0.1,
})

/** Deterministic RNG (mulberry32) so a shadow draw can be replayed in a test. */
export function seededRandom(seed) {
  let state = (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Steps that must never be explored: getting them wrong costs a whole turn. */
export function explorable(stepClass) {
  return stepClass !== 'hard' && stepClass !== 'engineering'
}

/**
 * Plan the draw for one step.
 *
 * @param {object} options
 * @param {boolean} [options.enabled] experiments.enabled
 * @param {boolean} [options.apply] whether the drawn arm is actually routed
 * @param {number} [options.epsilon] exploration probability
 * @param {string} [options.stepClass]
 * @param {string|null} [options.current] the incumbent arm
 * @param {string[]} [options.arms] candidate arms, incumbent included
 * @param {() => number} [options.random] uniform source (defaults to Math.random)
 * @returns {{allowed:boolean, explore:boolean, arm:string|null, applied:boolean,
 *   epsilon:number, reason:string}}
 */
export function planExperiment(options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const epsilon = Number.isFinite(opts.epsilon) ? Math.max(0, Math.min(1, opts.epsilon)) : EXPERIMENT_DEFAULTS.epsilon
  const stepClass = typeof opts.stepClass === 'string' ? opts.stepClass : ''
  const current = typeof opts.current === 'string' && opts.current.length > 0 ? opts.current : null
  const arms = Array.isArray(opts.arms) ? opts.arms.filter((arm) => typeof arm === 'string' && arm.length > 0) : []
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const off = (reason) => ({ allowed: false, explore: false, arm: null, applied: false, epsilon, reason })
  if (opts.enabled !== true) return off('experiments are off')
  if (!explorable(stepClass)) return off(stepClass + ' steps are never explored')
  if (arms.length < 2) return off('fewer than two arms in the pool')
  if (current === null) return off('the incumbent arm is unknown')
  const alternatives = arms.filter((arm) => arm !== current)
  if (alternatives.length === 0) return off('the incumbent is the only arm')
  const draw = Number(random())
  const roll = Number.isFinite(draw) ? Math.max(0, Math.min(0.999999, draw)) : 0.999999
  if (roll >= epsilon) return { allowed: true, explore: false, arm: current, applied: false, epsilon, reason: 'exploit the incumbent' }
  const pick = alternatives[Math.min(alternatives.length - 1, Math.floor((roll / Math.max(epsilon, 1e-9)) * alternatives.length))]
  return {
    allowed: true,
    explore: true,
    arm: pick,
    applied: opts.apply === true,
    epsilon,
    reason: 'epsilon draw ' + roll.toFixed(3) + ' < ' + epsilon,
  }
}

/**
 * Aggregate experiment records for /stats.
 *
 * @param {object[]} events telemetry decision events
 * @returns {{steps:number, explored:number, exploit:number, applied:number,
 *   byArm:object, exploredShare:number}}
 */
export function experimentReport(events) {
  const list = Array.isArray(events) ? events : []
  const byArm = {}
  let steps = 0
  let explored = 0
  let applied = 0
  for (const event of list) {
    const draw = event && typeof event === 'object' ? event.experiment : null
    if (!draw || typeof draw !== 'object' || typeof draw.arm !== 'string') continue
    steps += 1
    if (draw.explore === true) explored += 1
    if (draw.applied === true) applied += 1
    byArm[draw.arm] = (byArm[draw.arm] || 0) + 1
  }
  return {
    steps,
    explored,
    exploit: steps - explored,
    applied,
    byArm,
    exploredShare: steps > 0 ? Math.round((explored / steps) * 1e4) / 1e4 : 0,
  }
}
