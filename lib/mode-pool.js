/**
 * dsh-model-router — the agent-preset mode pool (v1.1).
 *
 * DSH ships four agent presets ("modes" in the UI): standard, ptc, minimal and
 * cordis. They are not equal-cost: ptc pays for the batch tool loop, minimal
 * gives up the coding persona and the todo tool, cordis mounts a plugin
 * development sandbox that a plain edit does not need. Picking one per task by
 * hand is a decision the router can make from the first message of a session.
 *
 * Two hard host facts shape this module:
 *   1. An agent preset can only be selected before a session appends its first
 *      `turn/start`. Afterwards agentPresets.select() rejects with
 *      `agent-preset/locked`. So the mode is chosen once, from the first
 *      message, and never changed inside the session.
 *   2. Classification must be cheap and synchronous: it runs inside the
 *      `agent/inbox/inserted` listener, before the host starts the turn. No
 *      model call, no I/O — keyword scores only. A wrong guess costs less than
 *      the round trip it would take to ask.
 *
 * Everything here is pure so the scoring can be tested without a host.
 */

/**
 * The four shipped agent presets, in the order the UI lists them.
 * Kept as data rather than discovered at runtime: the pool has to be
 * meaningful before any service is available (a config file, a test).
 */
export const MODE_IDS = Object.freeze(['standard', 'ptc', 'minimal', 'cordis'])

/** One-line description per mode, used by `/router modes` and the docs. */
export const MODE_HINTS = Object.freeze({
  standard: 'coding assistant with the full tool set — the balanced default',
  ptc: 'standard plus programmatic tool calling — batch work over many files',
  minimal: 'no coding persona, no todo tool — tiny edits and one-off questions',
  cordis: 'plugin development sandbox — writing or debugging DSH extensions',
})

/**
 * Keyword evidence per mode, as [needle, weight] pairs.
 *
 * English needles are matched against the lower-cased text, Chinese ones
 * against the raw text (no case to fold). A needle is a plain substring, not a
 * word boundary match, because Chinese has no spaces to anchor on and an
 * English false positive inside a longer word is rare enough to ignore.
 */
const EVIDENCE = Object.freeze({
  ptc: Object.freeze([
    ['批量', 6], ['批处理', 5], ['批量处理', 6], ['一次性处理', 4], ['去重', 5], ['汇总', 4],
    ['统计', 4], ['整理', 3], ['筛选', 5], ['遍历', 4], ['逐个', 3], ['每个文件', 4],
    ['所有文件', 3], ['全部文件', 3], ['清单', 2], ['表格', 2], ['生成报表', 4],
    ['bulk', 6], ['batch', 5], ['every file', 4], ['all files', 3], ['dedupe', 5],
    ['deduplicate', 5], ['aggregate', 4], ['summarize all', 4], ['tabulate', 4],
    ['extract all', 4], ['across the repo', 3], ['across all', 3],
  ]),
  minimal: Object.freeze([
    ['翻译', 5], ['改个名字', 5], ['改名字', 4], ['重命名', 5], ['格式化', 4], ['拼写', 5],
    ['错别字', 5], ['一行', 4], ['一句话', 3], ['是什么', 3], ['只改', 4], ['只替换', 4],
    ['快速回答', 4], ['简单问', 3], ['叫什么', 3],
    ['typo', 5], ['rename', 5], ['one-liner', 5], ['one line', 4], ['translate', 4],
    ['format this', 3], ['what is', 2], ['explain briefly', 3], ['just tell me', 3],
  ]),
  cordis: Object.freeze([
    ['插件', 6], ['写个插件', 6], ['写一个插件', 6], ['扩展 dsh', 6], ['cordis', 6],
    ['服务注入', 5], ['注入服务', 5], ['宿主契约', 4], ['钩子', 3], ['agent preset', 4],
    ['plugin', 6], ['extension point', 4], ['ctx.inject', 5], ['ctx.on', 4],
  ]),
  standard: Object.freeze([
    ['重构', 3], ['实现', 2], ['修复', 2], ['调试', 2], ['测试用例', 2], ['审查', 2],
    ['refactor', 3], ['implement', 2], ['fix', 2], ['debug', 2], ['add a test', 2],
  ]),
})

/** Tie-break order: the balanced default wins a draw, then the pool's order. */
const TIE_ORDER = Object.freeze(['standard', 'ptc', 'minimal', 'cordis'])

/**
 * Normalize a mode pool: known ids only, deduplicated, order preserved.
 * An unknown id is dropped silently rather than throwing, because the pool is
 * written from a panel that may be newer than this host.
 */
export function normalizeModes(value) {
  if (!Array.isArray(value)) return Object.freeze([])
  const out = []
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!MODE_IDS.includes(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return Object.freeze(out)
}

/** Whether a value is one of the four shipped mode ids. */
export function isKnownMode(value) {
  return typeof value === 'string' && MODE_IDS.includes(value)
}

/** Score one mode against a text. Exported for the tests and for /router modes. */
export function scoreMode(id, text) {
  const evidence = EVIDENCE[id]
  if (!evidence || typeof text !== 'string' || text.length === 0) return { score: 0, hits: [] }
  const lower = text.toLowerCase()
  let score = 0
  const hits = []
  for (const [needle, weight] of evidence) {
    const haystack = /[\u4e00-\u9fff]/.test(needle) ? text : lower
    if (!haystack.includes(needle)) continue
    score += weight
    hits.push(needle)
  }
  return { score, hits }
}

/**
 * Pick the mode that fits one message, restricted to the pool.
 *
 * @param {string} text - the first user message of the session.
 * @param {{modes?: readonly string[]}} options - the pool; empty or missing
 *   means the feature is off and nothing is recommended.
 * @returns {{id: string, why: string, scores: Record<string, number>} | null}
 *   null when the pool is empty or no mode has any evidence — an unanswered
 *   classification must not move the user's session.
 */
export function classifyMode(text, options = {}) {
  const pool = normalizeModes(options && options.modes)
  if (pool.length === 0) return null
  // A one-mode pool is not a classification problem: the user already said
  // which mode every session should use.
  if (pool.length === 1) {
    return { id: pool[0], why: 'the only mode in the pool', scores: { [pool[0]]: 0 } }
  }
  const scores = {}
  const hits = {}
  for (const id of pool) {
    const scored = scoreMode(id, text)
    scores[id] = scored.score
    hits[id] = scored.hits
  }
  const best = pool.slice().sort((a, b) => {
    if (scores[b] !== scores[a]) return scores[b] - scores[a]
    return TIE_ORDER.indexOf(a) - TIE_ORDER.indexOf(b)
  })[0]
  if (scores[best] <= 0) return null
  const why = hits[best].slice(0, 3).join(', ')
  return { id: best, why: why.length > 0 ? 'matched ' + why : 'the highest score in the pool', scores }
}

/** Every mode in the pool with its one-line hint, for /router and the panel. */
export function describeModes(pool) {
  return normalizeModes(pool).map((id) => ({ id, hint: MODE_HINTS[id] }))
}
