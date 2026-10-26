import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', 'scripts', 'smoke.mjs')
const fakeHost = path.join(here, 'fixtures', 'fake-host.mjs')

/**
 * Start test/fixtures/fake-host.mjs as its own process and resolve its base URL.
 *
 * The smoke script is driven with spawnSync on purpose (no shell, no bash), and
 * spawnSync blocks this process' event loop — so the HTTP peer has to live in a
 * separate process, not in the test itself.
 */
async function startHost(mode) {
  const child = spawn(process.execPath, [fakeHost, mode], {
    // FAKE_HOST_SERVE=1 is required: without it the fixture is a no-op, so a bare
    // `node --test` (which runs every *.mjs under test/) cannot hang on it.
    env: { ...process.env, PORT: '0', FAKE_HOST_SERVE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const port = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('fake host did not report a port in 10s')), 10_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const line = buffer.split('\n').find((candidate) => candidate.trim().startsWith('{'))
      if (!line) return
      clearTimeout(timer)
      try { resolve(JSON.parse(line).port) } catch (error) { reject(error) }
    })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => {
      if (port === undefined && code !== null) { clearTimeout(timer); reject(new Error('fake host exited with code ' + code)) }
    })
  })
  return {
    base: 'http://127.0.0.1:' + port,
    stop() { child.kill() },
  }
}

/** Run the smoke script against a base URL and return { status, stdout, stderr }. */
function runSmoke(base, extraEnv = {}, argv = []) {
  const result = spawnSync(process.execPath, [script, ...argv], {
    env: {
      ...process.env,
      ROUTER_BASE: base,
      SMOKE_TIMEOUT_MS: '1500',
      SMOKE_ALLOW_NO_TOKEN: '',
      SMOKE_TOKEN: '',
      ROUTER_SESSION_ID: '',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (result.error) throw result.error
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' }
}

function lines(stdout) {
  return stdout.split(/\r?\n/)
}

test('--help prints usage and exits 0 without touching the network', () => {
  const result = runSmoke('http://127.0.0.1:1', {}, ['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage: node scripts\/smoke\.mjs/)
  assert.match(result.stdout, /--check/)
  assert.match(result.stdout, /ROUTER_BASE/)
  assert.match(result.stdout, /SMOKE_ALLOW_NO_TOKEN/)
  assert.match(result.stdout, /Reads only GET routes/)
})

test('--help is not run when another flag is present (checks still execute)', () => {
  // --check must survive a --help lookalike in argv order: only the flag itself matters.
  const result = runSmoke('http://127.0.0.1:1', {}, ['--check'])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /RESULT/)
})

test('healthy host: S1/S2/S3 all pass and the exit code is 0', async () => {
  const host = await startHost('healthy')
  try {
    const result = runSmoke(host.base)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const out = lines(result.stdout)
    assert.ok(out.some((line) => line.startsWith('PASS S1')), result.stdout)
    assert.match(result.stdout, /decisions\[ 3 \] is an array/)
    assert.match(result.stdout, /routed target current\.model=deepseek-flash, current\.effort=low/)
    assert.ok(out.some((line) => line.startsWith('PASS S2')), result.stdout)
    assert.match(result.stdout, /all 3 decisions have provider\/model\/effort\/stepClass\/score/)
    assert.ok(out.some((line) => line.startsWith('PASS S3')), result.stdout)
    assert.match(result.stdout, /POST \/control \{control:"full"\} 200/)
    assert.match(result.stdout, /POST \/resume 200/)
    assert.match(result.stdout, /engaged=true, disengageReason empty after resume/)
    assert.match(result.stdout, /RESULT PASS \d+  WARN \d+  SKIP \d+  FAIL 0/)
    assert.doesNotMatch(result.stdout, /FAIL [^0]/)
  } finally {
    host.stop()
  }
})

test('--check passes when GET /state is 200 and a bogus token is refused', async () => {
  const host = await startHost('healthy')
  try {
    const result = runSmoke(host.base, {}, ['--check'])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /PASS C1  GET \/state 200 \(plugin loaded\)/)
    assert.match(result.stdout, /PASS C2  POST \/control with a bogus token refused \(403/)
    assert.match(result.stdout, /RESULT .*FAIL 0/)
  } finally {
    host.stop()
  }
})

test('--check fails when a bogus token is accepted while a token is published', async () => {
  const host = await startHost('open-control')
  try {
    const result = runSmoke(host.base, {}, ['--check'])
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /FAIL C2  POST \/control with a bogus token answered 200/)
    assert.match(result.stdout, /FAIL 1/)
  } finally {
    host.stop()
  }
})

test('a refused token makes S3 fail (and the run exits 1)', async () => {
  const host = await startHost('auth-refuse')
  try {
    const result = runSmoke(host.base)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /FAIL S3  POST \/control 403/)
    assert.match(result.stdout, /missing or stale panel token/)
    assert.match(result.stdout, /RESULT .*FAIL [12]/)
  } finally {
    host.stop()
  }
})

test('NO_TOKEN host: clientToken may be absent, S3 still mutates and restores', async () => {
  const host = await startHost('no-token')
  try {
    const result = runSmoke(host.base, { SMOKE_ALLOW_NO_TOKEN: '1' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /WARN S1  clientToken absent — accepted because SMOKE_ALLOW_NO_TOKEN=1/)
    assert.match(result.stdout, /POST \/control \{control:"full"\} 200/)
    // state started on effort, so S3 must put it back
    assert.match(result.stdout, /PASS S3  restored control=effort/)
    assert.match(result.stdout, /FAIL 0/)
  } finally {
    host.stop()
  }
})

test('a missing clientToken is a failure unless SMOKE_ALLOW_NO_TOKEN=1', async () => {
  const host = await startHost('no-token')
  try {
    const result = runSmoke(host.base)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /FAIL S1  clientToken missing/)
  } finally {
    host.stop()
  }
})

test('a /state payload without decisions is a failure', async () => {
  const host = await startHost('no-decisions')
  try {
    const result = runSmoke(host.base)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /FAIL S1  decisions is not an array/)
    assert.equal(result.status, 1)
  } finally {
    host.stop()
  }
})

test('--check fails with a hint when the plugin routes are not loaded (404)', async () => {
  const host = await startHost('missing-route')
  try {
    const result = runSmoke(host.base, {}, ['--check'])
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /FAIL C1  GET \/state expected 200, got HTTP 404/)
    assert.match(result.stdout, /hint: the desktop app may still run an older plugin build/)
  } finally {
    host.stop()
  }
})

test('an unreachable host fails with a hint instead of throwing', () => {
  const result = runSmoke('http://127.0.0.1:1')
  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAIL S1  GET \/state expected 200/)
  assert.match(result.stdout, /is the host running at http:\/\/127\.0\.0\.1:1/)
  assert.equal(result.stderr, '')
})
