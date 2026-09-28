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

44 tests. `test/policy.test.js` (30) covers classification, the absence of a ratchet, the
unreachable `max`, the refusal of `off`, evidence escalation, effort clamping, the poisoned-history
detector, and tool-result error parsing; `test/plugin.test.js` (14) drives the host wiring with
ctx/agent doubles — registering listeners, claiming messages, routing each step, raising a
hand-written `off`, honouring `allowThinkingOff`, pinning a poisoned session to `off`, recovering
when compaction drops it, pulling a pro conversation back to flash, and demoting a manually selected
`max`.

## License

MIT
