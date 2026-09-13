/**
 * dsh-model-router — routing policy engine (pure, no platform imports).
 *
 * v0.3 "flash-only, effort-only" policy.
 *
 * ONE model. The only thing this router changes is the reasoning effort of the
 * DeepSeek flash model. There is no pro tier to fall back to, so "how hard
 * should this step think?" is the entire routing problem.
 *
 * Four rules:
 *
 *   1. Cheap by default. A step is classified by its SHAPE (what kind of work
 *      it is), not by a score that ratchets upward as the session grows. A long
 *      agent run is not a harder task, so turn depth and cumulative tool-call
 *      counts no longer raise the effort on their own.
 *   2. Escalate on evidence. Repeated tool failures, or the same tool call
 *      retried with identical arguments, step the class up — at most
 *      maxEscalations times per task. Nothing else moves it.
 *   3. "high" is the ceiling for automatic routing. Auto mode never emits
 *      effort "max" unless allowMax is set. max costs roughly 1.6-1.8x the
 *      output tokens for a marginal gain and measures WORSE than high on long
 *      agent trajectories, so it is opt-in rather than earned.
 *   4. A manually selected max is demoted too (demoteManualMax), unless
 *      allowMax is on.
 *
 * Class -> effort:
 *   trivial     -> off    (cheap intent, short step: thinking adds nothing)
 *   standard    -> low
 *   engineering -> high   (the workhorse: code, diffs, tool loops)
 *   hard        -> max    (opt-in only; falls back to maxFallback otherwise)
 *
 * Every number is deterministic and overridable through the plugin row config.
 * The module has zero imports, so it is unit-testable anywhere.
 */

/** Legal DeepSeek reasoning efforts on the wire (adapter vocabulary). */
export const EFFORTS = Object.freeze(["off", "low", "high", "max"])

/**
 * The documented preset points behind the named efforts. V4.1-Flash drives
 * effort from an internal 1-100 scalar and exposes three preset names; the
 * adapter only serializes the names, so these points are documentation used for
 * logging and for reasoning about cost. "high" (75) is the sweet spot.
 */
export const EFFORT_POINTS = Object.freeze({ off: 0, low: 50, high: 75, max: 100 })

/** Step classes, ascending by effort. */
export const STEP_CLASSES = Object.freeze(["trivial", "standard", "engineering", "hard"])

/** The highest class the ladder reaches. "hard" is where max lives. */
export const AUTO_CEILING = "hard"

/** Class -> effort. No model here: the router is flash-only. */
export const DEFAULT_ROUTES = Object.freeze({
  trivial: Object.freeze({ effort: "off" }),
  standard: Object.freeze({ effort: "low" }),
  engineering: Object.freeze({ effort: "high" }),
  hard: Object.freeze({ effort: "max" }),
})

/** Shipped defaults; every key may be overridden by the plugin row config. */
export const DEFAULT_CONFIG = Object.freeze({
  /** Master switch. "auto" routes per step; "off" passes requests through untouched. */
  mode: "auto",
  /** Provider route that owns the conversation (see dsh-llm-deepseek). */
  provider: "deepseek-official",
  /** The one model this router drives. deepseek-flash is DeepSeek-V4.1-Flash. */
  model: "deepseek-flash",
  /** Retired flash ids still accepted by the API; treated as managed models. */
  legacyFlashModels: Object.freeze(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]),
  /** Regex of conversation models this router is allowed to take over. */
  familyPattern: "^deepseek-(flash|v4)",

  /**
   * Rule 3 — automatic routing never reaches effort "max" while this is false.
   * Turn it on only for one-shot hard problems; it is a losing trade in loops.
   */
  allowMax: false,
  /** What "max" collapses to when allowMax is false. */
  maxFallback: "high",
  /** Rule 4 — also demote a manually selected max on a managed model. */
  demoteManualMax: true,

  /** When a step carries images, keep the caller's model (default). */
  leaveImageSteps: true,
  /** "keep" leaves image steps alone; "flash" routes them to the managed model. */
  imagePolicy: "keep",

  /** Rule 2 — evidence thresholds, counted inside one task. */
  escalateOnErrors: 2,
  escalateOnRepeats: 3,
  maxEscalations: 2,
  /** Carry one hesitant step up when the previous task ended on an unresolved failure. */
  carryUnresolved: true,

  /**
   * Complexity scoring weights. This score is informational and acts only as a
   * tiebreaker (see scoring.hardScore); the step CLASS drives the effort.
   * turnPerPoint defaults to 0 on purpose: a long agent run is not a harder task.
   */
  scoring: {
    lengthPerPoint: 6,
    lengthCap: 26,
    codeSignal: 9,
    strongVerbPerHit: 4,
    strongVerbCap: 24,
    denseStrongThreshold: 5,
    denseStrongBonus: 20,
    denseStrongBig: 10,
    denseStrongBigBonus: 24,
    normalVerbPerHit: 2,
    normalVerbCap: 6,
    planSignal: 6,
    bulletSignal: 6,
    bulletMinLines: 4,
    turnPerPoint: 0,
    turnCap: 3,
    toolCallBase: 5,
    toolCallAt: 3,
    toolCallBig: 8,
    /** An engineering-class step scoring at least this high is promoted to hard. */
    hardScore: 82,
    /** A cheap-intent step stays trivial only while at most this many tokens. */
    trivialTokenCap: 60,
  },

  /** Engineering cues: any hit means the step is at least "engineering". */
  strong: [
    // en
    "refactor", "rewrite", "architect", "architecture", "design", "planning",
    "migrat", "optimiz", "performance", "concurr", "parallel", "debug",
    "diagnos", "implement", "integr", "deploy", "release", "secure",
    "encrypt", "protocol", "algorithm", "distributed", "high-avail",
    "deadlock", "thread", "multi-thread", "cache", "index", "regression",
    "benchmark", "dependency", "modular", "scalab", "parse", "compile",
    "reproduc", "complex", "asynchron", "crash", "race", "deadline",
    "pipeline", "replicat", "consisten", "transact", "auth", "api",
    // zh
    "重构", "架构", "设计", "规划", "迁移", "优化", "性能", "并发", "并行",
    "调试", "诊断", "排查", "实现", "集成", "部署", "发布", "安全", "加密",
    "协议", "算法", "数据结构", "分布式", "高并发", "压测", "兼容", "异常",
    "崩溃", "死锁", "多线程", "缓存", "索引", "回归", "基准", "遥测",
    "依赖", "模块化", "扩展", "解析", "编译", "异步", "竞态", "流水线",
    "副本", "一致性", "事务", "鉴权", "认证",
  ],
  /** Light cues: raise the score, never the class. */
  normal: [
    // en
    "explain", "summarize", "translate", "suggest", "format", "typo",
    "rename", "help me", "what is", "write a", "short", "simple",
    // zh
    "解释", "总结", "翻译", "推荐", "格式化", "错别字", "改名", "简单",
    "简短", "帮我看看", "说明一下",
  ],
  /**
   * Cheap-intent cues: reasoning adds nothing here. A short step matching one
   * of these is routed to thinking-off.
   */
  cheap: [
    // en
    "translate", "rename", "typo", "reformat", "format this", "summarize",
    "one-liner", "what does", "what is", "who is", "define ", "spell",
    // zh
    "翻译", "改名", "重命名", "错别字", "格式化", "总结一下", "一句话",
    "是什么", "谁是", "什么意思",
  ],
})

/** Normalize a config: defaults first, callers override, routes merged per class. */
export function normalizeConfig(input = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...input }
  cfg.scoring = { ...DEFAULT_CONFIG.scoring, ...(input.scoring ?? {}) }
  const routes = {}
  const given = input.routes && typeof input.routes === "object" ? input.routes : {}
  for (const key of STEP_CLASSES) routes[key] = { ...DEFAULT_ROUTES[key], ...(given[key] ?? {}) }
  cfg.routes = routes
  // Precompile the family regex once instead of on every request.
  try {
    cfg.familyRe = new RegExp(cfg.familyPattern)
  } catch (error) {
    cfg.familyRe = new RegExp(DEFAULT_CONFIG.familyPattern)
  }
  return cfg
}

const TRIPLE_TICK = String.fromCharCode(96).repeat(3)

/** Extract plain text from a message content block list (or string). */
export function textOfContent(content) {
  if (content == null) return ""
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    let out = ""
    for (const part of content) {
      if (part == null) continue
      if (typeof part === "string") out += part
      else if (part.type === "text" && typeof part.text === "string") out += part.text
      else if (part.type === "image") out += " [image] "
      else if (part.type === "tool-result" && part.content) out += textOfContent(part.content)
    }
    return out
  }
  return ""
}

/** Does a content block list carry an image? */
export function contentHasImage(content) {
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && part.type === "image") return true
      if (part && part.type === "tool-result" && contentHasImage(part.content)) return true
    }
  }
  return false
}

/** Tool calls issued by one assistant message: [{ name, key }]. */
export function toolCallsOf(content) {
  const out = []
  if (!Array.isArray(content)) return out
  for (const part of content) {
    if (!part || part.type !== "tool-call") continue
    const name = String(part.name ?? "")
    const args = String(part.arguments ?? "")
    out.push({ name, key: name + "|" + (args.length > 400 ? args.slice(0, 400) : args) })
  }
  return out
}

/**
 * Strong textual failure markers inside a tool result. The harness reports a
 * non-zero process exit as "[exit code: N]", the most reliable signal available.
 */
export const ERROR_TEXT = /\[exit code: [1-9][0-9]*\]|(?:^|\n)\s*(?:Traceback \(most recent call last\)|Errors?:|Exception|FATAL|Fatal error|panic:|错误|失败|异常|报错)/

/** How many tool results in one message look like failures. */
export function toolErrorsOf(content) {
  let errors = 0
  if (!Array.isArray(content)) return 0
  for (const part of content) {
    if (!part || part.type !== "tool-result") continue
    if (part.isError === true) {
      errors += 1
      continue
    }
    if (ERROR_TEXT.test(textOfContent(part.content))) errors += 1
  }
  return errors
}

/** Count keywords present (case-insensitive substring). */
function hits(text, words) {
  const lower = text.toLowerCase()
  let count = 0
  for (const word of words) if (lower.includes(String(word).toLowerCase())) count += 1
  return count
}

/** Rough token count: latin words plus CJK characters. */
function tokenEstimate(text) {
  const latin = (text.match(/[A-Za-z0-9_'-]+/g) || []).length
  let cjk = 0
  for (const ch of text) if (/[\u3400-\u9fff\uF900-\uFAFF]/.test(ch)) cjk += 1
  return latin + cjk
}

/** Does the text carry code / diff / markup structure? */
export function isStructural(text, lower) {
  const fenceCount = (text.split(TRIPLE_TICK).length - 1) / 2
  const diffLike = /\bdiff\s+--git\b|\b---\s+a\/|\+\+\+\s+b\//.test(text)
  const xmlLike = /<\/?[a-zA-Z][\w-]*(?:\s[^>]*)?>/.test(text)
  return fenceCount >= 1 || diffLike || xmlLike ||
    /\b(?:function|class|interface|const|let|def|import\s|from\s|=>)\b/.test(lower)
}

/** Does the text read like a multi-step plan? */
export function isPlanLike(lower, text, cfg = DEFAULT_CONFIG) {
  if (/step\s+by\s+step|first\s*[,.]|then\s*[,.]|步骤|首先|然后|按以下|如下/.test(lower)) return true
  const bulletLines = (text.split("\n") ?? []).filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l)).length
  if (bulletLines >= cfg.scoring.bulletMinLines) return true
  return (text.match(/\d+[).]/g) || []).length >= 3
}

/**
 * Deterministic complexity score in [0, 100]. Informational: the class comes
 * from classifyStep, and this score only breaks the engineering/hard tie.
 * @returns an object { score, reason }.
 */
export function scoreOf(signals, cfg = DEFAULT_CONFIG) {
  const s = cfg.scoring
  const text = signals.text ?? ""
  const lower = text.toLowerCase()
  const reason = []

  let score = 6
  if (text) {
    score += Math.min(s.lengthCap, Math.floor(tokenEstimate(text) / s.lengthPerPoint))
    if (isStructural(text, lower)) {
      score += s.codeSignal
      reason.push("code/diff markup")
    }
  }
  const strong = hits(text, cfg.strong)
  const normal = hits(text, cfg.normal)
  if (strong > 0) {
    score += Math.min(s.strongVerbCap, strong * s.strongVerbPerHit)
    if (strong >= s.denseStrongBig) {
      score += s.denseStrongBigBonus
      reason.push("dense engineering brief (" + strong + ")")
    } else if (strong >= s.denseStrongThreshold) {
      score += s.denseStrongBonus
      reason.push("engineering brief (" + strong + ")")
    }
  }
  if (normal > 0) score += Math.min(s.normalVerbCap, normal * s.normalVerbPerHit)
  if (/step\s+by\s+step|first\s*[,.]|then\s*[,.]|步骤|首先|然后|按以下|如下/.test(lower)) {
    score += s.planSignal
    reason.push("multi-step request")
  }
  if (isPlanLike(lower, text, cfg)) {
    score += s.bulletSignal
    reason.push("structured list")
  }

  // Bounded and off by default: a long run must not inflate the effort.
  const turn = Number.isFinite(signals.turn) && signals.turn > 1 ? Math.min(s.turnCap, signals.turn - 1) : 0
  if (turn > 0 && s.turnPerPoint > 0) {
    score += turn * s.turnPerPoint
    reason.push("turn depth " + signals.turn)
  }

  const toolCalls = Number.isFinite(signals.toolCalls) ? signals.toolCalls : 0
  if (toolCalls >= s.toolCallBig) {
    score += s.toolCallBase + s.toolCallAt + 2
    reason.push("tool-heavy run (" + toolCalls + ")")
  } else if (toolCalls >= s.toolCallAt) {
    score += s.toolCallBase + s.toolCallAt
    reason.push("multi-tool run (" + toolCalls + ")")
  } else if (toolCalls >= 1) {
    score += s.toolCallBase
    reason.push("tool use (" + toolCalls + ")")
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reason }
}

/**
 * Classify one step by its shape. Escalation to "hard" through evidence is the
 * caller's job (see decideRoute); this only reads the brief itself.
 * @returns an object { stepClass, reason }.
 */
export function classifyStep(signals, cfg = DEFAULT_CONFIG) {
  const s = cfg.scoring
  const text = signals.text ?? ""
  const lower = text.toLowerCase()
  const strong = hits(text, cfg.strong)
  const cheap = hits(text, cfg.cheap)
  const structural = isStructural(text, lower)
  const toolActive = Number.isFinite(signals.toolCalls) && signals.toolCalls > 0

  if (strong >= s.denseStrongBig) {
    return { stepClass: "hard", reason: ["dense engineering brief (" + strong + " cues)"] }
  }
  if (strong >= s.denseStrongThreshold && (structural || isPlanLike(lower, text, cfg))) {
    return { stepClass: "hard", reason: ["structured engineering spec (" + strong + " cues)"] }
  }
  if (strong > 0 || structural || toolActive) {
    const why = strong > 0 ? "engineering cues (" + strong + ")"
      : structural ? "code/diff markup"
      : "agent tool loop"
    return { stepClass: "engineering", reason: [why] }
  }
  if (cheap > 0 && tokenEstimate(text) <= s.trivialTokenCap) {
    return { stepClass: "trivial", reason: ["cheap intent, short step"] }
  }
  return { stepClass: "standard", reason: [] }
}

/** Move up the class ladder by a number of steps, capped at AUTO_CEILING. */
export function escalateClass(stepClass, bumps = 1) {
  let index = STEP_CLASSES.indexOf(stepClass)
  if (index < 0) index = STEP_CLASSES.indexOf("standard")
  const limit = STEP_CLASSES.indexOf(AUTO_CEILING)
  const steps = Math.max(0, Number(bumps) || 0)
  return STEP_CLASSES[Math.min(limit, index + steps)]
}

/** Is a model id one this router manages (and whose max it may demote)? */
export function isFlashFamily(model, cfg = DEFAULT_CONFIG) {
  if (typeof model !== "string") return false
  const id = model.toLowerCase()
  if (id.includes("flash")) return true
  if (id === String(cfg.model ?? "").toLowerCase()) return true
  for (const legacy of cfg.legacyFlashModels ?? []) {
    if (id === String(legacy).toLowerCase()) return true
  }
  return false
}

/**
 * Apply rules 3 and 4 to one effort: max is opt-in.
 * @returns an object { effort, changed, why }.
 */
export function clampEffort(effort, cfg = DEFAULT_CONFIG) {
  if (effort !== "max") return { effort, changed: false, why: "" }
  if (cfg.allowMax) return { effort, changed: false, why: "" }
  const fallback = cfg.maxFallback ?? "high"
  return { effort: fallback, changed: true, why: "max is opt-in; fell back to " + fallback }
}

/**
 * Full router decision for one request. Returns null when the router should not
 * touch the request (off mode / image steps that must stay on their model /
 * foreign provider or model family).
 *
 * The model is always cfg.model; only the effort varies.
 *
 * @param signals {
 *   text, turn, toolCalls, hasImage,
 *   escalations  evidence steps earned inside this task (0..maxEscalations)
 *   carry        1 when the previous task ended on an unresolved failure
 * }
 */
export function decideRoute(cfg, resolved, signals) {
  if (!cfg || cfg.mode !== "auto") return null
  if (!resolved || resolved.provider !== cfg.provider) return null
  if (!resolved.model) return null
  const familyRe = cfg.familyRe ?? new RegExp(cfg.familyPattern ?? DEFAULT_CONFIG.familyPattern)
  if (!familyRe.test(resolved.model)) return null
  if (signals.hasImage && cfg.leaveImageSteps && cfg.imagePolicy !== "flash") return null

  const { score, reason } = scoreOf(signals, cfg)
  const base = classifyStep(signals, cfg)
  let stepClass = base.stepClass
  const routeReason = [...base.reason]

  // Tiebreaker: a very high score on an engineering step means it is really hard.
  if (stepClass === "engineering" && score >= cfg.scoring.hardScore) {
    stepClass = "hard"
    routeReason.push("score " + score + " >= hardScore")
  }

  // Rule 2 — escalation is evidence-driven and only lifts real work.
  const evidence = Math.max(0, Math.min(cfg.maxEscalations, Number(signals.escalations) || 0))
  const carry = signals.carry && (stepClass === "engineering" || stepClass === "hard") ? 1 : 0
  const bumps = Math.max(evidence, carry)
  if (bumps > 0) {
    const lifted = escalateClass(stepClass, bumps)
    if (lifted !== stepClass) {
      const how = carry && carry >= evidence ? "carried from unresolved failure" : "escalated on evidence"
      routeReason.push(how + " x" + bumps)
      stepClass = lifted
    }
  }

  // Rules 3 and 4 — max is opt-in, so the ceiling is enforced at the effort level.
  const route = cfg.routes[stepClass] ?? DEFAULT_ROUTES[stepClass]
  const clamped = clampEffort(route.effort, cfg)
  if (clamped.changed) routeReason.push(clamped.why)

  return {
    score,
    stepClass,
    baseClass: base.stepClass,
    model: cfg.model,
    effort: clamped.effort,
    clamped: clamped.changed,
    clampWhy: clamped.why,
    reason: routeReason,
  }
}
