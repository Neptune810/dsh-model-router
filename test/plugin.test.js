import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

/** Minimal ctx double: captures listeners and log lines. */
function makeCtx() {
  const handlers = new Map()
  const logs = []
  const logger = {
    info: (...a) => logs.push(['info', a.map(String).join(' ')]),
    warn: (...a) => logs.push(['warn', a.map(String).join(' ')]),
  }
  const ctx = {
    logger: () => logger,
    on: (name, fn) => {
      handlers.set(name, fn)
    },
  }
  return { ctx, handlers, logs }
}

/** Minimal agent double backed by a mutable message projection. */
function makeAgent() {
  const state = { messages: [] }
  const agent = { session: { deriveMessages: () => state.messages } }
  return { agent, state }
}

const userText = (text) => ({ role: 'user', content: [{ type: 'text', text }] })
const toolCall = (id, name, args) => ({ role: 'assistant', content: [{ type: 'tool-call', id, name, arguments: args }] })
const toolResult = (id, text, isError) => ({
  role: 'user',
  content: [{ type: 'tool-result', toolCallId: id, isError, content: [{ type: 'text', text }] }],
})

const resolved = (over) =>
  Object.assign({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }, over)

test('apply registers both listeners and logs readiness', () => {
  const { ctx, handlers, logs } = makeCtx()
  apply(ctx, {})
  assert.ok(handlers.has('agent/inbox/claimed'))
  assert.ok(handlers.has('agent/request'))
  assert.ok(logs.some((l) => l[1].includes('model-router ready')))
  assert.ok(logs.some((l) => l[1].includes('flash-only')))
})

test('a cheap step runs with thinking disabled', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, {})
  const { agent, state } = makeAgent()

  handlers.get('agent/inbox/claimed')({ agent, turn: 1, message: { content: '翻译这句话：hello world' } })
  state.messages = [userText('翻译这句话：hello world')]

  const out = await handlers.get('agent/request')({ agent, turn: 1, step: 0 }, async () => resolved())
  assert.equal(out.model, 'deepseek-flash')
  assert.equal(out.reasoningEffort, 'off')
})

test('repeated failing tool calls escalate within the task, and the next task resets', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, {})
  const { agent, state } = makeAgent()

  handlers.get('agent/inbox/claimed')({ agent, turn: 1, message: { content: 'fix the parser test' } })
  state.messages = [
    userText('fix the parser test'),
    toolCall('c1', 'pwsh', '{"command":"node --test"}'),
    toolResult('c1', 'boom', true),
    toolCall('c2', 'pwsh', '{"command":"node --test"}'),
    toolResult('c2', 'boom', true),
  ]

  const escalated = await handlers.get('agent/request')({ agent, turn: 1, step: 4 }, async () => resolved({ reasoningEffort: 'low' }))
  assert.equal(escalated.model, 'deepseek-flash')
  assert.equal(escalated.reasoningEffort, 'high')

  handlers.get('agent/inbox/claimed')({ agent, turn: 2, message: { content: '翻译 hi' } })
  state.messages = state.messages.concat([userText('翻译 hi')])
  const fresh = await handlers.get('agent/request')({ agent, turn: 2, step: 5 }, async () => resolved())
  assert.equal(fresh.reasoningEffort, 'off')
})

test('a long quiet tool loop stays at high, never at max', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, {})
  const { agent, state } = makeAgent()

  handlers.get('agent/inbox/claimed')({ agent, turn: 1, message: { content: 'work through the checklist' } })
  const messages = [userText('work through the checklist')]
  for (let i = 0; i < 60; i += 1) {
    messages.push(toolCall('c' + i, 'read', '{"file_path":"f' + i + '"}'))
    messages.push(toolResult('c' + i, 'ok', undefined))
  }
  state.messages = messages

  const out = await handlers.get('agent/request')({ agent, turn: 40, step: 120 }, async () => resolved())
  assert.equal(out.model, 'deepseek-flash')
  assert.equal(out.reasoningEffort, 'high')
})

test('off mode passes through, but a manual max on a managed model is demoted', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, { mode: 'off' })
  const { agent } = makeAgent()

  const kept = await handlers.get('agent/request')({ agent, turn: 1, step: 0 }, async () =>
    resolved({ model: 'deepseek-v4-pro', reasoningEffort: 'max' })
  )
  assert.equal(kept.reasoningEffort, 'max')

  const demoted = await handlers.get('agent/request')({ agent, turn: 1, step: 1 }, async () =>
    resolved({ model: 'deepseek-v4-flash', reasoningEffort: 'max' })
  )
  assert.equal(demoted.reasoningEffort, 'high')
})

test('allowMax turns off both clamps', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, { mode: 'off', allowMax: true })
  const { agent } = makeAgent()
  const out = await handlers.get('agent/request')({ agent, turn: 1, step: 0 }, async () =>
    resolved({ reasoningEffort: 'max' })
  )
  assert.equal(out.reasoningEffort, 'max')
})

test('a foreign provider is never taken over', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, {})
  const { agent } = makeAgent()
  const out = await handlers.get('agent/request')({ agent, turn: 1, step: 0 }, async () =>
    resolved({ provider: 'someone-else', model: 'gpt-5', reasoningEffort: 'low' })
  )
  assert.equal(out.provider, 'someone-else')
  assert.equal(out.model, 'gpt-5')
  assert.equal(out.reasoningEffort, 'low')
})

test('an image step keeps the caller model by default', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, {})
  const { agent, state } = makeAgent()

  handlers.get('agent/inbox/claimed')({ agent, turn: 1, message: { content: 'read this screenshot' } })
  state.messages = [{ role: 'user', content: [{ type: 'text', text: 'read this screenshot' }, { type: 'image' }] }]

  const out = await handlers.get('agent/request')({ agent, turn: 1, step: 0 }, async () =>
    resolved({ model: 'some-vision-model', reasoningEffort: 'low' })
  )
  assert.equal(out.model, 'some-vision-model')
})

test('an unreadable projection degrades to a cheap default instead of throwing', async () => {
  const { ctx, handlers, logs } = makeCtx()
  apply(ctx, {})
  const broken = { session: { deriveMessages: () => { throw new Error('projection down') } } }
  const out = await handlers.get('agent/request')({ agent: broken, turn: 1, step: 0 }, async () => resolved())
  assert.equal(out.model, 'deepseek-flash')
  assert.equal(out.reasoningEffort, 'low')
  assert.ok(logs.some((l) => l[1].includes('deriveMessages failed')))
})

test('auto mode pulls a pro conversation back to the flash model', async () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, {})
  const { agent, state } = makeAgent()

  handlers.get('agent/inbox/claimed')({ agent, turn: 1, message: { content: 'refactor the parser' } })
  state.messages = [userText('refactor the parser')]

  const out = await handlers.get('agent/request')({ agent, turn: 1, step: 0 }, async () =>
    resolved({ model: 'deepseek-v4-pro', reasoningEffort: 'high' })
  )
  assert.equal(out.model, 'deepseek-flash')
  assert.equal(out.reasoningEffort, 'high')
})
