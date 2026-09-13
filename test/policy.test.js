import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTO_CEILING,
  DEFAULT_ROUTES,
  EFFORT_POINTS,
  STEP_CLASSES,
  classifyStep,
  clampEffort,
  contentHasImage,
  decideRoute,
  escalateClass,
  isFlashFamily,
  normalizeConfig,
  scoreOf,
  textOfContent,
  toolCallsOf,
  toolErrorsOf,
} from '../lib/policy.js'

const cfg = normalizeConfig({})
const resolved = { provider: 'deepseek-official', model: 'deepseek-flash' }
const FENCE = String.fromCharCode(96).repeat(3)

/** Build a signals object with sane defaults. */
function sig(over) {
  return Object.assign(
    { text: '', turn: 1, toolCalls: 0, hasImage: false, escalations: 0, carry: 0 },
    over
  )
}

const BRIEF = '重构 架构 设计 规划 迁移 优化 性能 并发 并行 调试 诊断'

test('trivial: a short cheap-intent step disables thinking', () => {
  const d = decideRoute(cfg, resolved, sig({ text: '翻译这句话：hello world' }))
  assert.equal(d.stepClass, 'trivial')
  assert.equal(d.effort, 'off')
  assert.equal(d.model, 'deepseek-flash')
})

test('standard: a plain short request runs at low', () => {
  const d = decideRoute(cfg, resolved, sig({ text: '帮我看看这段说明对不对' }))
  assert.equal(d.stepClass, 'standard')
  assert.equal(d.effort, 'low')
})

test('engineering: code markup lands on the workhorse effort', () => {
  const d = decideRoute(cfg, resolved, sig({ text: FENCE + 'js\nconst a = 1\n' + FENCE }))
  assert.equal(d.stepClass, 'engineering')
  assert.equal(d.effort, 'high')
})

test('engineering: an agent tool loop counts even with short text', () => {
  const d = decideRoute(cfg, resolved, sig({ text: 'continue', toolCalls: 5 }))
  assert.equal(d.stepClass, 'engineering')
  assert.equal(d.effort, 'high')
})

test('hard: a dense brief is clamped back to high by default', () => {
  const d = decideRoute(cfg, resolved, sig({ text: BRIEF }))
  assert.equal(d.stepClass, 'hard')
  assert.equal(d.effort, 'high')
  assert.equal(d.clamped, true)
  assert.ok(d.reason.some((r) => r.includes('max is opt-in')))
})

test('allowMax: hard reaches max only when the gate is open', () => {
  const cfgMax = normalizeConfig({ allowMax: true })
  const d = decideRoute(cfgMax, resolved, sig({ text: BRIEF }))
  assert.equal(d.stepClass, 'hard')
  assert.equal(d.effort, 'max')
  assert.equal(d.clamped, false)
})

test('the router only ever emits the one configured model', () => {
  const corpus = ['翻译 hi', '帮我看看', 'continue', BRIEF, FENCE + 'js' + FENCE]
  for (const text of corpus) {
    for (const toolCalls of [0, 5]) {
      for (const escalations of [0, 1, 2]) {
        const d = decideRoute(cfg, resolved, sig({ text, toolCalls, escalations, carry: 1 }))
        assert.equal(d.model, 'deepseek-flash')
      }
    }
  }
  assert.equal('proModel' in cfg, false)
  assert.equal(cfg.model, 'deepseek-flash')
})

test('a conversation sitting on another deepseek model is pulled back', () => {
  const d = decideRoute(cfg, { provider: 'deepseek-official', model: 'deepseek-v4-pro' }, sig({ text: 'refactor the parser' }))
  assert.equal(d.model, 'deepseek-flash')
  assert.equal(d.effort, 'high')
  assert.equal(d.stepClass, 'engineering')
})

test('no ratchet: a very long run never climbs out of engineering', () => {
  const early = decideRoute(cfg, resolved, sig({ text: 'continue', turn: 1, toolCalls: 1 }))
  const late = decideRoute(cfg, resolved, sig({ text: 'continue', turn: 120, toolCalls: 400 }))
  assert.equal(early.stepClass, 'engineering')
  assert.equal(late.stepClass, 'engineering')
  assert.equal(late.effort, early.effort)
})

test('no ratchet: turn depth contributes no score by default', () => {
  const early = scoreOf(sig({ text: 'continue', turn: 1, toolCalls: 3 }), cfg)
  const late = scoreOf(sig({ text: 'continue', turn: 99, toolCalls: 3 }), cfg)
  assert.equal(early.score, late.score)
})

test('evidence escalation lifts a standard step to engineering', () => {
  const d = decideRoute(cfg, resolved, sig({ text: '帮我看看', escalations: 1 }))
  assert.equal(d.stepClass, 'engineering')
  assert.equal(d.effort, 'high')
})

test('evidence escalation is capped, and capped max falls back', () => {
  const d = decideRoute(cfg, resolved, sig({ text: '帮我看看', escalations: 99 }))
  assert.equal(d.stepClass, 'hard')
  assert.equal(d.effort, 'high')
})

test('escalation and carry only lift real work', () => {
  assert.equal(decideRoute(cfg, resolved, sig({ text: '翻译这句话', carry: 1 })).stepClass, 'trivial')
  assert.equal(decideRoute(cfg, resolved, sig({ text: '帮我看看', carry: 1 })).stepClass, 'standard')
  assert.equal(decideRoute(cfg, resolved, sig({ text: 'continue', toolCalls: 2, carry: 1 })).stepClass, 'hard')
})

test('property: auto mode never emits max across a signal sweep', () => {
  const corpus = ['翻译 hello', 'continue', BRIEF, 'explain this', 'refactor the parser and add tests']
  for (const text of corpus) {
    for (const toolCalls of [0, 3, 50]) {
      for (const escalations of [0, 1, 2]) {
        for (const carry of [0, 1]) {
          const d = decideRoute(cfg, resolved, sig({ text, toolCalls, escalations, carry, turn: 7 }))
          assert.notEqual(d.effort, 'max')
        }
      }
    }
  }
})

test('the auto-max invariant survives a hostile route table', () => {
  const hostile = normalizeConfig({
    routes: {
      trivial: { effort: 'max' },
      standard: { effort: 'max' },
      engineering: { effort: 'max' },
      hard: { effort: 'max' },
    },
  })
  for (const text of ['翻译 hi', '帮我看看', 'continue', BRIEF]) {
    const d = decideRoute(hostile, resolved, sig({ text, toolCalls: 4 }))
    assert.notEqual(d.effort, 'max')
    assert.equal(d.effort, 'high')
  }
})

test('clampEffort: max is opt-in', () => {
  assert.deepEqual(clampEffort('max', cfg), {
    effort: 'high',
    changed: true,
    why: 'max is opt-in; fell back to high',
  })
  assert.equal(clampEffort('max', normalizeConfig({ allowMax: true })).changed, false)
  assert.equal(clampEffort('high', cfg).changed, false)
  assert.equal(clampEffort('off', cfg).effort, 'off')
  assert.equal(clampEffort('max', normalizeConfig({ maxFallback: 'low' })).effort, 'low')
})

test('isFlashFamily covers current and retired ids', () => {
  assert.equal(isFlashFamily('deepseek-flash', cfg), true)
  assert.equal(isFlashFamily('deepseek-v4-flash', cfg), true)
  assert.equal(isFlashFamily('deepseek-v4-flash-vision-exp', cfg), true)
  assert.equal(isFlashFamily('deepseek-v4-pro', cfg), false)
  assert.equal(isFlashFamily(undefined, cfg), false)
})

test('decideRoute passes through requests it must not own', () => {
  assert.equal(decideRoute(normalizeConfig({ mode: 'off' }), resolved, sig({ text: 'refactor' })), null)
  assert.equal(decideRoute(cfg, { provider: 'other', model: 'deepseek-flash' }, sig({ text: 'refactor' })), null)
  assert.equal(decideRoute(cfg, { provider: 'deepseek-official', model: 'gpt-5' }, sig({ text: 'refactor' })), null)
  assert.equal(decideRoute(cfg, resolved, sig({ text: 'refactor', hasImage: true })), null)
  assert.equal(decideRoute(cfg, { provider: 'deepseek-official' }, sig({ text: 'refactor' })), null)
})

test('imagePolicy flash lets image steps be routed', () => {
  const c = normalizeConfig({ imagePolicy: 'flash' })
  const d = decideRoute(c, resolved, sig({ text: 'read this screenshot', hasImage: true }))
  assert.equal(d.model, 'deepseek-flash')
})

test('tool evidence: isError and exit-code text are both failures', () => {
  const result = (text, isError) => [
    { type: 'tool-result', toolCallId: 'c1', isError, content: [{ type: 'text', text }] },
  ]
  assert.equal(toolErrorsOf(result('ok', undefined)), 0)
  assert.equal(toolErrorsOf(result('boom', true)), 1)
  assert.equal(toolErrorsOf(result('[exit code: 1]', undefined)), 1)
  assert.equal(toolErrorsOf(result('[exit code: 0]', undefined)), 0)
  assert.equal(toolErrorsOf(result('0 errors found', undefined)), 0)
  assert.equal(toolErrorsOf(result('Traceback (most recent call last)', undefined)), 1)
  assert.equal(toolErrorsOf(undefined), 0)
})

test('toolCallsOf keys on name plus arguments', () => {
  const calls = toolCallsOf([{ type: 'tool-call', id: '1', name: 'read', arguments: '{"file_path":"a"}' }])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'read')
  assert.equal(calls[0].key, 'read|{"file_path":"a"}')
  assert.equal(toolCallsOf([{ type: 'text', text: 'hi' }]).length, 0)
  assert.equal(toolCallsOf(undefined).length, 0)
})

test('escalateClass walks the ladder and stops at the ceiling', () => {
  assert.equal(escalateClass('trivial', 1), 'standard')
  assert.equal(escalateClass('standard', 1), 'engineering')
  assert.equal(escalateClass('engineering', 2), 'hard')
  assert.equal(escalateClass('engineering', 9), 'hard')
  assert.equal(escalateClass('nonsense', 1), 'engineering')
})

test('normalizeConfig merges routes and compiles the family regex', () => {
  const c = normalizeConfig({ routes: { engineering: { effort: 'low' } } })
  assert.equal(c.routes.engineering.effort, 'low')
  assert.equal(c.routes.hard.effort, 'max')
  assert.ok(c.familyRe instanceof RegExp)
  assert.ok(normalizeConfig({ familyPattern: '[' }).familyRe instanceof RegExp)
})

test('content helpers', () => {
  assert.equal(textOfContent('hi'), 'hi')
  assert.equal(textOfContent([{ type: 'text', text: 'a' }, { type: 'image' }]), 'a [image] ')
  assert.equal(contentHasImage([{ type: 'tool-result', content: [{ type: 'image' }] }]), true)
  assert.equal(contentHasImage([{ type: 'text', text: 'a' }]), false)
})

test('documented presets and shipped routes', () => {
  assert.equal(EFFORT_POINTS.low, 50)
  assert.equal(EFFORT_POINTS.high, 75)
  assert.equal(EFFORT_POINTS.max, 100)
  assert.equal(AUTO_CEILING, 'hard')
  assert.equal(DEFAULT_ROUTES.hard.effort, 'max')
  assert.equal(DEFAULT_ROUTES.engineering.effort, 'high')
})

test('classifyStep only ever returns a known class', () => {
  const corpus = ['', '翻译 hi', '帮我看看', 'continue', BRIEF, FENCE + 'js' + FENCE, 'a'.repeat(400)]
  for (const text of corpus) {
    for (const toolCalls of [0, 9]) {
      assert.ok(STEP_CLASSES.includes(classifyStep(sig({ text, toolCalls }), cfg).stepClass))
    }
  }
})
