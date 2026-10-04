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
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-modes-'))
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
  // The real projection state is { lastUsed, pending } (see the host projection).
  let selection = { lastUsed: null, pending: null }
  const registered = []
  const projections = {
    stateOf: (session, key) => (key === 'modelSelection' ? selection : undefined),
    // Model the real sessionProjections service: lib/index.js registers its route
    // projection through ctx.inject(['sessionProjections'], ...).
    register: (definition) => { registered.push(definition); return () => {} },
  }
  const host = makeHost({ pool: POOL, routes: ROUTES }, { sessionProjections: projections })
  assert.equal(registered.length, 1, 'exactly one projection registration')
  assert.equal(registered[0].key, 'modelRouterRoute')
  assert.equal(registered[0].stateVersion, 1)
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })

  // No pending pick: the router routes.
  const first = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(first.model, 'deepseek-v4-pro')
  assert.ok(!host.logs.some((line) => line.includes('manual model selection detected')), 'routing alone is not a manual pick')

  // The user picks flash in the model seat; the host records it as pending.
  selection = {
    lastUsed: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    pending: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'low' },
  }
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
  let selection = { lastUsed: null, pending: null }
  const registered = []
  const projections = {
    stateOf: () => selection,
    register: (definition) => { registered.push(definition); return () => {} },
  }
  const host = makeHost({ pool: POOL, routes: ROUTES }, { sessionProjections: projections })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  await request(host, { agent, turn: 1, step: 0 }, seed())
  selection = {
    lastUsed: { provider: 'deepseek-official', model: 'deepseek-flash' },
    pending: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'low' },
  }
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
  const nullOrigin = await call(host.routes.get(path), {
    method: 'POST', url: path, headers: { origin: 'null', host: 'localhost' },
    body: { sessionId: 's1', control: 'effort' },
  })
  assert.equal(nullOrigin.status, 403, 'a present but unparseable origin is not an absent one')
  const wrongMethod = await call(host.routes.get(path), { method: 'GET', url: path })
  assert.equal(wrongMethod.status, 405)
})

test('the Desktop proxy strips the origin headers, so its mutations must pass', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const path = '/model-router/control'
  const stripped = await call(host.routes.get(path), {
    method: 'POST', url: path, headers: {},
    body: { sessionId: 's1', control: 'effort' },
  })
  assert.equal(stripped.status, 200)
  assert.equal(JSON.parse(stripped.payload).ok, true)
  const forwarded = await call(host.routes.get(path), {
    method: 'POST', url: path, headers: { 'content-type': 'application/json', cookie: 'dsh=signed' },
    body: { sessionId: 's1', control: 'full' },
  })
  assert.equal(forwarded.status, 200)
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
      // crossProvider must be explicitly allowed: the default ('confirm') would
      // hold this step on deepseek-official and only propose the vendor-x switch.
      crossProvider: 'allow',
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

test('image routing sends image steps to the vision model and text steps back', async () => {
  const host = makeHost({
    pool: POOL.concat([{ id: 'deepseek-official/deepseek-v4-flash-vision-exp', cost: 1, tags: ['vision'] }]),
    routes: ROUTES,
    imagePolicy: 'vision',
  })
  const agent = agentWith([{ role: 'user', content: [{ type: 'text', text: '看这张图' }, { type: 'image' }] }])
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('看这张图') })

  const image = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(image.model, 'deepseek-v4-flash-vision-exp')

  // The image stays task-scoped: a new task without one returns to the normal tier.
  emit(host, 'agent/inbox/claimed', { agent, turn: 2, message: { content: '改个变量名' } })
  const text = await request(host, { agent, turn: 2, step: 0 }, seed())
  assert.notEqual(text.model, 'deepseek-v4-flash-vision-exp')
})

test('a subagent spends the cheap tier even on hard work', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const lead = agentWith()
  emit(host, 'agent/inbox/claimed', { agent: lead, ...claimed(HARD_BRIEF) })
  const leadOut = await request(host, { agent: lead, turn: 1, step: 0 }, seed())
  assert.equal(leadOut.model, 'deepseek-v4-pro')

  const sub = agentWith()
  sub.session.header = { delegationDepth: 1 }
  emit(host, 'agent/inbox/claimed', { agent: sub, ...claimed(HARD_BRIEF) })
  const subOut = await request(host, { agent: sub, turn: 1, step: 0 }, seed())
  assert.equal(subOut.model, 'deepseek-flash')
})

test('the active todo feeds task-type matching', async () => {
  const presets = { novel: { match: ['续写'], weights: { 'deepseek-official/deepseek-v4-pro': 95 } } }
  const registered = []
  const projections = {
    stateOf: (session, key) => (key === 'todos' ? [{ content: '续写第三章', status: 'in_progress' }] : undefined),
    register: (definition) => { registered.push(definition); return () => {} },
  }
  const host = makeHost({ pool: POOL, routes: ROUTES, presets }, { sessionProjections: projections })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('继续') })
  const out = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(out.model, 'deepseek-v4-pro', 'the todo text matched the preset, not the prompt')
})

test('context pressure biases toward the cheap tier', async () => {
  const registered = []
  const projections = {
    stateOf: (session, key) => (key === 'contextPressure' ? { contextWindow: 1000, pressureTokens: 950, surfaceTokens: 950 } : undefined),
    register: (definition) => { registered.push(definition); return () => {} },
  }
  const host = makeHost({ pool: POOL, routes: ROUTES }, { sessionProjections: projections })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  const out = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(out.model, 'deepseek-flash', 'a nearly full context prefers the cheap model')
})

test('/router reports the live routing state', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(host.commands.length, 1)
  assert.equal(host.commands[0].name, 'router')
  const result = host.commands[0].handler({}, { agent })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /model-router/)
  assert.match(result.text, /deepseek-v4-pro/)
  assert.match(result.text, /scope:/)
})

test('classifier llm classifies once per turn and falls back to the rules', async () => {
  let calls = 0
  const llm = { stream: async function* stream() { calls += 1; yield { type: 'text-delta', index: 0, text: 'novel' } } }
  const presets = { novel: { match: ['绝不出现的词'], weights: { 'deepseek-official/deepseek-v4-pro': 99 } } }
  const host = makeHost({ pool: POOL, routes: ROUTES, presets, classifier: 'llm' }, { llm })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('写点东西') })
  const first = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(first.model, 'deepseek-v4-pro')
  assert.equal(calls, 1)
  await request(host, { agent, turn: 1, step: 1 }, seed())
  assert.equal(calls, 1, 'the classification is cached for the turn')

  const broken = makeHost({ pool: POOL, routes: ROUTES, presets, classifier: 'llm' }, { llm: { stream: () => { throw new Error('no classifier model') } } })
  const agent2 = agentWith()
  emit(broken, 'agent/inbox/claimed', { agent: agent2, ...claimed('翻译一句话') })
  const fallback = await request(broken, { agent: agent2, turn: 1, step: 0 }, seed())
  assert.equal(fallback.model, 'deepseek-flash')
})

test('the settings route drives images, classifier and pressure from the UI', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const path = '/model-router/settings'
  const posted = await call(host.routes.get(path), {
    method: 'POST', url: path, headers: { origin: 'http://localhost', host: 'localhost' },
    body: { settings: { imagePolicy: 'vision', classifier: 'llm', signals: { contextPressure: 0 } } },
  })
  assert.equal(posted.status, 200)
  const state = JSON.parse((await call(host.routes.get('/model-router/state'), {
    method: 'GET', url: '/model-router/state?sessionId=s1',
  })).payload)
  assert.equal(state.settings.imagePolicy, 'vision')
  assert.equal(state.settings.classifier, 'llm')
  assert.equal(state.settings.signals.contextPressure, 0)
  assert.equal(state.settings.panelBg, 'solid')

  const themed = await call(host.routes.get(path), {
    method: 'POST', url: path, headers: { origin: 'http://localhost', host: 'localhost' },
    body: { settings: { panelBg: 'theme' } },
  })
  assert.equal(themed.status, 200)
  const after = JSON.parse((await call(host.routes.get('/model-router/state'), {
    method: 'GET', url: '/model-router/state?sessionId=s1',
  })).payload)
  assert.equal(after.settings.panelBg, 'theme')
})

test('the catalog route lists provider models for the pool UI', async () => {
  const llm = {
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    listModels: async (provider) => (provider === 'deepseek-official'
      ? [{ id: 'deepseek-flash', name: 'Flash' }, { id: 'deepseek-v4-pro', name: 'Pro' }]
      : []),
  }
  const host = makeHost({ pool: POOL, routes: ROUTES }, { llm })
  const response = await call(host.routes.get('/model-router/catalog'), { method: 'GET', url: '/model-router/catalog' })
  const body = JSON.parse(response.payload)
  assert.equal(response.status, 200)
  assert.deepEqual(body.groups, [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [{ id: 'deepseek-flash', name: 'Flash' }, { id: 'deepseek-v4-pro', name: 'Pro' }],
  }])
})

test("the router's own model change is not mistaken for a manual pick", async () => {
  // The host writes what was actually used into lastUsed; pending stays null.
  const selection = { lastUsed: null, pending: null }
  const registered = []
  const projections = {
    stateOf: (session, key) => (key === 'modelSelection' ? selection : undefined),
    register: (definition) => { registered.push(definition); return () => {} },
  }
  const host = makeHost({ pool: POOL, routes: ROUTES }, { sessionProjections: projections })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })

  const first = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(first.model, 'deepseek-v4-pro')
  selection.lastUsed = { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' }

  const second = await request(host, { agent, turn: 1, step: 1 }, seed({ model: 'deepseek-v4-pro', reasoningEffort: 'high' }))
  assert.equal(second.model, 'deepseek-v4-pro', 'the router keeps routing after logging its own model')
  assert.ok(
    !host.logs.some((line) => line.includes('manual model selection detected')),
    'a router-chosen model recorded as lastUsed must never stand the router down',
  )
})

test('a scope pick before the session exists becomes the default', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const path = '/model-router/control'
  const posted = await call(host.routes.get(path), {
    method: 'POST', url: path, headers: { origin: 'http://localhost', host: 'localhost' },
    body: { control: 'model' },
  })
  assert.equal(posted.status, 200)
  const body = JSON.parse(posted.payload)
  assert.equal(body.defaultScope, true, 'the host reports that it set the default')
  assert.equal(body.effectiveControl, 'model')

  const state = JSON.parse((await call(host.routes.get('/model-router/state'), {
    method: 'GET', url: '/model-router/state',
  })).payload)
  assert.equal(state.effectiveControl, 'model', 'a session-less state read shows the default')
  assert.equal(state.settings.control, 'model')

  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  const routed = await request(host, { agent, turn: 1, step: 0 }, seed({ model: 'deepseek-flash', reasoningEffort: 'high' }))
  assert.equal(routed.model, 'deepseek-v4-pro', 'a new session inherits the default scope')
  assert.equal(routed.reasoningEffort, 'high', 'model scope leaves the effort alone')
})

test('a pick for a session that has not run yet is reflected by /state', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES, presets: { novel: { match: ['续写'], weights: {} } } })
  const headers = { origin: 'http://localhost', host: 'localhost' }
  await call(host.routes.get('/model-router/control'), {
    method: 'POST', url: '/model-router/control', headers, body: { sessionId: 'fresh-session', control: 'effort' },
  })
  await call(host.routes.get('/model-router/task-type'), {
    method: 'POST', url: '/model-router/task-type', headers, body: { sessionId: 'fresh-session', preset: 'novel' },
  })

  const state = JSON.parse((await call(host.routes.get('/model-router/state'), {
    method: 'GET', url: '/model-router/state?sessionId=fresh-session',
  })).payload)
  assert.equal(state.control, 'effort', 'the scope shows before the first request')
  assert.equal(state.effectiveControl, 'effort')
  assert.equal(state.pinnedTaskType, 'novel', 'the pinned task type shows before the first request')
})

// ---- cross-provider guard (v0.14) -------------------------------------------

/** Pool that spans two brands: flash is the anchor, writer-pro is the rival. */
const CROSS_POOL = [
  { id: 'deepseek-official/deepseek-flash', cost: 1, tier: 'cheap' },
  { id: 'vendor-x/writer-pro', cost: 4, tier: 'strong', weights: { novel: 99 } },
]
const CROSS_PRESETS = { novel: { match: ['续写'], weights: { 'vendor-x/writer-pro': 99 } } }
const SAME_ORIGIN = { origin: 'http://localhost', host: 'localhost' }

async function stateOf(host, sessionId = 's1') {
  const res = await call(host.routes.get('/model-router/state'), {
    method: 'GET', url: '/model-router/state?sessionId=' + sessionId,
  })
  return JSON.parse(res.payload)
}

test('a cross-provider switch is proposed, not taken, by default', async () => {
  const host = makeHost({ pool: CROSS_POOL, routes: ROUTES, presets: CROSS_PRESETS })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('帮我续写这一段') })
  const held = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(held.provider, 'deepseek-official', 'the conversation stays on its own brand')
  assert.equal(held.model, 'deepseek-flash')

  const state = await stateOf(host)
  assert.equal(state.cross.mode, 'confirm')
  assert.equal(state.cross.defaultMode, 'confirm')
  assert.equal(state.cross.anchor, 'deepseek-official')
  assert.equal(state.cross.allowed, false)
  assert.equal(state.cross.proposal.id, 'vendor-x/writer-pro', 'the rival is exposed as a proposal')
  assert.equal(state.cross.proposal.provider, 'vendor-x')
})

test('allowing a conversation lets it cross to the other brand', async () => {
  const host = makeHost({ pool: CROSS_POOL, routes: ROUTES, presets: CROSS_PRESETS })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('帮我续写这一段') })
  await request(host, { agent, turn: 1, step: 0 }, seed())

  const allowed = await call(host.routes.get('/model-router/cross'), {
    method: 'POST', url: '/model-router/cross', headers: SAME_ORIGIN,
    body: { sessionId: 's1', action: 'allow' },
  })
  assert.equal(allowed.status, 200)

  emit(host, 'agent/inbox/claimed', { agent, ...claimed('帮我续写这一段', 2) })
  const crossed = await request(host, { agent, turn: 2, step: 0 }, seed())
  assert.equal(crossed.provider, 'vendor-x')
  assert.equal(crossed.model, 'writer-pro')
  assert.equal((await stateOf(host)).cross.allowed, true)
})

test('approving the proposal crosses once, then the new brand is the anchor', async () => {
  const host = makeHost({ pool: CROSS_POOL, routes: ROUTES, presets: CROSS_PRESETS })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('帮我续写这一段') })
  await request(host, { agent, turn: 1, step: 0 }, seed())

  const once = await call(host.routes.get('/model-router/cross'), {
    method: 'POST', url: '/model-router/cross', headers: SAME_ORIGIN,
    body: { sessionId: 's1', action: 'once' },
  })
  assert.equal(once.status, 200)
  assert.equal(JSON.parse(once.payload).once, 'vendor-x/writer-pro')

  emit(host, 'agent/inbox/claimed', { agent, ...claimed('帮我续写这一段', 2) })
  const crossed = await request(host, { agent, turn: 2, step: 0 }, seed())
  assert.equal(crossed.provider, 'vendor-x')
  assert.equal(crossed.model, 'writer-pro')
  assert.equal((await stateOf(host)).cross.allowed, false, 'once is not a standing permission')
})

test('never keeps the conversation on its own brand with no proposal', async () => {
  const host = makeHost({ pool: CROSS_POOL, routes: ROUTES, presets: CROSS_PRESETS, crossProvider: 'never' })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('帮我续写这一段') })
  const held = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(held.provider, 'deepseek-official')
  assert.equal(held.model, 'deepseek-flash')
  const state = await stateOf(host)
  assert.equal(state.cross.mode, 'never')
  assert.equal(state.cross.proposal, null)
})

test('a pool that only holds another brand still routes (guard needs an anchor brand)', async () => {
  const host = makeHost({
    pool: [{ id: 'vendor-x/writer-pro', cost: 4, tier: 'strong', weights: { novel: 99 } }],
    routes: ROUTES,
    presets: CROSS_PRESETS,
  })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('帮我续写这一段') })
  const out = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(out.provider, 'vendor-x')
  assert.equal(out.model, 'writer-pro')
})

test('a single-brand pool never proposes a cross-provider switch', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal((await stateOf(host)).cross.proposal, null)
})

test('the /cross route rejects an unknown action', async () => {
  const host = makeHost({ pool: CROSS_POOL, routes: ROUTES })
  const res = await call(host.routes.get('/model-router/cross'), {
    method: 'POST', url: '/model-router/cross', headers: SAME_ORIGIN,
    body: { sessionId: 's1', action: 'sometimes' },
  })
  assert.equal(res.status, 400)
})

test('the pool auto-pricer fills unlabelled rows and leaves hand-labelled ones alone', async () => {
  const host = makeHost({
    pool: [
      { id: 'deepseek-official/deepseek-reasoner' },
      { id: 'deepseek-official/deepseek-flash', cost: 8, costSource: 'manual' },
      { id: 'vendor-x/gpt-4o-mini' },
    ],
    routes: ROUTES,
  })
  const priced = await call(host.routes.get('/model-router/pool/auto-price'), {
    method: 'POST', url: '/model-router/pool/auto-price', headers: SAME_ORIGIN, body: {},
  })
  assert.equal(priced.status, 200)
  const payload = JSON.parse(priced.payload)
  assert.equal(payload.ok, true)
  assert.equal(payload.source, 'builtin')
  const filled = Object.fromEntries(payload.changed.map((row) => [row.id, row.to]))
  assert.equal(filled['deepseek-official/deepseek-reasoner'], 4)
  assert.equal(filled['vendor-x/gpt-4o-mini'], 1)
  assert.deepEqual(payload.skipped.map((row) => row.id), ['deepseek-official/deepseek-flash'])

  const state = await stateOf(host)
  const rows = Object.fromEntries(state.pool.map((row) => [row.id, row]))
  assert.equal(rows['deepseek-official/deepseek-flash'].cost, 8, 'the manual label survives')
  assert.equal(rows['deepseek-official/deepseek-flash'].costSource, 'manual')
  assert.equal(rows['deepseek-official/deepseek-reasoner'].costSource, 'builtin')
})

test('the /prices route reports a fetch failure instead of throwing', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('offline') }
  try {
    const res = await call(host.routes.get('/model-router/prices'), {
      method: 'POST', url: '/model-router/prices', headers: SAME_ORIGIN, body: {},
    })
    assert.equal(res.status, 400, 'a failed refresh is reported as a 400')
    assert.match(JSON.parse(res.payload).error, /offline|fetch/i)
  } finally {
    globalThis.fetch = original
  }
})

test('a refreshed OpenRouter snapshot wins over the built-in rules', async () => {
  const host = makeHost({ pool: [{ id: 'vendor-x/mystery-model' }], routes: ROUTES })
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [
        { id: 'vendor-x/mystery-model', name: 'Mystery', pricing: { prompt: '0.00002', completion: '0.00006' } },
      ],
    }),
  })
  try {
    const refreshed = await call(host.routes.get('/model-router/prices'), {
      method: 'POST', url: '/model-router/prices', headers: SAME_ORIGIN, body: {},
    })
    assert.equal(refreshed.status, 200)
    assert.equal(JSON.parse(refreshed.payload).count, 1)

    const priced = await call(host.routes.get('/model-router/pool/auto-price'), {
      method: 'POST', url: '/model-router/pool/auto-price', headers: SAME_ORIGIN, body: {},
    })
    const payload = JSON.parse(priced.payload)
    assert.equal(payload.source, 'openrouter+builtin')
    assert.equal(payload.changed[0].source, 'openrouter')
    assert.equal(payload.changed[0].to, 8, 'the snapshot price is used')
    const state = await stateOf(host)
    assert.equal(state.prices.remote.count, 1)
  } finally {
    globalThis.fetch = original
  }
})

