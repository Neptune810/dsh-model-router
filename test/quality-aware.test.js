/**
 * Quality-aware routing (v1.1.2).
 *
 * The catalog carries an AA index for most models; this module lets it shape the
 * score the same way cost does, and ships with the switch OFF: every decision
 * still routes exactly as 1.1.1 did and records the choice a quality-aware
 * router would have made next to it. These tests pin both halves — the pure
 * scorer, and the fact that the shipped default does not move a route.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { ROUTING_DEFAULTS, scoreEntry } from '../lib/routing.js'
import { normalizeRuntimeConfig, withSettings } from '../lib/config.js'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-quality-'))
delete process.env.DSH_PROFILE_DIR
process.env.DSH_MODEL_ROUTER_NO_TOKEN = '1'

const ROUTES = { trivial: { effort: 'low' }, standard: { effort: 'low' }, engineering: { effort: 'high' }, hard: { effort: 'high' } }
// Two entries with the same tier and the same pooled cost: with the quality term
// off they tie and the id breaks the tie, so any movement here is the term's.
// The catalog scores them 32 and 46 (AA v5.0).
const POOL = [
  { id: 'deepseek-official/deepseek-flash', cost: 1, tier: 'cheap' },
  { id: 'moonshot-official/kimi-k3.1-pro', cost: 1, tier: 'cheap' },
]
const entry = (over = {}) => ({ id: 'entry', tier: 'cheap', cost: 1, tags: [], ...over })

/** Host double: listeners, services, routes. Same shape as observation.test.js. */
function makeHost(config = {}) {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-quality-'))
  const handlers = new Map()
  const routes = new Map()
  const logs = []
  const registry = new Map()
  const logger = { info: (...a) => logs.push('INFO ' + a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')) }
  const ctx = {
    logger: () => logger,
    on: (name, fn, options) => {
      const list = handlers.get(name)
      if (options && options.prepend) handlers.set(name, [fn, ...(list || [])])
      else handlers.set(name, [...(list || []), fn])
    },
    get: (name) => registry.get(name),
    inject: (deps, callback) => {
      const scope = { effect: (fn) => { fn(); return () => {} } }
      let ready = true
      for (const dep of deps) {
        scope[dep] = registry.get(dep)
        if (scope[dep] === undefined) ready = false
      }
      if (ready) callback(scope)
    },
  }
  registry.set('webServer', {
    register: ({ path, handler }) => { routes.set(path, handler); return () => routes.delete(path) },
  })
  registry.set('commands', { register: () => () => {} })
  apply(ctx, config)
  return { handlers, routes, logs }
}

const agentWith = (messages = []) => ({ session: { id: 's1', deriveMessages: () => messages } })

function emit(host, name, payload) {
  for (const fn of host.handlers.get(name) || []) fn(payload)
}

function request(host, payload, seed) {
  const fns = host.handlers.get('agent/request') || []
  const inner = () => Promise.resolve(typeof seed === 'function' ? seed() : seed)
  const run = (index) => index >= fns.length ? inner() : fns[index](payload, () => run(index + 1))
  return run(0)
}

const seed = (over = {}) => ({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high', ...over })
const claimed = (text, turn = 1) => ({ turn, message: { content: text } })

function call(handler, { method = 'GET', url = '/', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = method
    req.url = url
    req.headers = headers
    req.destroy = () => {}
    const res = {
      status: 0,
      headers: {},
      payload: '',
      writeHead(status, extra) { this.status = status; this.headers = extra || {} },
      end(text) { this.payload = text || ''; resolve(this) },
    }
    handler(req, res)
    setImmediate(() => {
      if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
      req.emit('end')
    })
  })
}

const stateOf = async (host, sessionId = 's1') =>
  JSON.parse((await call(host.routes.get('/model-router/state'), { url: '/model-router/state?sessionId=' + sessionId })).payload)

test('the quality term mirrors the cost term: opt-in, floored at the pool, capped by the guard', () => {
  const cfg = normalizeRuntimeConfig({ pool: POOL, routes: ROUTES, crossProvider: 'allow' })
  const signals = { stepClass: 'standard', qualityIndex: { a: 30, b: 60, c: null }, qualityFloor: 30 }
  const a = entry({ id: 'a' })
  const b = entry({ id: 'b' })
  const c = entry({ id: 'c' })

  // Off by default: the switch, not the data, decides.
  assert.equal(scoreEntry(b, null, cfg, signals), scoreEntry(a, null, cfg, signals))

  const on = { ...cfg, qualityAware: true }
  assert.equal(scoreEntry(a, null, on, signals), scoreEntry(a, null, cfg, signals), 'the floor gains nothing')
  assert.ok(scoreEntry(b, null, on, signals) > scoreEntry(a, null, on, signals), 'twice the floor gains points')
  assert.equal(scoreEntry(c, null, on, signals), scoreEntry(c, null, cfg, signals), 'an unscored entry is never guessed at')

  // 60 / 30 - 1 = 1 ratio unit at the shipped weight: 0.15 * 10 = 1.5 points.
  assert.equal(Math.round((scoreEntry(b, null, on, signals) - scoreEntry(b, null, cfg, signals)) * 1e6) / 1e6, 1.5)

  // The guard caps the gain at maxMultiple - 1 ratio units, so a 100x index is
  // worth 10.5 points — the same magnitude the cost term can subtract at 8x.
  const far = entry({ id: 'far' })
  const farSignals = { stepClass: 'standard', qualityIndex: { far: 3000 }, qualityFloor: 30 }
  const capped = scoreEntry(far, null, on, farSignals) - scoreEntry(far, null, cfg, farSignals)
  assert.equal(Math.round(capped * 1e6) / 1e6, 10.5)
  // A three-times guard shrinks the same cap to 2 ratio units => 3 points.
  const tight = { ...on, qualityGuard: { maxMultiple: 3 } }
  const tightGain = scoreEntry(far, null, tight, farSignals) - scoreEntry(far, null, cfg, farSignals)
  assert.equal(Math.round(tightGain * 1e6) / 1e6, 3)
  // A zero weight is the documented way to keep the switch on but the term out.
  const zero = { ...on, scoring: { ...on.scoring, qualityWeight: 0 } }
  assert.equal(scoreEntry(b, null, zero, signals), scoreEntry(b, null, cfg, signals))
})

test('qualityAware and its guard are normalized, and the settings blob can switch it', () => {
  const base = normalizeRuntimeConfig({})
  assert.equal(base.qualityAware, false)
  assert.equal(base.qualityGuard.maxMultiple, ROUTING_DEFAULTS.qualityGuard.maxMultiple)
  assert.equal(base.scoring.qualityWeight, ROUTING_DEFAULTS.scoring.qualityWeight)

  const on = normalizeRuntimeConfig({ qualityAware: true, qualityGuard: { maxMultiple: 3 } })
  assert.equal(on.qualityAware, true)
  assert.equal(on.qualityGuard.maxMultiple, 3)

  // A guard at or below 1 would make the cap meaningless, so it falls back.
  assert.equal(normalizeRuntimeConfig({ qualityGuard: { maxMultiple: 1 } }).qualityGuard.maxMultiple, 8)
  assert.equal(normalizeRuntimeConfig({ qualityGuard: { maxMultiple: 'nine' } }).qualityGuard.maxMultiple, 8)

  // The panel sends the whole settings blob: an absent key must not flip it.
  assert.equal(withSettings(base, {}).qualityAware, false)
  assert.equal(withSettings(base, { qualityAware: true }).qualityAware, true)
  assert.equal(withSettings(on, { qualityAware: false }).qualityAware, false)
})

test('the shipped default does not move the route and records the counterfactual', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES, crossProvider: 'allow' })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('hello there') })
  const applied = await request(host, { agent, turn: 1, step: 0 }, seed())

  // Same tier, same cost: the tie goes to the id, exactly as in 1.1.1.
  assert.equal(applied.model, 'deepseek-flash')

  const state = await stateOf(host)
  assert.equal(state.quality.enabled, false)
  assert.equal(state.quality.qualityWeight, 0.15)
  assert.equal(state.quality.aaVersion, 'v5.0')
  assert.equal(state.quality.floorIndex, 32, 'the pool floor is the lowest known index')
  assert.equal(state.quality.known, 2)
  assert.deepEqual(state.quality.entries, [
    { id: 'deepseek-official/deepseek-flash', tier: 'cheap', aaIndex: 32 },
    { id: 'moonshot-official/kimi-k3.1-pro', tier: 'cheap', aaIndex: 46 },
  ])

  const shadow = state.quality.shadow
  assert.equal(shadow.current, 'deepseek-official/deepseek-flash')
  assert.equal(shadow.candidate, 'moonshot-official/kimi-k3.1-pro')
  assert.equal(shadow.agree, false)
  assert.equal(shadow.currentIndex, 32)
  assert.equal(shadow.candidateIndex, 46)
  assert.equal(shadow.floorIndex, 32)
  assert.equal(shadow.gainRatio, 0.4375)
  // The cost shadow keeps working next to it, untouched.
  assert.ok(state.costAware.shadow === null || typeof state.costAware.shadow === 'object')
})

test('with quality awareness on, the better-index entry wins the tie', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES, crossProvider: 'allow', qualityAware: true })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('hello there') })
  const applied = await request(host, { agent, turn: 1, step: 0 }, seed())

  assert.equal(applied.model, 'kimi-k3.1-pro')
  const state = await stateOf(host)
  assert.equal(state.quality.enabled, true)
  // Nothing hypothetical is recorded when the router is already acting on it.
  assert.equal(state.quality.shadow, null)
})

test('a pool the catalog cannot score leaves the router where it was', async () => {
  const unknownPool = [{ id: 'qiyue/deepseek-v4.1-flash', cost: 1, tier: 'cheap' }]
  const host = makeHost({ pool: unknownPool, routes: ROUTES, qualityAware: true })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('hello there') })
  const applied = await request(host, { agent, turn: 1, step: 0 }, seed({ provider: 'qiyue', model: 'deepseek-v4.1-flash' }))

  assert.equal(applied.provider, 'qiyue')
  const state = await stateOf(host)
  assert.equal(state.quality.floorIndex, null)
  assert.equal(state.quality.known, 0)
  assert.equal(state.quality.shadow, null, 'no index, no comparison to record')
})
