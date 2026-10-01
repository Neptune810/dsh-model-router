/**
 * dsh-model-router — per-tool-call route projection (v0.8.0).
 *
 * Unit tests for lib/route-projection.js apply(), the host half of "show the
 * model + thinking level used by every tool-call segment":
 *
 *   'request/header' -> header {provider, model, effort}
 *   'step/start'     -> at {turn, step}
 *   'tool/call'      -> calls[String(callId)] {turn, step, provider, model, effort}
 *
 * The projection registry structuredClones the state for checkpointing, so the
 * state must stay plain JSON, and apply() runs against the live state object, so
 * it must never mutate its input. The 200-entry cap follows an explicit
 * oldest-first state.order list: call ids may be integer-like strings, which the
 * JS engine re-orders numerically in an object, so Object.keys is NOT the order.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { routeProjection } from '../lib/route-projection.js'
import { apply } from '../lib/index.js'

// Keep the plugin's UI state file out of the developer's real profile.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-projection-'))
delete process.env.DSH_PROFILE_DIR

const header = (config) => ({ type: 'request/header', data: { header: { config } } })
const step = (turn, at) => ({ type: 'step/start', data: { turn, step: at } })
const tool = (callId, turn, at, name = 'read_file') => ({ type: 'tool/call', data: { callId, turn, step: at, name } })
const run = (events, state = routeProjection.init()) => events.reduce((acc, event) => routeProjection.apply(acc, event), state)

test('the projection declares key/stateVersion and a plain-JSON initial state', () => {
  assert.equal(routeProjection.key, 'modelRouterRoute')
  assert.equal(routeProjection.stateVersion, 1)
  assert.deepEqual(routeProjection.init(), { header: null, at: null, calls: {}, order: [] })
  assert.equal(routeProjection.stateSchema.parse('anything'), 'anything')
  assert.equal(routeProjection.wire.viewSchema.parse('anything'), 'anything')
  // The registry clones the state for checkpointing: it must survive both.
  assert.deepEqual(JSON.parse(JSON.stringify(routeProjection.init())), routeProjection.init())
  assert.deepEqual(structuredClone(routeProjection.init()), routeProjection.init())
})

test('request/header folds provider/model/effort, treating absent and explicit null alike', () => {
  let state = routeProjection.init()
  state = routeProjection.apply(state, header({ provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' }))
  assert.deepEqual(state.header, { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'low' })

  // The adapter may own the default (it deletes reasoningEffort), so absence is
  // meaningful and must NOT become the string "undefined".
  state = routeProjection.apply(state, header({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }))
  assert.deepEqual(state.header, { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: null })

  // An explicit null means the same as absence ("the adapter owns it") and must
  // not become the string "null"; real values are still stringified.
  state = routeProjection.apply(state, header({ provider: 'p', model: 'm', reasoningEffort: null }))
  assert.equal(state.header.effort, null)
  state = routeProjection.apply(state, header({ provider: 'p', model: 'm', reasoningEffort: 'high' }))
  assert.equal(state.header.effort, 'high')
  state = routeProjection.apply(state, header({ provider: 'p', model: 'm', reasoningEffort: 1024 }))
  assert.equal(state.header.effort, '1024')

  // An identical envelope is a no-op that returns the very same state object.
  assert.equal(routeProjection.apply(state, header({ provider: 'p', model: 'm', reasoningEffort: 1024 })), state)
  // A header event without a config is ignored, not recorded as nulls.
  assert.equal(routeProjection.apply(state, { type: 'request/header', data: {} }), state)
  assert.equal(routeProjection.apply(state, { type: 'request/header' }), state)
})

test('step/start tracks turn and step, repeats are a no-op, junk becomes null', () => {
  let state = routeProjection.init()
  state = routeProjection.apply(state, step(3, 2))
  assert.deepEqual(state.at, { turn: 3, step: 2 })
  assert.equal(routeProjection.apply(state, step(3, 2)), state)
  state = routeProjection.apply(state, step(3, 4))
  assert.deepEqual(state.at, { turn: 3, step: 4 })
  // Non-finite / non-numeric values are recorded as null rather than leaked raw.
  state = routeProjection.apply(state, { type: 'step/start', data: { turn: '3', step: Number.NaN } })
  assert.deepEqual(state.at, { turn: null, step: null })
})

test('tool/call captures the header and step in force at that call', () => {
  const state = run([
    header({ provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' }),
    step(2, 1),
    tool('call-a', 2, 1, 'read_file'),
    tool('call-b', 2, 2, 'write_file'),
  ])
  assert.deepEqual(state.calls['call-a'], { turn: 2, step: 1, provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high' })
  assert.deepEqual(state.calls['call-b'], { turn: 2, step: 1, provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high' })
  assert.deepEqual(state.order, ['call-a', 'call-b'])
})

test('the in-force header/step win over the tool/call event own turn and step', () => {
  const state = run([step(2, 1), tool('c1', 9, 9)])
  assert.deepEqual(state.calls['c1'], { turn: 2, step: 1, provider: null, model: null, effort: null })
})

test('with no step/start or header the tool/call falls back to its own values', () => {
  const bare = run([tool('c1', 4, 7, 'grep')])
  assert.deepEqual(bare.calls['c1'], { turn: 4, step: 7, provider: null, model: null, effort: null })

  // Header but no step: the numbers come from the call itself.
  const headerOnly = run([header({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off' }), tool('c2', 5, 3)])
  assert.deepEqual(headerOnly.calls['c2'], { turn: 5, step: 3, provider: 'deepseek-official', model: 'deepseek-flash', effort: 'off' })

  // Step but no header: the route fields stay null instead of inheriting junk.
  const stepOnly = run([step(1, 2), tool('c3', 1, 2)])
  assert.deepEqual(stepOnly.calls['c3'], { turn: 1, step: 2, provider: null, model: null, effort: null })

  // A tool/call without an id is ignored (identity, nothing recorded).
  const base = routeProjection.init()
  const state = routeProjection.apply(base, { type: 'tool/call', data: { name: 'x', turn: 1, step: 0 } })
  assert.equal(state, base)
  assert.deepEqual(state.calls, {})
  assert.deepEqual(state.order, [])
})

test('a repeated callId overwrites its entry without duplicating the order list', () => {
  const state = run([
    step(1, 0),
    tool('c1', 1, 0),
    step(2, 1),
    tool('c1', 2, 1),
  ])
  assert.deepEqual(Object.keys(state.calls), ['c1'])
  assert.deepEqual(state.order, ['c1'])
  assert.deepEqual(state.calls['c1'], { turn: 2, step: 1, provider: null, model: null, effort: null })
})

test('the 200-entry cap drops the oldest calls in insertion order', () => {
  const events = [tool('c1', 1, 0, 'first')]
  for (let i = 0; i <= 204; i += 1) events.push(tool('k' + i, 1, 0, 'many'))
  const state = run(events)
  assert.equal(Object.keys(state.calls).length, 200)
  assert.equal(state.order.length, 200)
  assert.equal(state.calls['c1'], undefined, 'the oldest call is dropped')
  assert.equal(state.calls['k4'], undefined)
  assert.equal(state.calls['k204'] !== undefined, true, 'the newest call is kept')
  assert.equal(state.order[0], 'k5', 'the explicit list drops oldest-first')
  assert.equal(state.order[199], 'k204')
})

test('integer-like call ids keep their insertion order, not the engine key order', () => {
  // '7', '2', '10' are integer-like: Object.keys would return 2, 7, 10.
  const small = run([tool('7', 1, 0), tool('2', 1, 0), tool('10', 1, 0)])
  assert.deepEqual(small.order, ['7', '2', '10'])
  assert.deepEqual(Object.keys(small.calls), ['2', '7', '10'])

  // The cap must drop by insertion order, not by numeric id order: insert 204..0
  // so a key-order drop would remove the wrong entries.
  const ids = Array.from({ length: 205 }, (_, i) => String(204 - i))
  const capped = run(ids.map((id) => tool(id, 1, 0)))
  assert.equal(capped.order.length, 200)
  assert.equal(capped.calls['204'], undefined)
  assert.equal(capped.calls['200'], undefined)
  assert.equal(capped.calls['199'] !== undefined, true)
  assert.equal(capped.order[0], '199')
  assert.equal(capped.order[199], '0')
  assert.notDeepEqual(capped.order, Object.keys(capped.calls))
})

test('apply is pure, ignores unknown events, and the state survives a JSON round-trip', () => {
  const state = run([header({ provider: 'p', model: 'm', reasoningEffort: 'low' }), step(1, 0)])
  const before = structuredClone(state)

  assert.equal(routeProjection.apply(state, { type: 'assistant/text', data: { text: 'hi' } }), state)
  assert.equal(routeProjection.apply(state, { type: 'tool/result', data: { callId: 'c1' } }), state)

  const next = routeProjection.apply(state, tool('c1', 1, 0))
  assert.notEqual(next, state)
  assert.deepEqual(state, before, 'recording a call never mutates the previous state')
  assert.notEqual(next.calls, state.calls)

  const round = JSON.parse(JSON.stringify(next))
  assert.deepEqual(round, next)
  const after = routeProjection.apply(round, tool('c2', 1, 1))
  assert.deepEqual(after.order, ['c1', 'c2'])
  assert.equal(after.calls['c1'].provider, 'p')

  assert.deepEqual(routeProjection.wire.view(next), { calls: next.calls, latest: next.header })
  assert.deepEqual(Object.keys(routeProjection.wire.view(next)).sort(), ['calls', 'latest'])
})

test('lib/index.js registers the projection once through the sessionProjections service', () => {
  const registered = []
  const projections = {
    stateOf: () => undefined,
    register: (definition) => { registered.push(definition); return () => {} },
  }
  const registry = new Map([['sessionProjections', projections]])
  const handlers = new Map()
  const ctx = {
    logger: () => ({ info: () => {}, warn: () => {} }),
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
  apply(ctx, {})

  assert.equal(registered.length, 1, 'exactly one projection registration')
  const definition = registered[0]
  assert.equal(definition.key, 'modelRouterRoute')
  assert.equal(definition.stateVersion, 1)
  assert.equal(typeof definition.init, 'function')
  assert.equal(typeof definition.apply, 'function')
  assert.equal(definition.init().calls !== undefined, true)
  // The registered definition is the one the client reads: view = {calls, latest}.
  const state = run([header({ provider: 'p', model: 'm' }), tool('c1', 1, 0)])
  assert.deepEqual(definition.wire.view(state), { calls: state.calls, latest: state.header })
})

test('a host with no sessionProjections service still loads the plugin', () => {
  const handlers = new Map()
  const ctx = {
    logger: () => ({ info: () => {}, warn: () => {} }),
    on: (name, fn) => handlers.set(name, [...(handlers.get(name) || []), fn]),
    get: () => undefined,
    inject: (deps, callback) => {
      const scope = { effect: (fn) => { fn(); return () => {} } }
      let ready = true
      for (const dep of deps) {
        scope[dep] = undefined
        ready = false
      }
      if (ready) callback(scope)
    },
  }
  assert.doesNotThrow(() => apply(ctx, {}))
  assert.ok(handlers.has('agent/request'))
})
