import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const SOURCE = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

/** Minimal React stand-in: enough for a render pass with no effects. */
function reactStub() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: (subscribe, snapshot) => snapshot(),
  }
}

function loadBundle(options = {}) {
  let registered
  const loaderWindow = { __ModuleLoader__: { load: (row) => { registered = row } } }
  const sandbox = Object.assign({ window: loaderWindow, console, Symbol }, options.globals || {})
  if (options.fetch) sandbox.fetch = options.fetch
  runInNewContext(SOURCE, sandbox)
  assert.ok(registered, 'the bundle must register through window.__ModuleLoader__.load')
  const react = options.react || reactStub()
  const reactDom = { createPortal: (children) => children }
  const exports = registered.factory((spec) => {
    if (spec === 'react') return react
    if (spec === 'react-dom') return reactDom
    throw new Error('unexpected require: ' + spec)
  })
  return { id: registered.id, exports, react }
}

/**
 * Load the bundle and run apply() with recording slot + conversation doubles.
 * options.registerThrows / options.injectThrows make one slot name blow up, so a
 * host that never declared it can be simulated.
 */
function mountBundle(options = {}) {
  const { exports, react } = loadBundle(options)
  const injections = []
  const registrations = []
  const definitions = []
  const slots = {
    inject: (name, callback) => {
      injections.push(name)
      if (options.injectThrows === name) throw new Error('slot ' + name + ' is not declared')
      return callback()
    },
    register: (descriptor, component) => {
      if (options.registerThrows === descriptor.name) throw new Error('slot ' + descriptor.name + ' is not declared')
      registrations.push({ descriptor, component })
      return () => {}
    },
  }
  const modelDirectories = options.modelDirectories || {
    directoryFor: () => ({
      store: { subscribe: () => () => {}, getSnapshot: () => ({ groups: [], status: 'idle' }) },
      load: async () => ({ groups: [] }),
      select: async () => ({ ok: true }),
    }),
  }
  const conversation = { events: { register: (definition) => { definitions.push(definition); return () => {} } } }
  const ctx = {
    slots,
    uiConversation: conversation,
    inject: (deps, callback) => callback({ slots, modelDirectories, sessions: options.sessions }),
  }
  exports.apply(ctx)
  return { exports, react, injections, registrations, definitions, slots, modelDirectories }
}

const registrationNamed = (registrations, name) => registrations.find((entry) => entry.descriptor.name === name)

/** The composer chip face apply() hands the host (the merged seat is the live one). */
function chipFace(registrations, sessionId = 'session-1') {
  const chip = registrationNamed(registrations, 'conversation.input.right')
  assert.ok(chip, 'the composer chip must have registered')
  return chip.descriptor.inject(sessionId)
}

/**
 * Interactive React stand-in: state and refs survive re-renders (a click handler
 * from an older tree still updates the tree we assert on), effects run once after
 * mount, and the host can push new props in (holder.update) the way it re-injects
 * the seat when the conversation changes. Every draw is synchronous, so a click
 * can be inspected immediately.
 */
function createRuntime() {
  const states = []
  const callbacks = []
  const refs = []
  const effects = []
  let cursor = 0
  let callbackCursor = 0
  let refCursor = 0
  let effectCursor = 0
  let rendering = false
  let draw = null
  let phase = 'mount'
  let pendingEffects = []

  const sameDeps = (a, b) => {
    if (a === undefined || b === undefined) return a === b
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false
    return true
  }

  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState: (initial) => {
      const index = cursor++
      if (states.length <= index) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
        if (draw && !rendering) draw()
      }]
    },
    useEffect: (fn, deps) => {
      const index = effectCursor++
      if (phase === 'mount') {
        effects[index] = { deps: deps, cleanup: null }
        pendingEffects.push({ index, fn })
        return
      }
      // Plain state-driven draws do not re-run effects; only the props-driven
      // update below models React's dependency check (a session change).
      if (phase !== 'update') return
      const slot = effects[index]
      if (slot && sameDeps(slot.deps, deps)) return
      pendingEffects.push({ index, fn })
    },
    useCallback: (fn, deps) => {
      const index = callbackCursor++
      const slot = callbacks[index]
      if (slot && sameDeps(slot.deps, deps)) return slot.fn
      callbacks[index] = { fn: fn, deps: deps }
      return fn
    },
    useRef: (value) => {
      const index = refCursor++
      if (!refs[index]) refs[index] = { current: value }
      return refs[index]
    },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  }
  const flush = async (ticks = 40) => { for (let i = 0; i < ticks; i += 1) await Promise.resolve() }
  const runPendingEffects = () => {
    for (const effect of pendingEffects.splice(0)) {
      const slot = effects[effect.index]
      if (slot && typeof slot.cleanup === 'function') slot.cleanup()
      const cleanup = effect.fn()
      if (effects[effect.index]) effects[effect.index].cleanup = typeof cleanup === 'function' ? cleanup : null
    }
  }
  const mount = async (component, props) => {
    const holder = { tree: null, renders: 0, props: props }
    const render = (nextProps) => {
      if (nextProps) holder.props = nextProps
      if (rendering) return
      rendering = true
      cursor = 0
      callbackCursor = 0
      refCursor = 0
      effectCursor = 0
      holder.tree = component(holder.props)
      holder.renders += 1
      rendering = false
    }
    draw = render
    render(props)
    phase = 'steady'
    runPendingEffects()
    await flush()
    // The host re-injects the seat for the next conversation: re-render with the
    // new props and run only the effects whose dependencies changed.
    holder.update = async (nextProps) => {
      phase = 'update'
      render(nextProps)
      phase = 'steady'
      runPendingEffects()
      await flush()
    }
    return holder
  }
  return { react, mount, flush }
}

/** The DOM surface the opened panel touches: a portal host, a probe element, computed style. */
function browserGlobals() {
  return {
    document: {
      body: { appendChild: () => {}, removeChild: () => {} },
      createElement: () => ({ style: {} }),
    },
    getComputedStyle: () => ({ backgroundColor: 'rgb(35, 35, 38)' }),
  }
}

/** ModelDirectory double: a snapshot store plus a recording load/select. */
function directoryStub(snapshot, options = {}) {
  const calls = { load: 0, select: [] }
  const store = { subscribe: () => () => {}, getSnapshot: () => snapshot }
  const directory = {
    store,
    load: () => {
      calls.load += 1
      if (options.loadReject) return Promise.reject(new Error('catalog down'))
      return Promise.resolve({ groups: [] })
    },
    select: (selection) => {
      calls.select.push(selection)
      if (options.selectReject) return Promise.reject(new Error('network down'))
      if (options.selectResult !== undefined) return Promise.resolve(options.selectResult)
      return Promise.resolve({ ok: true })
    },
  }
  return { store, directory, calls }
}

/** ctx.modelDirectories double; an unmapped session id throws like the host does. */
function directoriesStub(map) {
  const calls = { directoryFor: [] }
  return {
    calls,
    modelDirectories: {
      directoryFor: (sessionId) => {
        calls.directoryFor.push(sessionId)
        const hit = map[sessionId]
        if (!hit) throw new Error('unknown session ' + sessionId)
        return hit.directory
      },
    },
  }
}

/** Headers stand-in: the one method the client reads, case-insensitive like Fetch. */
function headerStub(map) {
  const entries = Object.entries(map || {}).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  return { get: (name) => { const hit = entries.find(([key]) => key === String(name).toLowerCase()); return hit ? hit[1] : null } }
}

/**
 * fetch double: records every request (headers included) and answers from the
 * callback. A payload with `__status` becomes that non-2xx response (a 304 has no
 * body); `__headers` rides on the response without leaking into the JSON body.
 */
function fetchStub(answer) {
  const calls = []
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET'
    const body = options && options.body ? JSON.parse(options.body) : undefined
    const headers = Object.assign({}, (options && options.headers) || {})
    const record = { url: String(url), path: String(url).split('?')[0], method, body, headers }
    calls.push(record)
    const payload = answer ? answer(record) : {}
    const responseHeaders = headerStub(payload && payload.__headers)
    if (payload && payload.__status) {
      return {
        ok: false,
        status: payload.__status,
        headers: responseHeaders,
        // A 304 carries no body at all; other failures answer with { error }.
        json: async () => { if (payload.error === undefined) throw new SyntaxError('Unexpected end of JSON input'); return { error: payload.error } },
      }
    }
    const json = {}
    if (payload) for (const key of Object.keys(payload)) if (key.indexOf('__') !== 0) json[key] = payload[key]
    return { ok: true, status: 200, headers: responseHeaders, json: async () => json }
  }
  return { fetch, calls, posts: (path) => calls.filter((entry) => entry.method === 'POST' && entry.path === path) }
}

const plain = (value) => JSON.parse(JSON.stringify(value))

function findAll(node, predicate, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, predicate, out)
    return out
  }
  if (!node || typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) findAll(child, predicate, out)
  return out
}

function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!node || typeof node !== 'object') return ''
  return (node.children || []).map(textOf).join('')
}

const byClass = (tree, className) => findAll(tree, (node) => node.props && node.props.className === className)
const byProp = (tree, key, value) => findAll(tree, (node) => node.props && node.props[key] === value)
const triggerOf = (tree) => byClass(tree, 'mr-trigger')[0]
const panelOf = (tree) => byClass(tree, 'mr-panel')[0]

test('the bundle registers under the package id and exports a client plugin', () => {
  const { id, exports } = loadBundle()
  assert.equal(id, '@neptune810/dsh-model-router')
  assert.equal(exports.name, 'model-router')
  // The seat drives ui-model-selection's shared ModelDirectory, whose methods resolve
  // `remote.session` against the CALLER's fiber: the plugin root must declare the same
  // service list the shipped model-selection plugin declares, or directoryFor throws.
  assert.deepEqual([...exports.inject], ['slots', 'uiConversation', 'sessions', 'remote', 'remote.session'])
  assert.equal(typeof exports.apply, 'function')
})

test('apply contributes the route row, the composer chip, and the merged model seat', () => {
  const { injections, registrations, definitions } = mountBundle()
  // The merged cell owns the shipped model seat at priority -1, so ui-model-selection's
  // ModelSelect is replaced. The ".right" chip is registered as the fallback surface
  // for a host that keeps the shipped cell, and it self-retracts once the seat lands.
  assert.deepEqual(injections, ['conversation.chat.node', 'conversation.input.right', 'conversation.input.model'])
  assert.equal(registrations.length, 3)
  assert.equal(injections.filter((name) => name.startsWith('conversation.input.')).length, 2, 'the chip plus the merged seat')

  // The route row goes on ui-chat's conversation.chat.node seat, keyed by slot key.
  const chat = registrations[0]
  assert.equal(chat.descriptor.name, 'conversation.chat.node')
  assert.equal(chat.descriptor.key, 'model-router-route')
  assert.equal(chat.descriptor.locale, 'dsh-model-router')
  assert.equal(typeof chat.component, 'function')

  const { descriptor, component } = registrations[1]
  assert.equal(descriptor.name, 'conversation.input.right')
  assert.equal(descriptor.id, 'model-router:composer-control')
  assert.equal(descriptor.registrant, 'dsh-model-router')
  assert.ok(Number.isFinite(descriptor.order))
  assert.equal(typeof component, 'function')

  // The chip face marks itself as the fallback and carries no directory wiring:
  // the official half is no longer connected by the host.
  const face = descriptor.inject('session-1')
  assert.equal(face.sessionId, 'session-1')
  assert.equal(face.fallbackChip, true)
  assert.equal(face.available, true)
  assert.equal(face.directory, undefined)
  assert.equal(face.load, undefined)
  assert.equal(face.select, undefined)
  assert.equal(typeof face.resolveCatalog, 'function')
  assert.equal(typeof face.loadCatalog, 'function')

  // The merged seat: same component, priority -1 (below the shipped 0), and the
  // directory wiring the official half of the control needs.
  const seat = registrationNamed(registrations, 'conversation.input.model')
  assert.ok(seat, 'the merged seat must register on conversation.input.model')
  assert.equal(seat.descriptor.priority, -1, 'a lower priority shadows the shipped priority 0')
  assert.equal(seat.descriptor.registrant, 'dsh-model-router')
  assert.equal(seat.component, component, 'the chip and the seat are one control')
  const seatFace = seat.descriptor.inject('session-1')
  assert.equal(seatFace.sessionId, 'session-1')
  assert.equal(seatFace.fallbackChip, false)
  assert.equal(seatFace.available, true)
  assert.equal(typeof seatFace.directory.subscribe, 'function', 'the seat hands the shared store to the control')
  assert.equal(typeof seatFace.load, 'function')
  assert.equal(typeof seatFace.select, 'function')
  seatFace.loadCatalog()
  assert.equal(typeof seatFace.resolveCatalog, 'function')

  // ...and the projection Definition is registered on the conversation events.
  assert.equal(definitions.length, 1)
  assert.equal(definitions[0].kind, 'model-router-route')
  assert.equal(definitions[0].target, 'chat')
})

test('the closed control renders a trigger without touching the network', () => {
  const { exports } = loadBundle()
  const tree = exports.ModelRouterControl({ sessionId: 'session-1' })
  assert.equal(typeof tree, 'object')
  assert.equal(tree.type, 'div')
  const trigger = tree.children[0]
  assert.equal(trigger.type, 'button')
  assert.match(trigger.props.title || '', /路由|router/i)
})

test('the host routes the control talks to are the documented ones', () => {
  const source = SOURCE
  for (const route of ['/state', '/control', '/resume', '/task-type', '/pool', '/presets', '/settings']) {
    assert.ok(source.includes('"' + route) || source.includes(route + '?'), 'missing ' + route)
  }
})

test('the route Definition matches tool calls and anchors a row after the call', () => {
  const { definitions } = mountBundle()
  const definition = definitions[0]
  assert.equal(definition.match({ type: 'assistant/text', data: {} }), null)
  // The bundle runs in a vm realm, so compare fields instead of deep-equalling
  // its plain objects (node:assert/strict also checks the prototype identity).
  const matched = definition.match({ type: 'tool/call', data: { callId: 7, name: 'read_file' } })
  assert.equal(matched.id, '7')
  assert.equal(matched.role, 'start')

  const match = { event: { data: { callId: 7, name: 'read_file', turn: 2, step: 1 }, seq: 40 } }
  const state = definition.start({}, match)
  assert.equal(state.callId, '7')
  assert.equal(state.name, 'read_file')
  assert.equal(state.turn, 2)
  assert.equal(state.step, 1)
  assert.equal(state.seq, 40)
  assert.equal(definition.update({ state }), state)

  const node = definition.buildViewNode({ state, key: 'k', id: '7', start: { location: { kind: 'chat' } } })
  assert.equal(node.kind, 'model-router-route')
  assert.equal(node.target, 'chat')
  assert.equal(node.visibility, 'visible')
  assert.equal(node.anchorSeq, 40.1, 'the row sits just after the tool call it labels')
  assert.equal(node.data.callId, '7')
  assert.equal(node.data.name, 'read_file')
  assert.equal(node.data.turn, 2)
  assert.equal(node.data.step, 1)
  assert.equal(node.location.kind, 'chat')

  // A start context without a location stays unresolved rather than borrowing one.
  assert.equal(definition.buildViewNode({ state, key: 'k', id: '7', start: {} }).location.kind, 'unresolved')
  assert.equal(definition.buildViewNode({ state: null }), null)
})

test('the route row renders the folded projection and reads it defensively', () => {
  const { registrations } = mountBundle()
  const component = registrations[0].component
  const node = { data: { callId: 'c1', name: 'read_file', turn: 1, step: 0 } }
  const view = { calls: { c1: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high' } }, latest: null }

  const row = component({ node, useProjection: () => view })
  assert.equal(row.type, 'div')
  assert.equal(row.props['data-route-call'], 'c1')
  assert.equal(row.props['data-route-tool'], 'read_file')
  assert.equal(row.props.title, 'deepseek-official/deepseek-v4-pro · high')
  assert.equal(row.children[0].children[0], 'deepseek-official/deepseek-v4-pro')
  assert.equal(row.children[1].children[0], '· high')

  // Missing projection / missing entry / no props must render nothing - never throw,
  // because a throw blanks the whole conversation.chat.node slot entry.
  assert.equal(component({ node, useProjection: () => undefined }), null)
  assert.equal(component({ node, useProjection: () => ({ calls: {} }) }), null)
  assert.equal(component({ node, useProjection: () => ({ calls: { c1: {} } }) }), null, 'an entry with no model cannot label a row')
  assert.equal(component({ node: { data: { callId: 'missing' } }, useProjection: () => view }), null)
  assert.equal(component({ node: { data: {} }, useProjection: () => view }), null)
  assert.equal(component({ node }), null)
  assert.equal(component({}), null)
  assert.equal(component(undefined), null)
  assert.equal(component({ node, useProjection: () => { throw new Error('no projection host') } }), null)
})

test('a call with no recorded effort shows the localized default label', () => {
  const { registrations } = mountBundle()
  const component = registrations[0].component
  const row = component({
    node: { data: { callId: 'c1', name: 'read_file' } },
    useProjection: () => ({ calls: { c1: { provider: 'deepseek-official', model: 'deepseek-flash', effort: null } } }),
  })
  // The sandbox has no navigator, so the bundle falls back to the zh table.
  assert.equal(row.props.title, 'deepseek-official/deepseek-flash · 默认')
})

test('package.json declares the ui-chat seat and the uiConversation service', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-client-ui-model-selection',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-chat',
  ])
  // Coherence: the declared uiConversation service is the one apply() reads, and
  // ui-chat owns the conversation.chat.node seat the row registers on.
  // The docs task owns the version: just require a real semver (0.11.0 is the
  // release that takes over the composer model cell).
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.ok(SOURCE.includes('ctx.uiConversation'), 'apply() must read the declared uiConversation service')
  assert.ok(SOURCE.includes('"conversation.chat.node"'), 'the row must register on the ui-chat seat')
})

// --- 0.10.0 composer chip and the official half (no longer host-wired) -------------

/** The official cell's own catalog snapshot (the ModelDirectory store shape). */
function officialSnapshot(overrides = {}) {
  return Object.assign({
    status: 'ready',
    groups: [
      { id: 'deepseek-official', name: 'Official', models: [
        { id: 'deepseek-v4-pro', name: 'V4 Pro', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } },
        { id: 'deepseek-flash', name: 'Flash' },
      ] },
    ],
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    pending: null,
    retainedEffort: undefined,
  }, overrides)
}

/**
 * Mount the control through the chip entry with the host face plus the official
 * catalog wiring. The component is shared by the chip and the merged seat; here it
 * is mounted with the chip face, so directory/load/select are passed explicitly.
 */
async function openControl(options = {}) {
  const dir = directoryStub(options.snapshot || officialSnapshot(), options)
  const dirs = directoriesStub({ 'session-1': dir })
  const net = fetchStub((record) => {
    if (record.path === '/model-router/catalog') return { groups: [] }
    if (record.path === '/model-router/state') return options.stateAnswer ? options.stateAnswer(record) : (options.state || {})
    return { ok: true }
  })
  const rt = createRuntime()
  const bundle = mountBundle({
    react: rt.react, modelDirectories: dirs.modelDirectories, fetch: net.fetch, sessions: options.sessions,
    globals: Object.assign(browserGlobals(), options.globals || {}),
  })
  const entry = registrationNamed(bundle.registrations, 'conversation.input.right')
  const face = chipFace(bundle.registrations)
  const props = Object.assign({}, face, {
    directory: dir.store,
    load: () => dir.directory.load(),
    select: (selection) => dir.directory.select(selection),
  }, options.props || {})
  const holder = await rt.mount(entry.component, props)
  return { dir, dirs, net, bundle, face, props, holder, rt }
}

const openPanel = (holder) => { triggerOf(holder.tree).props.onClick(); return holder.tree }

test('the chip face resolves the session catalog and never throws for an unknown session', async () => {
  const snapshot = { groups: [], status: 'idle' }
  const known = directoryStub(snapshot)
  const dirs = directoriesStub({ 'session-1': known })
  const { registrations } = mountBundle({ modelDirectories: dirs.modelDirectories })
  const face = chipFace(registrations, 'session-1')
  assert.equal(dirs.calls.directoryFor[0], 'session-1', 'directoryFor must receive the session id')
  assert.equal(face.sessionId, 'session-1')
  assert.equal(face.fallbackChip, true, 'the chip is the fallback surface')
  assert.equal(face.available, true)
  // The rolled-back face exposes the catalog for reading, never the directory
  // itself and never a selection path of its own.
  assert.equal(face.directory, undefined)
  assert.equal(face.load, undefined)
  assert.equal(face.select, undefined)
  assert.equal(face.resolveCatalog(), known.store)
  face.loadCatalog()
  assert.equal(known.calls.load, 1, 'loadCatalog drives directory.load()')

  // An unknown session id: directoryFor throws, inject must still hand back a usable face.
  const unknown = chipFace(registrations, 'ghost')
  assert.equal(unknown.sessionId, 'ghost')
  assert.equal(unknown.available, true)
  assert.equal(unknown.resolveCatalog(), undefined)
  unknown.loadCatalog()
  assert.equal(known.calls.load, 1, 'an unknown session never reaches the known directory')

  // A rejecting catalog load is swallowed: never an unhandled rejection out of inject.
  const broken = directoryStub(snapshot, { loadReject: true })
  const brokenDirs = directoriesStub({ 'session-1': broken })
  const second = mountBundle({ modelDirectories: brokenDirs.modelDirectories })
  const poor = chipFace(second.registrations, 'session-1')
  poor.loadCatalog()
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(broken.calls.load, 1)
})

test('the host face is always available, and the component still honours available === false', async () => {
  const dir = directoryStub(officialSnapshot())
  const dirs = directoriesStub({ 'session-1': dir })
  const sessions = { subagentAddress: (sessionId) => (sessionId === 'session-1' ? 'parent-1' : undefined) }
  const { registrations } = mountBundle({ modelDirectories: dirs.modelDirectories, sessions })
  // 0.10.0 rollback: the face no longer consults sessions, so it never reports itself
  // unavailable and it exposes neither load() nor select().
  const face = chipFace(registrations)
  assert.equal(face.available, true)
  assert.equal(face.directory, undefined)
  assert.equal(face.load, undefined)
  assert.equal(face.select, undefined)

  // The component contract still renders nothing for an unavailable session.
  const rt = createRuntime()
  const bundle = mountBundle({ react: rt.react, modelDirectories: dirs.modelDirectories, sessions, fetch: fetchStub(() => ({})).fetch })
  const entry = registrationNamed(bundle.registrations, 'conversation.input.right')
  const holder = await rt.mount(entry.component, Object.assign({}, face, { available: false }))
  assert.equal(holder.tree, null)
  assert.equal(dir.calls.select.length, 0)
})

test('the merged seat reports a subagent session unavailable and never touches its directory', async () => {
  const dir = directoryStub(officialSnapshot())
  const dirs = directoriesStub({ 'session-1': dir })
  const sessions = { subagentAddress: (sessionId) => (sessionId === 'session-1' ? 'parent-1' : undefined) }
  const { registrations } = mountBundle({ modelDirectories: dirs.modelDirectories, sessions })
  const seat = registrationNamed(registrations, 'conversation.input.model')
  const face = seat.descriptor.inject('session-1')
  assert.equal(face.available, false, 'a subagent-addressed session cannot pick a model')
  assert.equal(typeof face.directory.subscribe, 'function', 'the store is still handed over for rendering')
  face.load()
  await face.select({ provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.equal(dir.calls.load, 0, 'an unavailable seat never calls the seat load() verb')
  assert.equal(dir.calls.select.length, 0, 'an unavailable seat never selects')
})

test('a host without the sessions service still wires the seat as available', () => {
  const dir = directoryStub(officialSnapshot())
  const dirs = directoriesStub({ 'session-1': dir })
  const { registrations } = mountBundle({ modelDirectories: dirs.modelDirectories, sessions: undefined })
  const seat = registrationNamed(registrations, 'conversation.input.model')
  const face = seat.descriptor.inject('session-1')
  assert.equal(face.available, true, 'no sessions service means the seat cannot be a subagent')
})

test('the seat selection verbs forward to the session directory and swallow a double resolve', async () => {
  const dir = directoryStub(officialSnapshot())
  const dirs = directoriesStub({ 'session-1': dir })
  const bundle = mountBundle({ modelDirectories: dirs.modelDirectories })
  const seat = registrationNamed(bundle.registrations, 'conversation.input.model')
  const face = seat.descriptor.inject('session-1')
  face.load()
  assert.equal(dir.calls.load, 1, 'load() drives the session directory')
  const result = await face.select({ provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.deepEqual(plain(result), { ok: true })
  assert.deepEqual(plain(dir.calls.select[0]), { provider: 'deepseek-official', model: 'deepseek-flash' })
  // An unknown session still hands back a face with no directory wiring.
  const ghost = seat.descriptor.inject('ghost')
  assert.equal(ghost.directory, undefined)
  ghost.load()
  await ghost.select({ provider: 'x', model: 'y' })
  assert.equal(dir.calls.load, 1, 'a ghost session never reaches the real directory')
})

test('official model rows select the model alone, and the current row is a no-op', async () => {
  const app = await openControl()
  assert.equal(panelOf(app.holder.tree), undefined, 'the panel starts closed')
  openPanel(app.holder)
  await app.rt.flush()
  assert.ok(panelOf(app.holder.tree), 'clicking the trigger opens the merged panel')

  const current = byProp(app.holder.tree, 'data-official-model', 'deepseek-official/deepseek-v4-pro')[0]
  const other = byProp(app.holder.tree, 'data-official-model', 'deepseek-official/deepseek-flash')[0]
  assert.equal(current.props['aria-checked'], 'true')
  assert.equal(current.props.role, 'menuitemradio')
  assert.equal(other.props['aria-checked'], 'false')
  const currentCell = byClass(current, 'mr-check')[0]
  const currentIcon = currentCell.children.filter(Boolean)[0]
  assert.ok(currentIcon, 'the current row carries the check mark')
  assert.equal(currentIcon.props.name, 'check')
  assert.equal(byClass(other, 'mr-check')[0].children.filter(Boolean).length, 0, 'a non-current row carries no check')

  // The already-current model is a no-op that just closes the popup.
  current.props.onClick()
  await app.rt.flush()
  assert.equal(app.dir.calls.select.length, 0)
  assert.equal(panelOf(app.holder.tree), undefined)

  // Another model: {provider, model} only. The model's own default effort is the
  // host's business, so the payload must not carry a reasoningEffort key.
  openPanel(app.holder)
  await app.rt.flush()
  byProp(app.holder.tree, 'data-official-model', 'deepseek-official/deepseek-flash')[0].props.onClick()
  await app.rt.flush()
  assert.equal(app.dir.calls.select.length, 1)
  const payload = app.dir.calls.select[0]
  assert.deepEqual(plain(payload), { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'reasoningEffort'), false)
  assert.equal(panelOf(app.holder.tree), undefined, 'the popup closes once the host accepted the pick')
})

test('effort rows: provider default omits the key, an explicit level sends it, the effective one is a no-op', async () => {
  const snapshot = officialSnapshot({
    groups: [{ id: 'deepseek-official', name: 'Official', models: [
      { id: 'deepseek-v4-pro', name: 'V4 Pro', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
    ] }],
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
  })
  const app = await openControl({ snapshot })
  openPanel(app.holder)
  await app.rt.flush()
  const rows = findAll(app.holder.tree, (node) => node.props && node.props['data-official-effort'] !== undefined)
  // No declared defaultEffort: the provider default is offered first, then every level.
  assert.deepEqual(rows.map((node) => node.props['data-official-effort']), ['provider-default', 'low', 'high'])
  assert.equal(rows[2].props['aria-checked'], 'true', 'the effective level is checked')
  assert.equal(rows[0].props['aria-checked'], 'false')

  // The already-effective level sends nothing.
  rows[2].props.onClick()
  await app.rt.flush()
  assert.equal(app.dir.calls.select.length, 0)

  // Provider default: the current provider/model, no reasoningEffort key at all.
  openPanel(app.holder)
  await app.rt.flush()
  findAll(app.holder.tree, (node) => node.props && node.props['data-official-effort'] === 'provider-default')[0].props.onClick()
  await app.rt.flush()
  assert.equal(app.dir.calls.select.length, 1)
  const payload = app.dir.calls.select[0]
  assert.deepEqual(plain(payload), { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'reasoningEffort'), false)
})

test('an explicit effort level is sent with the current provider and model', async () => {
  const snapshot = officialSnapshot({ current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' } })
  const app = await openControl({ snapshot })
  openPanel(app.holder)
  await app.rt.flush()
  // defaultEffort is 'low', so the list is just the two declared levels.
  const rows = findAll(app.holder.tree, (node) => node.props && node.props['data-official-effort'] !== undefined)
  assert.deepEqual(rows.map((node) => node.props['data-official-effort']), ['low', 'high'])
  rows[1].props.onClick()
  await app.rt.flush()
  assert.equal(app.dir.calls.select.length, 1)
  assert.deepEqual(plain(app.dir.calls.select[0]), { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' })
})

test('a model that advertises no reasoning levels renders no effort section', async () => {
  const snapshot = officialSnapshot({
    groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash', name: 'Flash' }] }],
    current: { provider: 'deepseek-official', model: 'deepseek-flash' },
    retainedEffort: 'low',
  })
  const app = await openControl({ snapshot })
  openPanel(app.holder)
  await app.rt.flush()
  assert.equal(findAll(app.holder.tree, (node) => node.props && node.props['data-official-effort'] !== undefined).length, 0)
  assert.equal(byClass(app.holder.tree, 'mr-group').map(textOf).includes('推理等级'), false)
  assert.ok(panelOf(app.holder.tree), 'the model list is still there')
})

// --- trigger labelling, busy/fallback states, failures and the router half ---------

test('the official-half trigger labels the session model and its effort through the documented ladder', async () => {
  const labels = (trigger) => trigger.children
    .filter((child) => child && (!child.props.className || child.props.className === 'mr-sub'))
    .map((child) => textOf(child))

  const base = await openControl()
  assert.deepEqual(labels(triggerOf(base.holder.tree)), ['V4 Pro', 'High'])
  const sub = triggerOf(base.holder.tree).children.filter((child) => child && child.props.className === 'mr-sub')[0]
  assert.equal(sub.props.title, 'V4 Pro · High', 'the tooltip spells out both halves')
  assert.equal(triggerOf(base.holder.tree).props['aria-busy'], undefined)

  // No effort recorded on the current step: the model's declared default is shown.
  const declared = await openControl({ snapshot: officialSnapshot({ current: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }) })
  assert.deepEqual(labels(triggerOf(declared.holder.tree)), ['V4 Pro', 'Low'])

  // A model without reasoning levels falls back to the effort the session retained.
  const retained = await openControl({ snapshot: officialSnapshot({
    groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash', name: 'Flash' }] }],
    current: { provider: 'deepseek-official', model: 'deepseek-flash' }, retainedEffort: 'medium',
  }) })
  assert.deepEqual(labels(triggerOf(retained.holder.tree)), ['Flash', 'medium'])

  // Levels advertised but no declared default and no current effort: provider default.
  const providerDefault = await openControl({ snapshot: officialSnapshot({
    groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-pro', name: 'V4 Pro', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }] }],
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
  }) })
  assert.deepEqual(labels(triggerOf(providerDefault.holder.tree)), ['V4 Pro', '默认（供应商）'])

  // Loading, then a ready catalog with nothing selected yet.
  const loading = await openControl({ snapshot: officialSnapshot({ status: 'loading', current: null, groups: [] }) })
  assert.deepEqual(labels(triggerOf(loading.holder.tree)), ['正在加载模型…'])
  const empty = await openControl({ snapshot: officialSnapshot({ current: null, groups: [] }) })
  assert.deepEqual(labels(triggerOf(empty.holder.tree)), ['请选择模型'])

  // A current model outside the catalog is still named exactly.
  const outside = await openControl({ snapshot: officialSnapshot({ current: { provider: 'other-gw', model: 'mystery' }, groups: [] }) })
  assert.deepEqual(labels(triggerOf(outside.holder.tree)), ['other-gw/mystery'])
})

test('a pending official pick shows a busy trigger and locks every row', async () => {
  const snapshot = officialSnapshot({ pending: { provider: 'deepseek-official', model: 'deepseek-flash' } })
  const app = await openControl({ snapshot })
  const trigger = triggerOf(app.holder.tree)
  assert.equal(trigger.props['aria-busy'], 'true')
  assert.equal(findAll(trigger, (node) => node.props && node.props.className === 'mr-spin').length, 1)
  openPanel(app.holder)
  await app.rt.flush()
  const pendingRow = byProp(app.holder.tree, 'data-official-model', 'deepseek-official/deepseek-flash')[0]
  assert.equal(pendingRow.props.disabled, true)
  assert.equal(findAll(byClass(pendingRow, 'mr-check')[0], (node) => node.props && node.props.className === 'mr-spin').length, 1)
  assert.equal(byProp(app.holder.tree, 'data-official-model', 'deepseek-official/deepseek-v4-pro')[0].props.disabled, true)
})

test('a locked session shows a disabled trigger with no popup', async () => {
  const locked = await openControl({ props: { locked: true } })
  const trigger = triggerOf(locked.holder.tree)
  assert.equal(trigger.props.disabled, true)
  trigger.props.onClick()
  await locked.rt.flush()
  assert.equal(panelOf(locked.holder.tree), undefined, 'a locked control never opens')
  assert.equal(locked.holder.tree.type, 'div', 'a locked control is still a visible cell')
  assert.equal(locked.dir.calls.select.length, 0)
  assert.equal(locked.net.calls.filter((call) => call.path === '/model-router/catalog').length, 0)
})

test('a failed official pick keeps its message on the open panel instead of closing', async () => {
  const refused = await openControl({ selectResult: { ok: false, error: { message: 'provider refused' } } })
  openPanel(refused.holder)
  await refused.rt.flush()
  byProp(refused.holder.tree, 'data-official-model', 'deepseek-official/deepseek-flash')[0].props.onClick()
  await refused.rt.flush()
  assert.ok(panelOf(refused.holder.tree), 'the panel stays open so the failure is visible')
  assert.equal(refused.dir.calls.select.length, 1)
  assert.match(textOf(byClass(refused.holder.tree, 'mr-err')[0]), /provider refused/)

  const rejected = await openControl({ selectReject: true })
  openPanel(rejected.holder)
  await rejected.rt.flush()
  byProp(rejected.holder.tree, 'data-official-model', 'deepseek-official/deepseek-flash')[0].props.onClick()
  await rejected.rt.flush()
  assert.ok(panelOf(rejected.holder.tree))
  assert.match(textOf(byClass(rejected.holder.tree, 'mr-err')[0]), /network down/)

  const accepted = await openControl()
  openPanel(accepted.holder)
  await accepted.rt.flush()
  byProp(accepted.holder.tree, 'data-official-model', 'deepseek-official/deepseek-flash')[0].props.onClick()
  await accepted.rt.flush()
  assert.equal(panelOf(accepted.holder.tree), undefined, 'a successful pick closes the panel')
})

test('official catalog errors and provider failures offer a retry that reloads the directory', async () => {
  const snapshot = officialSnapshot({ error: { message: 'boom' }, failures: [{ id: 'deepseek-account', message: 'timeout' }] })
  const app = await openControl({ snapshot })
  openPanel(app.holder)
  await app.rt.flush()
  assert.match(textOf(byClass(app.holder.tree, 'mr-err')[0]), /boom/)
  const notes = byClass(app.holder.tree, 'mr-note').map(textOf)
  assert.ok(notes.some((text) => text.includes('DeepSeek 账号') && text.includes('timeout')), 'the failure note names the account')
  const retries = findAll(app.holder.tree, (node) => node.type === 'button' && textOf(node) === '重新加载')
  assert.equal(retries.length, 2)
  const before = app.dir.calls.load
  retries[0].props.onClick()
  assert.equal(app.dir.calls.load, before + 1)
})

test('official groups render account, official, then everything else', async () => {
  const snapshot = officialSnapshot({
    groups: [
      { id: 'custom-gw', name: 'Custom', models: [{ id: 'm1', name: 'M1' }] },
      { id: 'deepseek-official', name: 'Official', models: [{ id: 'deepseek-flash', name: 'Flash' }] },
      { id: 'deepseek-account', models: [{ id: 'acct-1', name: 'Acct' }] },
    ],
    current: { provider: 'deepseek-account', model: 'acct-1' },
  })
  const app = await openControl({ snapshot })
  openPanel(app.holder)
  await app.rt.flush()
  const ids = findAll(app.holder.tree, (node) => node.props && node.props['data-official-model']).map((node) => node.props['data-official-model'])
  assert.deepEqual(ids, ['deepseek-account/acct-1', 'deepseek-official/deepseek-flash', 'custom-gw/m1'])
  assert.deepEqual(byClass(app.holder.tree, 'mr-group').map(textOf).slice(0, 4), ['本会话模型', 'DeepSeek 账号', 'Official', 'Custom'])
})

test('the router half still posts the control, pool and settings payloads it always did', async () => {
  const state = {
    effectiveControl: 'full', engaged: true, effortModelPending: false, effectiveEffortModel: null,
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high', stepClass: 'standard' },
    pool: [{ id: 'deepseek-official/deepseek-v4-pro', tier: 'cheap', cost: 1, tags: [] }],
    presets: {}, settings: { classifier: 'rules' }, decisions: [],
  }
  const app = await openControl({ state })
  openPanel(app.holder)
  await app.rt.flush()

  const segmented = (values) => findAll(app.holder.tree, (node) => Array.isArray(node.props && node.props.options) && values.every((value) => node.props.options.some((option) => option.value === value)))[0]
  segmented(['full', 'effort', 'model']).props.onChange('effort')
  await app.rt.flush()
  assert.deepEqual(plain(app.net.posts('/model-router/control').pop().body), { sessionId: 'session-1', control: 'effort' })

  // The pool now rides on the model rows: the tick on this row removes it again.
  assert.equal(findAll(app.holder.tree, (node) => node.type === 'button' && node.props['data-mr-pool-entry']).length, 0, 'the seated control shows no second pool list')
  const poolTick = findAll(app.holder.tree, (node) => node.type === 'button' && node.props['data-pool-toggle'] === 'deepseek-official/deepseek-v4-pro')[0]
  assert.ok(poolTick, 'the model row carries the pool tick')
  assert.equal(poolTick.props['data-active'], 'true')
  poolTick.props.onClick()
  await app.rt.flush()
  assert.deepEqual(plain(app.net.posts('/model-router/pool').pop().body), { pool: [] })

  segmented(['rules', 'llm']).props.onChange('llm')
  await app.rt.flush()
  assert.deepEqual(plain(app.net.posts('/model-router/settings').pop().body), { settings: { classifier: 'llm' } })
})

test('effort mode binds exactly one model through /effort-model and never edits the pool', async () => {
  const state = {
    effectiveControl: 'effort', engaged: true, effortModelPending: true, effectiveEffortModel: null,
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high', stepClass: 'standard' },
    pool: [{ id: 'deepseek-official/deepseek-v4-pro', tier: 'cheap', cost: 1, tags: [] }],
    presets: {}, settings: {}, decisions: [],
  }
  const app = await openControl({ state, snapshot: officialSnapshot({ groups: [], current: null }) })
  openPanel(app.holder)
  await app.rt.flush()
  assert.ok(byClass(app.holder.tree, 'mr-group').map(textOf).includes('思考模式只作用于一个模型'))
  assert.ok(byClass(app.holder.tree, 'mr-note').map(textOf).some((text) => text.includes('先选一个模型')))
  const chips = findAll(app.holder.tree, (node) => node.type === 'button' && node.props['data-effort-bind'] === 'deepseek-official/deepseek-v4-pro')
  assert.equal(chips.length, 1, 'effort mode offers one bind control on the model row')
  assert.equal(chips[0].props['data-active'], 'false')
  chips[0].props.onClick()
  await app.rt.flush()
  assert.deepEqual(plain(app.net.posts('/model-router/effort-model').pop().body), { sessionId: 'session-1', model: 'deepseek-official/deepseek-v4-pro' })
  assert.equal(app.net.posts('/model-router/pool').length, 0, 'an effort pick is not a pool edit')

  // Already bound: the control reports the state and posts nothing.
  const boundState = Object.assign({}, state, { effortModelPending: false, effectiveEffortModel: 'deepseek-official/deepseek-v4-pro' })
  const bound = await openControl({ state: boundState, snapshot: officialSnapshot({ groups: [], current: null }) })
  openPanel(bound.holder)
  await bound.rt.flush()
  const boundChip = findAll(bound.holder.tree, (node) => node.type === 'button' && node.props['data-effort-bind'] === 'deepseek-official/deepseek-v4-pro')[0]
  assert.equal(boundChip.props['data-active'], 'true')
  assert.equal(textOf(boundChip), '已绑定')
  boundChip.props.onClick()
  await bound.rt.flush()
  assert.equal(bound.net.posts('/model-router/effort-model').length, 0, 'a bound control is a no-op')
})

test('the seated panel folds the pool into the model rows instead of a second list', async () => {
  const state = {
    effectiveControl: 'full', engaged: true, effortModelPending: false, effectiveEffortModel: null,
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high', stepClass: 'standard' },
    pool: [{ id: 'deepseek-official/deepseek-v4-pro', tier: 'cheap', cost: 1, tags: [] }],
    presets: {}, settings: {}, decisions: [],
  }
  const app = await openControl({ state })
  openPanel(app.holder)
  await app.rt.flush()
  // The header no longer repeats the pool: the tick rides on the model row itself.
  assert.equal(findAll(app.holder.tree, (node) => node.type === 'button' && node.props['data-mr-pool-entry']).length, 0)
  const picks = byProp(app.holder.tree, 'data-official-model', 'deepseek-official/deepseek-v4-pro')
  assert.equal(picks.length, 1, 'the pooled model appears once, as the session-model radio')
  const ticks = findAll(app.holder.tree, (node) => node.type === 'button' && node.props['data-pool-toggle'] === 'deepseek-official/deepseek-v4-pro')
  assert.equal(ticks.length, 1, 'the same row carries the pool tick')
  assert.equal(ticks[0].props['data-active'], 'true')
  assert.match(textOf(ticks[0]), /模型池/)
  // A pooled model also opens its tier/cost/vision line inline.
  assert.equal(byClass(app.holder.tree, 'mr-line').filter((node) => textOf(node).includes('定位')).length, 1)
  // The radio still picks the session model: choosing the other model selects it.
  byProp(app.holder.tree, 'data-official-model', 'deepseek-official/deepseek-flash')[0].props.onClick()
  await app.rt.flush()
  assert.equal(app.dir.calls.select.length, 1)
  assert.equal(app.dir.calls.select[0].model, 'deepseek-flash')
  ticks[0].props.onClick()
  await app.rt.flush()
  assert.deepEqual(plain(app.net.posts('/model-router/pool').pop().body), { pool: [] })
})

/** The state a fresh conversation sees: the last plan, inherited and unconfirmed. */
function planningState(overrides = {}) {
  return Object.assign({
    effectiveControl: 'effort', engaged: true, effortModelPending: false,
    effectiveEffortModel: 'deepseek-official/deepseek-v4-pro',
    current: null, pool: [], presets: {}, settings: {}, decisions: [],
    plan: { control: 'effort', effortModel: 'deepseek-official/deepseek-v4-pro', taskType: '小说续写', pool: 2, poolIds: ['a', 'b'] },
    planKey: 'effort|deepseek-official/deepseek-v4-pro|小说续写|a,b',
    planConfirmed: false, inherited: true,
  }, overrides)
}

test('a new conversation highlights the inherited plan and confirms it once', async () => {
  const app = await openControl({ state: planningState() })
  // The trigger announces the pending confirmation before the panel is even opened.
  assert.equal(byClass(app.holder.tree, 'mr-attn').length, 1, 'the trigger carries the attention dot')
  assert.match(triggerOf(app.holder.tree).props.title, /新对话待确认路由方案/)

  openPanel(app.holder)
  await app.rt.flush()
  const bar = byClass(app.holder.tree, 'mr-confirm')[0]
  assert.ok(bar, 'the unconfirmed plan renders the highlight bar')
  const shown = textOf(bar)
  assert.match(shown, /已沿用上一次的选择/)
  assert.match(shown, /思考/, 'the bar states the scope')
  assert.match(shown, /deepseek-v4-pro/, 'the bar states the bound effort model')
  assert.match(shown, /小说续写/, 'the bar states the pinned task type')
  assert.match(shown, /2 个/, 'the bar states the pool size')

  const button = findAll(bar, (node) => node.type === 'button')[0]
  assert.equal(textOf(button), '确认')
  button.props.onClick()
  await app.rt.flush()
  assert.deepEqual(plain(app.net.posts('/model-router/confirm').pop().body), { sessionId: 'session-1', plan: 'effort|deepseek-official/deepseek-v4-pro|小说续写|a,b' })
  assert.equal(byClass(app.holder.tree, 'mr-confirm').length, 0, 'the bar stands down for the rest of the conversation')
  assert.equal(byClass(app.holder.tree, 'mr-attn').length, 0, 'and so does the trigger dot')
})

test('a confirmed plan is silent, and a changed plan asks again', async () => {
  const confirmed = await openControl({ state: planningState({ planConfirmed: true }) })
  openPanel(confirmed.holder)
  await confirmed.rt.flush()
  assert.equal(byClass(confirmed.holder.tree, 'mr-confirm').length, 0, 'a confirmed plan is not asked twice')
  assert.equal(byClass(confirmed.holder.tree, 'mr-attn').length, 0)

  // Changing the plan changes the key, so the conversation is asked once more.
  const changed = await openControl({ state: planningState({
    plan: { control: 'effort', effortModel: 'deepseek-official/deepseek-v4-pro', taskType: '代码重构', pool: 2, poolIds: ['a', 'b'] },
    planKey: 'effort|deepseek-official/deepseek-v4-pro|代码重构|a,b',
  }) })
  openPanel(changed.holder)
  await changed.rt.flush()
  const bar = byClass(changed.holder.tree, 'mr-confirm')[0]
  assert.ok(bar, 'a changed plan is confirmed again')
  assert.match(textOf(bar), /代码重构/)
  assert.equal(changed.net.posts('/model-router/confirm').length, 0, 'rendering the bar posts nothing by itself')
})

test('pool rows are grouped by provider and each group adds or removes the whole brand', async () => {
  const state = {
    effectiveControl: 'full', engaged: true, effortModelPending: false, effectiveEffortModel: null,
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high', stepClass: 'standard' },
    pool: [{ id: 'deepseek-official/deepseek-v4-pro', tier: 'strong', cost: 4, tags: [] }],
    presets: {}, settings: { crossProvider: 'confirm' }, decisions: [],
  }
  const snapshot = officialSnapshot({
    groups: [
      { id: 'deepseek-official', name: 'Official', models: [{ id: 'deepseek-v4-pro', name: 'V4 Pro' }, { id: 'deepseek-flash', name: 'Flash' }] },
      { id: 'vendor-x', name: 'Vendor X', models: [{ id: 'writer-pro', name: 'Writer Pro' }] },
    ],
  })
  const app = await openControl({ state, snapshot })
  openPanel(app.holder)
  await app.rt.flush()

  const heads = findAll(app.holder.tree, (node) => node.props && node.props.className === 'mr-prov')
  assert.ok(heads.length >= 2, 'each provider group renders a header row')
  const addVendor = findAll(app.holder.tree, (node) => node.type === 'button' && node.props['data-provider-add'] === 'vendor-x')[0]
  const removeVendor = findAll(app.holder.tree, (node) => node.type === 'button' && node.props['data-provider-remove'] === 'vendor-x')[0]
  assert.ok(addVendor && removeVendor, 'the vendor-x header carries the bulk controls')
  assert.equal(textOf(addVendor), '全加入')
  assert.equal(textOf(removeVendor), '全移除')

  // Add all: only what is missing enters the pool, as a cheap default entry.
  addVendor.props.onClick()
  await app.rt.flush()
  assert.deepEqual(plain(app.net.posts('/model-router/pool').pop().body), { pool: [
    { id: 'deepseek-official/deepseek-v4-pro', tier: 'strong', cost: 4, tags: [] },
    { id: 'vendor-x/writer-pro', tier: 'cheap', cost: 1, tags: [] },
  ] })

  // Remove all: every entry of that brand goes, the other brand survives.
  // A fresh mount, because the stub /state never echoes the optimistic pool back.
  const both = Object.assign({}, state, { pool: [
    { id: 'deepseek-official/deepseek-v4-pro', tier: 'strong', cost: 4, tags: [] },
    { id: 'vendor-x/writer-pro', tier: 'cheap', cost: 1, tags: [] },
  ] })
  const second = await openControl({ state: both, snapshot })
  openPanel(second.holder)
  await second.rt.flush()
  const dropVendor = findAll(second.holder.tree, (node) => node.type === 'button' && node.props['data-provider-remove'] === 'vendor-x')[0]
  dropVendor.props.onClick()
  await second.rt.flush()
  assert.deepEqual(plain(second.net.posts('/model-router/pool').pop().body), { pool: [
    { id: 'deepseek-official/deepseek-v4-pro', tier: 'strong', cost: 4, tags: [] },
  ] })
})

test('the panel head prices the pool, with the network fetch behind its own button', async () => {
  const state = {
    effectiveControl: 'full', engaged: true, effortModelPending: false, effectiveEffortModel: null,
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high', stepClass: 'standard' },
    pool: [{ id: 'deepseek-official/deepseek-v4-pro', tier: 'strong', cost: 4, tags: [] }],
    presets: {}, settings: {}, decisions: [],
  }
  const app = await openControl({ state })
  openPanel(app.holder)
  await app.rt.flush()

  const auto = findAll(app.holder.tree, (node) => node.type === 'button' && node.props['data-mr-auto-price'])[0]
  const net = findAll(app.holder.tree, (node) => node.type === 'button' && node.props['data-mr-net-price'])[0]
  assert.ok(auto && net, 'the head offers both pricing controls')
  assert.equal(textOf(auto), '自动定价')
  assert.equal(textOf(net), '联网定价')

  auto.props.onClick()
  await app.rt.flush()
  assert.deepEqual(plain(app.net.posts('/model-router/pool/auto-price').pop().body), { fetch: false })

  const net2 = findAll(app.holder.tree, (node) => node.type === 'button' && node.props['data-mr-net-price'])[0]
  net2.props.onClick()
  await app.rt.flush()
  assert.deepEqual(plain(app.net.posts('/model-router/pool/auto-price').pop().body), { fetch: true })

  // Nothing changed in this stub, so the note says so instead of inventing a count.
  const note = findAll(app.holder.tree, (node) => node.props && node.props['data-mr-price-note'])[0]
  assert.ok(note, 'the outcome is shown under the head')
  assert.match(textOf(note), /没有需要更新的模型/)
})

test('a cross-provider proposal renders the bar and answers through /cross', async () => {
  const state = {
    effectiveControl: 'full', engaged: true, effortModelPending: false, effectiveEffortModel: null,
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high', stepClass: 'standard' },
    pool: [{ id: 'deepseek-official/deepseek-v4-pro', tier: 'strong', cost: 4, tags: [] }, { id: 'vendor-x/writer-pro', tier: 'cheap', cost: 4, tags: [] }],
    presets: {}, settings: { crossProvider: 'confirm' }, decisions: [],
    cross: { mode: 'confirm', defaultMode: 'confirm', anchor: 'deepseek-official', allowed: false, proposal: { id: 'vendor-x/writer-pro', provider: 'vendor-x', model: 'writer-pro', tier: 'cheap', cost: 4, score: 12 } },
  }
  const app = await openControl({ state, snapshot: officialSnapshot({ groups: [{ id: 'deepseek-official', name: 'Official', models: [{ id: 'deepseek-v4-pro', name: 'V4 Pro' }] }] }) })
  openPanel(app.holder)
  await app.rt.flush()

  const bar = byClass(app.holder.tree, 'mr-cross')[0]
  assert.ok(bar, 'the proposal renders its own bar')
  assert.match(textOf(bar), /跨品牌切换/)
  assert.match(textOf(bar), /vendor-x\/writer-pro/, 'the bar names the target model')
  const answer = (action) => findAll(app.holder.tree, (node) => node.type === 'button' && node.props['data-mr-cross-action'] === action)[0]
  assert.equal(textOf(answer('once')), '只切一次')
  assert.equal(textOf(answer('allow')), '本会话允许')
  assert.equal(textOf(answer('never')), '不再跨品牌')

  answer('once').props.onClick()
  await app.rt.flush()
  assert.deepEqual(plain(app.net.posts('/model-router/cross').pop().body), { sessionId: 'session-1', action: 'once' })
})

test('the cross-brand setting offers allow / ask / never and posts the choice', async () => {
  const state = {
    effectiveControl: 'full', engaged: true, effortModelPending: false, effectiveEffortModel: null,
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high', stepClass: 'standard' },
    pool: [{ id: 'deepseek-official/deepseek-v4-pro', tier: 'strong', cost: 4, tags: [] }],
    presets: {}, settings: { crossProvider: 'confirm' }, decisions: [],
  }
  const app = await openControl({ state })
  openPanel(app.holder)
  await app.rt.flush()
  const row = findAll(app.holder.tree, (node) => node.props && node.props['data-mr-cross-setting'] === 'true')[0]
  assert.ok(row, 'the more section carries the cross-brand setting')
  const segmented = findAll(row, (node) => Array.isArray(node.props && node.props.options))[0]
  assert.deepEqual(plain(segmented.props.options.map((option) => option.value)), ['allow', 'confirm', 'never'])
  assert.equal(segmented.props.value, 'confirm')
  segmented.props.onChange('never')
  await app.rt.flush()
  assert.deepEqual(plain(app.net.posts('/model-router/settings').pop().body), { settings: { crossProvider: 'never' } })
})

test('the readout polls while visible and refreshes at once when the window returns', async () => {
  // The composer trigger sits outside the conversation projection, so the host's
  // current step reaches it over /state. It must not wait a full tick after the
  // window comes back, and it must not poll at all while hidden.
  const listeners = {}
  const documentStub = {
    hidden: true,
    body: { appendChild: () => {}, removeChild: () => {} },
    createElement: () => ({ style: {} }),
    addEventListener: (type, fn) => { listeners[type] = fn },
    removeEventListener: (type) => { delete listeners[type] },
  }
  let armed = null
  const state = {
    effectiveControl: 'full', engaged: true, effortModelPending: false, effectiveEffortModel: null,
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high', stepClass: 'standard' },
    pool: [{ id: 'deepseek-official/deepseek-v4-pro', tier: 'cheap', cost: 1, tags: [] }],
    presets: {}, settings: {}, decisions: [],
  }
  const app = await openControl({
    state,
    globals: {
      document: documentStub,
      setInterval: (fn, ms) => { armed = { fn: fn, ms: ms }; return 7 },
      clearInterval: () => { armed = null },
    },
  })
  await app.rt.flush()
  assert.ok(armed, 'the readout keeps a poll armed while a conversation is open')
  assert.equal(armed.ms, 1200, 'the conditional poll cadence is 1200 ms')
  const fetches = () => app.net.calls.filter((entry) => entry.path === '/model-router/state').length
  const before = fetches()

  // Hidden: the tick does nothing, so a backgrounded app costs nothing.
  armed.fn()
  await app.rt.flush()
  assert.equal(fetches(), before, 'a hidden window does not poll')

  // Visible again: refresh now instead of waiting for the next tick.
  documentStub.hidden = false
  listeners.visibilitychange()
  await app.rt.flush()
  assert.equal(fetches(), before + 1, 'becoming visible refreshes immediately')

  // And the tick keeps working once visible.
  armed.fn()
  await app.rt.flush()
  assert.equal(fetches(), before + 2)
})

// --- 0.15.0: conditional /state polling (ETag / 304) -------------------------------

const stateCalls = (app) => app.net.calls.filter((entry) => entry.path === '/model-router/state')
const lastStateCall = (app) => stateCalls(app)[stateCalls(app).length - 1]

/**
 * Mount the control with a visible document and a captured poll timer, so the
 * conditional read can be ticked by hand. stateAnswer answers each /state request;
 * every request is recorded on net.calls together with its request headers.
 */
async function openPollingControl(options = {}) {
  const listeners = {}
  const documentStub = {
    hidden: false,
    body: { appendChild: () => {}, removeChild: () => {} },
    createElement: () => ({ style: {} }),
    addEventListener: (type, fn) => { listeners[type] = fn },
    removeEventListener: (type) => { delete listeners[type] },
  }
  let armed = null
  const app = await openControl(Object.assign({}, options, {
    globals: Object.assign({
      document: documentStub,
      setInterval: (fn, ms) => { armed = { fn: fn, ms: ms }; return 7 },
      clearInterval: () => { armed = null },
    }, options.globals || {}),
  }))
  return Object.assign(app, { poll: () => armed, documentStub: documentStub, listeners: listeners })
}

test('the readout polls /state every 1200 ms and an old host is read unconditionally', async () => {
  const app = await openPollingControl()
  await app.rt.flush()
  assert.ok(app.poll(), 'the readout keeps a poll armed while a conversation is open')
  assert.equal(app.poll().ms, 1200)

  // The response carries no ETag (an old host): the tick still answers 200 and its
  // request has no validator, exactly the plain polling 0.14 did.
  app.poll().fn()
  await app.rt.flush()
  const calls = stateCalls(app)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].headers['if-none-match'], undefined, 'a host without ETag is polled unconditionally')
})

test('the second poll sends if-none-match with the ETag of the first response', async () => {
  const app = await openPollingControl({
    stateAnswer: () => ({ __headers: { ETag: '"state-7"' }, stateVersion: 7, engaged: true }),
  })
  await app.rt.flush()
  const first = stateCalls(app)[0]
  assert.equal(first.headers['if-none-match'], undefined, 'the first read is unconditional')
  app.poll().fn()
  await app.rt.flush()
  const second = stateCalls(app)[1]
  assert.equal(second.headers['if-none-match'], '"state-7"', 'the next read revalidates with the stored ETag')
})

test('a 304 response leaves the rendered state untouched', async () => {
  let reads = 0
  const app = await openPollingControl({
    stateAnswer: () => {
      reads += 1
      if (reads > 1) return { __status: 304, __headers: { etag: '"state-1"' } }
      return {
        __headers: { etag: '"state-1"' }, stateVersion: 1, engaged: true, effectiveControl: 'full',
        current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high', stepClass: 'standard' },
        pool: [], presets: {}, settings: {}, decisions: [],
      }
    },
  })
  await app.rt.flush()
  const renders = app.holder.renders
  const tree = app.holder.tree
  app.poll().fn()
  await app.rt.flush()
  assert.equal(stateCalls(app).length, 2, 'the tick did reach the host')
  assert.equal(app.holder.renders, renders, 'a 304 does not re-render the panel')
  assert.equal(app.holder.tree, tree, 'and the rendered view stays exactly as it was')
})

test('a 200 with a new ETag is stored and revalidated with the new value next time', async () => {
  let reads = 0
  const app = await openPollingControl({
    stateAnswer: () => {
      reads += 1
      return { __headers: { etag: '"state-' + reads + '"' }, stateVersion: reads, engaged: true }
    },
  })
  await app.rt.flush()
  assert.equal(stateCalls(app)[0].headers['if-none-match'], undefined)
  app.poll().fn()
  await app.rt.flush()
  assert.equal(stateCalls(app)[1].headers['if-none-match'], '"state-1"')
  app.poll().fn()
  await app.rt.flush()
  assert.equal(stateCalls(app)[2].headers['if-none-match'], '"state-2"', 'the newest validator replaces the old one')
})

test('a session change clears the stored ETag so the new conversation reads unconditionally', async () => {
  let reads = 0
  const app = await openPollingControl({
    stateAnswer: () => {
      reads += 1
      return { __headers: { etag: '"state-' + reads + '"' }, stateVersion: reads, engaged: true }
    },
  })
  await app.rt.flush()
  app.poll().fn()
  await app.rt.flush()
  assert.equal(lastStateCall(app).headers['if-none-match'], '"state-1"', 'the same conversation revalidates')

  // The host re-injects the seat when the conversation changes.
  await app.holder.update(Object.assign({}, app.props, { sessionId: 'session-2' }))
  const switched = lastStateCall(app)
  assert.equal(switched.url, '/model-router/state?sessionId=session-2')
  assert.equal(switched.headers['if-none-match'], undefined, 'the new conversation reads unconditionally')
})

/** A state carrying the catalog hard-date block the 0.15.1 router serves. */
function catalogState(alerts, evidenceDate = '2026-10-26') {
  return {
    effectiveControl: 'full', engaged: true, effortModelPending: false, effectiveEffortModel: null,
    current: { provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high', stepClass: 'standard' },
    pool: [], presets: {}, settings: {}, decisions: [],
    catalog: { evidenceDate, withinDays: 30, alerts },
  }
}

const CATALOG_ALERTS = [
  { date: '2026-12-01', description: 'Gemini 4 Argon 开始计费', daysUntil: 36 },
  { date: '2027-01-01', description: 'Gemini 3.8 Flash 促销结束', daysUntil: 67 },
  { date: '2026-12-31', description: 'GLM-4.5 到期', daysUntil: 66 },
  { date: '2027-02-01', description: '第四条不该出现在面板里', daysUntil: 98 },
]

test('the catalog watchlist raises a dot on the trigger and a note inside the panel', async () => {
  const app = await openControl({ state: catalogState(CATALOG_ALERTS) })
  const triggerDot = byProp(app.holder.tree, 'data-catalog', 'true')
  assert.equal(triggerDot.length, 1, 'the closed trigger carries the catalog dot')
  assert.match(triggerDot[0].props.title, /模型目录里有几个硬日期快到/)
  assert.match(triggerDot[0].props.title, /\[2026-12-01\] Gemini 4 Argon 开始计费 · 36 天后/)
  assert.doesNotMatch(triggerDot[0].props.title, /第四条/, 'the trigger summarises at most three dates')

  openPanel(app.holder)
  await app.rt.flush()
  assert.equal(byProp(app.holder.tree, 'data-catalog', 'true').length, 2, 'the open panel adds its own dot in the head')
  const note = byProp(app.holder.tree, 'data-mr-catalog', 'true')[0]
  assert.ok(note, 'the panel lists the hard dates')
  const shown = textOf(note)
  assert.match(shown, /\[2026-12-01\] Gemini 4 Argon 开始计费 · 36 天后/)
  assert.match(shown, /GLM-4\.5 到期/)
  assert.match(shown, /67 天后/)
  assert.doesNotMatch(shown, /第四条/, 'the note shows the same three dates')
  assert.equal(note.props.title, '目录核对日期 2026-10-26')
})

test('a router without catalog alerts shows no dot and no note', async () => {
  // An older host: no state.catalog at all.
  const legacy = await openControl({ state: { effectiveControl: 'full', engaged: true, current: null, pool: [], decisions: [] } })
  openPanel(legacy.holder)
  await legacy.rt.flush()
  assert.equal(byProp(legacy.holder.tree, 'data-catalog', 'true').length, 0)
  assert.equal(byProp(legacy.holder.tree, 'data-mr-catalog', 'true').length, 0)

  // The current host with an empty watchlist stays quiet too.
  const quiet = await openControl({ state: catalogState([]) })
  openPanel(quiet.holder)
  await quiet.rt.flush()
  assert.equal(byProp(quiet.holder.tree, 'data-catalog', 'true').length, 0)

  // A catalog block with no alerts array is ignored rather than rendered as junk.
  const odd = await openControl({ state: Object.assign(catalogState([]), { catalog: { evidenceDate: null } }) })
  openPanel(odd.holder)
  await odd.rt.flush()
  assert.equal(byProp(odd.holder.tree, 'data-catalog', 'true').length, 0)
})

test('the catalog dot and note follow the chat language', async () => {
  const app = await openControl({
    state: catalogState([{ date: '2026-12-01', description: 'Gemini 4 Argon starts billing', daysUntil: 3 }]),
    globals: { navigator: { language: 'en-US' } },
  })
  const dot = byProp(app.holder.tree, 'data-catalog', 'true')[0]
  assert.match(dot.props.title, /hard dates coming up/)
  assert.match(dot.props.title, /in 3d/)
  openPanel(app.holder)
  await app.rt.flush()
  const note = byProp(app.holder.tree, 'data-mr-catalog', 'true')[0]
  assert.match(textOf(note), /in 3d/)
  assert.equal(note.props.title, 'catalog evidence 2026-10-26')
})

/** A state carrying the v0.16.0 cost-aware block the router serves. */
function costState(costAware) {
  return Object.assign(catalogState([]), { costAware })
}

test('the cost shadow names the model a cost-aware router would have used', async () => {
  const app = await openControl({
    state: costState({
      enabled: false,
      costWeight: 0.15,
      guard: { maxMultiple: 8, unknownPricing: 'exclude' },
      floorUsdPerMTok: 0.158143,
      entries: [],
      shadow: {
        candidate: 'deepseek-official/deepseek-flash',
        current: 'deepseek-official/deepseek-v4-pro',
        agree: false,
        savedRatio: 0.75,
      },
    }),
  })
  openPanel(app.holder)
  await app.rt.flush()

  const note = byProp(app.holder.tree, 'data-mr-shadow', 'true')[0]
  assert.ok(note, 'the panel carries the shadow line')
  const shown = textOf(note)
  assert.match(shown, /成本影子 \(off\)/)
  assert.match(shown, /成本路由会选 deepseek-official\/deepseek-flash 而不是 deepseek-official\/deepseek-v4-pro/)
  assert.match(shown, /便宜约 75%/)
  assert.equal(note.props.title, '若打开成本感知路由，本步会选哪个模型（仅记录，不影响当前路由）')
})

test('the shadow line follows agreement, the enabled flag and the chat language', async () => {
  // A cost-aware router has nothing to shadow: it reports that it is on.
  const on = await openControl({ state: costState({ enabled: true, entries: [], shadow: null }) })
  openPanel(on.holder)
  await on.rt.flush()
  assert.equal(textOf(byProp(on.holder.tree, 'data-mr-shadow', 'true')[0]), '成本影子 (on)')

  // Agreement names one model and claims no saving.
  const agree = await openControl({
    state: costState({
      enabled: false,
      entries: [],
      shadow: { candidate: 'deepseek-official/deepseek-flash', current: 'deepseek-official/deepseek-flash', agree: true, savedRatio: 0 },
    }),
  })
  openPanel(agree.holder)
  await agree.rt.flush()
  assert.equal(
    textOf(byProp(agree.holder.tree, 'data-mr-shadow', 'true')[0]),
    '成本影子 (off) · 成本路由也选 deepseek-official/deepseek-flash',
  )

  const en = await openControl({
    state: costState({
      enabled: false,
      entries: [],
      shadow: { candidate: 'b/flash', current: 'a/pro', agree: false, savedRatio: 0.5 },
    }),
    globals: { navigator: { language: 'en-US' } },
  })
  openPanel(en.holder)
  await en.rt.flush()
  assert.equal(
    textOf(byProp(en.holder.tree, 'data-mr-shadow', 'true')[0]),
    'cost shadow (off) · cost routing would pick b/flash over a/pro · ~50% cheaper',
  )

  // A host that predates cost awareness renders nothing at all.
  const legacy = await openControl({ state: { effectiveControl: 'full', engaged: true, current: null, pool: [], decisions: [] } })
  openPanel(legacy.holder)
  await legacy.rt.flush()
  assert.equal(byProp(legacy.holder.tree, 'data-mr-shadow', 'true').length, 0)
})


/** A state carrying the 0.16.1 spend guard, peak window and channel health. */
function spendState(overrides = {}) {
  return Object.assign(catalogState([]), {
    budget: {
      mode: 'block', softRatio: 0.8, exceeded: false, soft: true, over: [], ledgerAgeMs: 1200,
      rows: [{ id: 'sessionUsd', unit: 'usd', limit: 0.5, used: 0.42, ratio: 0.84, active: true, remaining: 0.08, soft: true, over: false }],
    },
    peak: { policy: 'inform', atPeak: true },
    channels: { enabled: true, coolingDown: [], quarantined: [], entries: [] },
  }, overrides)
}

test('the spend guard raises a near-budget dot and a bar inside the panel', async () => {
  const app = await openControl({ state: spendState() })
  const dot = byProp(app.holder.tree, 'data-budget', 'near')
  assert.equal(dot.length, 1, 'the closed trigger carries the near-budget dot')
  assert.match(dot[0].props.title, /^预算/)
  assert.match(dot[0].props.title, /本会话 \$0\.42 \/ \$0\.50/)

  openPanel(app.holder)
  await app.rt.flush()
  const block = byProp(app.holder.tree, 'data-mr-budget', 'true')[0]
  assert.ok(block, 'the panel lists the limits that are set')
  assert.equal(block.props['data-tone'], 'near')
  assert.equal(block.props['data-mode'], 'block')
  assert.equal(textOf(byProp(app.holder.tree, 'data-mr-budget-head', 'true')[0]), '预算 · 接近预算')

  const row = byProp(app.holder.tree, 'data-mr-budget-row', 'sessionUsd')[0]
  assert.match(textOf(row), /本会话/)
  assert.match(textOf(row), /\$0\.42 \/ \$0\.50/)
  assert.equal(byClass(row, 'mr-bar-fill')[0].props.style.width, '84%', 'the bar is the ratio of the limit')
})

test('an exhausted limit turns the block red and the dot with it', async () => {
  const app = await openControl({
    state: spendState({
      budget: {
        mode: 'block', softRatio: 0.8, exceeded: true, soft: true, over: ['sessionUsd'],
        rows: [{ id: 'sessionUsd', unit: 'usd', limit: 0.5, used: 0.52, ratio: 1.04, active: true, remaining: 0, soft: false, over: true }],
      },
    }),
  })
  assert.equal(byProp(app.holder.tree, 'data-budget', 'over').length, 1)

  openPanel(app.holder)
  await app.rt.flush()
  const block = byProp(app.holder.tree, 'data-mr-budget', 'true')[0]
  assert.equal(block.props['data-tone'], 'over')
  assert.equal(textOf(byProp(app.holder.tree, 'data-mr-budget-head', 'true')[0]), '预算 · 超预算')
  assert.equal(byClass(block, 'mr-bar-fill')[0].props.style.width, '100%', 'an overspent bar is clamped')
})

test('token limits render as counts and a zero limit is not a limit', async () => {
  const app = await openControl({
    state: spendState({
      budget: {
        mode: 'inform', softRatio: 0.8, exceeded: false, soft: false, over: [], rows: [
          { id: 'sessionTokens', unit: 'tokens', limit: 1000, used: 640.4, ratio: 0.64, active: true, remaining: 359.6, soft: false, over: false },
          { id: 'dayUsd', unit: 'usd', limit: 0, used: 0, ratio: 0, active: false, remaining: 0, soft: false, over: false },
        ],
      },
    }),
  })
  openPanel(app.holder)
  await app.rt.flush()
  const rows = byProp(app.holder.tree, 'data-mr-budget-row', 'sessionTokens')
  assert.equal(rows.length, 1)
  assert.match(textOf(rows[0]), /本会话 tokens/)
  assert.match(textOf(rows[0]), /640 \/ 1000/)
  assert.equal(byProp(app.holder.tree, 'data-mr-budget-row', 'dayUsd').length, 0)
  assert.equal(byProp(app.holder.tree, 'data-budget', 'near').length + byProp(app.holder.tree, 'data-budget', 'over').length, 0, 'a healthy spend keeps the trigger clean')
})

test('a host without spend limits renders neither dot nor block', async () => {
  const legacy = await openControl({ state: { effectiveControl: 'full', engaged: true, current: null, pool: [], decisions: [] } })
  openPanel(legacy.holder)
  await legacy.rt.flush()
  assert.equal(byProp(legacy.holder.tree, 'data-mr-budget', 'true').length, 0)

  const none = await openControl({ state: spendState({ budget: { mode: 'inform', softRatio: 0.8, rows: [] } }) })
  openPanel(none.holder)
  await none.rt.flush()
  assert.equal(byProp(none.holder.tree, 'data-mr-budget', 'true').length, 0, 'no active limit means no block')

  const odd = await openControl({ state: spendState({ budget: { mode: 'block' } }) })
  openPanel(odd.holder)
  await odd.rt.flush()
  assert.equal(byProp(odd.holder.tree, 'data-mr-budget', 'true').length, 0, 'a malformed block is ignored')
})

test('the peak window is announced under inform and shift, never when off or off-peak', async () => {
  const inform = await openControl({ state: spendState() })
  openPanel(inform.holder)
  await inform.rt.flush()
  assert.match(textOf(byProp(inform.holder.tree, 'data-mr-peak', 'true')[0]), /当前高峰时段，单价更高/)

  const shift = await openControl({ state: spendState({ peak: { policy: 'shift', atPeak: true } }) })
  openPanel(shift.holder)
  await shift.rt.flush()
  assert.match(textOf(byProp(shift.holder.tree, 'data-mr-peak', 'true')[0]), /空闲时段/)

  const offPeak = await openControl({ state: spendState({ peak: { policy: 'inform', atPeak: false } }) })
  openPanel(offPeak.holder)
  await offPeak.rt.flush()
  assert.equal(byProp(offPeak.holder.tree, 'data-mr-peak', 'true').length, 0)

  const off = await openControl({ state: spendState({ peak: { policy: 'off', atPeak: true } }) })
  openPanel(off.holder)
  await off.rt.flush()
  assert.equal(byProp(off.holder.tree, 'data-mr-peak', 'true').length, 0)
})

test('a benched channel is named on the panel in the chat language', async () => {
  const benched = {
    enabled: true,
    coolingDown: ['deepseek-official'],
    quarantined: [{ channel: 'relay-x' }],
    entries: [],
  }
  const zh = await openControl({ state: spendState({ channels: benched }) })
  openPanel(zh.holder)
  await zh.rt.flush()
  const note = byProp(zh.holder.tree, 'data-mr-channels', 'true')[0]
  assert.ok(note, 'the panel says which channel is out of rotation')
  assert.match(textOf(note), /渠道冷却中：deepseek-official/)
  assert.match(textOf(note), /渠道已隔离：relay-x/)

  const en = await openControl({ state: spendState({ channels: benched }), globals: { navigator: { language: 'en-US' } } })
  openPanel(en.holder)
  await en.rt.flush()
  assert.equal(
    textOf(byProp(en.holder.tree, 'data-mr-channels', 'true')[0]),
    'channel benched: deepseek-official · channel quarantined: relay-x',
  )

  // The fingerprint verifier speaks through the same line when it fails.
  const verified = await openControl({
    state: spendState({
      channels: { enabled: true, coolingDown: [], quarantined: [], entries: [] },
      lastVerify: { ok: false, channel: 'relay-y', reasons: ['usage_missing'] },
    }),
  })
  openPanel(verified.holder)
  await verified.rt.flush()
  assert.match(textOf(byProp(verified.holder.tree, 'data-mr-channels', 'true')[0]), /渠道冷却中：relay-y/)

  const quiet = await openControl({ state: spendState({ channels: { enabled: false, coolingDown: [], quarantined: [], entries: [] } }) })
  openPanel(quiet.holder)
  await quiet.rt.flush()
  assert.equal(byProp(quiet.holder.tree, 'data-mr-channels', 'true').length, 0)
})

/** A state carrying the v0.17.0 effort-mapping report the router now serves. */
function effortState(last) {
  return Object.assign(catalogState([]), {
    effort: { ladder: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], points: { high: 75 }, last: last || null },
  })
}

test('a tier the model cannot take verbatim is explained on the panel', async () => {
  const alias = await openControl({ state: effortState({ from: 'medium', to: 'high', why: 'alias' }) })
  openPanel(alias.holder)
  await alias.rt.flush()
  const note = byProp(alias.holder.tree, 'data-mr-effort', 'true')[0]
  assert.ok(note, 'the panel explains the collapse')
  assert.equal(textOf(note), '思考等级 medium \u2192 high（别名）')
  assert.match(note.props.title, /再按目标模型的真实词表映射/)
  assert.equal(byProp(alias.holder.tree, 'data-mr-effort', 'true').length, 1)

  const nearest = await openControl({ state: effortState({ from: 'high', to: 'max', why: 'nearest' }) })
  openPanel(nearest.holder)
  await nearest.rt.flush()
  assert.equal(textOf(byProp(nearest.holder.tree, 'data-mr-effort', 'true')[0]), '思考等级 high \u2192 max（就近取档）')

  const none = await openControl({ state: effortState({ from: 'high', to: null, why: 'none' }) })
  openPanel(none.holder)
  await none.rt.flush()
  assert.equal(textOf(byProp(none.holder.tree, 'data-mr-effort', 'true')[0]), '思考等级 high \u2192 -（该模型不接思考等级）')
})

test('an exact mapping, a missing report and the chat language', async () => {
  const exact = await openControl({ state: effortState({ from: 'low', to: 'low', why: 'exact' }) })
  openPanel(exact.holder)
  await exact.rt.flush()
  assert.equal(byProp(exact.holder.tree, 'data-mr-effort', 'true').length, 0, 'a verbatim tier needs no note')

  const legacy = await openControl({ state: catalogState([]) })
  openPanel(legacy.holder)
  await legacy.rt.flush()
  assert.equal(byProp(legacy.holder.tree, 'data-mr-effort', 'true').length, 0, 'an older host renders nothing')

  const broken = await openControl({ state: Object.assign(catalogState([]), { effort: { last: 'nope' } }) })
  openPanel(broken.holder)
  await broken.rt.flush()
  assert.equal(byProp(broken.holder.tree, 'data-mr-effort', 'true').length, 0, 'a malformed report is ignored')

  const en = await openControl({ state: effortState({ from: 'medium', to: 'high', why: 'alias' }), globals: { navigator: { language: 'en-US' } } })
  openPanel(en.holder)
  await en.rt.flush()
  assert.equal(textOf(byProp(en.holder.tree, 'data-mr-effort', 'true')[0]), 'effort medium \u2192 high (alias)')
})

// --- Route feedback, exploration and the classifier (v0.17.1) -----------------------

/** A router state carrying the feedback report, on top of the catalog baseline. */
function feedbackState(overrides = {}) {
  return Object.assign(catalogState([]), {
    feedback: Object.assign({
      enabled: true,
      labels: ['too-expensive', 'too-weak', 'just-right'],
      written: 1,
      lastError: null,
      last: { at: 1, label: 'too-expensive', provider: 'deepseek-official', model: 'deepseek-v4-pro', effort: 'high', stepClass: 'standard', outcome: null },
      pending: true,
    }, overrides),
  })
}

/** A router state carrying an exploration report. */
function experimentState(last, config = {}) {
  return Object.assign(catalogState([]), {
    experiments: Object.assign({ enabled: true, apply: false, epsilon: 0.1, seed: 3, last }, config),
  })
}

/** A router state carrying a classifier report. */
function classifierState(overrides = {}) {
  return Object.assign(catalogState([]), {
    classifier: Object.assign({ enabled: true, minConfidence: 0.6, escalate: false, confidence: null, breaker: { fails: 0, open: false, openUntil: null } }, overrides),
  })
}

test('the feedback labels post the verdict for the route on screen', async () => {
  const app = await openControl({ state: feedbackState() })
  openPanel(app.holder)
  await app.rt.flush()

  const buttons = byProp(app.holder.tree, 'data-mr-feedback', 'true')[0]
  assert.ok(buttons, 'the panel carries the feedback row')
  const labels = byProp(app.holder.tree, 'data-feedback-label', 'too-expensive')
  const all = findAll(app.holder.tree, (node) => node.props && node.props['data-feedback-label'])
  assert.deepEqual(all.map((node) => node.props['data-feedback-label']), ['too-expensive', 'too-weak', 'just-right'])
  assert.deepEqual(all.map(textOf), ['太贵', '太弱', '正好'])
  assert.equal(labels[0].props['data-active'], 'true', 'the label already recorded is marked')
  assert.equal(textOf(byProp(app.holder.tree, 'data-mr-feedback-note', 'true')[0]), '太贵 · 等下一步验证')

  all[1].props.onClick()
  await app.rt.flush()
  assert.deepEqual(plain(app.net.posts('/model-router/feedback').pop().body), { sessionId: 'session-1', label: 'too-weak' })
})

test('the feedback row follows the chat language and reports what the next step did', async () => {
  const app = await openControl({
    state: feedbackState({ last: { at: 2, label: 'just-right', provider: 'deepseek-official', model: 'deepseek-flash', effort: 'low', stepClass: 'standard', outcome: 'moved' } }),
    globals: { navigator: { language: 'en-US' } },
  })
  openPanel(app.holder)
  await app.rt.flush()
  const all = findAll(app.holder.tree, (node) => node.props && node.props['data-feedback-label'])
  assert.deepEqual(all.map(textOf), ['too expensive', 'too weak', 'just right'])
  assert.equal(all[2].props['data-active'], 'true')
  assert.equal(textOf(byProp(app.holder.tree, 'data-mr-feedback-note', 'true')[0]), 'just right · the next step moved to another route')
})

test('a host without the feedback report renders no label row', async () => {
  const legacy = await openControl({ state: { effectiveControl: 'full', engaged: true, current: null, pool: [], decisions: [] } })
  openPanel(legacy.holder)
  await legacy.rt.flush()
  assert.equal(byProp(legacy.holder.tree, 'data-mr-feedback', 'true').length, 0, 'an older host has no labels to show')

  const broken = await openControl({ state: Object.assign(catalogState([]), { feedback: { labels: 'nope' } }) })
  openPanel(broken.holder)
  await broken.rt.flush()
  assert.equal(byProp(broken.holder.tree, 'data-mr-feedback', 'true').length, 0, 'a malformed report is ignored')
})

test('the exploration draw is named, and only a shadow leaves the route alone', async () => {
  const shadow = await openControl({ state: experimentState({ allowed: true, explore: true, applied: false, arm: 'deepseek-official/deepseek-v4-pro' }) })
  openPanel(shadow.holder)
  await shadow.rt.flush()
  assert.equal(textOf(byProp(shadow.holder.tree, 'data-mr-experiment', 'true')[0]), '探索影子：抽到 deepseek-official/deepseek-v4-pro，未改路由')

  const applied = await openControl({ state: experimentState({ allowed: true, explore: true, applied: true, arm: 'deepseek-official/deepseek-v4-pro' }) })
  openPanel(applied.holder)
  await applied.rt.flush()
  assert.equal(textOf(byProp(applied.holder.tree, 'data-mr-experiment', 'true')[0]), '探索实验：这一步试了 deepseek-official/deepseek-v4-pro')

  const exploit = await openControl({ state: experimentState({ allowed: true, explore: false, applied: false, arm: 'deepseek-official/deepseek-v4-pro' }) })
  openPanel(exploit.holder)
  await exploit.rt.flush()
  assert.equal(byProp(exploit.holder.tree, 'data-mr-experiment', 'true').length, 0, 'an exploit draw is not news')

  const none = await openControl({ state: Object.assign(catalogState([]), { experiments: { enabled: true, apply: false, epsilon: 0.1, seed: null, last: null } }) })
  openPanel(none.holder)
  await none.rt.flush()
  assert.equal(byProp(none.holder.tree, 'data-mr-experiment', 'true').length, 0)

  const en = await openControl({ state: experimentState({ allowed: true, explore: true, applied: true, arm: 'deepseek-official/deepseek-flash' }), globals: { navigator: { language: 'en-US' } } })
  openPanel(en.holder)
  await en.rt.flush()
  assert.equal(textOf(byProp(en.holder.tree, 'data-mr-experiment', 'true')[0]), 'experiment: this step tried deepseek-official/deepseek-flash')
})

test('a raised tier for lack of confidence, and an open breaker, are said out loud', async () => {
  const raised = await openControl({ state: classifierState({ escalate: true, confidence: 0.42 }) })
  openPanel(raised.holder)
  await raised.rt.flush()
  assert.equal(textOf(byProp(raised.holder.tree, 'data-mr-classifier', 'true')[0]), '分类器低置信（0.42）已上调一档')

  const open = await openControl({ state: classifierState({ escalate: true, confidence: 0.42, breaker: { fails: 3, open: true, openUntil: 99, openForMs: 10, cooldownMs: 600000, opens: 1 } }) })
  openPanel(open.holder)
  await open.rt.flush()
  assert.equal(textOf(byProp(open.holder.tree, 'data-mr-classifier', 'true')[0]), '分类器连续失败，暂时只用规则', 'the breaker outranks the last escalation')

  const quiet = await openControl({ state: classifierState({ confidence: 0.91 }) })
  openPanel(quiet.holder)
  await quiet.rt.flush()
  assert.equal(byProp(quiet.holder.tree, 'data-mr-classifier', 'true').length, 0)

  const legacy = await openControl({ state: catalogState([]) })
  openPanel(legacy.holder)
  await legacy.rt.flush()
  assert.equal(byProp(legacy.holder.tree, 'data-mr-classifier', 'true').length, 0)
})
