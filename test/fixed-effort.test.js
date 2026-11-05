import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { normalizePool } from '../lib/routing.js'

// A relay can pin one effort word on its side (v1.1): the request is rejected
// with a 400 for anything else, so "high" is not a routing decision there, it is
// the only legal value. The pool entry says which word the route accepts.

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-fixed-effort-'))
delete process.env.DSH_PROFILE_DIR
process.env.DSH_MODEL_ROUTER_NO_TOKEN = '1'

const ROUTES = { trivial: { effort: 'low' }, standard: { effort: 'low' }, engineering: { effort: 'high' }, hard: { effort: 'high' } }

test('normalizePool keeps a known fixedEffort and drops anything else', () => {
  const pool = normalizePool({
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    pool: [
      { id: 'relay/fast', fixedEffort: 'max' },
      { id: 'relay/slow', fixedEffort: 'turbo' },
      { id: 'relay/plain' },
      'relay/short',
    ],
  })
  assert.equal(pool[0].fixedEffort, 'max')
  assert.equal(pool[1].fixedEffort, undefined, 'a word the host does not know is dropped, not forwarded')
  assert.equal(pool[2].fixedEffort, undefined)
  assert.equal(pool[3].fixedEffort, undefined, 'a bare string entry stays bare')
  // The entry is frozen like every other pool entry.
  assert.equal(Object.isFrozen(pool[0]), true)
})

/** Host double: listeners, services, routes, logs. */
function makeHost(config = {}, services = {}) {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-fixed-effort-'))
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
  registry.set('commands', { register: () => () => {} })
  apply(ctx, config)
  return { handlers, routes, logs, registry }
}

const agentWith = () => ({ session: { id: 's1', deriveMessages: () => [] } })
const claimed = (text, turn = 1) => ({ turn, message: { content: text } })

function request(host, payload, seed) {
  const fns = host.handlers.get('agent/request') || []
  const inner = () => Promise.resolve(typeof seed === 'function' ? seed() : seed)
  const run = (index) => index >= fns.length ? inner() : fns[index](payload, () => run(index + 1))
  return run(0)
}

const seed = (over = {}) => ({ provider: 'relay', model: 'deepseek-v4.1-flash', reasoningEffort: 'max', ...over })

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

test('a pinned route sends its one word, whatever the step is worth', async () => {
  const host = makeHost({
    crossProvider: 'allow',
    provider: 'relay',
    model: 'deepseek-v4.1-flash',
    routes: ROUTES,
    pool: [{ id: 'relay/deepseek-v4.1-flash', cost: 1, tier: 'cheap', fixedEffort: 'max' }],
  })
  const agent = agentWith()
  // A trivial step would otherwise run at low; the relay only accepts max.
  emitClaimed(host, agent, '翻译一下')
  const out = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(out.model, 'deepseek-v4.1-flash')
  assert.equal(out.reasoningEffort, 'max', 'the pin wins over the ladder tier')
  const state = await call(host.routes.get('/model-router/state'), { method: 'GET', url: '/model-router/state?sessionId=s1' })
  const view = JSON.parse(state.payload)
  assert.equal(view.pool[0].fixedEffort, 'max', 'the panel can see the pin')
})

function emitClaimed(host, agent, text, turn = 1) {
  for (const fn of host.handlers.get('agent/inbox/claimed') || []) fn({ agent, ...claimed(text, turn) })
}

test('an unpinned route follows the lazy ladder as before', async () => {
  const host = makeHost({
    crossProvider: 'allow',
    provider: 'relay',
    model: 'deepseek-v4.1-flash',
    routes: ROUTES,
    pool: [{ id: 'relay/deepseek-v4.1-flash', cost: 1, tier: 'cheap', efforts: ['off', 'low', 'high', 'max'] }],
  })
  const agent = agentWith()
  emitClaimed(host, agent, '翻译一下')
  const trivial = await request(host, { agent, turn: 1, step: 0 }, seed({ reasoningEffort: 'low' }))
  assert.equal(trivial.reasoningEffort, 'low', 'no pin means the tier is mapped')
})

test('the model vocabulary comes from the host, not from a dead adapter call', async () => {
  const resolved = []
  const host = makeHost(
    {
      crossProvider: 'allow',
      provider: 'relay',
      model: 'other-writer',
      routes: { ...ROUTES, standard: { effort: 'max' } },
      pool: [{ id: 'relay/other-writer', cost: 4, tier: 'strong' }],
    },
    // The service-layer call. A host that only has the adapter-level
    // resolveModel would answer nothing, which is what 1.0 silently did.
    { llm: { resolveModelInfo: async (provider, model) => {
      resolved.push(provider + '/' + model)
      return { reasoning: { efforts: [{ id: 'low' }, { id: 'xhigh' }] } }
    } } },
  )
  const agent = agentWith()
  // allowMax is off by default, so a "max" tier is clamped to high first; the
  // point here is where the vocabulary comes from, not which word wins.
  emitClaimed(host, agent, '重构 架构 设计 规划 迁移 优化 性能 并发 并行 调试 诊断')
  const out = await request(host, { agent, turn: 1, step: 0 }, seed({ provider: 'relay', model: 'other-writer' }))
  assert.deepEqual(resolved, ['relay/other-writer'], 'the host is asked with the exact route')
  assert.equal(out.reasoningEffort, 'xhigh', 'high is mapped onto the nearest advertised word, not onto an empty list')
})

test('poisoned history keeps thinking off even on a route pinned to max', async () => {
  const host = makeHost({
    crossProvider: 'allow',
    provider: 'relay',
    model: 'deepseek-v4.1-flash',
    routes: ROUTES,
    pool: [{ id: 'relay/deepseek-v4.1-flash', cost: 1, tier: 'cheap', fixedEffort: 'max' }],
  })
  const agent = {
    session: {
      id: 's1',
      deriveMessages: () => [
        { role: 'user', content: [{ type: 'text', text: '之前的问题' }] },
        { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'read', args: {} }] },
      ],
    },
  }
  // The first request teaches the router about the history; the next one acts on it.
  await request(host, { agent, turn: 1, step: 0 }, seed())
  const out = await request(host, { agent, turn: 1, step: 1 }, seed())
  assert.equal(out.reasoningEffort, 'off', 'safety beats the pin')
  assert.ok(host.logs.some((line) => line.includes('tool call without a thinking block')))
})

test('the pin survives the panel round-trip through /pool', async () => {
  const host = makeHost({ provider: 'relay', model: 'deepseek-v4.1-flash', routes: ROUTES })
  const saved = await call(host.routes.get('/model-router/pool'), {
    method: 'POST', url: '/model-router/pool', headers: { origin: 'http://localhost', host: 'localhost' },
    body: { pool: [{ id: 'relay/deepseek-v4.1-flash', tier: 'cheap', fixedEffort: 'high' }] },
  })
  assert.equal(saved.status, 200)
  const state = await call(host.routes.get('/model-router/state'), { method: 'GET', url: '/model-router/state' })
  const view = JSON.parse(state.payload)
  assert.equal(view.pool[0].fixedEffort, 'high')
})
