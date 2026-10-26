/**
 * Feedback storage (v0.17.1): one append-only JSONL file beside the decision
 * telemetry. Small on purpose - the volume here is a few lines per session, so
 * there is no rotation, only a hard line cap when reading and a single warning
 * when the file cannot be written.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { parseFeedback } from './feedback.js'

const FILE_NAME = 'feedback.v1.jsonl'

/**
 * @param {object} [options]
 * @param {string} [options.dir] absolute directory; created lazily on first write
 * @param {boolean} [options.enabled] false makes the log a no-op
 * @param {(error: {at:number, message:string}) => void} [options.onError] called once
 */
export function createFeedbackLog(options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const dir = typeof opts.dir === 'string' ? opts.dir : ''
  const onError = typeof opts.onError === 'function' ? opts.onError : null
  const file = dir.length > 0 ? join(dir, FILE_NAME) : FILE_NAME
  let disabled = opts.enabled === false || dir.length === 0
  let written = 0
  let bytes = 0
  let lastError = null

  function append(record) {
    if (disabled || !record || typeof record !== 'object') return false
    try {
      mkdirSync(dir, { recursive: true })
      const line = JSON.stringify(record) + '\n'
      appendFileSync(file, line)
      written += 1
      bytes += Buffer.byteLength(line)
      return true
    } catch (error) {
      lastError = { at: Date.now(), message: String((error && error.message) || error) }
      disabled = true
      if (onError) onError(lastError)
      return false
    }
  }

  function read(limit = 5000) {
    const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5000
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch (_missingOrUnreadable) {
      return []
    }
    // The file ends with a newline, so a plain slice would spend one slot of
    // the cap on the empty string after it and hand back one record less than
    // asked for. Blank lines are not records.
    const lines = text.split('\n').filter((line) => line.trim().length > 0)
    const tail = lines.length > max ? lines.slice(lines.length - max) : lines
    return parseFeedback(tail.join('\n'))
  }

  return {
    file,
    append,
    read,
    health() {
      let size = bytes
      try {
        size = statSync(file).size
      } catch (_missing) {
        /* keep the running count */
      }
      return { enabled: !disabled, file: FILE_NAME, written, bytes: size, lastError }
    },
  }
}
