#!/usr/bin/env node
// Local release gate for @neptune810/dsh-model-router.
//
// The CI job runs the suite and the release checks separately; this script is
// the same sequence locally, in one command, with one exit code:
//
//   1. "node --test"              — the whole suite on the real clock.
//   2. "node --test"              — again at a pinned peak instant and a pinned
//                                   off-peak instant (DSH_MODEL_ROUTER_NOW), so a
//                                   test that reads the wall clock instead of
//                                   lib/clock.js fails here, not in CI at 3am.
//   3. "scripts/check-release.mjs" — version / changelog / manifest checks.
//   4. "scripts/check-catalog.mjs" — the generated catalog stays valid.
//
// A missing check script is reported as SKIP instead of failing, so the gate
// also works in a worktree where a script has not been written yet. Every step
// echoes the last few lines of its output; the summary at the end says what
// passed, failed or was skipped, plus the wall time.
//
// Usage:
//   npm run test:gate
//   node scripts/gate.mjs
//
// Exit code 0 when every step passed (skips are fine), 1 otherwise.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAIL_LINES = 5

/** Last few lines of a child's combined output, prefixed for the log. */
function tail(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').trimEnd().split('\n')
  return lines.slice(-TAIL_LINES).map((line) => '  | ' + line)
}

/** Run one child process with this Node binary; never throws. */
function run(args, env) {
  const started = Date.now()
  const options = { cwd: ROOT, encoding: 'utf8' }
  if (env) options.env = { ...process.env, ...env }
  const result = spawnSync(process.execPath, args, options)
  return {
    ok: !result.error && result.status === 0,
    elapsed: Date.now() - started,
    output: (result.stdout || '') + (result.stderr || ''),
    error: result.error || null,
  }
}

function seconds(ms) {
  return (ms / 1000).toFixed(1) + 's'
}

/** Run a step and print its tail; returns { label, status, elapsed }. */
function step(label, args, env) {
  const frozen = env && env.DSH_MODEL_ROUTER_NOW ? ' (DSH_MODEL_ROUTER_NOW=' + env.DSH_MODEL_ROUTER_NOW + ')' : ''
  console.log('gate: node ' + args.join(' ') + frozen)
  const result = run(args, env)
  if (result.error) console.log('  | spawn failed: ' + result.error.message)
  for (const line of tail(result.output)) console.log(line)
  const status = result.ok ? 'pass' : 'fail'
  console.log('  ' + status.toUpperCase() + ' (' + seconds(result.elapsed) + ')')
  return { label, status, elapsed: result.elapsed }
}

/** Run "node <script>", or report SKIP when the script is not in this worktree. */
function scriptStep(script, label) {
  if (!existsSync(join(ROOT, script))) {
    console.log('gate: ' + label + ' (' + script + ') — SKIP (missing)')
    return { label, status: 'skip', elapsed: 0 }
  }
  return step(label, [script])
}

function main() {
  const started = Date.now()
  const results = []

  // Tests first: the other checks are only meaningful when the suite is green.
  results.push(step('tests (node --test)', ['--test']))
  // The catalog prices DeepSeek-V4-Pro off-peak (half rate on weekday nights and
  // weekends). A suite that reads Date.now() directly is green during CST peak
  // hours and red otherwise, so the same suite runs twice more at pinned
  // instants: Monday 10:00 +08:00 (peak) and Sunday 09:30 +08:00 (off-peak).
  results.push(step('tests at a pinned peak instant', ['--test'], { DSH_MODEL_ROUTER_NOW: String(Date.UTC(2026, 9, 26, 2, 0, 0)) }))
  results.push(step('tests at a pinned off-peak instant', ['--test'], { DSH_MODEL_ROUTER_NOW: String(Date.UTC(2026, 10, 1, 1, 30, 0)) }))
  results.push(scriptStep('scripts/check-release.mjs', 'release checks'))
  results.push(scriptStep('scripts/check-catalog.mjs', 'catalog checks'))

  const failed = results.filter((result) => result.status === 'fail')
  const skipped = results.filter((result) => result.status === 'skip')
  console.log('')
  console.log('gate summary:')
  for (const result of results) {
    const status = result.status.toUpperCase().padEnd(4)
    const time = result.elapsed ? '  ' + seconds(result.elapsed) : ''
    console.log('  ' + status + ' ' + result.label + time)
  }
  console.log('  total ' + seconds(Date.now() - started))
  if (failed.length > 0) {
    console.log('gate: FAIL (' + failed.length + ' step' + (failed.length === 1 ? '' : 's') + ' failed)')
    return 1
  }
  console.log('gate: PASS' + (skipped.length > 0 ? ' (' + skipped.length + ' skipped)' : ''))
  return 0
}

process.exitCode = main()
