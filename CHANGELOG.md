# Changelog

## 0.5.0

**The router now steers a model pool, not just one model's effort — with a composer UI.**

- **Three authorization scopes.** `control: full | effort | model` decides what the router may
  choose. `full` owns model + effort; `effort` only sets how hard the session's own model thinks;
  `model` only picks the model and leaves the thinking level alone. The scope is per session
  (set from the UI) with the profile row as the default.
- **Manual picks always win, and routing resumes.** The user's own model selection is observed
  through the session's `modelSelection` projection (the plugin never writes it). A pick makes the
  router stand down immediately — the pick stands — and it re-engages on the next command or when
  the composer control's **resume** action calls `POST /model-router/resume`.
- **Model pool.** `pool` is a whitelist of `provider/model` entries with `cost`, `tier`,
  `tags` (e.g. `vision`), `maxPerTask` and per-preset `weights`. A model outside the pool is never
  selected; hard steps and evidence escalation prefer the `strong` tier, routine work stays cheap.
- **Task presets with weights.** `presets` maps a user-defined task type to keyword/regex rules and
  per-model weights. A task type pinned in the UI always beats the rules; otherwise the rules run.
  Third-party models route through their own advertised effort vocabulary
  (`llm.resolveModel()`), and a model that advertises no reasoning simply gets no effort field.
- **Hysteresis.** Upgrades apply immediately; downgrades wait `hysteresis.downAfter` quiet steps,
  and a new command resets the baseline, so one task cannot flap between tiers.
- **Composer UI.** A client half registers into the `conversation.input.right` list slot — directly
  left of the manual model selector — with the scope switch, the resume action, the task-type
  picker, the pool editor and the preset editor. It talks to the host over same-origin
  `/model-router/*` routes; mutations are refused unless the request is same-origin.
- Host state (pool, presets, per-session scope and pinned task type) persists in
  `<profile>/.model-router/state.json`; the row config stays the default layer.
- 68 tests (`node --test`): policy, routing, host wiring, the three scopes, manual yield/resume,
  pool/preset editing, third-party effort mapping and the client bundle.

## 0.4.0

**Thinking stays on — "off" is no longer an automatic route.**

- **Fixed: one cheap step could fail the whole turn.** DeepSeek's Messages API rejects a
  thinking-enabled request whose history contains an assistant tool call produced while thinking was
  disabled:

  ```
  400 The `content[].thinking` in the thinking mode must be passed back to the API.
  ```

  The old table routed `trivial` -> `off`, but a "trivial" step can still call a tool, and the next
  step of the same task is classified `engineering` -> `high`. One `off` step followed by a `high`
  step therefore failed the turn. Reproduced against the live API: with `thinking: disabled` the
  model returned `stop_reason: tool_use` and no thinking block, and replaying that history with
  thinking enabled returned 400.
- **`trivial` now routes to `low`.** Automatic routing never emits `off`; a configured route or a
  manually selected `off` on a managed model is raised to `low`.
- **New `allowThinkingOff` (default `false`).** Escape hatch for an operator whose whole session
  stays non-thinking; when set, `off` routes and manual `off` are honoured again.
- **A poisoned conversation recovers instead of failing forever.** A session that already contains an
  assistant tool call with no thinking block (the state 0.3.0 created) is detected from the session
  projection and pinned to `off` — the only mode the API accepts for that history — with a single
  warning. The flag is re-derived whenever the projection shrinks, so compaction brings thinking
  back, and a new session starts clean.
- Routing table, config sample, config table and both READMEs updated; the test suite covers the new
  clamp, the escape hatch, the poisoned-history detector and the recovery path — 44 cases, up from 36.

## 0.3.0

First public release.

- **npm package name.** Published as `@neptune810/dsh-model-router@0.3.0` on 2026-09-15: the unscoped
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
