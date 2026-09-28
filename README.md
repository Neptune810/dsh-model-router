# dsh-model-router

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that sets the reasoning
effort of the DeepSeek flash model per step. The model never changes — this plugin only decides how
hard a step should think.

Host-only: no browser UI, no client bundle. It runs silently in the background.

## Routing table

| Step class | Decided by | Reasoning effort | Internal point |
| --- | --- | --- | --- |
| `trivial` | a clearly cheap intent (translate, rename, reformat) in a short step | `low` | ~50 |
| `standard` | a plain short request with no engineering cue | `low` | ~50 |
| `engineering` | engineering cues, code/diff/XML structure, or an agent tool loop | `high` | ~75 |
| `hard` | a dense engineering brief, or failures earned inside the task | `high` (`max` when `allowMax`) | ~75 / 100 |

`high` is the default ceiling. V4.1-Flash drives effort from an internal 1–100 scalar and exposes
three preset names; `high` corresponds to roughly 75, which is where the published effort curve is
still steep. Pushing past it costs about 1.6–1.8x the output tokens for a marginal gain.

## Authorization scopes, the model pool and task presets (v0.5)

`control` decides what the router owns. A manual pick always stands; it makes the router stand down
until the next command or the composer control's **resume** action.

| Scope | Owns |
| --- | --- |
| `full` | model + reasoning effort |
| `effort` | reasoning effort only; the session keeps its model |
| `model` | model only; the session keeps its thinking level |

The client half registers into the `conversation.input.right` list slot — immediately left of the
manual model selector — and carries the scope switch, the resume action, the task-type picker, the
model pool and the task presets. It talks to the host over same-origin `/model-router/*` routes.

**Model pool.** Only pooled models are ever selected.

```yaml
pool:
  - { id: deepseek-official/deepseek-flash, cost: 1, tier: cheap }
  - { id: deepseek-official/deepseek-v4-pro, cost: 8, tier: strong, maxPerTask: 3 }
  - { id: deepseek-official/deepseek-v4-flash-vision-exp, cost: 1, tags: [vision] }
  - { id: vendor-x/writer-pro, cost: 20, weights: { 小说续写: 95 } }
```

`tier: strong` is what hard steps and evidence escalation prefer; `cost` feeds
`scoring.costPenalty`; `maxPerTask` caps how many steps of one task may spend that entry; a
`vision` tag is required for image steps once any pooled model carries one.

**Task presets.** A user-defined task type with rules and per-model weights:

```yaml
presets:
  小说续写:
    match: ["续写", "小说", "文风", "/chapter\\s+\\d+/i"]
    weights: { "vendor-x/writer-pro": 95, "deepseek-official/deepseek-v4-pro": 60 }
  代码重构:
    match: ["重构", "refactor", "架构"]
    weights: { "deepseek-official/deepseek-v4-pro": 90 }
```

A type pinned in the composer always wins; with nothing pinned the keyword rules run
(`classifier: rules`). Third-party models keep their own effort vocabulary: the router asks the
provider what it supports, picks the nearest level, and sends no effort field when the model
advertises none.

## Images, session signals, subagents and the classifier (v0.6.0)

**Images.** `imagePolicy: vision` sends a task that carries an image to a vision model: the pool
entry tagged `vision`, or `visionModel` when set explicitly. The image is task-scoped — the next
command without one goes back to the normal tier.

**Session signals.** The router reads core session projections and lets them sharpen the choice:

| Signal | Effect |
| --- | --- |
| active todo (`todos`) | feeds task-type matching — a todo list states the work better than the prompt |
| context pressure | above `signals.contextPressure` (0–1) the cheap tier is preferred |
| token total | above `signals.sessionTokens` (0 = off) the cheap tier is preferred |
| `delegationDepth` | subagents prefer the cheap tier (`subagent.preferCheap`) |

Every decision records the signals it saw, so `/router` and the composer control can explain it.

**`/router`** prints the scope, engagement, pool, task type, the recent decisions and the task's
strong-tier spend.

**Classifier.** `classifier: llm` makes one small call per turn to pick a preset
(`classifierModel`, effort off, `classifierTimeoutMs`), caches it for the turn and falls back to the
keyword rules on any failure. The default stays `rules`.

## The five rules

1. **No ratchet.** Turn depth contributes no score by default (`scoring.turnPerPoint: 0`) and tool
   calls are counted per task, so a long agent run does not drift toward the most expensive effort.
   A long run is not a harder task.
2. **Escalation needs evidence.** Inside the current task, `escalateOnErrors` failing tool results,
   or the same tool call retried with identical arguments `escalateOnRepeats` times, step the class
   up — at most `maxEscalations` times. Nothing else moves it.
3. **`max` is opt-in.** Automatic routing never emits `max` unless `allowMax` is set. The ceiling is
   enforced at the effort level, so even a hand-written route table asking for `max` is clamped.
4. **A manually selected `max` is demoted too** (`demoteManualMax`), but only for models this plugin
   manages. Other models are left alone. Enabling `allowMax` turns both clamps off.
5. **Thinking stays on.** `off` is not an automatic route. DeepSeek's Messages API rejects a
   thinking-enabled request whose history contains an assistant tool call produced while thinking was
   disabled (`The content[].thinking in the thinking mode must be passed back to the API`). A cheap
   step can still call a tool, and the next step of the same task is an engineering tool loop, so one
   `off` step followed by a `high` step failed the turn. `trivial` now routes to `low`, and any
   configured or manually selected `off` is raised to `low` unless `allowThinkingOff` is set.
   **Recovery:** if a conversation already contains such a turn (from an earlier version, or from a
   hand-selected `off`), the router detects it and keeps that session at `off` instead of failing
   every step, and logs one warning. Compact the session or start a new one to get thinking back.

Task boundaries come from `agent/inbox/claimed`, which is what actually opens a new piece of work.
When a task ends on an unresolved failure, the next one inherits a single hesitant step up — and only
if it is engineering or hard work. A one-line "translate this" never inherits a crash.

## Configuration

The plugin reads its config from its row in the profile's `cordis.patch.yml`:

```yaml
- id: model-router
  config:
    mode: auto            # auto | off
    model: deepseek-flash
    allowMax: false       # true enables max for auto routing and manual selection alike
    maxFallback: high     # where max collapses when allowMax is false
    allowThinkingOff: false # true re-enables effort "off" (see rule 5: it breaks tool loops)
    control: full         # full | effort | model — what the router may choose
    manualOverride:
      yieldOnManual: true        # a manual pick stands; routing stands down
      resumeOnNextCommand: true  # …and re-engages on your next command
    pool: []              # whitelist; empty keeps the single `model` above
    presets: {}           # task type -> { match: [...], weights: { modelId: 0-100 } }
    scoring:
      costPenalty: 0.4    # how strongly relative cost subtracts from a pool score
    hysteresis:
      downAfter: 2        # quiet steps required before the effort steps down
    imagePolicy: keep     # keep | vision — route image tasks to a vision model
    visionModel: null     # explicit vision model; the pool's `vision` tag is used otherwise
    signals:
      todos: true         # let the active todo feed task-type matching
      contextPressure: 0.75  # above this occupancy, prefer the cheap tier (0 disables)
      sessionTokens: 0    # above this token total, prefer the cheap tier (0 disables)
    subagent:
      preferCheap: true   # delegated work stays cheap unless a preset says otherwise
    classifier: rules     # rules | llm — llm makes one small call per turn
    classifierModel: null # model used by the llm classifier (defaults to the first pool entry)
    escalateOnErrors: 2   # failed tool results needed to step up
    escalateOnRepeats: 3  # identical retries needed to step up
    scoring:
      turnPerPoint: 0     # raise this to let long sessions weigh more (not recommended)
    routes:
      trivial:     { effort: low }   # "off" here is raised to low unless allowThinkingOff
      standard:    { effort: low }
      engineering: { effort: high }
      hard:        { effort: max }
```

`DSH_MODEL_ROUTER=off|auto` overrides `mode` at boot.

| Key | Default | Meaning |
| --- | --- | --- |
| `mode` | `auto` | `off` passes every request through, except the manual-`max` clamp |
| `provider` | `deepseek-official` | only this provider is ever touched |
| `model` | `deepseek-flash` | the one model this plugin drives |
| `familyPattern` | `^deepseek-(flash\|v4)` | conversation models it may take over; a pro session is pulled back to flash |
| `allowMax` | `false` | whether `max` is reachable at all |
| `maxFallback` | `high` | what `max` collapses to |
| `demoteManualMax` | `true` | also demote a manually selected `max` |
| `allowThinkingOff` | `false` | allow effort `off` again; only for sessions that stay non-thinking |
| `control` | `full` | what the router owns: `full`, `effort` or `model` |
| `manualOverride.yieldOnManual` | `true` | a manual pick makes the router stand down |
| `manualOverride.resumeOnNextCommand` | `true` | the next command re-engages it |
| `pool` | `[]` | `provider/model` whitelist with `cost`/`tier`/`tags`/`weights`/`maxPerTask` |
| `presets` | `{}` | task types with `match` rules and per-model `weights` |
| `scoring.costPenalty` | `0.4` | relative-cost weight in the pool score |
| `hysteresis.downAfter` | `2` | quiet steps before a downgrade applies |
| `classifier` | `rules` | `rules` or `llm` (one small call per turn, rules as fallback) |
| `classifierModel` | first pool entry | model the LLM classifier uses |
| `imagePolicy` | `keep` | `vision` routes a task carrying an image to a vision model |
| `visionModel` | `null` | explicit vision model id |
| `signals.todos` | `true` | let the active todo feed task-type matching |
| `signals.contextPressure` | `0.75` | occupancy above which the cheap tier is preferred |
| `signals.sessionTokens` | `0` | token total above which the cheap tier is preferred |
| `subagent.preferCheap` | `true` | delegated work prefers the cheap tier |
| `leaveImageSteps` | `true` | steps carrying images keep the caller's model |
| `imagePolicy` | `keep` | set to `flash` to route image steps too (the flash model has native vision) |
| `escalateOnErrors` | `2` | failure-evidence threshold |
| `escalateOnRepeats` | `3` | repeated-call threshold |
| `maxEscalations` | `2` | most classes a single task may climb |
| `carryUnresolved` | `true` | carry one step up from an unresolved failure |

## Install

`dsh plugin` is a pnpm forwarder, so any pnpm specifier works. From the npm registry:

```sh
dsh plugin --profile web add @neptune810/dsh-model-router
```

or straight from the repository:

```sh
dsh plugin --profile web add github:Neptune810/dsh-model-router
```

Restart `dsh web` afterwards. Because the router registers listeners at boot, a reload is not
enough.

## Requirements

- Node 20 or newer.
- Verified against `@deepseek-ai/dsh` 0.1.7-rc.2. The plugin uses `agent/request`,
  `agent/inbox/claimed`, and `session.deriveMessages()`. No `engines.dsh` range is declared, so the
  plugin market keeps this entry visible rather than guessing it incompatible.

## Limitations

- **Host-only.** There is no client bundle, so nothing appears in the browser UI.
- **No config schema.** Settings are read from the profile patch layer shown above and do not render
  as a form in the settings UI. This is deliberate: a schema would require importing
  `@deepseek-ai/*` packages, which a plugin installed beside the profile cannot resolve.
- The router only touches the `deepseek-official` provider and models matching `familyPattern`.

## Tests

```sh
node --test
```

75 tests. `test/policy.test.js` (30) covers classification, the absence of a ratchet, the
unreachable `max`, the refusal of `off`, evidence escalation, effort clamping, the poisoned-history
detector, and tool-result error parsing; `test/routing.test.js` (12) covers the pool, preset
weights, vision filtering, `maxPerTask`, effort-vocabulary mapping and hysteresis;
`test/plugin.test.js` (14) drives the host wiring with ctx/agent doubles; `test/modes.test.js` (14)
covers the three scopes, manual yield + resume, same-origin route guards, pool/preset editing, a
pinned task type, a third-party effort vocabulary, vision routing, subagent frugality, todo-driven
task types, context pressure, the `/router` command and the LLM classifier; `test/client.test.js` (4) loads the shipped
browser bundle in a VM and asserts the composer contribution.

## License

MIT
