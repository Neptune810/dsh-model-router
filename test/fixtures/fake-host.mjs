#!/usr/bin/env node
/**
 * Fake model-router host for test/smoke.test.js.
 *
 * A separate process (not an in-process server) because the smoke test is run
 * with spawnSync, which blocks the test's event loop and would dead-lock an
 * in-process HTTP server.
 *
 * Usage: FAKE_HOST_SERVE=1 node test/fixtures/fake-host.mjs <mode>
 *   PORT=0 prints {"port":N} on stdout once listening.
 *
 * The FAKE_HOST_SERVE guard is load-bearing: Node's test runner treats every
 * *.mjs under a test/ directory as a test file, so a bare `node --test` would
 * execute this fixture and then wait forever on an HTTP server that nobody
 * stops. Without the flag the file is a no-op.
 *
 * Modes:
 *   healthy           full /state payload, token required on POST, 403 on mismatch
 *   no-token          /state has no clientToken (DSH_MODEL_ROUTER_NO_TOKEN=1); POST is open
 *   auth-refuse       every POST answers 403 {ok:false,error:"missing or stale panel token"}
 *   no-decisions      /state.decisions is missing
 *   open-control      /state has a clientToken but POST accepts any token (--check must FAIL)
 *   missing-route     every path answers 404 (simulates a host without this plugin build)
 */

import http from 'node:http'

const mode = process.argv[2] || 'healthy'
const port = Number(process.env.PORT || 0)
const PREFIX = '/model-router'

const state = {
  ok: true,
  control: 'full',
  effectiveControl: mode === 'no-token' ? 'effort' : 'full',
  engaged: true,
  disengageReason: '',
  sessions: ['session-smoke'],
  pool: [{ id: 'deepseek-flash', provider: 'deepseek', model: 'deepseek-flash', cost: 0, costSource: 'builtin', tier: 'cheap', tags: [] }],
  current: { scope: 'full', provider: 'deepseek', model: 'deepseek-flash', effort: 'low', stepClass: 'standard', score: 55, preset: null, reason: 'standard step -> flash', signals: {} },
  decisions: [
    { turn: 1, step: 1, provider: 'deepseek', model: 'deepseek-flash', effort: 'low', stepClass: 'standard', score: 55, reason: 'standard step -> flash' },
    { turn: 1, step: 2, provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high', stepClass: 'engineering', score: 78, reason: 'escalated on evidence' },
    { turn: 2, step: 1, provider: 'qiyue', model: 'glm-5', effort: 'off', stepClass: 'trivial', score: 12, reason: 'trivial step' },
  ],
}
if (mode === 'no-token') delete state.clientToken
else state.clientToken = 'panel-token-' + 'x'.repeat(24)
if (mode === 'no-decisions') delete state.decisions

function reply(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  response.end(text)
}

const server = http.createServer((request, response) => {
  request.resume()
  if (mode === 'missing-route') return reply(response, 404, { ok: false, error: 'not found' })
  const url = new URL(request.url, 'http://127.0.0.1')
  if (!url.pathname.startsWith(PREFIX)) return reply(response, 404, { ok: false, error: 'not found' })
  const path = url.pathname.slice(PREFIX.length)
  if (request.method === 'GET' && path === '/state') return reply(response, 200, state)
  if (request.method !== 'POST') return reply(response, 405, { ok: false, error: 'method not allowed' })

  if (path === '/control') {
    if (mode === 'auth-refuse') return reply(response, 403, { ok: false, error: 'missing or stale panel token' })
    if (mode !== 'no-token' && mode !== 'open-control') {
      const token = request.headers['x-model-router-token']
      if (token !== state.clientToken) return reply(response, 403, { ok: false, error: 'missing or stale panel token' })
    }
    return collect(request, (body) => {
      if (body && typeof body.control === 'string') {
        state.control = body.control
        state.effectiveControl = body.control
      }
      reply(response, 200, { ok: true, control: state.control, effectiveControl: state.effectiveControl })
    })
  }
  if (path === '/resume') {
    if (mode !== 'no-token') {
      const token = request.headers['x-model-router-token']
      if (token !== state.clientToken) return reply(response, 403, { ok: false, error: 'missing or stale panel token' })
    }
    state.engaged = true
    state.disengageReason = ''
    return reply(response, 200, { ok: true, engaged: true })
  }
  return reply(response, 404, { ok: false, error: 'not found' })
})

function collect(request, then) {
  let raw = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => { if (raw.length < 65536) raw += chunk })
  request.on('end', () => {
    let body
    try { body = raw ? JSON.parse(raw) : undefined } catch (_badJson) { body = undefined }
    then(body)
  })
}

if (process.env.FAKE_HOST_SERVE === '1') {
  server.listen(port, '127.0.0.1', () => {
    console.log(JSON.stringify({ port: server.address().port, mode }))
  })
}
