/**
 * Route-layer tests: the panel's HTTP surface is same-origin on reads too, and
 * every mutation carries the per-process panel token. These are the checks that
 * keep a cross-site page from reading the routing plan or steering it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { isSameOrigin, mountRoutes } from '../lib/routes.js'

const BASE = '/model-router'

/** A web server that just records the handlers mountRoutes registers. */
function boot(api) {
  const handlers = new Map()
  const server = {
    register({ path, handler }) {
      handlers.set(path, handler)
      return () => { handlers.delete(path) }
    },
  }
  const dispose = mountRoutes(server, api)
  return { handlers, dispose }
}

/** A fake req/res pair: enough for readJson and sendJson. */
async function invoke(handlers, path, { method = 'GET', headers = {}, body } = {}) {
  const handler = handlers.get(path.split('?')[0])
  assert.ok(handler, 'route is registered: ' + path)
  const req = new EventEmitter()
  req.method = method
  req.url = path
  req.headers = headers
  req.destroy = () => {}
  const res = {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, next) { this.status = status; this.headers = next },
    end(text) { this.body = text },
  }
  const payload = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  queueMicrotask(() => {
    if (payload !== undefined) req.emit('data', Buffer.from(payload))
    req.emit('end')
  })
  await handler(req, res)
  return { status: res.status, headers: res.headers, json: res.body ? JSON.parse(res.body) : null }
}

function fakeApi(overrides) {
  const calls = { state: 0, pool: 0 }
  const api = {
    clientToken: 'panel-token',
    state() {
      calls.state += 1
      return {
        ok: true,
        sessions: [],
        // Forward slashes so the fixture means the same path on Windows and Linux.
        stateFile: '/home/someone/.dsh/profiles/web/.model-router/state.json',
        prices: { levels: [1, 4, 8], remote: null, file: '/home/someone/.dsh/profiles/web/.model-router/state.json' },
      }
    },
    setPool() { calls.pool += 1; return { ok: true } },
  }
  return { api: Object.assign(api, overrides || {}), calls }
}

test('GET /state rejects a cross-site request', async () => {
  const { api } = fakeApi()
  const { handlers } = boot(api)
  const { status, json } = await invoke(handlers, BASE + '/state', {
    headers: { host: '127.0.0.1:49833', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(status, 403)
  assert.equal(json.error, 'same-origin only')
})

test('POST /pool rejects a request without the panel token', async () => {
  const { api, calls } = fakeApi()
  const { handlers } = boot(api)
  const refused = await invoke(handlers, BASE + '/pool', {
    method: 'POST',
    headers: { host: '127.0.0.1:49833', 'sec-fetch-site': 'same-origin' },
    body: {},
  })
  assert.equal(refused.status, 403)
  assert.equal(refused.json.error, 'missing or stale panel token')
  assert.equal(calls.pool, 0)

  const accepted = await invoke(handlers, BASE + '/pool', {
    method: 'POST',
    headers: { host: '127.0.0.1:49833', 'sec-fetch-site': 'same-origin', 'x-model-router-token': 'panel-token' },
    body: {},
  })
  assert.equal(accepted.status, 200)
  assert.equal(calls.pool, 1)
})

test('a state read redacts the absolute state file path and hands out the token', async () => {
  const { api } = fakeApi()
  const { handlers } = boot(api)
  const { status, json } = await invoke(handlers, BASE + '/state', {
    headers: { host: '127.0.0.1:49833', 'sec-fetch-site': 'same-origin' },
  })
  assert.equal(status, 200)
  assert.equal(json.stateFile, 'state.json')
  assert.equal(json.prices.file, 'state.json')
  assert.equal(json.clientToken, 'panel-token')
})

test('desktop-style request without origin headers is accepted', async () => {
  // The Desktop build's proxy strips origin/host/sec-fetch-site before forwarding.
  const { api, calls } = fakeApi()
  const { handlers } = boot(api)
  const state = await invoke(handlers, BASE + '/state')
  assert.equal(state.status, 200)
  assert.equal(state.json.clientToken, 'panel-token')

  const post = await invoke(handlers, BASE + '/pool', {
    method: 'POST',
    headers: { 'x-model-router-token': 'panel-token' },
    body: {},
  })
  assert.equal(post.status, 200)
  assert.equal(calls.pool, 1)
})

test('a matching Origin is accepted and a foreign one is refused', async () => {
  const { api } = fakeApi()
  const { handlers } = boot(api)
  const same = await invoke(handlers, BASE + '/state', {
    headers: { host: '127.0.0.1:49833', origin: 'http://127.0.0.1:49833', 'sec-fetch-site': 'same-origin' },
  })
  assert.equal(same.status, 200)
  const foreign = await invoke(handlers, BASE + '/state', {
    headers: { host: '127.0.0.1:49833', origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' },
  })
  assert.equal(foreign.status, 403)
})

test('DSH_MODEL_ROUTER_NO_TOKEN disables the token but not the origin check', async () => {
  const { api, calls } = fakeApi({ clientToken: null })
  const { handlers } = boot(api)
  const post = await invoke(handlers, BASE + '/pool', {
    method: 'POST',
    headers: { host: '127.0.0.1:49833', 'sec-fetch-site': 'same-origin' },
    body: {},
  })
  assert.equal(post.status, 200)
  assert.equal(calls.pool, 1)
  const state = await invoke(handlers, BASE + '/state', {
    headers: { host: '127.0.0.1:49833', 'sec-fetch-site': 'same-origin' },
  })
  assert.equal(state.json.clientToken, undefined)
  const cross = await invoke(handlers, BASE + '/state', {
    headers: { host: '127.0.0.1:49833', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(cross.status, 403)
})

test('GET /state carries an ETag and a matching If-None-Match gets a bodyless 304', async () => {
  let revision = 1
  const { api } = fakeApi({ state() { return { ok: true, sessions: [], revision } } })
  const { handlers } = boot(api)
  const headers = { host: '127.0.0.1:49833', 'sec-fetch-site': 'same-origin' }
  const first = await invoke(handlers, BASE + '/state', { headers })
  assert.equal(first.status, 200)
  assert.match(String(first.headers.etag), /^W\/"[0-9a-f]{16}"$/)
  const second = await invoke(handlers, BASE + '/state', { headers: { ...headers, 'if-none-match': first.headers.etag } })
  assert.equal(second.status, 304)
  assert.equal(second.json, null)
  assert.equal(second.headers.etag, first.headers.etag)
  revision = 2
  const third = await invoke(handlers, BASE + '/state', { headers: { ...headers, 'if-none-match': first.headers.etag } })
  assert.equal(third.status, 200)
  assert.equal(third.json.revision, 2)
  assert.notEqual(third.headers.etag, first.headers.etag)
})

test('DSH_MODEL_ROUTER_NO_ETAG disables the state validator but not the route', async () => {
  process.env.DSH_MODEL_ROUTER_NO_ETAG = '1'
  try {
    const { api } = fakeApi()
    const { handlers } = boot(api)
    const headers = { host: '127.0.0.1:49833', 'sec-fetch-site': 'same-origin' }
    const first = await invoke(handlers, BASE + '/state', { headers })
    assert.equal(first.status, 200)
    assert.equal(first.headers.etag, undefined)
    const second = await invoke(handlers, BASE + '/state', { headers: { ...headers, 'if-none-match': 'W/"stale"' } })
    assert.equal(second.status, 200)
    assert.equal(second.json.ok, true)
  } finally {
    delete process.env.DSH_MODEL_ROUTER_NO_ETAG
  }
})

test('GET /stats forwards the window to the host aggregator', async () => {
  let seen
  const { api } = fakeApi({
    stats(query) {
      seen = query
      return { ok: true, window: { since: 1, until: 2, steps: 0 }, byClass: [], byModel: [], byEffort: [], totals: {} }
    },
  })
  const { handlers } = boot(api)
  const res = await invoke(handlers, BASE + '/stats?since=2026-11-01&until=2026-11-02&limit=10', {
    headers: { host: '127.0.0.1:49833', 'sec-fetch-site': 'same-origin' },
  })
  assert.equal(res.status, 200)
  assert.deepEqual(seen, { since: '2026-11-01', until: '2026-11-02', limit: '10' })
  assert.equal(res.json.ok, true)
  const empty = await invoke(handlers, BASE + '/stats', {
    headers: { host: '127.0.0.1:49833', 'sec-fetch-site': 'same-origin' },
  })
  assert.equal(empty.status, 200)
  assert.deepEqual(seen, { since: undefined, until: undefined, limit: undefined })
})

test('isSameOrigin keeps allowing a present-but-missing proxied header set', () => {
  assert.equal(isSameOrigin({ headers: {} }), true)
  assert.equal(isSameOrigin({ headers: { 'sec-fetch-site': 'same-origin' } }), true)
  assert.equal(isSameOrigin({ headers: { 'sec-fetch-site': 'cross-site' } }), false)
  assert.equal(isSameOrigin({ headers: { origin: 'null' } }), false)
})
