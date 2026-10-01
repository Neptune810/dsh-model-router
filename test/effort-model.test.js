/**
 * dsh-model-router — effort-scope one-model binding (v0.7.0).
 *
 * Independent regression tests for the composer behaviour the users asked for:
 * the effort scope may only steer ONE model the user picked first, a manual
 * thinking-level change is the only thing that stands it down, and a plain
 * model switch is not an override. Harness style mirrors test/modes.test.js.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-effort-model-'))
delete process.env.DSH_PROFILE_DIR

const ROUTES = { trivial: { effort: 'low' }, standard: { effort: 'low' }, engineering: { effort: 'high' }, hard: { effort: 'high' } }
/** A dense engineering brief classifies as "hard", which asks for "high" effort. */
const HARD_BRIEF = '重构 架构 设计 规划 迁移 优化 性能 并发 并行 调试 诊断'
const POOL = [
  { id: 'deepseek-official/deepseek-flash', cost: 1, tier: 'cheap' },
  { id: 'deepseek-official/deepseek-v4-pro', cost: 8, tier: 'strong' },
]
const BOUND = 'deepseek-official/deepseek-v4-pro'
const HEADERS = { origin: 'http://localhost', host: 'localhost' }

/** Host double: listeners, services, routes, logs. */
function makeHost(config = {}, services = {}) {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-effort-model-'))
  const handlers = new Map()
  const routes = new Map()
  const logs = []
  const registry = new Map(Object.entries(services))
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
  const commands = []
  registry.set('commands', {
    register: (definition) => { commands.push(definition); return () => {} },
  })
  apply(ctx, config)
  return { handlers, routes, logs, registry, commands }
}

const agentWith = (messages = [], id = 's1') => ({ session: { id, deriveMessages: () => messages } })

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

const claimed = (text, turn = 1) => ({ turn, message: { content: text } })

const post = (host, path, body, headers = HEADERS) => call(host.routes.get(path), { method: 'POST', url: path, headers, body })
const stateOf = async (host, sessionId) => JSON.parse((await call(host.routes.get('/model-router/state'), {
  method: 'GET', url: '/model-router/state' + (sessionId ? '?sessionId=' + sessionId : ''),
})).payload)

test('an unbound effort scope does not touch the request and asks for a pick', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  const control = await post(host, '/model-router/control', { sessionId: 's1', control: 'effort' })
  assert.equal(control.status, 200)

  const out = await request(host, { agent, turn: 1, step: 0 }, seed({ model: 'deepseek-v4-pro', reasoningEffort: 'low' }))
  assert.equal(out.model, 'deepseek-v4-pro', 'the model is never swapped while unbound')
  assert.equal(out.reasoningEffort, 'low', 'the thinking level is left exactly as the session asked')
  assert.ok(
    host.logs.some((line) => line.includes('effort scope has no model bound yet')),
    'the router must say why it is staying out',
  )

  const state = await stateOf(host, 's1')
  assert.equal(state.effortModelPending, true)
  assert.equal(state.effectiveEffortModel, null)
  assert.equal(state.effectiveControl, 'effort')
})

test('binding one model reports it back and clears the pending flag', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const bound = await post(host, '/model-router/effort-model', { sessionId: 's1', model: BOUND })
  assert.equal(bound.status, 200)
  const body = JSON.parse(bound.payload)
  assert.equal(body.ok, true)
  assert.equal(body.effortModel, BOUND)

  const state = await stateOf(host, 's1')
  assert.equal(state.effortModel, BOUND)
  assert.equal(state.effectiveEffortModel, BOUND)
  assert.equal(state.effortModelPending, false)
})

test('the bound effort scope raises only that model thinking level', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  await post(host, '/model-router/control', { sessionId: 's1', control: 'effort' })
  await post(host, '/model-router/effort-model', { sessionId: 's1', model: BOUND })

  const out = await request(host, { agent, turn: 1, step: 0 }, seed({ model: 'deepseek-v4-pro', reasoningEffort: 'low' }))
  assert.equal(out.model, 'deepseek-v4-pro', 'effort scope never changes the model')
  assert.equal(out.reasoningEffort, 'high', 'hard work is lifted from low to high')
})

test("the effort vocabulary comes from the bound model's own pool entry", async () => {
  const lite = { id: 'deepseek-official/deepseek-lite', cost: 1, tier: 'cheap', efforts: ['off', 'low'] }
  const host = makeHost({ pool: POOL.concat([lite]), routes: ROUTES })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  await post(host, '/model-router/control', { sessionId: 's1', control: 'effort' })
  await post(host, '/model-router/effort-model', { sessionId: 's1', model: 'deepseek-official/deepseek-lite' })

  const out = await request(host, { agent, turn: 1, step: 0 }, seed({ model: 'deepseek-lite', reasoningEffort: 'off' }))
  assert.equal(out.model, 'deepseek-lite')
  assert.equal(out.reasoningEffort, 'low', "an unrelated entry would have yielded 'high'")
})

test('in effort scope a model switch is not a manual override', async () => {
  let selection = { lastUsed: null, pending: null }
  const registered = []
  const projections = {
    stateOf: (session, key) => (key === 'modelSelection' ? selection : undefined),
    register: (definition) => { registered.push(definition); return () => {} },
  }
  const host = makeHost({ pool: POOL, routes: ROUTES }, { sessionProjections: projections })
  // The host service double must model the real registry: lib/index.js registers
  // its route projection through ctx.inject(['sessionProjections'], ...).
  assert.equal(registered.length, 1, 'exactly one projection registration')
  assert.equal(registered[0].key, 'modelRouterRoute')
  assert.equal(registered[0].stateVersion, 1)
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  await post(host, '/model-router/control', { sessionId: 's1', control: 'effort' })
  await post(host, '/model-router/effort-model', { sessionId: 's1', model: BOUND })

  const applied = await request(host, { agent, turn: 1, step: 0 }, seed({ model: 'deepseek-v4-pro', reasoningEffort: 'low' }))
  assert.equal(applied.model, 'deepseek-v4-pro')
  assert.equal(applied.reasoningEffort, 'high')

  // The user switches the session model to flash; the thinking level is untouched.
  selection = {
    lastUsed: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    pending: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
  }
  const switched = await request(host, { agent, turn: 1, step: 1 }, seed({ model: 'deepseek-flash', reasoningEffort: 'high' }))
  assert.ok(
    !host.logs.some((line) => line.includes('manual model selection detected')),
    'a model switch must not stand the router down in effort scope',
  )
  assert.equal(switched.model, 'deepseek-flash', 'the other model is left completely alone')
  assert.equal(switched.reasoningEffort, 'high')

  const state = await stateOf(host, 's1')
  assert.equal(state.engaged, true)
})

test('in effort scope a thinking-level change does stand the router down', async () => {
  let selection = { lastUsed: null, pending: null }
  const registered = []
  const projections = {
    stateOf: (session, key) => (key === 'modelSelection' ? selection : undefined),
    register: (definition) => { registered.push(definition); return () => {} },
  }
  const host = makeHost({ pool: POOL, routes: ROUTES }, { sessionProjections: projections })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  await post(host, '/model-router/control', { sessionId: 's1', control: 'effort' })
  await post(host, '/model-router/effort-model', { sessionId: 's1', model: BOUND })

  const applied = await request(host, { agent, turn: 1, step: 0 }, seed({ model: 'deepseek-v4-pro', reasoningEffort: 'low' }))
  assert.equal(applied.reasoningEffort, 'high')

  selection = {
    lastUsed: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    pending: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
  }
  const changed = await request(host, { agent, turn: 1, step: 1 }, seed({ model: 'deepseek-v4-pro', reasoningEffort: 'max' }))
  assert.ok(
    host.logs.some((line) => line.includes('manual model selection detected')),
    'the manual thinking pick must make the router yield',
  )
  assert.equal(changed.model, 'deepseek-v4-pro')
  assert.equal(changed.reasoningEffort, 'max', 'the user pick stands')

  const state = await stateOf(host, 's1')
  assert.equal(state.engaged, false)
})

test('model scope ignores an effort change but yields to a model change', async () => {
  let selection = { lastUsed: null, pending: null }
  const registered = []
  const projections = {
    stateOf: (session, key) => (key === 'modelSelection' ? selection : undefined),
    register: (definition) => { registered.push(definition); return () => {} },
  }
  const host = makeHost({ pool: POOL, routes: ROUTES }, { sessionProjections: projections })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  await post(host, '/model-router/control', { sessionId: 's1', control: 'model' })

  const first = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(first.model, 'deepseek-v4-pro')
  assert.equal(first.reasoningEffort, 'high')

  // An effort-only pending change: model scope owns the model dimension, so it
  // must neither stand down nor stop picking the pool model.
  selection = {
    lastUsed: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    pending: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' },
  }
  const effortOnly = await request(host, { agent, turn: 1, step: 1 }, seed({ model: 'deepseek-flash', reasoningEffort: 'low' }))
  assert.ok(
    !host.logs.some((line) => line.includes('manual model selection detected')),
    'an effort change is not an override in model scope',
  )
  assert.equal(effortOnly.model, 'deepseek-v4-pro', 'the router still picks the pool model')
  let state = await stateOf(host, 's1')
  assert.equal(state.engaged, true)

  // A model change in the pick does stand it down.
  selection = {
    lastUsed: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' },
    pending: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'low' },
  }
  const afterModel = await request(host, { agent, turn: 1, step: 2 }, seed({ model: 'deepseek-flash', reasoningEffort: 'low' }))
  assert.ok(host.logs.some((line) => line.includes('manual model selection detected')))
  assert.equal(afterModel.model, 'deepseek-flash')
  state = await stateOf(host, 's1')
  assert.equal(state.engaged, false)
})

test('full scope still reacts to an effort-only change', async () => {
  let selection = { lastUsed: null, pending: null }
  const registered = []
  const projections = {
    stateOf: (session, key) => (key === 'modelSelection' ? selection : undefined),
    register: (definition) => { registered.push(definition); return () => {} },
  }
  const host = makeHost({ pool: POOL, routes: ROUTES }, { sessionProjections: projections })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })

  const applied = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(applied.model, 'deepseek-v4-pro')
  assert.equal(applied.reasoningEffort, 'high')

  selection = {
    lastUsed: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    pending: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' },
  }
  await request(host, { agent, turn: 1, step: 1 }, seed({ model: 'deepseek-v4-pro', reasoningEffort: 'low' }))
  assert.ok(host.logs.some((line) => line.includes('manual model selection detected')))
  const state = await stateOf(host, 's1')
  assert.equal(state.engaged, false)
})

test('clearing, validating and protecting the effort-model route', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  await post(host, '/model-router/control', { sessionId: 's1', control: 'effort' })
  await post(host, '/model-router/effort-model', { sessionId: 's1', model: BOUND })
  assert.equal((await stateOf(host, 's1')).effortModelPending, false)

  const cleared = await post(host, '/model-router/effort-model', { sessionId: 's1', model: null })
  assert.equal(cleared.status, 200)
  assert.equal(JSON.parse(cleared.payload).effortModel, null)
  const state = await stateOf(host, 's1')
  assert.equal(state.effortModelPending, true)
  assert.equal(state.effectiveEffortModel, null)

  const invalid = await post(host, '/model-router/effort-model', { sessionId: 's1', model: 123 })
  assert.equal(invalid.status, 400)
  assert.equal(JSON.parse(invalid.payload).error, 'model must be a non-empty string or null')

  const cross = await post(host, '/model-router/effort-model', { sessionId: 's1', model: BOUND }, { origin: 'http://evil.test', host: 'localhost' })
  assert.equal(cross.status, 403)
})

test('a session-less binding becomes the default a fresh session inherits', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const bound = await post(host, '/model-router/effort-model', { model: BOUND })
  assert.equal(bound.status, 200)
  const body = JSON.parse(bound.payload)
  assert.equal(body.defaultScope, true)
  assert.equal(body.effectiveEffortModel, BOUND)

  const defaults = await stateOf(host)
  assert.equal(defaults.effectiveEffortModel, BOUND)

  const agent = agentWith([], 's2')
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  await post(host, '/model-router/control', { sessionId: 's2', control: 'effort' })
  const out = await request(host, { agent, turn: 1, step: 0 }, seed({ model: 'deepseek-v4-pro', reasoningEffort: 'low' }))
  assert.equal(out.model, 'deepseek-v4-pro')
  assert.equal(out.reasoningEffort, 'high', 'the inherited binding is enough to steer')
  assert.ok(
    !host.logs.some((line) => line.includes('effort scope has no model bound yet')),
    'the inherited binding must not be reported as unbound',
  )
})
