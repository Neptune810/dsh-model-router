import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, resolveStoreFile, SESSION_CAP, STATE_VERSION } from '../lib/store.js'

/** A fresh state-file path under a private temp directory. */
function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'model-router-store-'))
  return join(dir, '.model-router', 'state.json')
}

test('createStore backs up a corrupt state file and starts from defaults', () => {
  const file = tempFile()
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, '{ this is not json', 'utf8')

  const warnings = []
  const store = createStore(file, { onWarn: (message) => warnings.push(message) })

  assert.equal(store.recovery.kind, 'corrupt')
  assert.ok(store.recovery.backupPath, 'a backup path is reported')
  assert.ok(existsSync(store.recovery.backupPath), 'the corrupt file still exists under .corrupt-*')
  assert.equal(existsSync(file), false, 'the original path is free for a clean file')
  assert.equal(store.session('missing'), undefined)

  store.settings = { classifier: 'llm' }
  assert.equal(store.flush(), true)
  const written = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(written.version, STATE_VERSION)
  assert.deepEqual(written.settings, { classifier: 'llm' })
  assert.ok(warnings.length >= 1)
  assert.equal(store.health().corruptBackup, store.recovery.backupPath)
})

test('state version 1 migrates to 2 without dropping sessions', () => {
  const file = tempFile()
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify({
    version: 1,
    pool: null,
    settings: { imagePolicy: 'vision' },
    sessions: { s1: { control: 'effort' }, s2: { pinnedTaskType: 'standard' } },
    legacyField: { keep: true },
  }), 'utf8')

  const store = createStore(file)
  assert.equal(store.session('s1').control, 'effort')
  assert.equal(store.settings.imagePolicy, 'vision')
  assert.equal(store.health().ok, true)

  assert.equal(store.flush(), true)
  const written = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(written.version, 2)
  assert.equal(written.sessions.s1.control, 'effort')
  assert.equal(written.sessions.s2.pinnedTaskType, 'standard')
  assert.deepEqual(written.legacyField, { keep: true })
})

test('flush failure is surfaced through onError and lastError', () => {
  const file = tempFile()
  const dir = join(file, '..')
  const store = createStore(file)
  const errors = []
  // Replace the state directory with a plain file: mkdir then fails on flush.
  rmSync(dir, { recursive: true, force: true })
  writeFileSync(dir, 'blocker')
  const failing = createStore(file, { onError: (error) => errors.push(error) })
  failing.settings = { classifier: 'llm' }
  const ok = failing.flush()

  assert.equal(ok, false)
  assert.equal(failing.health().ok, false)
  assert.equal(typeof failing.health().lastErrorAt, 'number')
  assert.ok(failing.lastError, 'lastError is exposed')
  assert.ok(failing.lastError.code, 'the fs error code is kept')
  // Linux answers the read of "<state dir>/state.json" (state dir is a plain
  // file) with ENOTDIR and reports it too; Windows answers ENOENT and stays
  // silent. Both are legitimate, so only the write failure itself is required.
  assert.ok(errors.length >= 1, 'onError is called for the failed write')
  assert.ok(
    errors.every((error) => error.path === file && typeof error.code === 'string'),
    'every reported error names the state file and keeps its fs code',
  )
  assert.deepEqual(errors[errors.length - 1], failing.lastError)
  assert.equal(store.health().ok, true)
})

test('newer state versions are served read-only and never overwritten', () => {
  const file = tempFile()
  mkdirSync(join(file, '..'), { recursive: true })
  const future = JSON.stringify({ version: 99, sessions: { s1: { control: 'model' } }, futureField: { a: 1 } })
  writeFileSync(file, future, 'utf8')

  const store = createStore(file)
  assert.equal(store.readOnly, true)
  assert.equal(store.session('s1').control, 'model')
  assert.equal(store.flush(), false)
  assert.equal(readFileSync(file, 'utf8'), future, 'the newer file is left untouched')
})

test('session map is capped by least-recently-seen', () => {
  const file = tempFile()
  const store = createStore(file)
  for (let i = 0; i < SESSION_CAP + 5; i += 1) store.patchSession('s' + i, { control: 'effort' })
  store.flush()

  const written = JSON.parse(readFileSync(file, 'utf8'))
  const ids = Object.keys(written.sessions)
  assert.equal(ids.length, SESSION_CAP)
  assert.equal(written.sessions.s0, undefined, 'oldest records were dropped')
  assert.ok(written.sessions['s' + (SESSION_CAP + 4)], 'newest records were kept')
  assert.equal(typeof written.sessions['s' + (SESSION_CAP + 4)].lastSeenAt, 'number')
})

test('resolveStoreFile follows DSH_HOME and DSH_PROFILE', () => {
  assert.equal(
    resolveStoreFile({ DSH_HOME: 'C:\\home', DSH_PROFILE: 'web' }),
    join('C:\\home', 'profiles', 'web', '.model-router', 'state.json'),
  )
  assert.equal(
    resolveStoreFile({ DSH_HOME: 'C:\\home', DSH_PROFILE_DIR: 'C:\\custom' }),
    join('C:\\custom', '.model-router', 'state.json'),
  )
})
