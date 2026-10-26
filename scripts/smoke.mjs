#!/usr/bin/env node
/**
 * dsh-model-router — zero-dependency end-to-end smoke test.
 *
 * Runs against an ALREADY RUNNING DSH web host (the plugin's own HTTP routes),
 * so it answers the one question unit tests cannot: "is the installed build
 * actually loaded and serving its routes in this host?"
 *
 * It never writes files and never edits the profile. The only state it mutates
 * is the target session's control scope, and S3 restores what it found.
 *
 * Usage:
 *   node scripts/smoke.mjs                 # S1 + S2 + S3 against ROUTER_BASE
 *   node scripts/smoke.mjs --check         # connectivity + auth only (post-release gate)
 *   node scripts/smoke.mjs --help
 *
 * Environment:
 *   ROUTER_BASE          host base URL           (default http://127.0.0.1:49832)
 *   ROUTER_SESSION_ID    session used by S3      (default: last id /state lists)
 *   SMOKE_TOKEN          panel token override    (default: clientToken from /state)
 *   SMOKE_ALLOW_NO_TOKEN 1 = accept a missing clientToken field (token check disabled)
 *   SMOKE_TIMEOUT_MS     per-request timeout     (default 8000)
 *
 * Exit code 0 when nothing FAILed (WARN/SKIP are not failures), 1 otherwise.
 */

import process from 'node:process'

const BASE = (process.env.ROUTER_BASE || 'http://127.0.0.1:49832').replace(/\/+$/, '')
const PREFIX = '/model-router'
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 8000)
const POLL_MS = 1000

const results = []
const counts = { PASS: 0, WARN: 0, SKIP: 0, FAIL: 0 }

/** Record and print one outcome line: "PASS S1  GET /state 200". */
function record(kind, id, message) {
  counts[kind] += 1
  results.push({ kind, id, message })
  const head = kind.padEnd(4)
  console.log(head + ' ' + id + '  ' + message)
}

const pass = (id, message) => record('PASS', id, message)
const warn = (id, message) => record('WARN', id, message)
const skip = (id, message) => record('SKIP', id, message)
const fail = (id, message) => record('FAIL', id, message)

function usage() {
  console.log([
    'dsh-model-router smoke test (zero dependencies, no files written)',
    '',
    'Usage: node scripts/smoke.mjs [--check] [--help]',
    '',
    '  (no flag)   end-to-end run: S1 GET /state shape, S2 two polls of decisions,',
    '              S3 POST /control then POST /resume on one session (restored).',
    '  --check     connectivity + auth probe only: GET /state must be 200 and a POST',
    '              carrying a bogus token must be refused (403/400). Use this right',
    '              after installing a build to confirm the plugin is loaded.',
    '  --help      this text.',
    '',
    'Environment:',
    '  ROUTER_BASE=' + BASE,
    '  ROUTER_SESSION_ID=<id>     session for S3 (default: last id in /state.sessions)',
    '  SMOKE_TOKEN=<token>        panel token override (default: /state.clientToken)',
    '  SMOKE_ALLOW_NO_TOKEN=1     tolerate a missing clientToken (DSH_MODEL_ROUTER_NO_TOKEN=1)',
    '  SMOKE_TIMEOUT_MS=' + TIMEOUT_MS,
    '',
    'Reads only GET routes, plus S3\'s control/resume POSTs. S3 restores the',
    'session\'s previous control scope; --check performs one POST that must be',
    'refused before any state is touched.',
  ].join('\n'))
}

function url(path) {
  return BASE + PREFIX + path
}

/** Fetch JSON with a hard timeout; returns { status, json, error }. Never throws. */
async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers['x-model-router-token'] = token
  try {
    const response = await fetch(url(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await response.text()
    let json
    try { json = text ? JSON.parse(text) : null } catch (_notJson) { json = undefined }
    return { status: response.status, json, text }
  } catch (error) {
    const cause = error && error.cause ? ' (' + error.cause.code + ')' : ''
    return { status: 0, json: undefined, error: String((error && error.message) || error) + cause }
  }
}

/** GET /state, or null after printing why it is unusable. */
async function readState(id) {
  const response = await call('/state')
  if (response.status !== 200) {
    const why = response.error ? response.error : 'HTTP ' + response.status
    fail(id, 'GET /state expected 200, got ' + why + ' — is the host running at ' + BASE + '?')
    return null
  }
  if (!response.json || typeof response.json !== 'object') {
    fail(id, 'GET /state 200 but the body is not a JSON object')
    return null
  }
  return response.json
}

/** The effort a /state payload reports for the step it last routed. */
function reportedEffort(state) {
  if (state && state.current && typeof state.current === 'object') {
    if ('effort' in state.current) return { effort: state.current.effort, where: 'current.effort' }
  }
  if (state && 'effort' in state) return { effort: state.effort, where: 'effort' }
  return { effort: undefined, where: null }
}

function reportedModel(state) {
  if (state && state.current && typeof state.current.model === 'string') return { model: state.current.model, where: 'current.model' }
  if (state && typeof state.model === 'string') return { model: state.model, where: 'model' }
  return { model: undefined, where: null }
}

/** S1 — the /state payload every panel build depends on. */
async function s1StateShape() {
  const state = await readState('S1')
  if (!state) return null
  const keys = Object.keys(state).sort()
  pass('S1', 'GET /state 200, keys: ' + keys.join(','))

  // decisions — the array the composer row and the stats read.
  if (!Array.isArray(state.decisions)) {
    fail('S1', 'decisions is not an array (got ' + typeof state.decisions + '); keys: ' + keys.join(','))
  } else {
    pass('S1', 'decisions[ ' + state.decisions.length + ' ] is an array')
  }

  // clientToken — mutations are refused without it since 0.14.3.
  if (typeof state.clientToken === 'string' && state.clientToken.length > 0) {
    pass('S1', 'clientToken present (' + state.clientToken.length + ' chars)')
  } else if (process.env.SMOKE_ALLOW_NO_TOKEN === '1') {
    warn('S1', 'clientToken absent — accepted because SMOKE_ALLOW_NO_TOKEN=1 (host runs with DSH_MODEL_ROUTER_NO_TOKEN=1)')
  } else {
    fail('S1', 'clientToken missing: mutation routes will need a token; set DSH_MODEL_ROUTER_NO_TOKEN=1 on the host and SMOKE_ALLOW_NO_TOKEN=1 here if that is intentional')
  }

  // model + effort — the two fields the whole router exists to choose.
  const model = reportedModel(state)
  const effort = reportedEffort(state)
  const hasDecisions = Array.isArray(state.decisions) && state.decisions.length > 0
  if (model.model !== undefined && effort.effort !== undefined) {
    pass('S1', 'routed target ' + model.where + '=' + model.model + ', ' + effort.where + '=' + String(effort.effort))
  } else if (!state.current && !hasDecisions) {
    warn('S1', 'no decision recorded yet (current=null, decisions empty): ' + (model.where || 'model') + '/' + (effort.where || 'effort') + ' cannot be checked — run one turn and re-run')
  } else {
    fail('S1', 'cannot read the routed model/effort: model=' + String(model.model) + ' via ' + String(model.where) + ', effort=' + String(effort.effort) + ' via ' + String(effort.where) + '; keys: ' + keys.join(','))
  }
  return state
}

/** S2 — decisions keep being appended and carry the documented fields. */
async function s2Decisions() {
  const first = await readState('S2')
  if (!first) return
  if (!Array.isArray(first.decisions)) {
    fail('S2', 'no decisions array on the first poll — cannot validate entries')
    return
  }
  const before = first.decisions.length
  await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  const second = await readState('S2')
  if (!second) return
  if (!Array.isArray(second.decisions)) {
    fail('S2', 'no decisions array on the second poll')
    return
  }
  const decisions = second.decisions
  pass('S2', 'two polls ' + POLL_MS + 'ms apart: decisions ' + before + ' -> ' + decisions.length)

  let bad = 0
  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index] || {}
    const problems = []
    if (typeof decision.provider !== 'string' || !decision.provider) problems.push('provider')
    if (typeof decision.model !== 'string' || !decision.model) problems.push('model')
    if (!('effort' in decision)) problems.push('effort')
    // 0.14.x writes stepClass; accept "class" too so a renamed field warns loudly instead of hiding.
    if (typeof decision.stepClass !== 'string' && typeof decision.class !== 'string') problems.push('stepClass')
    if (typeof decision.score !== 'number' || !Number.isFinite(decision.score)) problems.push('score')
    if (problems.length > 0) {
      bad += 1
      if (bad <= 3) fail('S2', 'decisions[' + index + '] missing/wrong: ' + problems.join(',') + '; entry keys: ' + Object.keys(decision).join(','))
    }
  }
  if (bad === 0) pass('S2', 'all ' + decisions.length + ' decisions have provider/model/effort/stepClass/score')
  else fail('S2', bad + ' of ' + decisions.length + ' decisions are malformed')

  if (decisions.length === before) {
    warn('S2', 'no new decision in ' + POLL_MS + 'ms (idle session?) — shape checked, liveness not proven')
  } else {
    pass('S2', 'a new decision landed during the poll window')
  }
}

/** S3 — mutation auth works and the session can be put back. */
async function s3ControlResume(state) {
  if (!state) return
  const listed = Array.isArray(state.sessions) ? state.sessions.filter((id) => typeof id === 'string') : []
  const sessionId = process.env.ROUTER_SESSION_ID || listed[listed.length - 1]
  if (!sessionId) {
    skip('S3', 'no ROUTER_SESSION_ID and /state.sessions is empty — mutation path not exercised')
    return
  }
  const token = process.env.SMOKE_TOKEN || (typeof state.clientToken === 'string' ? state.clientToken : undefined)
  if (!token && process.env.SMOKE_ALLOW_NO_TOKEN !== '1') {
    warn('S3', 'no panel token available (clientToken absent) — POST may be refused; set SMOKE_TOKEN or SMOKE_ALLOW_NO_TOKEN=1')
  }
  const before = typeof state.effectiveControl === 'string' ? state.effectiveControl : undefined
  console.log('# S3  session ' + sessionId + ' (control before: ' + String(before) + ')')

  const forced = await call('/control', { method: 'POST', token, body: { sessionId, control: 'full' } })
  if (forced.status === 403) {
    fail('S3', 'POST /control 403 ' + JSON.stringify(forced.json) + ' — token/origin rejected; pass SMOKE_TOKEN=<clientToken>')
    return
  }
  if (forced.status !== 200 || !forced.json || forced.json.ok !== true) {
    fail('S3', 'POST /control expected 200 {ok:true}, got ' + forced.status + ' ' + (forced.text || forced.error || '').slice(0, 200))
    return
  }
  pass('S3', 'POST /control {control:"full"} 200')

  const afterControl = await readState('S3')
  if (afterControl) {
    if (afterControl.effectiveControl === 'full') pass('S3', 'effectiveControl=full after the control POST')
    else warn('S3', 'effectiveControl is ' + String(afterControl.effectiveControl) + ' after setting full (host may not have applied it yet)')
  }

  const resumed = await call('/resume', { method: 'POST', token, body: { sessionId } })
  if (resumed.status === 403) {
    fail('S3', 'POST /resume 403 ' + JSON.stringify(resumed.json))
    return
  }
  if (resumed.status !== 200 || !resumed.json || resumed.json.ok !== true) {
    fail('S3', 'POST /resume expected 200 {ok:true}, got ' + resumed.status + ' ' + (resumed.text || resumed.error || '').slice(0, 200))
    return
  }
  pass('S3', 'POST /resume 200 {engaged:' + String(resumed.json.engaged) + '}')

  const afterResume = await readState('S3')
  if (afterResume) {
    if (afterResume.engaged === true && !afterResume.disengageReason) pass('S3', 'engaged=true, disengageReason empty after resume')
    else warn('S3', 'engaged=' + String(afterResume.engaged) + ', disengageReason=' + JSON.stringify(afterResume.disengageReason))
    // v0.14.3 resume() re-engages routing but does NOT write a scope: report, do not fail.
    if (afterResume.effectiveControl === 'effort') pass('S3', 'back to effort scope')
    else warn('S3', 'effectiveControl=' + String(afterResume.effectiveControl) + ' after resume (0.14.3 resume re-engages; the scope stays where control last set it)')
  }

  // Leave the session as we found it: the control POST above persisted "full".
  if (before === undefined || before === 'full') {
    skip('S3', 'nothing to restore (previous control was ' + String(before) + ')')
    return
  }
  if (before === 'effort' || before === 'model') {
    const restored = await call('/control', { method: 'POST', token, body: { sessionId, control: before } })
    if (restored.status === 200 && restored.json && restored.json.ok === true) pass('S3', 'restored control=' + before)
    else warn('S3', 'could not restore control=' + before + ' (got ' + restored.status + '); re-set it from the panel')
  } else {
    warn('S3', 'previous control ' + JSON.stringify(before) + ' is not restorable through this route; leave it for the panel')
  }
}

/** --check — the post-release "did the plugin load?" probe. */
async function checkConnectivity() {
  const state = await readState('C1')
  if (!state) {
    console.log('hint: the desktop app may still run an older plugin build; the route only exists once this build is loaded.')
    return
  }
  const keys = Object.keys(state).sort()
  pass('C1', 'GET /state 200 (plugin loaded); keys: ' + keys.join(','))

  const token = process.env.SMOKE_TOKEN || (typeof state.clientToken === 'string' ? state.clientToken : undefined)
  const probe = await call('/control', { method: 'POST', token: '__smoke__', body: { sessionId: '__smoke__', control: 'full' } })
  if (probe.status === 403 || probe.status === 400) {
    pass('C2', 'POST /control with a bogus token refused (' + probe.status + ' ' + JSON.stringify(probe.json) + ')')
  } else if (probe.status === 200 && typeof state.clientToken !== 'string') {
    warn('C2', 'POST /control accepted a bogus token because the host runs with DSH_MODEL_ROUTER_NO_TOKEN=1 — auth path untested')
  } else {
    fail('C2', 'POST /control with a bogus token answered ' + probe.status + ' (expected 403/400): ' + (probe.text || probe.error || '').slice(0, 200))
  }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) { usage(); return 0 }
  const mode = argv.includes('--check') ? 'check' : 'full'
  console.log('# model-router smoke  base=' + BASE + '  mode=' + mode + '  node=' + process.version + (process.env.ROUTER_SESSION_ID ? '  session=' + process.env.ROUTER_SESSION_ID : ''))
  if (mode === 'check') {
    await checkConnectivity()
  } else {
    const state = await s1StateShape()
    await s2Decisions()
    await s3ControlResume(state)
  }
  const summary = ['PASS ' + counts.PASS, 'WARN ' + counts.WARN, 'SKIP ' + counts.SKIP, 'FAIL ' + counts.FAIL].join('  ')
  console.log('RESULT ' + summary)
  return counts.FAIL === 0 ? 0 : 1
}

process.exitCode = await main()
