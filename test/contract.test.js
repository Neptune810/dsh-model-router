/**
 * Contract tests for 1.0.0.
 *
 * Three things can silently rot in a plugin like this: the documented HTTP surface drifts away from the
 * registered routes, the documented host events drift away from the ones the plugin listens to, and the
 * published entry points stop resolving. Each of those is a promise to somebody outside this repository, so
 * each one gets a test that fails on the drift rather than on the symptom.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mountRoutes } from '../lib/routes.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const read = (name) => readFileSync(join(root, name), 'utf8')
const pkg = JSON.parse(read('package.json'))

/** A host web server that only records what mountRoutes registers. */
function boot(api) {
  const handlers = new Map()
  const server = { register({ path, handler }) { handlers.set(path, handler); return () => handlers.delete(path) } }
  mountRoutes(server, api)
  return handlers
}

/** Any api callback answers { ok: true }; the contract under test is the transport, not the routing. */
function stubApi(extra) {
  return new Proxy(Object.assign({ clientToken: 'panel-token' }, extra || {}), {
    get(target, key) {
      if (key in target) return target[key]
      if (typeof key !== 'string') return undefined
      return () => ({ ok: true })
    },
  })
}

async function invoke(handlers, path, { method = 'GET', headers = {}, body } = {}) {
  const handler = handlers.get(path)
  assert.ok(handler, 'route is registered: ' + path)
  const req = new EventEmitter()
  req.method = method
  req.url = path
  req.headers = Object.assign({ host: '127.0.0.1:49833', 'sec-fetch-site': 'same-origin' }, headers)
  req.destroy = () => {}
  const res = {
    status: 0, headers: {}, body: null,
    writeHead(status, next) { this.status = status; this.headers = next },
    end(text) { this.body = text },
  }
  const payload = body === undefined ? undefined : JSON.stringify(body)
  queueMicrotask(() => {
    if (payload !== undefined) req.emit('data', Buffer.from(payload))
    req.emit('end')
  })
  await handler(req, res)
  return { status: res.status, headers: res.headers, json: res.body ? JSON.parse(res.body) : null }
}

const TOKEN = { 'x-model-router-token': 'panel-token' }

test('every response states the contract version, errors included', async () => {
  const handlers = boot(stubApi())
  const state = await invoke(handlers, '/model-router/state')
  assert.equal(state.status, 200)
  assert.equal(state.json.schemaVersion, 1)
  assert.equal(typeof state.headers.etag, 'string', '/state still carries its validator')

  const ok = await invoke(handlers, '/model-router/pool', { method: 'POST', headers: TOKEN, body: {} })
  assert.equal(ok.json.schemaVersion, 1, 'a mutation answers with the version too')

  const refused = await invoke(handlers, '/model-router/pool', { method: 'POST', body: {} })
  assert.equal(refused.status, 403)
  assert.equal(refused.json.schemaVersion, 1, 'a refusal is still a host of some version')

  const wrongMethod = await invoke(handlers, '/model-router/pool', { method: 'GET' })
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.json.schemaVersion, 1)
})

test('the documented routes are exactly the registered ones', async () => {
  const handlers = boot(stubApi())
  const doc = read('docs/api.md')
  const documented = [...doc.matchAll(/^\| (GET|POST) \| (\/model-router\/[a-z/-]+) \|/gm)].map((m) => ({
    method: m[1],
    path: m[2],
  }))
  assert.ok(documented.length >= 15, 'docs/api.md documents the whole surface')
  const seen = new Set()
  for (const route of documented) {
    seen.add(route.path)
    const answer = route.method === 'GET'
      ? await invoke(handlers, route.path)
      : await invoke(handlers, route.path, { method: 'POST', headers: TOKEN, body: {} })
    assert.notEqual(answer.status, 405, route.method + ' ' + route.path + ' is documented but registered with another method')
  }
  const registered = [...handlers.keys()]
  assert.deepEqual(registered.filter((path) => !seen.has(path)), [], 'every registered route is documented')
})

test('every host event the plugin listens to is in the compatibility table', () => {
  const source = read('lib/index.js')
  const events = [...new Set([...source.matchAll(/ctx\.on\('(agent\/[a-z/-]+)'/g)].map((m) => m[1]))]
  assert.ok(events.includes('agent/request'), 'the routing hook is the one the plugin exists for')
  const doc = read('docs/compat.md')
  for (const event of events) {
    assert.ok(doc.includes(event), 'docs/compat.md must document ' + event)
  }
})

test('every published entry point resolves and ships', () => {
  const files = pkg.files
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (subpath === './package.json') continue
    assert.ok(existsSync(join(root, target)), 'export ' + subpath + ' points at a file that exists: ' + target)
    const top = target.replace(/^\.\//, '').split('/')[0]
    assert.ok(files.includes(top + '/'), 'export ' + subpath + ' is inside a published directory (' + top + '/)')
  }
})

test('the package declares the host it supports and never peers on it', () => {
  assert.match(pkg.engines.node, /^>=20/)
  assert.match(pkg.engines.dsh, /^>=0\.1\.7-rc\.2/)
  assert.equal(pkg.peerDependencies, undefined, 'a peer on @deepseek-ai/* makes the host silently skip the package')
})

test('the 1.0 documentation set is present', () => {
  for (const name of ['docs/api.md', 'docs/compat.md', 'docs/migration-0.14-to-1.0.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PUBLISHING.md']) {
    assert.ok(existsSync(join(root, name)), name + ' exists')
    assert.ok(read(name).length > 400, name + ' has something to say')
  }
})

test('the compat note exists in both panel languages', () => {
  const client = readFileSync(join(root, 'client', 'client.js'), 'utf8')
  assert.equal((client.match(/compatLabel:/g) || []).length, 2, 'one label per language')
  assert.ok(client.includes('data-mr-compat'), 'the panel renders the note it documents')
})
