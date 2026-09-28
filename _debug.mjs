
import { normalizeRuntimeConfig } from './lib/config.js'
import { effortTierForClass, mapEffort } from './lib/routing.js'
import { classifyStep, scoreOf } from './lib/policy.js'
const cfg = normalizeRuntimeConfig({ allowThinkingOff: true, routes: { trivial: { effort: 'off' } } })
console.log('allowThinkingOff =', cfg.allowThinkingOff, '| routes.trivial =', JSON.stringify(cfg.routes.trivial))
console.log('tier =', effortTierForClass(cfg, 'trivial'), '| mapEffort =', mapEffort('off', ['off','low','high','max']))
console.log('pool =', cfg.pool.map(e => e.id), '| control =', cfg.control)
const base = { text: '翻译这句话：hello world', turn: 1, toolCalls: 0, hasImage: false, escalations: 0, carry: 0 }
console.log('class =', classifyStep(base, cfg).stepClass, '| score =', scoreOf(base, cfg).score)

// now drive the real plugin with a double
import { apply } from './lib/index.js'
const logs = []
const handlers = new Map()
const ctx = {
  logger: () => ({ info: (...a) => logs.push('INFO ' + a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')) }),
  on: (n, fn) => { const l = handlers.get(n); if (l) l.push(fn); else handlers.set(n, [fn]) },
  get: () => undefined,
  inject: () => {},
}
apply(ctx, { allowThinkingOff: true, routes: { trivial: { effort: 'off' } } })
const agent = { session: { deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: '翻译这句话：hello world' }] }] } }
for (const fn of handlers.get('agent/inbox/claimed') || []) fn({ agent, turn: 1, message: { content: '翻译这句话：hello world' } })
const fns = handlers.get('agent/request') || []
const seed = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }
const run = (i) => i >= fns.length ? Promise.resolve(seed) : fns[i]({ agent, turn: 1, step: 0 }, () => run(i + 1))
const out = await run(0)
console.log('RESULT effort =', out.reasoningEffort, '| model =', out.model)
console.log(logs.join('\n'))
