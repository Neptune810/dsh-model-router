import test from 'node:test'
import assert from 'node:assert/strict'
import { freeze, isFrozen, now } from '../lib/clock.js'

// lib/clock.js is the plugin's only time source, so these cases pin its
// precedence and its handling of nonsense: freeze() beats the environment,
// the environment beats the wall clock, and neither one can pin NaN.
//
// The clock is process-global on purpose (a decision, its price and its budget
// boundary have to agree on "now"), so every case restores both hooks.

const ENV = 'DSH_MODEL_ROUTER_NOW'

/** Clear the env hook and freeze(), and put the environment back afterwards. */
function clean(t) {
  const saved = process.env[ENV]
  freeze(null)
  delete process.env[ENV]
  t.after(() => {
    freeze(null)
    if (saved === undefined) delete process.env[ENV]
    else process.env[ENV] = saved
  })
}

test('with nothing pinned now() is the wall clock', (t) => {
  clean(t)
  const before = Date.now()
  const value = now()
  const after = Date.now()
  assert.ok(value >= before && value <= after, 'now() is between the two wall-clock reads')
  assert.equal(isFrozen(), false)
})

test('freeze pins one instant for every later read, and freeze(null) releases it', (t) => {
  clean(t)
  const at = Date.UTC(2026, 9, 26, 2, 0, 0)
  assert.equal(freeze(at), at)
  assert.equal(now(), at)
  assert.equal(now(), at, 'the pinned instant does not drift between reads')
  assert.equal(isFrozen(), true)

  assert.equal(freeze(null), null)
  assert.notEqual(now(), at)
  assert.equal(isFrozen(), false)
})

test('freeze refuses a non-finite instant instead of pinning NaN', (t) => {
  clean(t)
  const at = Date.UTC(2026, 9, 26, 2, 0, 0)
  freeze(at)
  assert.equal(freeze(Number.NaN), null)
  assert.ok(Number.isFinite(now()), 'the clock fell back to the wall clock')
  assert.equal(isFrozen(), false)
})

test('DSH_MODEL_ROUTER_NOW pins a shell, and a value that is not a positive number is ignored', (t) => {
  clean(t)
  const at = Date.UTC(2020, 0, 1)
  process.env[ENV] = String(at)
  assert.equal(now(), at)
  assert.equal(isFrozen(), true)

  for (const bad of ['', '  ', 'not-a-number', '0', '-5', 'Infinity', 'NaN']) {
    process.env[ENV] = bad
    const value = now()
    assert.ok(Number.isFinite(value) && value !== at, 'ignored: ' + JSON.stringify(bad))
  }
  assert.equal(isFrozen(), false)
})

test('freeze beats the environment hook', (t) => {
  clean(t)
  process.env[ENV] = String(Date.UTC(2020, 0, 1))
  const pinned = Date.UTC(2026, 9, 26, 2, 0, 0)
  freeze(pinned)
  assert.equal(now(), pinned)
  assert.equal(isFrozen(), true)
})
