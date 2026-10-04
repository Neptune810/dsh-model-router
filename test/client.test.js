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
 * Interactive React stand-in: state survives re-renders (a click handler from an
 * older tree still updates the tree we assert on), effects run once after mount.
 * Every draw is synchronous, so a click can be inspected immediately.
 */
function createRuntime() {
  const states = []
  const mountEffects = []
  let cursor = 0
  let rendering = false
  let draw = null
  let phase = 'mount'
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
    useEffect: (fn) => { if (phase === 'mount') mountEffects.push(fn) },
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  }
  const flush = async (ticks = 40) => { for (let i = 0; i < ticks; i += 1) await Promise.resolve() }
  const mount = async (component, props) => {
    const holder = { tree: null, renders: 0 }
    draw = () => {
      if (rendering) return
      rendering = true
      cursor = 0
      holder.tree = component(props)
      holder.renders += 1
      rendering = false
    }
    draw()
    phase = 'steady'
    for (const effect of mountEffects.splice(0)) effect()
    await flush()
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

/** fetch double: records every request and answers from a path -> payload map. */
function fetchStub(answer) {
  const calls = []
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET'
    const body = options && options.body ? JSON.parse(options.body) : undefined
    const record = { url: String(url), path: String(url).split('?')[0], method, body }
    calls.push(record)
    const payload = answer ? answer(record) : {}
    if (payload && payload.__status) return { ok: false, status: payload.__status, json: async () => ({ error: payload.error }) }
    return { ok: true, status: 200, json: async () => (payload === undefined ? {} : payload) }
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
    if (record.path === '/model-router/state') return options.state || {}
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
  assert.ok(armed.ms <= 1000, 'the poll is short enough to read as live: ' + armed.ms)
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
