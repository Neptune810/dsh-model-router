import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { MODE_IDS, classifyMode, describeModes, isKnownMode, normalizeModes, scoreMode } from '../lib/mode-pool.js'

// The mode pool (v1.1) picks one of the host's four agent presets from the first
// message of a session. Two things can be tested without a host: the scoring,
// and the rule that an unanswered classification never moves a session.

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-mode-pool-'))
delete process.env.DSH_PROFILE_DIR
process.env.DSH_MODEL_ROUTER_NO_TOKEN = '1'

const ROUTES = { trivial: { effort: 'low' }, standard: { effort: 'low' }, engineering: { effort: 'high' }, hard: { effort: 'high' } }
const POOL = [
  { id: 'deepseek-official/deepseek-flash', cost: 1, tier: 'cheap' },
  { id: 'deepseek-official/deepseek-v4-pro', cost: 8, tier: 'strong' },
]

test('the pool keeps the host order, drops unknown ids and de-duplicates', () => {
  assert.deepEqual([...normalizeModes(['ptc', 'standard'])], ['ptc', 'standard'])
  assert.deepEqual([...normalizeModes(['ptc', 'ptc', ' nope ', 'minimal'])], ['ptc', 'minimal'])
  assert.deepEqual([...normalizeModes(undefined)], [])
  assert.deepEqual([...normalizeModes('ptc')], [], 'a bare string is not a pool')
  assert.deepEqual([...normalizeModes([' ptc '])], ['ptc'], 'ids are trimmed')
  assert.deepEqual([...MODE_IDS], ['standard', 'ptc', 'minimal', 'cordis'])
  assert.equal(isKnownMode('cordis'), true)
  assert.equal(isKnownMode('turbo'), false)
})

test('a batch-shaped first message scores highest for ptc', () => {
  const verdict = classifyMode('把仓库里所有文件里的旧 API 批量替换掉，逐个去重汇总成一张表格', { modes: MODE_IDS })
  assert.equal(verdict.id, 'ptc')
  assert.match(verdict.why, /matched /)
  assert.ok(verdict.scores.ptc > 0)
})

test('a one-line typo fix or a translation scores minimal', () => {
  assert.equal(classifyMode('帮我把这句话翻译成英文', { modes: MODE_IDS }).id, 'minimal')
  assert.equal(classifyMode('fix this typo and rename the variable', { modes: MODE_IDS }).id, 'minimal')
})

test('plugin work scores cordis, and a plain refactor stays standard', () => {
  assert.equal(classifyMode('帮我写一个 dsh 插件，用 ctx.inject 注入服务', { modes: MODE_IDS }).id, 'cordis')
  assert.equal(classifyMode('refactor this module and add a test', { modes: MODE_IDS }).id, 'standard')
})

test('an empty pool, a single mode, and a text with no evidence', () => {
  assert.equal(classifyMode('批量处理所有文件', { modes: [] }), null, 'no pool means the feature is off')
  const single = classifyMode('随便说点什么', { modes: ['minimal'] })
  assert.equal(single.id, 'minimal')
  assert.equal(single.why, 'the only mode in the pool', 'a one-mode pool needs no evidence')
  assert.equal(classifyMode('嗯', { modes: MODE_IDS }), null, 'no evidence must not move the session')
})

test('the pool is only scored against the modes it contains', () => {
  const verdict = classifyMode('批量处理所有文件', { modes: ['standard', 'minimal'] })
  assert.equal(verdict, null, 'ptc is not in the pool, and nothing else matches')
})

test('scoreMode is exported so /router modes can explain a pick', () => {
  const scored = scoreMode('ptc', 'bulk rename across all files')
  assert.ok(scored.score > 0)
  assert.deepEqual(scored.hits.slice(0, 1), ['bulk'])
  assert.deepEqual(scoreMode('standard', ''), { score: 0, hits: [] })
})

test('describeModes pairs every pooled id with its hint', () => {
  const described = describeModes(['cordis', 'minimal'])
  assert.deepEqual(described.map((entry) => entry.id), ['cordis', 'minimal'])
  for (const entry of described) assert.ok(typeof entry.hint === 'string' && entry.hint.length > 10)
})

/** Host double: listeners, services, routes, logs. */
function makeHost(config = {}, services = {}) {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-mode-pool-'))
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
  return { handlers, routes, logs, registry, commands, ctx }
}

const agentWith = (id = 's1') => ({ session: { id, deriveMessages: () => [] } })

function emit(host, name, payload) {
  for (const fn of host.handlers.get(name) || []) fn(payload)
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

const post = (host, path, body) => call(host.routes.get(path), {
  method: 'POST', url: path, headers: { origin: 'http://localhost', host: 'localhost' }, body,
})

const state = async (host, sessionId) => JSON.parse((await call(host.routes.get('/model-router/state'), {
  method: 'GET', url: '/model-router/state' + (sessionId ? '?sessionId=' + sessionId : ''),
})).payload)

/** A host with the four services the mode pool talks to. */
function modeHost(config = {}, options = {}) {
  const selects = []
  const projectionState = { agentPreset: [], turnBoundary: { openTurnStartSeq: null, lastTurn: 0 }, ...options.projection }
  const agents = new Map()
  const updates = []
  const services = {
    agents: { get: (id) => agents.get(id) },
    agentPresets: {
      select: async (agent, id) => {
        selects.push({ session: agent.session.id, id })
        if (options.selectFails) throw Object.assign(new Error(options.selectFails), { code: 'agent-preset/locked' })
        projectionState.agentPreset = id
        return id
      },
    },
    settings: { update: async (ns, patch) => { updates.push({ ns, patch }) } },
    sessionProjections: {
      stateOf: (session, key) => (key === 'agentPreset' ? projectionState.agentPreset : key === 'turnBoundary' ? projectionState.turnBoundary : undefined),
      register: () => () => {},
    },
  }
  const host = makeHost({ pool: POOL, routes: ROUTES, modes: MODE_IDS, ...config }, services)
  return { host, selects, updates, agents, projectionState }
}

test('the first message recommends a mode and never switches on its own', async () => {
  const { host, selects, agents } = modeHost()
  const agent = agentWith()
  agents.set('s1', agent)
  emit(host, 'agent/inbox/inserted', { agent, message: { content: '把仓库里所有文件批量去重汇总' } })

  assert.deepEqual(selects, [], 'a recommendation is not a switch')
  const view = await state(host, 's1')
  assert.equal(view.modes.decision.id, 'ptc')
  assert.equal(view.modes.applied, false)
  assert.equal(view.modes.current, null)
  assert.deepEqual(view.modes.pool, ['standard', 'ptc', 'minimal', 'cordis'])
  assert.ok(host.logs.some((line) => line.includes('mode pool recommends "ptc"')))
})

test('the panel applies the recommendation before the session starts', async () => {
  const { host, selects, agents, projectionState } = modeHost()
  const agent = agentWith()
  agents.set('s1', agent)
  emit(host, 'agent/inbox/inserted', { agent, message: { content: '批量处理所有文件并去重' } })

  const applied = await post(host, '/model-router/modes', { sessionId: 's1', mode: 'ptc' })
  assert.equal(applied.status, 200)
  const payload = JSON.parse(applied.payload)
  assert.equal(payload.ok, true)
  assert.equal(payload.mode, 'ptc')
  assert.deepEqual(selects, [{ session: 's1', id: 'ptc' }])
  assert.equal(projectionState.agentPreset, 'ptc')
  const view = await state(host, 's1')
  assert.equal(view.modes.applied, true)
  assert.equal(view.modes.current, 'ptc')
})

test('a started session refuses the switch and says why', async () => {
  const { host, selects, agents } = modeHost({}, { projection: { turnBoundary: { openTurnStartSeq: 12, lastTurn: 1 } } })
  const agent = agentWith()
  agents.set('s1', agent)
  const refused = await post(host, '/model-router/modes', { sessionId: 's1', mode: 'minimal' })
  assert.equal(refused.status, 400)
  const payload = JSON.parse(refused.payload)
  assert.equal(payload.ok, false)
  assert.match(payload.error, /agent-preset\/locked/)
  assert.deepEqual(selects, [], 'the host is never asked after the lock')
  const view = await state(host, 's1')
  assert.match(view.modes.error, /agent-preset\/locked/)
})

test('a host refusal is reported, not swallowed', async () => {
  const { host, agents } = modeHost({}, { selectFails: 'This session has already started' })
  const agent = agentWith()
  agents.set('s1', agent)
  const refused = await post(host, '/model-router/modes', { sessionId: 's1', mode: 'cordis' })
  assert.equal(refused.status, 400)
  assert.match(JSON.parse(refused.payload).error, /agent-preset\/locked: This session has already started/)
})

test('a host without agentPresets says so instead of pretending', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES, modes: MODE_IDS })
  const unavailable = await post(host, '/model-router/modes', { sessionId: 's1', mode: 'ptc' })
  assert.equal(unavailable.status, 400)
  assert.match(JSON.parse(unavailable.payload).error, /no live agent|no agentPresets/)
})

test('the pool, the auto flag and the default are edited through the same route', async () => {
  const { host, updates, agents } = modeHost()
  const narrowed = await post(host, '/model-router/modes', { pool: ['ptc', 'minimal'] })
  assert.equal(narrowed.status, 200)
  assert.deepEqual(JSON.parse(narrowed.payload).modes, ['ptc', 'minimal'])
  assert.deepEqual((await state(host)).modes.pool, ['ptc', 'minimal'])

  const off = await post(host, '/model-router/modes', { auto: false })
  assert.equal(JSON.parse(off.payload).auto, false)
  const agent = agentWith('s2')
  agents.set('s2', agent)
  emit(host, 'agent/inbox/inserted', { agent, message: { content: '批量处理所有文件' } })
  assert.equal((await state(host, 's2')).modes.decision, null, 'auto off means no recommendation')

  const setDefault = await post(host, '/model-router/modes', { setDefault: 'minimal' })
  assert.equal(setDefault.status, 200)
  assert.deepEqual(updates, [{ ns: 'agent-preset-registry', patch: { selectedDefault: 'minimal' } }])
})

test('recommendations persist as the next session default only when asked to', async () => {
  const quiet = modeHost()
  const quietAgent = agentWith('q1')
  quiet.agents.set('q1', quietAgent)
  emit(quiet.host, 'agent/inbox/inserted', { agent: quietAgent, message: { content: '批量处理所有文件' } })
  assert.deepEqual(quiet.updates, [], 'the default is not touched by default')

  const loud = modeHost({ modeSetDefault: true })
  const loudAgent = agentWith('l1')
  loud.agents.set('l1', loudAgent)
  emit(loud.host, 'agent/inbox/inserted', { agent: loudAgent, message: { content: '批量处理所有文件' } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(loud.updates, [{ ns: 'agent-preset-registry', patch: { selectedDefault: 'ptc' } }])
})

test('the recommendation is scored once per session', async () => {
  const { host, agents } = modeHost()
  const agent = agentWith()
  agents.set('s1', agent)
  emit(host, 'agent/inbox/inserted', { agent, message: { content: '批量处理所有文件' } })
  const first = (await state(host, 's1')).modes.decision
  emit(host, 'agent/inbox/inserted', { agent, message: { content: '帮我翻译这句话' } })
  const second = (await state(host, 's1')).modes.decision
  assert.deepEqual(second, first, 'later messages do not rewrite a seen recommendation')
})

test('an empty mode pool keeps the panel and the recommendation silent', async () => {
  const host = makeHost({ pool: POOL, routes: ROUTES }, {})
  const agent = agentWith()
  emit(host, 'agent/inbox/inserted', { agent, message: { content: '批量处理所有文件' } })
  const view = await state(host, 's1')
  assert.deepEqual(view.modes.pool, [])
  assert.equal(view.modes.decision, null)
  assert.deepEqual(view.modes.available, [])
})

test('/router modes prints the pool, the current mode and the hints', async () => {
  const { host, agents } = modeHost()
  const agent = agentWith()
  agents.set('s1', agent)
  emit(host, 'agent/inbox/inserted', { agent, message: { content: '批量处理所有文件' } })
  const command = host.commands[0]
  // handler(commandContext, invocation): args live on the invocation.
  const result = await command.handler({}, { agent, args: ['modes'] })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /modes: standard, ptc, minimal, cordis/)
  assert.match(result.text, /recommended ptc/)
  assert.match(result.text, /ptc — standard plus programmatic tool calling/)
})
