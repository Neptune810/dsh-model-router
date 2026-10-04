# Changelog

## 0.14.1

**A plan confirmation now survives a restart, so a conversation you already answered no longer pulses the amber dot and asks again.**

- The per-conversation live state seeded `confirmedPlan: ''` instead of reading the value the store had persisted.
  A conversation confirmed before its first request — and every conversation after a DSH restart — therefore came
  back unconfirmed, showing the warn bar and the pulsing amber dot on the composer trigger again. `lib/index.js`
  now seeds it from the session record, exactly like the control scope, the bound effort model and the pinned task
  type.
- Editing the scope, the bound model, the task type or the pool still produces a different plan key and asks once
  more; only the lost-answer case changed.
- 160 tests (`test/modes.test.js` 2 new: a plan confirmed before the first request survives the live state being
  created, and an edited pool still asks again).
## 0.14.0

**Crossing brands is now its own decision: the model pool is grouped per provider with bulk add/remove, costs can be filled in automatically, and a switch to a different provider asks first.**

- 模型池 / Model pool rows are grouped by provider — both under the official directory groups and under 其他模型 /
  Other models — and every group header carries 全加入 / Add all and 全移除 / Remove all, so building a
  second-brand pool is two clicks instead of one click per model.
- New `lib/pricing.js` (pure, import-free): a built-in relative-price classifier for the 便宜 / 中 / 贵 levels
  (1 / 4 / 8) covering the common DeepSeek, OpenAI, Anthropic, Google, Qwen and Llama families, plus
  `POST /model-router/pool/auto-price { fetch }` and `POST /model-router/prices`. Every pool entry records
  where its cost came from (`costSource`: `builtin` | `openrouter` | `manual`); a level you labelled by hand
  is never overwritten. 自动定价 / Auto price uses the built-in table and any stored snapshot; 联网定价 /
  Fetch prices pulls a fresh OpenRouter snapshot first (20 s timeout) and stores it in
  `<profile>/.model-router/state.json` under `prices`.
- Cross-provider guard: a switch away from the provider currently in use is gated by 跨品牌 / Cross-brand
  (允许 / 先问 / 禁止 — allow / ask / off, default ask). Under `ask` the host stays on the current brand and
  exposes `state.cross.proposal`, and the panel shows a propose bar with 只切一次 / Switch once, 本会话允许 /
  Allow in this chat and 不再跨品牌 / Never cross brands. A pool that holds only another brand keeps routing
  (the guard only fires when a same-brand alternative exists), and the hysteresis memory can no longer
  resurrect a model the guard excluded.
- `POST /model-router/cross { sessionId, action }`; `/state` gains `cross` (mode, anchor, proposal) and
  `prices` (levels, remote snapshot info).
- `docs/ui-preview.html` shows the grouped pool, the per-brand add/remove controls, the price buttons and the
  propose bar.
- 158 tests (`test/pricing.test.js` 11 new; `test/client.test.js` 4 new for provider grouping, the price buttons and the cross-brand bar; the cross-guard and auto-price route cases in `test/modes.test.js`).
## 0.13.0

**A new conversation inherits the last routing plan and asks you to confirm it once, instead of quietly resetting to the defaults on every DSH start.**

- The host keeps the plan you last set — the scope, the bound effort model and the pinned task type — under
  `last` in `<profile>/.model-router/state.json`. A conversation with no choice of its own inherits it; a
  conversation you have already configured keeps its own `sessions` entry, and the two never affect each
  other.
- A conversation that inherited a plan opens with a warn-tinted bar at the top: 已沿用上一次的选择 /
  carried over from your last choice, or 新对话：先确认这次的路由方案 / new conversation — confirm this
  routing plan when there was nothing to inherit yet. It lists the effective 范围 / 思考模型 / 任务类型 /
  模型池 and a 确认 / Confirm button that posts `POST /model-router/confirm { sessionId, plan }`.
- Until it is confirmed the composer trigger carries a pulsing amber dot. Confirming records the plan key for
  that session — `/state` reports it as `plan`, `planKey` and `planConfirmed` — so the bar, the dot and
  the trigger tooltip stand down. Changing the scope, the bound model, the task type or the pool produces a
  different key and asks once more.
- `docs/ui-preview.html` shows the bar and the trigger dot.
- 133 tests (`test/client.test.js` 28: the bar's plan summary, the confirm round-trip, the silent confirmed
  case and the changed-plan case).

## 0.12.0

**The model pool is no longer a second list: it lives on the model rows themselves, so the panel is one list instead of two near-identical ones.**

- Every row in the session-model list now carries a 模型池 / Model pool chip on its right. Tapping it pools
  or unpools that model; a pooled row expands its 定位 / 价格 / 视觉 controls directly underneath, and pool
  entries that have no provider group in the directory render under 其他模型 / Other models together with
  the manual "type a model id" row, so a stale entry can always still be unticked. The standalone 模型池
  section, its heading and its note are gone.
- In 思考 / effort scope the same chip becomes 接管 / 已绑定 and binds the one model that scope needs; the
  先选一个模型 hint stays at the top of the list.
- The panel header keeps a pool chip only when the router falls back to the `.right` capsule (a host
  without the seat); with the seat there is no second pool control.
- `docs/ui-preview.html` renders the folded list.
- 131 tests (`test/client.test.js` 26: the folded-list case replaces the header-toggle case).

## 0.11.1

**The model pool now lives behind a control on the router row, so the panel opens short and the list appears only when you ask for it.**

- The panel header carries a 模型池 / Model pool chip at the right of the router row, with the count of
  selectable models. It opens and closes the pool list in place; the list starts collapsed, so 控制范围
  and 任务类型 lead straight to 任务预设 instead of every model with its tier / cost / vision rows.
- Effort scope still forces the list open while no model is bound, because the one-model pick comes
  first; once the binding clears `effortModelPending`, the list collapses on its own again.
- The header's status text now truncates with an ellipsis instead of pushing the pool chip and the
  close button. `docs/ui-preview.html` shows the chip and the expanded list.
- 131 tests (`test/client.test.js` 26: one new case for the collapse / reopen toggle).

## 0.11.0

**The router now owns the composer model cell: one control that keeps the official model + reasoning-effort sections and the router's own, and takes precedence over the shipped model picker.**

- The client registers its merged control into the shipped `conversation.input.model` seat at priority
  **-1**, below the shipped `ModelSelect` (priority 0, from
  `@deepseek-ai/dsh-client-ui-model-selection`). The slots engine renders the lowest priority, so the
  router's control takes over that cell and the composer shows a single control instead of a second
  chip beside the official picker.
- That one control keeps both halves. The official half is 本会话模型 / Session model and 推理等级 /
  Reasoning effort, driven by the real ModelDirectory through `props.directory.store` subscribe,
  `props.load()` and `props.select({ provider, model, reasoningEffort })`: provider/model groups, the
  current-row check, the pending spinner, the provider-default row, catalog loading / error / retry and
  the official "model · effort" trigger label. Below it sit the router's own groups: 接管 status,
  控制范围 (模型+思考 / 思考 / 模型), 任务类型, 模型池, 任务预设 and 更多.
- The old `conversation.input.right` chip (`model-router:composer-control`, order 20) is still
  registered, but it **self-retracts** — it disposes itself as soon as the seat registration lands — so
  a normal host renders an empty `.right` column and only ever sees the merged cell. A host that
  rejects or renames the seat keeps the chip as its fallback.
- Root cause of the 0.10.0 boot crash, now fixed: cordis resolves nested services such as
  `remote.session` by walking fibers **upward from the calling fiber**, so a plugin whose methods touch
  `ModelDirectory.directoryFor()` must itself declare `sessions`, `remote` and `remote.session` at
  plugin level. 0.10.0's shadow did not, and the app failed to boot with
  `cannot get property "sessions" without inject`. The client plugin-level inject is now
  `["slots", "uiConversation", "sessions", "remote", "remote.session"]`, and the package's
  `dsh.client.inject` declares `@deepseek-ai/dsh-api-remotes` and
  `@deepseek-ai/dsh-api-session-controller` alongside the UI packages.
- Browser-verified on a real `dsh web` server with the plugin installed: no boot card, no console
  errors, exactly one control in the cell, its label shows the official "DeepSeek-V41-Flash / High", the
  panel shows 本会话模型 + 推理等级 above the router groups, the old `.right` column is empty, and
  clicking an official effort row really changes the official selection.
- 130 tests (2 new in `test/client.test.js`).

## 0.10.1

**Rolled back: the composer control is the router's own chip again, and the official model cell stays
official.**

- 0.10.0 made the control register into the official `conversation.input.model` seat at priority -1, so
  it *was* the composer model cell. In the field that seat rendered completely blank, and a restart
  carrying the temporary diagnostics failed to boot, so the change is reverted: the client registers the
  `conversation.input.right` chip (`model-router:composer-control`, order 20) again, and the official
  `conversation.input.model` seat is left to the official control.
- The merged model + effort popup code from 0.10.0 is still in `client/client.js` but is no longer wired
  by the host; the visible control is the chip and its own panel (scope, pool, effort-scope binding,
  presets, settings, resume).
- The 0.10.0 entry below is kept as the record of the attempt.

## 0.10.0

**The router now lives where the model picker lives: its control IS the composer model/effort cell.**

- The client shadows the official composer model/effort cell. It registers its control into the
  official `conversation.input.model` seat at priority **-1**, while the official `ModelSelect`
  registers that same seat at priority 0; the slots engine renders the lowest priority, so the shadow
  wins independently of bundle load order (no patch of the official component is involved). The
  registration is wrapped in `try`/`catch`: if the seat is renamed or never declared the shadow
  silently does not register and the pre-existing `conversation.input.right` chip
  (`model-router:composer-control`, order 20) stays the visible control; while the shadow is live the
  chip renders `null`, so the two never both appear.
- One merged popup. The top half is the official session model + reasoning-effort selection: provider
  groups ordered `deepseek-account` → `deepseek-official` → others, a check mark on the current
  model, a spinner on the pending one, a provider-default row only when the model advertises no default
  effort, and catalog loading / error / failure surfaces with a retry. The bottom half is the router's
  own configuration unchanged: scope (full / effort / model), pool rows with tier / cost / vision, the
  effort-scope single-model binding, presets, settings and resume.
- The shadow mirrors the official `select` semantics: a model row calls `select({ provider, model })`
  with no `reasoningEffort` key, an effort row calls
  `select({ provider, model, reasoningEffort })`, and the provider-default row sends
  `{ provider, model }`; picking the already-current model or effort closes with no RPC; a rejected
  selection keeps the popup open with the error visible; a locked session shows a disabled trigger that
  never opens; an addressed subagent session (`available === false`) renders nothing, exactly like the
  official cell. The trigger label is the official "model · effort" wording (with the model-name /
  provider-model fallback and its loading labels) plus the router's small yielded dot; the per-call
  route row is unchanged.
- Honest limits: this is a shadow, not a patch of the official component — the official popup's
  internals (portal menu, search box, keyboard navigation, module CSS) are not replicated, only its
  selection semantics. A future DSH that renames or stops declaring `conversation.input.model` makes
  the shadow silently not register and the small fallback chip takes over. If our component crashes
  while rendering, the framework retires our entry and the official control comes back automatically.
  Plugin source changes still need a full `dsh web`/desktop restart.
- 128 tests (15 new in `test/client.test.js`).

## 0.9.0

**A tool loop no longer pins the effort at high: the brief decides the class, and the loop only adds
score.**

- Audited cause: `classifyStep` gave **engineering** to any step of a task that had already seen one
  tool call (cue `agent tool loop`), and `engineering` routes to `high`. The per-task tool counter
  only resets when a new user command is claimed, so every step from the first tool call to the end of
  the Agent run stayed at `high`. Descent was unreachable mid-loop: `trivial` needs a cheap cue plus
  at most 60 tokens, and `standard` required zero tool calls. With `allowMax: false` (the default)
  `clampEffort` demotes `max` to `high`, so `hard` and `engineering` applied the same effort and
  evidence escalation (errors/repeats) changed nothing for a task already at engineering.
- Measured before: `帮我把这个文件里的日志改成中文` → tools=0 `standard`/`low`, then
  tools=1/3/6/12/25 `engineering`/`high` for the rest of the task; `翻译一下这句话` with a single
  tool also went to `high`.
- New `scoring.toolCallClass`, default **`standard`**: tool activity still adds score
  (`toolCallBase` / `toolCallAt` / `toolCallBig`) but no longer decides the class — the brief (strong
  cues or structural text) decides, and errors/repeats still escalate on evidence. Set it to
  `engineering` to restore the pre-0.9.0 rule; any other value normalizes back to `standard`.
- Measured after: a casual brief with tools stays `standard`/`low` throughout; an engineering brief
  stays `engineering`/`high` throughout (unchanged); an escalation to `hard` still collapses to
  `high` while `allowMax` is false, and `allowMax: true` is what makes `max` reachable.
  `routes.<class>.effort` still overrides any class directly.
- 113 tests (4 new in `test/policy.test.js`, 2 new in `test/plugin.test.js`).

## 0.8.0

**Every tool call now shows the model and thinking level that ran it.**

- Each tool call in the conversation gains one compact line — `deepseek-official/deepseek-v4-pro · high`
  — naming the model and the thinking level that actually ran that segment; when the adapter owns the
  default, the effort shows the localized **默认** / **default** label.
- The host folds the session's own events into the new `modelRouterRoute` session projection
  (`stateVersion` 1): `request/header` → provider/model/effort, `step/start` → turn/step, `tool/call`
  → the pair for that call id. It keeps the last **200** calls per session and drops the oldest.
- The client half registers a `model-router-route` conversation Definition and a
  `conversation.chat.node` row anchored right after the call, reading the projection defensively: a
  call the host has not folded yet renders nothing instead of borrowing another call's route.
  `dsh.client.inject` gains `@deepseek-ai/dsh-client-ui-chat`, the package that owns that seat.
- The line is a **separate** compact row next to the tool call, not a badge inside the harness's own
  tool row or the thinking chain: a keyed slot replaces whatever it targets, and the thinking chain
  exposes no child slot.
- 107 tests (12 new in `test/route-projection.test.js`, 4 new in `test/client.test.js`).

## 0.7.0

**The scope decides which manual pick counts, and 思考 is bound to one model you choose.**

- `全授权` is now **模型+思考** (English: **Model+Effort**), because it read like the workspace's own
  permission level and said nothing about the thinking level; the scope hint now spells out what each
  mode may change.
- **思考 works on exactly one model.** The panel asks you to pick a single model first
  (`POST /model-router/effort-model`), and until you do the router stays out entirely — it changes
  neither the model nor the effort. Once one is bound, the router only touches a step whose resolved
  model is that one, and takes the effort vocabulary from that model instead of an unrelated pool
  entry.
- **A manual pick only counts in the scope that owns it.** In 思考, switching the model by hand is no
  longer a manual override — the router keeps adjusting its bound model's thinking level — while
  changing the effort by hand still stands it down. 模型 is the mirror image: an effort-only change
  leaves it engaged, a model switch stands it down. 模型+思考 reacts to either.
- `/state` gains `effortModel`, `effectiveEffortModel` and `effortModelPending`, so the panel can
  show the bound model and prompt while none is picked.
- 91 tests (10 new in `test/effort-model.test.js`).

## 0.6.12

**Releases now publish themselves: push a tag, GitHub Actions does the rest over OIDC.**

- New `.github/workflows/publish.yml`: a `v*` tag push checks that the tag matches the
  `package.json` version, runs the test suite, then publishes with `npm publish` through npm
  trusted publishing — `id-token: write`, and deliberately no `registry-url` and no
  `NODE_AUTH_TOKEN`, so npm authenticates with the workflow's identity instead of a secret.
- `PUBLISHING.md` now leads with that flow and keeps the bypass-2FA access token as the
  fallback, with the three traps met while publishing 0.6.11 by hand: a plaintext token sitting in
  `.npmrc`, PowerShell reporting a false failure because npm writes its notices to stderr, and the
  two-to-three minutes the registry needs before the new version shows up.
- No code change: the tarball is 0.6.11 plus these two files. 81 tests.

## 0.6.11

**The panel works under the DeepSeek desktop app again — every control in it was dead there.**

- Every mutation was answered `403 same-origin only` in the desktop build, so the panel
  opened and painted correctly but nothing inside it did anything. That build's own proxy strips
  `origin`, `host`, `cookie` and `sec-fetch-site` before it forwards a request to the in-process host
  server and injects a signed cookie of its own, so the route guard saw a POST with no Origin at
  all and ruled it foreign. An absent Origin is now accepted: browsers send it on every POST,
  same-origin ones included, so its absence means the caller is not a page — the same correction
  dsh-market shipped for the same trap (its issue #648).
- The guard is otherwise unchanged: a caller stating `sec-fetch-site: cross-site` is still
  refused, and a present Origin must still equal the request's Host, which also refuses
  `Origin: null` and an empty Origin — present but unusable is not the same as absent.
- 81 tests (new: a request with the stripped headers passes; `Origin: null` does not).

## 0.6.10

**The routed model and its effort are visible again, for every step.**

- The composer chip now carries the live choice next to the scope — `全授权 · v4-pro · high` —
  and refreshes every 2.5s while a task runs (hidden tabs skip the poll), so each round's
  model and reasoning effort are visible without opening the panel. The tooltip has the full
  `provider/model`, the effort and the step class.
- The panel gained **最近决策**: the last five routed steps as
  `T<turn>.<step> · model · effort · class`, so the per-step story is readable after the fact.
- 80 tests; `docs/ui-preview.html` and the captures were refreshed.

## 0.6.9

**Two bugs the composer UI showed: a dead scope control in a new conversation, and an
amber dot without a manual pick.**

- **控制范围 in a brand-new conversation.** The panel refused to load without a session id,
  and `/state` ignored a per-session pick that was saved before the session's first
  request — so the segmented control snapped back and looked dead. The host now answers
  session-less reads with the deployment default, stores a pick made before the session
  exists **as** that default, and reads the saved per-session value for the scope and the
  pinned task type. The panel also keeps refreshing without a session and explains why.
- **Amber dot without a manual pick.** The `modelSelection` projection is
  `{ lastUsed, pending }`: `lastUsed` is the header of the last request — i.e. the model
  this router itself just chose — while only `pending` is a user pick. Comparing the whole
  projection made the router's own routing look like a hand pick and stood it down. It
  watches `pending` only now, so the amber dot means exactly what it says.
- 80 tests (new: lastUsed is not a pick, a pre-session scope pick becomes the default,
  persisted picks show before the first request).

## 0.6.8

**The status dot explains itself.**

- The trigger's green/amber dot now carries a tooltip: green = the router is
  controlling (it changes model / effort as needed), amber = it stood down because you
  picked a model by hand (click to resume).
- The panel header repeats the dot with its state in words, so the colour never has to
  be guessed from a screenshot.
- 77 tests.

## 0.6.7

**The package metadata finally describes what the plugin does now.**

- The npm \`description\` (shown on the npm page, and used by marketplaces that read npm
  metadata) still described the 0.3.0 flash-only effort knob — it now names the model
  pool, the composer panel, the three authorization scopes, task presets with per-model
  weights, vision routing, session signals and the optional semantic classifier.
- Keywords refreshed (vision-routing, composer-ui, task-classifier).
- No behaviour changes; 77 tests.

## 0.6.6

**The panel is readable now: opaque by default, with a background switch.**

- The theme's menu colour (\`--dsw-specific-menu\`) is translucent, so the conversation
  showed through the panel and the text was hard to read. The panel now measures that
  colour plus \`--dsw-alias-bg-base\`, composes them, and paints an **opaque** surface by
  default instead of the raw menu token.
- **更多 → 面板背景** switches between 不透明 and 跟随主题 (the translucent menu colour with a
  22px backdrop blur). It persists like the other settings (\`panelBg\`).
- The sticky header inherits the panel surface rather than re-painting a translucent one,
  so scrolled content no longer shows through the title bar.
- \`docs/preview-background.png\` shows both surfaces over a busy conversation background.
- 77 tests.

## 0.6.5

**Plain wording, hover explanations, and the preview ships with the package.**

- 档位/成本 became **定位（日常 / 攻坚）** and **价格（便宜 / 中 / 贵）** — the same
  \`tier\`/\`cost\` fields, only the labels changed, so existing configs keep working.
- Every control now explains itself on hover: 定位, 价格, 视觉, 控制范围, 任务类型,
  带图步骤, 任务识别, 上下文压力, plus a one-line hint under 模型池.
- Fixed a layout bug the new labels exposed: shrinkable captions and chips wrapped into
  vertical text. Captions/chips/segments no longer shrink and a crowded line wraps as a
  whole; the panel widened to 372px.
- The panel preview now ships with the package: \`docs/ui-preview.html\` plus
  \`docs/preview-dark.png\` / \`docs/preview-light.png\`, embedded in the README.
- 77 tests.

## 0.6.4

**The panel now looks like part of the harness instead of a bolted-on form.**

- Rewritten against the host's own menu language: the same theme tokens, a 28px
  borderless trigger, a 352px popover on \`--dsw-specific-menu\` with
  \`--dsw-elevation-prominent\`, a sticky header, 34px rows with an
  \`--dsw-alias-interactive-bg-hover\` wash, 11px group titles and a caption footer.
- Native \`select\`/\`checkbox\` widgets are gone: a model row carries a glyph check and
  the whole row toggles; tier, cost, weight and the "more" settings are segmented
  controls; keyword packs and keywords are chips.
- The task type became a sub-view list (like the host's own menus) with a check on the
  active entry, and the preset editor is its own view with a back button.
- The panel CSS is injected once as a stylesheet, so hover, focus and scrollbar styling
  is real CSS rather than inline attributes.
- \`docs/ui-preview.html\` renders that same stylesheet for a quick look; 77 tests.

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
