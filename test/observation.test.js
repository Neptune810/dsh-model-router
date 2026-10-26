import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, scoreOf } from '../lib/policy.js'
import { apply } from '../lib/index.js'

// Every host gets its own state + telemetry directory.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-obs-'))
delete process.env.DSH_PROFILE_DIR
process.env.DSH_MODEL_ROUTER_NO_TOKEN = '1'

const ROUTES = { trivial: { effort: 'low' }, standard: { effort: 'low' }, engineering: { effort: 'high' }, hard: { effort: 'high' } }
const HARD_BRIEF = '重构 架构 设计 规划 迁移 优化 性能 并发 并行 调试 诊断'
const POOL = [
  { id: 'deepseek-official/deepseek-flash', cost: 1, tier: 'cheap' },
  { id: 'deepseek-official/deepseek-v4-pro', cost: 8, tier: 'strong' },
]

/** Host double: listeners, services, routes, commands. */
function makeHost(config = {}, services = {}) {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-obs-'))
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

/** Token usage projection whose totals the test can move between steps. */
function tokenUsage(initial = { input: 0, output: 0, cacheRead: 0, reasoning: 0 }) {
  const totals = { ...initial }
  return {
    totals,
    add(tokens) { totals.input += tokens },
    service: {
      stateOf: (session, key) => {
        if (key === 'tokenUsage') return { totals }
        return undefined
      },
      register: () => () => {},
    },
  }
}

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
const stateOf = async (host, sessionId = 's1') =>
  JSON.parse((await call(host.routes.get('/model-router/state'), { url: '/model-router/state?sessionId=' + sessionId })).payload)
const tick = () => new Promise((resolve) => setTimeout(resolve, 30))

test('the state route publishes the v0.15 observation surface', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  await request(host, { agent, turn: 1, step: 0 }, seed())

  const state = await stateOf(host)
  assert.equal(typeof state.stateVersion, 'number')
  assert.equal(typeof state.cost.sessionTokens, 'number')
  assert.equal(typeof state.cost.sessionCostUnits, 'number')
  assert.deepEqual(Object.keys(state.classifierStats).sort(), ['calls', 'durationMs', 'fails', 'fallbacks', 'tokens'])
  assert.equal(state.telemetry.enabled, true)
  assert.equal(typeof state.telemetry.written, 'number')
  assert.ok(Array.isArray(state.compat.missing))
  assert.equal(state.settings.classifierMinConfidence, 0)

  // The revision counter moves when a routed step is recorded, and the panel's
  // ETag is what changes with it.
  const before = state.stateVersion
  await request(host, { agent, turn: 1, step: 1 }, seed())
  const after = await stateOf(host)
  assert.ok(after.stateVersion > before)
})

test('the state route answers a matching If-None-Match with 304 and no body', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const first = await call(host.routes.get('/model-router/state'), { url: '/model-router/state?sessionId=s1' })
  assert.equal(first.status, 200)
  assert.match(first.headers.etag, /^W\//)
  const second = await call(host.routes.get('/model-router/state'), {
    url: '/model-router/state?sessionId=s1',
    headers: { 'if-none-match': first.headers.etag },
  })
  assert.equal(second.status, 304)
  assert.equal(second.payload, '')
})

test('routed steps are persisted to telemetry and /stats aggregates them', async () => {
  const usage = tokenUsage({ input: 1000, output: 0, cacheRead: 0, reasoning: 0 })
  const host = makeHost({ pool: POOL, routes: ROUTES }, { sessionProjections: usage.service })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })

  await request(host, { agent, turn: 1, step: 0 }, seed())
  usage.add(8000)
  await request(host, { agent, turn: 1, step: 1 }, seed())
  await tick()

  const state = await stateOf(host)
  assert.equal(state.cost.sessionTokens, 9000)
  assert.ok(state.cost.sessionCostUnits > 0, 'the second step spends cost units')
  assert.equal(state.telemetry.written >= 2, true)

  const stats = JSON.parse((await call(host.routes.get('/model-router/stats'), { url: '/model-router/stats' })).payload)
  assert.equal(stats.ok, true)
  assert.ok(stats.window.steps >= 2)
  assert.ok(stats.byClass.length > 0)
  assert.ok(stats.byModel.length > 0)
  assert.equal(typeof stats.totals.costUnits, 'number')
  assert.equal(typeof stats.totals.overrideRate, 'number')
  assert.equal(typeof stats.telemetry.written, 'number', 'no absolute directory leaks through the stats route')
})

test('/router replay prints the persisted decisions and explains an empty log', async () => {
  const empty = makeHost({ pool: POOL, routes: ROUTES })
  const emptyAgent = agentWith()
  const nothing = empty.commands[0].handler({}, { agent: emptyAgent, args: ['replay'] })
  assert.equal(nothing.kind, 'success')
  assert.match(nothing.text, /no persisted decisions yet/)

  const usage = tokenUsage({ input: 500, output: 0, cacheRead: 0, reasoning: 0 })
  const host = makeHost({ pool: POOL, routes: ROUTES }, { sessionProjections: usage.service })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_BRIEF) })
  await request(host, { agent, turn: 1, step: 0 }, seed())
  usage.add(4000)
  await request(host, { agent, turn: 1, step: 1 }, seed())
  await tick()

  const replay = host.commands[0].handler({}, { agent, args: ['replay', '5'] })
  assert.equal(replay.kind, 'success')
  assert.match(replay.text, /persisted decision\(s\)/)
  assert.match(replay.text, /t1s0/)
  assert.match(replay.text, /deepseek-/)
  // A non-numeric argument falls back to the default limit instead of failing.
  assert.match(host.commands[0].handler({}, { agent, args: ['replay', 'banana'] }).text, /persisted decision/)
  // The argument-free command still reports the live plan.
  assert.match(host.commands[0].handler({}, { agent }).text, /model-router — session/)
})

test('the semantic classifier answer is filtered by classifierMinConfidence', async () => {
  const presets = { novel: { match: ['__never__'], weights: { 'deepseek-official/deepseek-v4-pro': 99 } } }
  const answer = (text) => ({
    stream: async function* stream() { yield { type: 'text-delta', index: 0, text } },
  })
  const low = makeHost(
    { pool: POOL, routes: ROUTES, presets, classifier: 'llm', classifierMinConfidence: 0.6 },
    { llm: answer('{"type":"novel","confidence":0.2}') },
  )
  const lowAgent = agentWith()
  emit(low, 'agent/inbox/claimed', { agent: lowAgent, ...claimed('write something') })
  const ignored = await request(low, { agent: lowAgent, turn: 1, step: 0 }, seed())
  assert.equal(ignored.model, 'deepseek-flash', 'a low-confidence answer falls back to the rules')

  const accept = makeHost(
    { pool: POOL, routes: ROUTES, presets, classifier: 'llm' },
    { llm: answer('{"type":"novel","confidence":0.2}') },
  )
  const acceptAgent = agentWith()
  emit(accept, 'agent/inbox/claimed', { agent: acceptAgent, ...claimed('write something') })
  const used = await request(accept, { agent: acceptAgent, turn: 1, step: 0 }, seed())
  assert.equal(used.model, 'deepseek-v4-pro', 'with the default floor every answer is used')
})

test('a nine-word route keeps the legacy thinking and allowMax guards', async () => {
  const off = makeHost({ routes: { ...ROUTES, trivial: { effort: 'none' } } })
  const offAgent = agentWith()
  emit(off, 'agent/inbox/claimed', { agent: offAgent, ...claimed('翻译这句话：hello world') })
  const offOut = await request(off, { agent: offAgent, turn: 1, step: 0 }, seed())
  assert.equal(offOut.reasoningEffort, 'low', 'a hand-written none cannot disable thinking')

  const capped = makeHost({ routes: { ...ROUTES, hard: { effort: 'xhigh' } } })
  const cappedAgent = agentWith()
  emit(capped, 'agent/inbox/claimed', { agent: cappedAgent, ...claimed(HARD_BRIEF) })
  const cappedOut = await request(capped, { agent: cappedAgent, turn: 1, step: 0 }, seed())
  assert.equal(cappedOut.reasoningEffort, 'high', 'max-class words are opt-in like max')

  const allowed = makeHost({ allowMax: true, routes: { ...ROUTES, hard: { effort: 'xhigh' } } })
  const allowedAgent = agentWith()
  emit(allowed, 'agent/inbox/claimed', { agent: allowedAgent, ...claimed(HARD_BRIEF) })
  const allowedOut = await request(allowed, { agent: allowedAgent, turn: 1, step: 0 }, seed())
  assert.equal(allowedOut.reasoningEffort, 'max', 'DeepSeek has no xhigh, so the nearest is max')
})

test('scoreOf publishes a scoreParts breakdown that sums to the score', () => {
  const result = scoreOf({ text: 'refactor the parser step by step', toolCalls: 2, turn: 1 }, DEFAULT_CONFIG)
  assert.deepEqual(Object.keys(result.scoreParts).sort(), ['base', 'bullet', 'code', 'length', 'normal', 'plan', 'strong', 'tool', 'turn'])
  const sum = Object.values(result.scoreParts).reduce((total, value) => total + value, 0)
  assert.equal(result.score, Math.max(0, Math.min(100, Math.round(sum))))
  assert.equal(result.scoreParts.base, 6)
  assert.ok(result.scoreParts.tool > 0)
})

// ---- v0.16.0 cost-aware shadow ---------------------------------------------
// Two cheap entries, so the preset weight alone decides the live route. The
// dearer model wins by two points, which the token cost term (~2.9 points at the
// measured pro/flash ratio of 3.9x) then erases — a margin small enough to prove
// the shadow is computed independently of the applied route, not echoed from it.
const COST_POOL = [
  { id: 'deepseek-official/deepseek-flash', cost: 1, tier: 'cheap' },
  { id: 'deepseek-official/deepseek-v4-pro', cost: 1, tier: 'cheap' },
]
const COST_PRESETS = {
  api: { match: ['接口'], weights: { 'deepseek-official/deepseek-flash': 90, 'deepseek-official/deepseek-v4-pro': 92 } },
}
const UNPRICED_POOL = [
  { id: 'local/some-model', cost: 1, tier: 'cheap' },
  { id: 'local/other-model', cost: 1, tier: 'cheap' },
]

test('the shadow records the model a cost-aware router would have picked', async () => {
  const host = makeHost({ pool: COST_POOL, routes: ROUTES, presets: COST_PRESETS })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('接口文档') })
  const out = await request(host, { agent, turn: 1, step: 0 }, seed())

  assert.equal(out.model, 'deepseek-v4-pro', 'the live route still follows the preset weight')

  const state = await stateOf(host)
  assert.equal(state.costAware.enabled, false)
  assert.equal(typeof state.costAware.costWeight, 'number')
  assert.equal(state.costAware.guard.maxMultiple, 8)
  assert.ok(Number.isFinite(state.costAware.floorUsdPerMTok))

  const entries = new Map(state.costAware.entries.map((e) => [e.id, e]))
  const flash = entries.get('deepseek-official/deepseek-flash')
  const pro = entries.get('deepseek-official/deepseek-v4-pro')
  assert.equal(flash.priced, true)
  assert.equal(pro.priced, true)
  assert.equal(flash.currency, 'CNY')
  assert.ok(pro.usdPerMTok > flash.usdPerMTok, 'the pro model is the dearer one')
  assert.equal(state.costAware.floorUsdPerMTok, flash.usdPerMTok)

  const shadow = state.costAware.shadow
  assert.equal(shadow.current, 'deepseek-official/deepseek-v4-pro')
  assert.equal(shadow.candidate, 'deepseek-official/deepseek-flash')
  assert.equal(shadow.agree, false)
  assert.ok(shadow.savedRatio > 0 && shadow.savedRatio < 1)
  assert.equal(shadow.costFallback, false)
})

test('the shadow agrees when the live route is already the cheap pick, and stats count it', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('refactor the parser') })
  const out = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(out.model, 'deepseek-flash')
  await tick()

  const state = await stateOf(host)
  const shadow = state.costAware.shadow
  assert.equal(shadow.current, 'deepseek-official/deepseek-flash')
  assert.equal(shadow.candidate, 'deepseek-official/deepseek-flash')
  assert.equal(shadow.agree, true)
  assert.equal(shadow.savedRatio, 0)

  const stats = JSON.parse((await call(host.routes.get('/model-router/stats'), { url: '/model-router/stats' })).payload)
  assert.ok(stats.shadow.steps >= 1)
  assert.ok(stats.shadow.agreeSteps >= 1)
  assert.equal(stats.shadow.divergedSteps, 0)
  assert.equal(stats.shadow.agreementRate, 1)
  assert.ok(stats.shadow.pricedSteps >= 1)
})

test('turning costAware on moves the route the shadow had been predicting', async () => {
  const host = makeHost({ pool: COST_POOL, routes: ROUTES, presets: COST_PRESETS, costAware: true })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('接口文档') })
  const out = await request(host, { agent, turn: 1, step: 0 }, seed())

  // Same config, same step, one flag: the cost term breaks the preset tie.
  assert.equal(out.model, 'deepseek-flash')

  const state = await stateOf(host)
  assert.equal(state.costAware.enabled, true)
  assert.equal(state.costAware.shadow, null, 'a cost-aware router has nothing to shadow')
})

test('a pool the catalog cannot price records no shadow and no rate', async () => {
  const host = makeHost({ pool: UNPRICED_POOL, routes: ROUTES })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('refactor the parser') })
  const out = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.ok(['some-model', 'other-model'].includes(out.model), 'the pool still routes without prices')

  const state = await stateOf(host)
  assert.equal(state.costAware.floorUsdPerMTok, null)
  assert.equal(state.costAware.shadow, null)
  assert.deepEqual(state.costAware.entries.map((e) => e.priced), [false, false])
})

/** Drive a host waterfall: each listener gets a next() that runs the rest. */
function waterfall(host, name, payload, seedValue) {
  const fns = host.handlers.get(name) || []
  const inner = () => Promise.resolve(seedValue)
  const run = (index) => (index >= fns.length ? inner() : fns[index](payload, () => run(index + 1)))
  return run(0)
}

const CROSS_POOL = [
  { id: 'deepseek-official/deepseek-v4-pro', cost: 8, tier: 'strong' },
  { id: 'google-official/gemini-3.8-flash', cost: 1, tier: 'cheap' },
]
const HAIKU_POOL = [
  { id: 'deepseek-official/deepseek-v4-pro', cost: 8, tier: 'strong' },
  { id: 'anthropic-official/claude-haiku-5-5', cost: 1, tier: 'cheap' },
]
const CHANNEL_POOL = [
  { id: 'deepseek-official/deepseek-flash', cost: 1, tier: 'cheap' },
  { id: 'google-official/gemini-3.8-flash', cost: 1, tier: 'cheap' },
]
const CHANNEL_PRESETS = {
  api: { match: ['接口'], weights: { 'deepseek-official/deepseek-flash': 95, 'google-official/gemini-3.8-flash': 80 } },
}
const crossPresets = (weights) => ({ api: { match: ['接口'], weights } })

// --- v0.16.1: the spend guard -----------------------------------------------

test('the budget guard refuses a synthetic step, and one release lets it through', async () => {
  const usage = tokenUsage({ input: 0, output: 0, cacheRead: 0, reasoning: 0 })
  // A limit a single step blows past: the arithmetic is what is under test here.
  const host = makeHost({ pool: POOL, routes: ROUTES, budget: { mode: 'block', sessionUsd: 5e-7 } }, { sessionProjections: usage.service })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('refactor the parser') })
  await request(host, { agent, turn: 1, step: 0 }, seed())
  usage.add(1_000_000)
  await request(host, { agent, turn: 1, step: 1 }, seed())

  let state = await stateOf(host)
  assert.ok(state.cost.sessionUsd > 0, 'the routed step booked real money')
  assert.equal(state.budget.mode, 'block')
  assert.equal(state.budget.exceeded, true)
  assert.deepEqual(state.budget.over, ['sessionUsd'])
  const row = state.budget.rows.find((entry) => entry.id === 'sessionUsd')
  assert.equal(row.over, true)
  assert.equal(row.limit, 5e-7)
  assert.ok(row.used > row.limit)

  // A step carrying the user's own text always runs: swallowing a message is
  // worse than paying for one.
  const withUser = await waterfall(host, 'agent/pre-step', { agent, messages: [{ role: 'user', content: 'hello' }], turn: 2, step: 0, signal: {} }, { kind: 'enter' })
  assert.deepEqual(withUser, { kind: 'enter' })

  // A synthetic step is refused, and the refusal is recorded for the panel.
  const synthetic = await waterfall(host, 'agent/pre-step', { agent, messages: [{ role: 'assistant', content: 'tool result' }], turn: 2, step: 1, signal: {} }, { kind: 'enter' })
  assert.deepEqual(synthetic, { kind: 'reject' })
  state = await stateOf(host)
  assert.ok(state.budget.blocked.at > 0)
  assert.deepEqual(state.budget.blocked.over, ['sessionUsd'])
  assert.match(state.budget.blocked.line, /sessionUsd/)
  assert.equal(state.budget.once, false)

  // One release: the next step runs, then the gate arms itself again.
  const released = await call(host.routes.get('/model-router/budget'), { method: 'POST', url: '/model-router/budget', body: { sessionId: 's1', action: 'once' } })
  assert.equal(released.status, 200)
  assert.equal(JSON.parse(released.payload).ok, true)
  assert.equal((await stateOf(host)).budget.once, true)

  const allowed = await waterfall(host, 'agent/pre-step', { agent, messages: [{ role: 'assistant' }], turn: 2, step: 2, signal: {} }, { kind: 'enter' })
  assert.deepEqual(allowed, { kind: 'enter' })
  const again = await waterfall(host, 'agent/pre-step', { agent, messages: [{ role: 'assistant' }], turn: 2, step: 3, signal: {} }, { kind: 'enter' })
  assert.deepEqual(again, { kind: 'reject' })
})

test('a budget in inform mode warns without ever refusing a step', async () => {
  const usage = tokenUsage({ input: 0, output: 0, cacheRead: 0, reasoning: 0 })
  const host = makeHost({ pool: POOL, routes: ROUTES, budget: { mode: 'inform', sessionUsd: 5e-7, softRatio: 0.5 } }, { sessionProjections: usage.service })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('refactor the parser') })
  await request(host, { agent, turn: 1, step: 0 }, seed())
  usage.add(1_000_000)
  await request(host, { agent, turn: 1, step: 1 }, seed())

  const state = await stateOf(host)
  assert.equal(state.budget.mode, 'inform')
  assert.ok(state.budget.over.includes('sessionUsd'), 'the spend is still reported')

  const step = await waterfall(host, 'agent/pre-step', { agent, messages: [{ role: 'assistant' }], turn: 2, step: 0, signal: {} }, { kind: 'enter' })
  assert.deepEqual(step, { kind: 'enter' }, 'inform never blocks')
  assert.ok(host.logs.some((line) => /budget/i.test(line)), 'the overrun is logged once')
})

// --- v0.16.1: channel health and failover -----------------------------------

test('a failed channel is benched and the next attempt moves to another one', async () => {
  const host = makeHost({ pool: CHANNEL_POOL, routes: ROUTES, presets: CHANNEL_PRESETS, channels: { failover: true } })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('接口文档') })
  const first = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(first.provider, 'deepseek-official')

  let state = await stateOf(host)
  assert.equal(state.channels.enabled, true)
  assert.equal(state.channels.maxFailoversPerStep, 1)
  assert.deepEqual(state.channels.coolingDown, [])
  assert.deepEqual(state.channels.channels.map((row) => row.channel), ['deepseek-official', 'google-official'])
  assert.deepEqual(state.channels.channels[0].entries, ['deepseek-official/deepseek-flash'])

  const failure = { agent, turn: 1, step: 0, provider: 'deepseek-official', failure: { code: 'SERVER', status: 503, message: 'upstream exploded' }, signal: {} }
  const retry = await waterfall(host, 'agent/request-error', failure, undefined)
  assert.deepEqual(retry, { kind: 'retry' })

  state = await stateOf(host)
  assert.equal(state.lastError.channel, 'deepseek-official')
  assert.equal(state.lastError.code, 'SERVER')
  assert.equal(state.lastError.action, 'failover')
  assert.deepEqual(state.channels.coolingDown, ['deepseek-official'])
  const benched = state.channels.channels.find((row) => row.channel === 'deepseek-official')
  assert.equal(benched.available, false)
  assert.ok(benched.cooldownUntilInMs > 0)
  assert.match(benched.lastError, /SERVER/)

  // One failover per step: the second failure hands the turn back to the host.
  assert.equal(await waterfall(host, 'agent/request-error', failure, undefined), undefined)

  // The retry takes the same step again, and lands on the only healthy channel
  // even though it is another brand — the review is skipped because leaving the
  // brand is not a downgrade here, it is the only way the step runs.
  const second = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(second.provider, 'google-official')
  assert.equal(second.model, 'gemini-3.8-flash')

  state = await stateOf(host)
  assert.match(state.current.reason, /failing over from deepseek-official/)
  assert.equal(state.cross.proposal, null, 'a benched brand does not ask for review')

  await tick()
  const stats = JSON.parse((await call(host.routes.get('/model-router/stats'))).payload)
  assert.equal(stats.totals.failoverSteps >= 1, true)
})

test('with failover off a failure is reported and the route is left alone', async () => {
  const host = makeHost({ pool: CHANNEL_POOL, routes: ROUTES, presets: CHANNEL_PRESETS })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('接口文档') })
  await request(host, { agent, turn: 1, step: 0 }, seed())

  const failure = { agent, turn: 1, step: 0, provider: 'deepseek-official', failure: { code: 'RATE_LIMIT', status: 429, message: 'slow down' }, signal: {} }
  assert.equal(await waterfall(host, 'agent/request-error', failure, undefined), undefined)

  const state = await stateOf(host)
  assert.equal(state.channels.enabled, false)
  assert.deepEqual(state.channels.coolingDown, [], 'an observe-only router benches nothing')
  assert.equal(state.lastError.action, 'rotate')
  assert.equal(state.lastError.status, 429)

  const again = await request(host, { agent, turn: 1, step: 1 }, seed())
  assert.equal(again.provider, 'deepseek-official', 'the route is unchanged by a failure')

  await tick()
  const stats = JSON.parse((await call(host.routes.get('/model-router/stats'))).payload)
  assert.equal(stats.totals.failoverSteps, 0)
})

// --- v0.16.1: crossing a brand needs a reason -------------------------------

test('a cross-brand switch is proposed only when it is clearly better or cheaper', async () => {
  // Better fit: the candidate wins on score by more than the margin.
  const fit = makeHost({ pool: CROSS_POOL, routes: ROUTES, presets: crossPresets({ 'deepseek-official/deepseek-v4-pro': 90, 'google-official/gemini-3.8-flash': 96 }) })
  const fitAgent = agentWith()
  emit(fit, 'agent/inbox/claimed', { agent: fitAgent, ...claimed('接口文档') })
  const fitOut = await request(fit, { agent: fitAgent, turn: 1, step: 0 }, seed())
  assert.equal(fitOut.model, 'deepseek-v4-pro', 'the step stays on the brand until the review happens')
  const fitState = await stateOf(fit)
  assert.equal(fitState.cross.costMultiple, 3)
  assert.equal(fitState.cross.scoreMargin, 5)
  assert.equal(fitState.cross.proposal.why, 'fit')
  assert.equal(fitState.cross.proposal.id, 'google-official/gemini-3.8-flash')
  assert.ok(fitState.cross.proposal.scoreDelta >= 5)
  assert.equal(fitState.cross.proposal.savingMultiple, null, 'gemini is not a multiple cheaper')
  assert.match(fitState.current.reason, /awaits confirmation \(fit\)/)

  // Cheaper: the candidate saves a multiple, so the review is worth asking for
  // even though it only wins on score by a hair.
  const cheap = makeHost({ pool: HAIKU_POOL, routes: ROUTES, presets: crossPresets({ 'deepseek-official/deepseek-v4-pro': 88, 'anthropic-official/claude-haiku-5-5': 88 }) })
  const cheapAgent = agentWith()
  emit(cheap, 'agent/inbox/claimed', { agent: cheapAgent, ...claimed('接口文档') })
  await request(cheap, { agent: cheapAgent, turn: 1, step: 0 }, seed())
  const cheapState = await stateOf(cheap)
  assert.equal(cheapState.cross.proposal.why, 'cost')
  assert.equal(cheapState.cross.proposal.savingMultiple, 9.6)
  assert.ok(cheapState.cross.proposal.scoreDelta < 5)
  assert.ok(cheapState.cross.proposal.usdPerMTok < cheapState.cross.proposal.sameUsdPerMTok)
})

test('a switch that saves a few percent is not worth interrupting the user', async () => {
  const host = makeHost({ pool: CROSS_POOL, routes: ROUTES, presets: crossPresets({ 'deepseek-official/deepseek-v4-pro': 88, 'google-official/gemini-3.8-flash': 90 }) })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('接口文档') })
  const out = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(out.model, 'deepseek-v4-pro')

  const state = await stateOf(host)
  assert.equal(state.cross.proposal, null)
  assert.match(state.current.reason, /is not worth a review/)
})

test('cross-provider routing turned off keeps every step on the brand', async () => {
  const host = makeHost({ pool: CROSS_POOL, routes: ROUTES, presets: crossPresets({ 'deepseek-official/deepseek-v4-pro': 90, 'google-official/gemini-3.8-flash': 96 }), crossProvider: 'never' })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed('接口文档') })
  const out = await request(host, { agent, turn: 1, step: 0 }, seed())
  assert.equal(out.model, 'deepseek-v4-pro')

  const state = await stateOf(host)
  assert.equal(state.cross.proposal, null)
  assert.match(state.current.reason, /cross-provider routing is off/)
})
