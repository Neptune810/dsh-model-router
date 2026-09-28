import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-modes-'))
delete process.env.DSH_PROFILE_DIR

const ROUTES = { trivial: { effort: 'low' }, standard: { effort: 'low' }, engineering: { effort: 'high' }, hard: { effort: 'high' } }
/** A dense engineering brief classifies as "hard", which is what lifts the strong tier. */
const HARD_BRIEF = '重构 架构 设计 规划 迁移 优化 性能 并发 并行 调试 诊断'
const POOL = [
  { id: 'deepseek-official/deepseek-flash', cost: 1, tier: 'cheap' },
  { id: 'deepseek-official/deepseek-v4-pro', cost: 8, tier: 'strong' },
]

/** Host double: listeners, services, routes, logs. */
function makeHost(config = {}, services = {}) {
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
      for (const dep of deps) scope[dep] = registry.get(dep)
      callback(scope)
    },
  }
  registry.set('webServer', {
    register: ({ path, handler }) => { routes.set(path, handler); return () => routes.delete(path) },
  })
  apply(ctx, config)
  return { handlers, routes, logs, registry }
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

test('full scope routes hard work to the strong pool model and cheap work to flash', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  const hard = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(hard.model, 'deepseek-v4-pro')
  assert.equal(hard.reasoningEffort, 'high')
  assert.equal(hard.provider, 'deepseek-official')

  const agent2 = agentWith()
  emit(host, 'agent/inbox/claimed', { agent: agent2, ...claimed('翻译一下这句话') })
  const cheap = await request(host, { agent: agent2, turn: 1, step: 0 }, seed())
  assert.equal(cheap.model, 'deepseek-flash')
  assert.equal(cheap.reasoningEffort, 'low')
})

test('effort scope never changes the model, model scope never changes the effort', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  const control = await call(host.routes.get('/model-router/control'), {
    method: 'POST', url: '/model-router/control', headers: { origin: 'http://localhost', host: 'localhost' },
    body: { sessionId: 's1', control: 'effort' },
  })
  assert.equal(control.status, 200)
  const effortOnly = await request(host, { agent, turn: 1, step: 0 }, seed({ model: 'deepseek-v4-pro' }))
  assert.equal(effortOnly.model, 'deepseek-v4-pro', 'effort scope keeps the session model')
  assert.equal(effortOnly.reasoningEffort, 'high')

  await call(host.routes.get('/model-router/control'), {
    method: 'POST', url: '/model-router/control', headers: { origin: 'http://localhost', host: 'localhost' },
    body: { sessionId: 's1', control: 'model' },
  })
  const modelOnly = await request(host, { agent, turn: 1, step: 0 }, seed({ model: 'deepseek-flash', reasoningEffort: 'low' }))
  assert.equal(modelOnly.model, 'deepseek-v4-pro', 'model scope still picks the pool model')
  assert.equal(modelOnly.reasoningEffort, 'low', 'model scope keeps the session effort')
})

test('a manual pick makes the router stand down until the next command', async () => {
  let selection = { provider: 'deepseek-official', model: 'deepseek-flash' }
  const projections = { stateOf: (session, key) => (key === 'modelSelection' ? selection : undefined) }
  const host = makeHost({ pool: POOL, routes: ROUTES }, { sessionProjections: projections })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })

  // Baseline observation, then the user picks pro by hand.
  const first = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(first.model, 'deepseek-v4-pro')
  selection = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'low' }
  const afterManual = await request(host, { agent, turn: 1, step: 1 }, seed({ model: 'deepseek-flash', reasoningEffort: 'low' }))
  assert.equal(afterManual.model, 'deepseek-flash', 'the manual pick stands while the router is stood down')
  assert.equal(afterManual.reasoningEffort, 'low')
  assert.ok(host.logs.some((line) => line.includes('manual model selection detected')))

  // The next command re-engages.
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF, 2) })
  const second = await request(host, { agent, turn: 2, step: 0 }, seed())
  assert.equal(second.model, 'deepseek-v4-pro')
})

test('the UI resume route re-engages without waiting for a command', async () => {
  let selection = { model: 'a' }
  const projections = { stateOf: () => selection }
  const host = makeHost({ pool: POOL, routes: ROUTES }, { sessionProjections: projections })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  await request(host, { agent, turn: 1, step: 0 }, seed())
  selection = { model: 'b' }
  await request(host, { agent, turn: 1, step: 1 }, seed({ model: 'deepseek-flash' }))

  const resumed = await call(host.routes.get('/model-router/resume'), {
    method: 'POST', url: '/model-router/resume', headers: { origin: 'http://localhost', host: 'localhost' },
    body: { sessionId: 's1' },
  })
  assert.equal(resumed.status, 200)
  const out = await request(host, { agent, turn: 1, step: 2 }, seed({ model: 'deepseek-flash' }))
  assert.equal(out.model, 'deepseek-v4-pro')
})

test('mutations require a same-origin request', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const path = '/model-router/control'
  const cross = await call(host.routes.get(path), {
    method: 'POST', url: path, headers: { origin: 'http://evil.example', host: 'localhost' },
    body: { sessionId: 's1', control: 'effort' },
  })
  assert.equal(cross.status, 403)
  const crossSite = await call(host.routes.get(path), {
    method: 'POST', url: path, headers: { 'sec-fetch-site': 'cross-site', host: 'localhost' },
    body: { sessionId: 's1', control: 'effort' },
  })
  assert.equal(crossSite.status, 403)
  const wrongMethod = await call(host.routes.get(path), { method: 'GET', url: path })
  assert.equal(wrongMethod.status, 405)
})

test('the pool editor and preset editor round-trip through the routes', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const poolPath = '/model-router/pool'
  const saved = await call(host.routes.get(poolPath), {
    method: 'POST', url: poolPath, headers: { origin: 'http://localhost', host: 'localhost' },
    body: { pool: [{ id: 'other/big-model', tier: 'strong', cost: 20 }] },
  })
  assert.equal(saved.status, 200)
  const state = await call(host.routes.get('/model-router/state'), { method: 'GET', url: '/model-router/state?sessionId=s1' })
  const parsed = JSON.parse(state.payload)
  assert.deepEqual(parsed.pool.map((entry) => entry.id), ['other/big-model'])
  assert.equal(parsed.effectiveControl, 'full')
})

test('a pinned task type overrides the keyword rules', async () => {
  const presets = {
    novel: { match: ['续写'], weights: { 'deepseek-official/deepseek-v4-pro': 90, 'deepseek-official/deepseek-flash': 10 } },
    refactor: { match: ['refactor'], weights: { 'deepseek-official/deepseek-flash': 95, 'deepseek-official/deepseek-v4-pro': 5 } },
  }
  const host = makeHost({ pool: POOL, routes: ROUTES, presets })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('写点别的') })

  const pinned = await call(host.routes.get('/model-router/task-type'), {
    method: 'POST', url: '/model-router/task-type', headers: { origin: 'http://localhost', host: 'localhost' },
    body: { sessionId: 's1', preset: 'novel' },
  })
  assert.equal(pinned.status, 200)
  const out = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(out.model, 'deepseek-v4-pro', 'the pinned task type weighs pro first')

  const unknown = await call(host.routes.get('/model-router/task-type'), {
    method: 'POST', url: '/model-router/task-type', headers: { origin: 'http://localhost', host: 'localhost' },
    body: { sessionId: 's1', preset: 'nope' },
  })
  assert.equal(unknown.status, 400)
})

test('third-party models route with their own effort vocabulary', async () => {
  const host = makeHost(
    {
      pool: [
        { id: 'deepseek-official/deepseek-flash', cost: 1, tier: 'cheap' },
        { id: 'vendor-x/writer-pro', cost: 4, tier: 'strong', weights: { novel: 99 } },
      ],
      presets: { novel: { match: ['续写'] } },
      routes: { ...ROUTES, standard: { effort: 'max' } },
    },
    { llm: { resolveModel: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }) } },
  )
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('帮我续写这一段') })
  const out = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(out.provider, 'vendor-x')
  assert.equal(out.model, 'writer-pro')
  assert.equal(out.reasoningEffort, 'high', 'max clamps onto the model vocabulary')
})

test('the routes behave the same on a real HTTP server', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const handler = host.routes.get(url.pathname)
    if (!handler) { res.writeHead(404); res.end(); return }
    return handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  try {
    const state = await fetch(origin + '/model-router/state?sessionId=s1').then((response) => response.json())
    assert.equal(state.ok, true)
    assert.deepEqual(state.pool.map((entry) => entry.id), ['deepseek-official/deepseek-flash', 'deepseek-official/deepseek-v4-pro'])

    const denied = await fetch(origin + '/model-router/control', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ sessionId: 's1', control: 'effort' }),
    })
    assert.equal(denied.status, 403)

    const allowed = await fetch(origin + '/model-router/control', {
      method: 'POST', headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ sessionId: 's1', control: 'effort' }),
    })
    assert.equal(allowed.status, 200)
    assert.equal((await allowed.json()).effectiveControl, 'effort')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
