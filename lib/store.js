/**
 * dsh-model-router — durable UI state.
 *
 * The browser cannot write plugin config, so the UI's own edits (model pool,
 * presets, per-session control scope and pinned task type) live in a small JSON
 * file beside the profile, written atomically and debounced. Absent files
 * degrade to the shipped defaults; a corrupt file is moved aside instead of
 * being silently overwritten, and write failures are reported through
 * onError instead of disappearing. Nothing here can fail plugin load.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Current on-disk shape. Older files migrate on read; newer ones are read-only. */
export const STATE_VERSION = 2
/** Upper bound for remembered per-session records (least-recently-seen go first). */
export const SESSION_CAP = 200

const EMPTY = Object.freeze({ version: STATE_VERSION, pool: null, presets: null, settings: null, last: null, prices: null, sessions: {} })

/** Resolve the state file from the host environment. */
export function resolveStoreFile(env = typeof process === 'undefined' ? {} : process.env) {
  const home = env.DSH_HOME || join(env.USERPROFILE || env.HOME || '.', '.dsh')
  const profileDir = env.DSH_PROFILE_DIR || join(home, 'profiles', env.DSH_PROFILE || 'web')
  return join(profileDir, '.model-router', 'state.json')
}

/** Merge a parsed file into the canonical shape, keeping unknown fields. */
function normalize(parsed) {
  return {
    ...EMPTY,
    ...parsed,
    version: STATE_VERSION,
    sessions: { ...(parsed.sessions && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions) ? parsed.sessions : {}) },
  }
}

/** Drop the least-recently-seen session records beyond the cap. */
function capSessions(sessions) {
  const ids = Object.keys(sessions)
  if (ids.length <= SESSION_CAP) return 0
  ids.sort((a, b) => ((sessions[a] && sessions[a].lastSeenAt) || 0) - ((sessions[b] && sessions[b].lastSeenAt) || 0))
  const drop = ids.slice(0, ids.length - SESSION_CAP)
  for (const id of drop) delete sessions[id]
  return drop.length
}

/**
 * Open (or create) the store. Never throws: every failure is reported through
 * the optional onError / onWarn callbacks and health().
 */
export function createStore(file = resolveStoreFile(), options = {}) {
  const onError = typeof options.onError === 'function' ? options.onError : null
  const onWarn = typeof options.onWarn === 'function' ? options.onWarn : null
  const now = typeof options.now === 'function' ? options.now : Date.now

  let data = { ...EMPTY, sessions: {} }
  let readOnly = false
  let migrateOnLoad = false
  let recovery = { kind: 'absent', backupPath: null }
  let lastError = null
  let warnedWrite = false
  let warnedReadOnly = false

  const warnOnce = (which, message) => {
    if (which === 'write' && warnedWrite) return
    if (which === 'readonly' && warnedReadOnly) return
    if (which === 'write') warnedWrite = true
    else warnedReadOnly = true
    if (onWarn) { try { onWarn(message) } catch (_ignore) { /* advisory */ } }
  }

  const recordError = (error) => {
    lastError = {
      at: now(),
      path: file,
      code: (error && error.code) || null,
      message: String((error && error.message) || error),
    }
    if (onError) { try { onError(lastError) } catch (_ignore) { /* advisory */ } }
  }

  // ---- read --------------------------------------------------------------
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    if (!error || error.code !== 'ENOENT') recordError(error)
    raw = undefined
  }

  if (raw !== undefined) {
    let parsed
    let parseError
    try {
      parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('state root is not an object')
    } catch (error) {
      parseError = error
    }
    if (parseError) {
      const backupPath = file + '.corrupt-' + new Date(now()).toISOString().replace(/[:.]/g, '-')
      try {
        renameSync(file, backupPath)
        recovery = { kind: 'corrupt', backupPath }
        warnOnce('write', 'model-router state file was unreadable; moved to ' + backupPath + ' and started from defaults')
      } catch (error) {
        recovery = { kind: 'corrupt', backupPath: null }
        recordError(error)
      }
    } else {
      const version = Number.isFinite(parsed.version) ? parsed.version : 1
      data = normalize(parsed)
      capSessions(data.sessions)
      if (version > STATE_VERSION) {
        // A newer build wrote this file. Keep serving it from memory but never
        // write back: an older writer must not overwrite fields it cannot see.
        readOnly = true
        warnOnce('readonly', 'model-router state file has version ' + version + ' (this build knows ' + STATE_VERSION + '); running read-only')
      } else if (version < STATE_VERSION) {
        // 1 -> 2 is a pure additive migration: keep every field and session.
        migrateOnLoad = true
      }
    }
  }

  // ---- write -------------------------------------------------------------
  let timer
  const flush = () => {
    timer = undefined
    if (readOnly) return false
    try {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = file + '.tmp'
      writeFileSync(tmp, JSON.stringify(data, null, 2))
      renameSync(tmp, file)
      lastError = null
      return true
    } catch (error) {
      recordError(error)
      warnOnce('write', 'model-router state file could not be written: ' + String((error && error.message) || error))
      return false
    }
  }
  const schedule = () => {
    if (readOnly || timer !== undefined) return
    timer = setTimeout(flush, 250)
    if (timer && typeof timer.unref === 'function') timer.unref()
  }
  // A version-1 file is rewritten in the new shape once, after the writer exists.
  if (migrateOnLoad) schedule()

  return {
    file,
    get pool() { return data.pool },
    set pool(value) { data.pool = value; schedule() },
    get presets() { return data.presets },
    set presets(value) { data.presets = value; schedule() },
    get settings() { return data.settings },
    set settings(value) { data.settings = value; schedule() },
    // The routing plan the user picked last: the default a conversation opens with.
    get last() { return data.last },
    set last(value) { data.last = value; schedule() },
    // The last OpenRouter price snapshot the user pulled: a compact
    // { fetchedAt, models: [{ id, name, level }] } used by auto-pricing.
    get prices() { return data.prices },
    set prices(value) { data.prices = value; schedule() },
    get readOnly() { return readOnly },
    get recovery() { return { ...recovery } },
    get lastError() { return lastError ? { ...lastError } : null },
    /** Shape consumed by the panel's /state: ok is false after a write failure. */
    health() {
      return {
        ok: lastError === null,
        lastErrorAt: lastError ? lastError.at : null,
        lastErrorCode: lastError ? lastError.code : null,
        corruptBackup: recovery.kind === 'corrupt' ? recovery.backupPath : null,
        readOnly,
        version: STATE_VERSION,
      }
    },
    session(id) { return id ? data.sessions[id] : undefined },
    patchSession(id, patch) {
      if (!id) return undefined
      data.sessions[id] = { ...(data.sessions[id] || {}), ...patch, lastSeenAt: now() }
      capSessions(data.sessions)
      schedule()
      return data.sessions[id]
    },
    flush,
  }
}
