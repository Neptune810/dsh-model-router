/**
 * One clock for the whole plugin.
 *
 * Every time read in the router funnels through now() so a test, a replay or a
 * CI job can pin "the current instant" and get the same answer on a Monday
 * morning in Shanghai as on a Sunday night. The catalog prices DeepSeek-V4-Pro
 * off-peak (weekday nights and weekends cost half), so a suite that reads the
 * wall clock directly is green during CST peak hours and red at 3am — exactly
 * the failure this module exists to remove.
 *
 * Two hooks, in precedence order:
 *   1. freeze(ms)                — in-process, for tests (freeze(null) clears)
 *   2. DSH_MODEL_ROUTER_NOW=ms   — environment, for CI jobs and shells
 *   3. Date.now()                — production
 */

let frozen = null

/** Pin the clock to an epoch-millisecond instant; pass anything non-finite (or null) to clear it. */
export function freeze(atMs) {
  frozen = Number.isFinite(atMs) ? atMs : null
  return frozen
}

/** The current instant in epoch milliseconds, honouring freeze() and DSH_MODEL_ROUTER_NOW. */
export function now() {
  if (frozen !== null) return frozen
  const raw = process.env.DSH_MODEL_ROUTER_NOW
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return Date.now()
}

/** True while an explicit instant is pinned (either hook). Useful for diagnostics and logs. */
export function isFrozen() {
  return frozen !== null || (() => {
    const parsed = Number(process.env.DSH_MODEL_ROUTER_NOW)
    return Number.isFinite(parsed) && parsed > 0
  })()
}
