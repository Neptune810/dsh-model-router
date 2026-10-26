/**
 * Golden routing decisions (spec 150-9, v0.15.0).
 *
 * Ten conversations freeze the exact { provider, model, effort, stepClass, score }
 * the router applies at each step. The fixture is committed; a change in routing
 * behaviour must show up as a reviewable diff here instead of a silent drift.
 *
 * Regenerate deliberately (and review the diff, do not bless a bug):
 *   GOLDEN_UPDATE=1 node --test test/golden.test.js
 *
 * Hermetic: every test builds a fresh host double with a throwaway DSH_HOME, no
 * network, no timers and no absolute paths in the fixture.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../lib/index.js'

// Keep profile state out of the developer's home directory, and the fake panel
// token out of the snapshots (the capture only reads, it never mutates).
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-golden-'))
delete process.env.DSH_PROFILE_DIR
delete process.env.DSH_MODEL_ROUTER
process.env.DSH_MODEL_ROUTER_NO_TOKEN = '1'

const UPDATE = process.env.GOLDEN_UPDATE === '1'
const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/golden-decisions.json', import.meta.url))

/** A pool with one cheap and one strong entry, for the scoring scenarios. */
const POOL = [
  { id: 'deepseek-official/deepseek-flash', cost: 1, tier: 'cheap' },
  { id: 'deepseek-official/deepseek-v4-pro', cost: 8, tier: 'strong' },
]

// Step texts are fixed here so the golden values are stable and easy to review.
const STANDARD_TEXT = 'hello, can you help me with this?'
const CHEAP_TEXT = 'translate this: good morning'
const ENGINEERING_BRIEF = 'implement the deploy pipeline and debug the cache lookup'
const HARD_SPEC = 'Refactor the architecture, migrate the cache layer, and optimize concurrency. '
  + 'Then debug the pipeline, benchmark the algorithm, and secure the protocol. '
  + 'Finally implement distributed transactions and harden the auth API.'
const POISONED_TEXT = 'fix the failing test'

const SEED = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }
const seed = (over = {}) => ({ ...SEED, ...over })

const userText = (text) => ({ role: 'user', content: [{ type: 'text', text }] })
const toolCall = (id, name, args, opts = {}) => ({
  role: 'assistant',
  content: [
    ...(opts.thinkingOff ? [] : [{ type: 'reasoning', text: 'planning' }]),
    { type: 'tool-call', id, name, arguments: args },
  ],
})
const toolResult = (id, text) => ({
  role: 'user',
  content: [{ type: 'tool-result', toolCallId: id, content: [{ type: 'text', text }] }],
})

/** Host double: listeners, panel routes, logs and a throwaway profile store. */
function makeHost(config = {}, sessionId = 'golden-session') {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-golden-'))
  const handlers = new Map()
  const routes = new Map()
  const logs = []
  const registry = new Map()
  const logger = {
    info: (...a) => logs.push('INFO ' + a.join(' ')),
    warn: (...a) => logs.push('WARN ' + a.join(' ')),
  }
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
  registry.set('commands', {
    register: () => () => {},
  })
  apply(ctx, config)
  return { handlers, routes, logs, sessionId }
}

const agentWith = (messages = [], sessionId = 'golden-session', header = undefined) => {
  const session = { id: sessionId, deriveMessages: () => messages }
  if (header !== undefined) session.header = header
  return { session }
}

function emit(host, name, payload) {
  for (const fn of host.handlers.get(name) || []) fn(payload)
}

function request(host, payload, seedValue) {
  const fns = host.handlers.get('agent/request') || []
  const inner = () => Promise.resolve(typeof seedValue === 'function' ? seedValue() : seedValue)
  const run = (index) => index >= fns.length ? inner() : fns[index](payload, () => run(index + 1))
  return run(0)
}

/** Drive the registered GET /model-router/state route (no token: GET only). */
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

/** The session's own decisions as the panel sees them. */
async function panelState(host, agent) {
  const handler = host.routes.get('/model-router/state')
  assert.ok(handler, 'GET /model-router/state route is registered')
  const res = await call(handler, { url: '/model-router/state?sessionId=' + encodeURIComponent(agent.session.id) })
  assert.equal(res.status, 200, 'panel state returned ' + res.status + ': ' + res.payload)
  return JSON.parse(res.payload)
}

/**
 * One routed step: what the waterfall returned, plus the decision row it logged.
 * The snapshot couples the applied request (provider/model/effort) with the
 * classifier's verdict (stepClass/score); an untouched step logs neither.
 */
async function step(host, agent, { turn = 1, step: stepNo = 0, over } = {}) {
  const before = await panelState(host, agent)
  const applied = await request(host, { agent, turn, step: stepNo }, seed(over))
  const after = await panelState(host, agent)
  const decision = after.decisions.length > before.decisions.length
    ? after.decisions[after.decisions.length - 1]
    : null
  const snapshot = {
    provider: applied.provider ?? null,
    model: applied.model ?? null,
    effort: applied.reasoningEffort ?? null,
    stepClass: decision ? decision.stepClass : null,
    score: decision ? decision.score : null,
  }
  return { applied, state: after, decision, snapshot }
}

const claimed = (text, turn = 1) => ({ turn, message: { content: text } })

// --- golden bookkeeping -----------------------------------------------------

/** Loaded once; in update mode it only supplies the version field. */
const fixture = UPDATE || !existsSync(FIXTURE_PATH)
  ? { version: 1, scenarios: {} }
  : JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
const recorded = {}

/** Record one scenario and, outside update mode, compare it to the fixture. */
function freeze(id, scenario) {
  recorded[id] = scenario
  if (UPDATE) return
  assert.ok(fixture.scenarios[id], 'fixture is missing scenario "' + id + '"; run GOLDEN_UPDATE=1 node --test test/golden.test.js')
  assert.deepEqual(scenario, fixture.scenarios[id], 'routing drift in scenario "' + id + '" (review the diff before running GOLDEN_UPDATE=1)')
}

after(() => {
  if (!UPDATE) return
  const ids = Object.keys(recorded).sort()
  if (ids.length !== 10) {
    console.error('golden: not rewriting the fixture — expected 10 scenarios, recorded ' + ids.length)
    return
  }
  const scenarios = {}
  for (const id of ids) scenarios[id] = recorded[id]
  writeFileSync(FIXTURE_PATH, JSON.stringify({ version: 1, scenarios }, null, 2) + '\n')
  console.log('updated ' + ids.length + ' snapshots')
})

// --- the ten frozen conversations ------------------------------------------

test('01 short English request: standard class, low effort', async () => {
  const host = makeHost()
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(STANDARD_TEXT) })
  agent.session.deriveMessages = () => [userText(STANDARD_TEXT)]
  const run = await step(host, agent)
  assert.equal(run.decision.stepClass, 'standard')
  assert.equal(run.applied.reasoningEffort, 'low')
  assert.equal(run.applied.model, 'deepseek-flash')
  freeze('01-short-english-standard', { t1s0: run.snapshot })
})

test('02 explicit cheap intent: trivial class, low effort', async () => {
  const host = makeHost()
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(CHEAP_TEXT) })
  agent.session.deriveMessages = () => [userText(CHEAP_TEXT)]
  const run = await step(host, agent)
  assert.equal(run.decision.stepClass, 'trivial')
  assert.equal(run.applied.reasoningEffort, 'low')
  assert.ok(run.decision.reason.includes('cheap intent'))
  freeze('02-cheap-intent-trivial', { t1s0: run.snapshot })
})

test('03 engineering brief: engineering class, high effort', async () => {
  const host = makeHost()
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(ENGINEERING_BRIEF) })
  agent.session.deriveMessages = () => [userText(ENGINEERING_BRIEF)]
  const run = await step(host, agent)
  assert.equal(run.decision.stepClass, 'engineering')
  assert.equal(run.applied.reasoningEffort, 'high')
  assert.equal(run.applied.model, 'deepseek-flash')
  freeze('03-engineering-brief', { t1s0: run.snapshot })
})

test('04 dense hard spec: hard class and the max effort clamps to the fallback', async () => {
  const host = makeHost()
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_SPEC) })
  agent.session.deriveMessages = () => [userText(HARD_SPEC)]
  const run = await step(host, agent)
  assert.equal(run.decision.stepClass, 'hard')
  // The hard route asks for max; allowMax is off, so the clamp applies the fallback.
  assert.equal(run.applied.reasoningEffort, 'high')
  assert.notEqual(run.applied.reasoningEffort, 'max')
  freeze('04-hard-spec-clamped', { t1s0: run.snapshot })
})

test('05 image step with imagePolicy keep: the request is left alone', async () => {
  const host = makeHost()
  const agent = agentWith()
  const message = {
    content: [
      { type: 'text', text: 'what is in this picture' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
    ],
  }
  emit(host, 'agent/inbox/claimed', { agent, turn: 1, message })
  agent.session.deriveMessages = () => [{ role: 'user', content: message.content }]
  const run = await step(host, agent)
  assert.deepEqual(run.applied, seed(), 'an image step keeps the host-resolved route untouched')
  assert.equal(run.decision, null, 'an untouched step logs no decision')
  assert.equal(run.state.current, null)
  assert.equal(run.state.decisions.length, 0)
  freeze('05-image-step-untouched', { t1s0: run.snapshot })
})

test('06 poisoned history: effort is pinned to off', async () => {
  const host = makeHost()
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(POISONED_TEXT, 2) })
  agent.session.deriveMessages = () => [
    userText('summarize this'),
    toolCall('c1', 'read', '{"file_path":"a"}', { thinkingOff: true }),
    toolResult('c1', 'ok'),
  ]
  const run = await step(host, agent, { turn: 2 })
  assert.equal(run.applied.reasoningEffort, 'off')
  assert.equal(run.decision.effort, 'off')
  assert.equal(run.decision.stepClass, 'standard')
  freeze('06-poisoned-history-off', { t2s0: run.snapshot })
})

test('07 subagent delegation: frugal pool model on engineering work', async () => {
  const host = makeHost({ pool: POOL })
  const agent = agentWith([], 'golden-session', { delegationDepth: 1 })
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(ENGINEERING_BRIEF) })
  agent.session.deriveMessages = () => [userText(ENGINEERING_BRIEF)]
  const run = await step(host, agent)
  assert.equal(run.decision.signals.frugal, true)
  assert.equal(run.decision.signals.depth, 1)
  assert.equal(run.applied.model, 'deepseek-flash', 'frugal prefers the cheap tier')
  assert.equal(run.decision.stepClass, 'engineering')
  freeze('07-subagent-frugal', { t1s0: run.snapshot })
})

test('08 pool with strong entry: engineering step picks the strong model', async () => {
  const host = makeHost({
    pool: POOL,
    presets: { build: { match: ['implement'], weights: { 'deepseek-official/deepseek-v4-pro': 90 } } },
  })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(ENGINEERING_BRIEF) })
  agent.session.deriveMessages = () => [userText(ENGINEERING_BRIEF)]
  const run = await step(host, agent)
  assert.equal(run.decision.stepClass, 'engineering')
  assert.equal(run.applied.model, 'deepseek-v4-pro')
  assert.equal(run.applied.reasoningEffort, 'high')
  freeze('08-pool-strong-engineering', { t1s0: run.snapshot })
})

test('09 hysteresis: a standard step keeps high effort once, then lowers', async () => {
  const host = makeHost()
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(ENGINEERING_BRIEF, 1) })
  agent.session.deriveMessages = () => [userText(ENGINEERING_BRIEF)]
  const first = await step(host, agent, { turn: 1 })

  // Turns 2 and 3 arrive without a new claim, so the task hysteresis survives.
  agent.session.deriveMessages = () => [userText(STANDARD_TEXT)]
  const second = await step(host, agent, { turn: 2 })
  const third = await step(host, agent, { turn: 3 })

  assert.deepEqual(
    [first.decision.stepClass, second.decision.stepClass, third.decision.stepClass],
    ['engineering', 'standard', 'standard'],
  )
  assert.deepEqual(
    [first.applied.reasoningEffort, second.applied.reasoningEffort, third.applied.reasoningEffort],
    ['high', 'high', 'low'],
    'high is downgraded only after downAfter consecutive quiet steps',
  )
  freeze('09-hysteresis-downgrade', {
    t1s0: first.snapshot,
    t2s0: second.snapshot,
    t3s0: third.snapshot,
  })
})

test('10 cross-provider confirm: stays on the current provider and proposes the switch', async () => {
  const host = makeHost({
    pool: [
      { id: 'deepseek-official/deepseek-flash', cost: 1, tier: 'cheap' },
      { id: 'vendor-x/heavy', cost: 1, tier: 'strong' },
    ],
  })
  const agent = agentWith()
  emit(host, 'agent/inbox/claimed', { agent, ...claimed(HARD_SPEC) })
  agent.session.deriveMessages = () => [userText(HARD_SPEC)]
  const run = await step(host, agent)
  assert.equal(run.applied.provider, 'deepseek-official', 'confirm mode never switches provider by itself')
  assert.equal(run.applied.model, 'deepseek-flash')
  assert.ok(run.state.cross.proposal, 'the panel gets a proposal to confirm')
  assert.equal(run.state.cross.proposal.id, 'vendor-x/heavy')
  assert.equal(run.state.cross.proposal.provider, 'vendor-x')
  assert.equal(run.decision.stepClass, 'hard')
  freeze('10-cross-provider-confirm', { t1s0: run.snapshot })
})

test('the fixture lists exactly the ten scenarios, alphabetically', () => {
  const ids = Object.keys(recorded).sort()
  assert.equal(ids.length, 10)
  if (UPDATE) return
  assert.equal(fixture.version, 1)
  assert.deepEqual(Object.keys(fixture.scenarios), ids, 'fixture scenarios must be stable and alphabetical')
  for (const id of ids) {
    assert.ok(fixture.scenarios[id] && Object.keys(fixture.scenarios[id]).length > 0, 'scenario ' + id + ' has steps')
  }
})
