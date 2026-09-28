# Changelog

## 0.6.3

**Fixes the two things you hit: unreadable text in dark mode, and an empty model pool.**

- **Dark mode.** The panel is portaled onto \`document.body\`, so \`color: inherit\`
  resolved to the document default (black) — invisible on a dark panel. Every colour now
  comes from the harness tokens (\`--dsw-alias-label-primary\`, \`--dsw-specific-input-major\`,
  \`--dsw-alias-border-l2\`, …), so both themes read correctly.
- **Model pool.** Rows now come from the **host's own catalog**
  (\`GET /model-router/catalog\`, built from \`llm.listProviders()\` + \`llm.listModels()\` —
  the same source the host's model selector uses), merged with the current pool and the
  client directory. The section is never empty once you have models, and a fallback
  "add a model id" box covers the rest.
- Ticking a model updates the checkbox immediately (optimistic) and a failed call is
  reported inside the panel and logged as \`[model-router] request failed …\`; requests
  time out after 10s so the panel can never freeze on a pending call.
- The panel logs its sources on open: \`[model-router] panel open: client … + host …\`.
- 77 tests.

## 0.6.2

**The whole configuration is clickable — no JSON, no YAML to hand-edit.**

- The composer panel is now a real editor. **Model pool**: tick models from the live
  catalog (the same list the host's model selector shows) and set each one's
  tier / cost / vision with dropdowns, instead of typing `provider/model` ids.
- **Task presets are built with buttons**: click a keyword pack (写作 / 代码 / 翻译 /
  分析) or type a word and press enter, then choose each pooled model's weight from a
  dropdown (不参与 / 低 / 中 / 高). The JSON textarea is gone.
- **More settings** in the same panel: image steps (leave alone / vision model), task
  detection (keyword rules / semantic), context pressure (off / prefer cheap when
  nearly full) — all selects, persisted through `POST /model-router/settings`.
- The client half reads its model list from the host's model directory service
  (`modelDirectories`, provided by ui-model-selection) and declares that plugin as a
  client dependency.
- 76 tests.

## 0.6.1

**Composer control fix — the panel now opens where you can see it.**

- The panel is rendered through a **portal to `document.body` with fixed coordinates** measured from
  the trigger, the same approach the host's own model menu uses. An ancestor of the composer can
  clip an absolutely positioned panel, which made a click look like it did nothing.
- The trigger is never disabled: it opens even before a session id is known, the panel shows the
  session it resolved, and a fetch failure is reported inside the panel instead of silently.
- The trigger logs one line (`[model-router] composer control ready (session …)`) so a loaded bundle
  is distinguishable from a bundle that never arrived.

## 0.6.0

**Complete routing: images, session signals, subagents, an LLM classifier and a /router command.**

- **Vision routing.** `imagePolicy: vision` routes a task that carries an image to a vision model —
  `visionModel` picks one explicitly, otherwise the pool entry tagged `vision` is used. The image
  stays task-scoped: the next command without one returns to the normal tier.
- **Session signals.** The router now reads core session projections and lets them sharpen the
  decision: the **active todo** feeds task-type matching (a todo list states the work better than
  the prompt), **context pressure** above `signals.contextPressure` and a **token total** above
  `signals.sessionTokens` both prefer the cheap tier, and every decision records the signals it saw.
- **Subagent policy.** Delegated work (`delegationDepth > 0`) prefers the cheap tier even for hard
  steps unless a preset weight overrides it (`subagent.preferCheap`).
- **`/router` command.** Prints the current scope, engagement, pool, task type, the last decisions
  and the task's strong-tier spend — the same picture the composer control shows.
- **Optional LLM task classifier.** `classifier: llm` makes one small call per turn
  (`classifierModel`, `reasoningEffort: off`, `classifierTimeoutMs`) to pick a preset, caches the
  answer for that turn, and silently falls back to the keyword rules on any failure.
- Composer control shows the live signals; 75 tests (was 69).

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
