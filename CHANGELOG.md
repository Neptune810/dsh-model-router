# Changelog

## 0.3.0

First public release.

- **npm package name.** Published as `@neptune810/dsh-model-router`: the unscoped
  `dsh-model-router` was taken on npm by an unrelated project, so the scope carries the identity.
  The repository name, the `github:` install spec, the loader row id (`model-router`) and the
  module's exported plugin name are all unchanged; only the loader row's import specifier in
  `cordis.patch.yml` follows the scoped package name.
- **Flash-only.** The router only drives `deepseek-flash` (DeepSeek-V4.1-Flash). The model never
  changes; the reasoning effort is the only thing it sets. The earlier pro/flash split was removed.
- **Effort ladder.** `trivial` -> `off`, `standard` -> `low`, `engineering` -> `high`,
  `hard` -> `max` (opt-in).
- **No ratchet.** Turn depth contributes no score by default (`scoring.turnPerPoint: 0`) and tool
  calls are counted per task, so a long agent run no longer drifts toward the most expensive effort.
- **Escalation needs evidence.** Repeated failing tool results, or the same tool call retried with
  identical arguments, step the class up — at most `maxEscalations` times per task.
- **`max` is opt-in.** Auto routing never emits `max` unless `allowMax` is set, and that ceiling is
  enforced at the effort level, so even a hand-written route table asking for `max` is clamped.
  A manually selected `max` on a managed model is demoted too (`demoteManualMax`).
- **Task boundaries** come from `agent/inbox/claimed`. A task that ends on an unresolved failure
  carries one hesitant step up, and only for engineering or hard work.
- 36 tests: `node --test`.

## 0.2.0 (unreleased)

Interim design, superseded by 0.3.0 and never published.

- Replaced the cumulative complexity score with per-step classification plus evidence-based
  escalation; removed the unbounded tool-call and turn-depth accumulation.
- Made `max` unreachable for automatic routing.

## 0.1.0

Original host-only prototype.

- Routed between a flash and a pro model using a complexity band table, with a hard rule that flash
  never runs at `max`.
- The complexity score accumulated tool calls and turn depth over the whole session.
