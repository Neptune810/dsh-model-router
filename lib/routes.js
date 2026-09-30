/**
 * dsh-model-router — host HTTP routes for the composer UI.
 *
 * The browser half is a client plugin with no RPC surface of its own, so it
 * talks to the host over same-origin HTTP, the pattern dsh-market uses. Reads
 * are GET; every mutation is a POST whose Origin, when it has one, must match
 * the request's Host, so a cross-site page cannot steer routing.
 */
import { CONTROL_SCOPES } from './routing.js'

const PREFIX = '/model-router'
const MAX_BODY = 64 * 1024

function sendJson(res, status, body) {
  const text = JSON.stringify(body === undefined ? null : body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) { resolve(undefined); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('error', () => resolve(undefined))
    req.on('end', () => {
      if (size === 0) { resolve({}); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (_badJson) { resolve(undefined) }
    })
  })
}

/**
 * Whether a mutating request came from the page itself — required on every POST.
 *
 * A MISSING Origin is allowed (#648). The check exists to stop another web page
 * from driving this local API, and the Fetch spec has browsers send `Origin` on
 * every POST — same-origin ones included — so a request that arrives without it
 * did not come from a page at all. A non-browser client can set any Origin it
 * likes, so refusing the header's absence bought nothing while breaking a whole
 * supported host: the Desktop build's own proxy strips `origin`, `host`,
 * `cookie` and `sec-fetch-site` before forwarding to the in-process server and
 * injects a cookie only that server can sign. Requiring the header answered every
 * mutating request from the Desktop build with 403 `same-origin only`, which
 * left the panel's controls dead — they all POST.
 *
 * What remains: a caller that states `sec-fetch-site: cross-site` is refused,
 * as is a present Origin that is not the request's Host. That also covers
 * `Origin: null` (a sandboxed frame, a `data:` document) and an empty Origin,
 * because those are present-but-unparseable rather than absent — only absence is
 * what a stripping proxy produces.
 *
 * The Host header is not re-checked here: the host API's own trust fence already
 * requires a loopback (or explicitly trusted) authority, and this route runs
 * behind it.
 */
export function isSameOrigin(req) {
  const host = req.headers.host
  const site = req.headers['sec-fetch-site']
  const origin = req.headers.origin
  if (site !== undefined && site !== 'same-origin') return false
  if (origin === undefined) return true
  try { return new URL(origin).host === host } catch (_badOrigin) { return false }
}

/** One route definition per action, invoked from the entry handler. */
export function routeTable(api) {
  return [
    { path: PREFIX + '/state', method: 'GET', run: (query) => api.state(query.get('sessionId') || undefined) },
    { path: PREFIX + '/catalog', method: 'GET', run: () => api.catalog() },
    {
      path: PREFIX + '/control', method: 'POST',
      run: (query, body) => CONTROL_SCOPES.includes(body.control) || body.control === null
        ? api.setControl(body.sessionId, body.control)
        : { ok: false, error: 'control must be full, effort, model or null' },
    },
    { path: PREFIX + '/resume', method: 'POST', run: (query, body) => api.resume(body.sessionId) },
    { path: PREFIX + '/task-type', method: 'POST', run: (query, body) => api.setTaskType(body.sessionId, typeof body.preset === 'string' ? body.preset : null) },
    { path: PREFIX + '/pool', method: 'POST', run: (query, body) => api.setPool(body.pool) },
    { path: PREFIX + '/presets', method: 'POST', run: (query, body) => api.setPresets(body.presets) },
    { path: PREFIX + '/settings', method: 'POST', run: (query, body) => api.setSettings(body.settings) },
  ]
}

/**
 * Register every route on the host web server.
 * @param server - the acquired webServer service.
 * @param api - host callbacks; see plugin index.
 * @returns a disposer removing every route.
 */
export function mountRoutes(server, api) {
  const disposers = []
  for (const route of routeTable(api)) {
    const handler = async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        if (req.method !== route.method) { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        if (route.method !== 'GET' && !isSameOrigin(req)) { sendJson(res, 403, { ok: false, error: 'same-origin only' }); return }
        const body = route.method === 'POST' ? await readJson(req) : {}
        if (body === undefined) { sendJson(res, 400, { ok: false, error: 'invalid JSON body' }); return }
        const result = await route.run(url.searchParams, body)
        sendJson(res, result && result.ok === false ? 400 : 200, result === undefined ? { ok: true } : result)
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    }
    disposers.push(server.register({ kind: 'exact', path: route.path, handler }))
  }
  return () => { for (const dispose of disposers) { try { dispose() } catch (_alreadyGone) { /* ignore */ } } }
}
