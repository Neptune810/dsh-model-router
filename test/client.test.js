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

function loadBundle() {
  let registered
  const window = { __ModuleLoader__: { load: (row) => { registered = row } } }
  runInNewContext(SOURCE, { window, console, Symbol })
  assert.ok(registered, 'the bundle must register through window.__ModuleLoader__.load')
  const react = reactStub()
  const reactDom = { createPortal: (children) => children }
  const exports = registered.factory((spec) => {
    if (spec === 'react') return react
    if (spec === 'react-dom') return reactDom
    throw new Error('unexpected require: ' + spec)
  })
  return { id: registered.id, exports, react }
}

test('the bundle registers under the package id and exports a client plugin', () => {
  const { id, exports } = loadBundle()
  assert.equal(id, '@neptune810/dsh-model-router')
  assert.equal(exports.name, 'model-router')
  assert.deepEqual([...exports.inject], ['slots'])
  assert.equal(typeof exports.apply, 'function')
})

test('apply contributes into the composer slot left of the model seat', () => {
  const { exports } = loadBundle()
  const injections = []
  const registrations = []
  const slots = {
    inject: (name, callback) => { injections.push(name); return callback() },
    register: (descriptor, component) => { registrations.push({ descriptor, component }); return () => {} },
  }
  const modelDirectories = {
    directoryFor: () => ({
      store: { subscribe: () => () => {}, getSnapshot: () => ({ groups: [], status: 'idle' }) },
      load: async () => ({ groups: [] }),
    }),
  }
  const ctx = {
    slots,
    inject: (deps, callback) => callback({ slots, modelDirectories }),
  }
  exports.apply(ctx)
  assert.deepEqual(injections, ['conversation.input.right'])
  assert.equal(registrations.length, 1)
  const { descriptor, component } = registrations[0]
  assert.equal(descriptor.name, 'conversation.input.right')
  assert.equal(descriptor.id, 'model-router:composer-control')
  assert.equal(descriptor.registrant, 'dsh-model-router')
  assert.ok(Number.isFinite(descriptor.order))
  const face = descriptor.inject('session-1')
  assert.equal(face.sessionId, 'session-1')
  assert.equal(typeof face.loadCatalog === 'function' || face.loadCatalog === undefined, true)
  assert.equal(typeof component, 'function')
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
