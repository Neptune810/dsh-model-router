/**
 * dsh-model-router — durable UI state.
 *
 * The browser cannot write plugin config, so the UI's own edits (model pool,
 * presets, per-session control scope and pinned task type) live in a small JSON
 * file beside the profile, written atomically and debounced. Absent or corrupt
 * files degrade to the shipped defaults; nothing here can fail plugin load.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const EMPTY = Object.freeze({ version: 1, pool: null, presets: null, settings: null, sessions: {} })

/** Resolve the state file from the host environment. */
export function resolveStoreFile(env = typeof process === 'undefined' ? {} : process.env) {
  const home = env.DSH_HOME || join(env.USERPROFILE || env.HOME || '.', '.dsh')
  const profileDir = env.DSH_PROFILE_DIR || join(home, 'profiles', env.DSH_PROFILE || 'web')
  return join(profileDir, '.model-router', 'state.json')
}

/** Open (or create) the store. Never throws. */
export function createStore(file = resolveStoreFile()) {
  let data = { ...EMPTY, sessions: {} }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object') {
      data = { ...EMPTY, ...parsed, sessions: { ...(parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {}) } }
    }
  } catch (_absentOrCorrupt) { /* defaults */ }
  let timer
  const flush = () => {
    timer = undefined
    try {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = file + '.tmp'
      writeFileSync(tmp, JSON.stringify(data, null, 2))
      renameSync(tmp, file)
    } catch (_unwritable) { /* state is advisory */ }
  }
  const schedule = () => {
    if (timer !== undefined) return
    timer = setTimeout(flush, 250)
    if (timer && typeof timer.unref === 'function') timer.unref()
  }
  return {
    file,
    get pool() { return data.pool },
    set pool(value) { data.pool = value; schedule() },
    get presets() { return data.presets },
    set presets(value) { data.presets = value; schedule() },
    get settings() { return data.settings },
    set settings(value) { data.settings = value; schedule() },
    session(id) { return id ? data.sessions[id] : undefined },
    patchSession(id, patch) {
      if (!id) return undefined
      data.sessions[id] = { ...(data.sessions[id] || {}), ...patch }
      schedule()
      return data.sessions[id]
    },
    flush,
  }
}
