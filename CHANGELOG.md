## 1.0.0

**A stability release: the surface the panel and any other client talk to is now versioned, documented and
tested against the code, and a host missing a capability is named instead of looking fine. No routing decision
changes; `costAware` stays `false`.**

- **A versioned envelope (`lib/routes.js`).** `API_SCHEMA_VERSION = 1` and `withSchemaVersion` stamp every
  response — route results and the transport's own 400/403/405/500 answers alike — so a client can refuse an
  envelope it does not understand. `/state` keeps its ETag over the final bytes, so the version is inside the
  hash it advertises.
- **A contract that fails the build (`test/contract.test.js`, 7 cases).** The routes in `docs/api.md` are
  exactly the registered ones (and every registered path is documented); every host event the plugin listens to
  appears in `docs/compat.md`; every `package.json#exports` target resolves and lives in a published directory;
  `engines` declares `node >=20` and `dsh >=0.1.7-rc.2 <0.2.0` and `peerDependencies` stays undeclared; the 1.0
  documentation set is present; and no response ever loses `schemaVersion`.
- **Degradation is named (`/state.compat`).** `missing` lists the capabilities routing cannot run without
  (today `sessionProjections`), `optional` lists the rest (`webServer`, `commands`, `llm`). The panel renders the
  missing list in the chat language (`data-mr-compat`), so an old host reads as a shortcoming rather than as
  features that quietly do nothing.
- **Documentation set.** `docs/api.md` (the envelope, the fifteen routes, the published modules, the 1.x
  stability promise), `docs/compat.md` (host contracts, verified against dsh 0.1.7-rc.2),
  `docs/migration-0.14-to-1.0.md` (no state migration; the keys added since 0.14.2; the single default that
  changed shape), `CONTRIBUTING.md` (layout and the four checks), `SECURITY.md` (what is stored, what is never
  read).
- **Not in this version, on purpose:** splitting the browser bundle into a build artifact, and a CI matrix
  against two host versions. Recorded as deferred in `PLAN.md`.

Tests: 421 (0.17.1: 413). 1.0.0 adds `test/contract.test.js` (7) and one panel case for the compat note.

Upgrade note: no state migration and no behaviour change. Everything this release adds is a larger envelope
(`schemaVersion`), a new `/state` field (`compat` was already there, the panel now reads it) and new
documentation. Rolling back to 0.17.1 leaves the state file readable.
# Changelog

## 0.17.1

**A feedback release: the panel can now take a verdict (too expensive / too weak / just right) and the router answers it
on the next step, the classifier is allowed to admit doubt instead of guessing, and ε-greedy exploration ships as a
shadow behind two switches. No route changes unless you turn something on; `costAware` stays `false`.**

- **Route feedback (`lib/feedback-store.js`).** Three labels in the panel (`data-mr-feedback`), each one a
  `POST /model-router/feedback` with `{ sessionId, label }`. The verdict is written to
  `telemetry/feedback.v1.jsonl` — local only, never uploaded — and the **next routed step answers it**: `outcome:
  "stayed"` when the route that followed is the one the label judged, `"moved"` when it is not. `/state.feedback`
  publishes the labels, the last verdict and whether one is waiting; `/stats.feedback` aggregates the file: totals,
  per-label counts, `overrides` (every label that is not `just-right`) with their share, `outcomes` with the changed
  share, and `byClass` so "too weak" and "too expensive" can be read per step class.
- **Classifier v2 (`lib/classifier2.js`).** `parseVerdict` reads `{ class, confidence, family, evidence, signals }` out of
  the model's prose and `decideVerdict` keeps a `source` on the answer. The model's classification is used only above
  `classifierMinConfidence` (0.6); below it the tier is raised one step rather than guessed. The call is bounded
  (`classifierAttempts` 2, `classifierTimeoutMs` 2000) and behind a circuit breaker that opens after three failures and
  leaves the router on rules for ten minutes. `/state.classifier` publishes the verdict, `escalate` and the breaker.
- **ε-greedy exploration (`lib/experiments.js`).** `experiments.enabled` defaults to `false`; with it on, `planExperiment`
  draws once per step, and only on steps that are neither `hard` nor `engineering`. `apply` defaults to `false` as well, so
  a draw is a shadow by default: recorded in `/state.experiments.last`, aggregated in `/stats.totals.experiments` and the
  `experiment` field of the decision event, with the route untouched. `seed` reproduces a run, `epsilon` (0.1) is the
  exploration share, and an applied draw resets the hysteresis streak so the explored arm is judged on its own merits.
- **Panel.** A feedback row with the three labels and what the next step did, an exploration line naming the arm (shadow
  or applied), and a classifier line for a raised tier or an open breaker — all localized, all silent when the host sends
  nothing to say.
- **Not flipped:** `costAware` still defaults to `false`. The flip wants G3/G4 (seven days, 300 priced shadow steps, one
  restart on a build that records the shadow); this release records the threshold instead of claiming it.

Tests: 413. Upgrade note: additive — the new config keys default to off/lazy, no state migration, and the feedback file
is created on first use inside the telemetry directory.

## 0.17.0

**An effort-economics release that changes no route: the eight-tier ladder becomes a module, every step records how its
tier reached the wire (exact / alias / nearest / none), `/stats` counts the collapses per step class, and `npm run replay`
re-derives a recorded ledger against the code and the pool you have now. `costAware` stays off.**

- **The ladder as data (`lib/effort.js`, new subpath export `./effort`).** `LADDER` is the documented eight tiers
  (`off minimal low medium high xhigh max ultra`) with `LADDER_POINTS`; `budgetTable(meta)` and
  `budgetForTier(tier, meta)` turn a tier into a token budget from `DEFAULT_BUDGETS` (low 2048 … max 32768),
  overridable per model through `effort.budgets` in the catalog and always capped by `maxOutput`.
- **Every decision says how its tier arrived.** `explainMapping(tier, applied, meta)` answers `exact`, `alias`
  (`effort.aliases` — DeepSeek maps medium to high), `nearest` (the vocabulary has no such tier) or `none` (the model
  advertises no effort at all). It lands in the decision event as `effortMapped`, on `/state.effort` together with the
  ladder and its points, and in the route's `reason` whenever it is not exact.
- **`/stats` counts the collapses.** `totals.mappedSteps` / `totals.mappedShare`, plus `effort.byClass` (the mapped
  share per step class) and `effort.top` (the most common `from->to:why` pairs).
- **Offline replay (`lib/replay.js`, `npm run replay`).** Reads `decisions*.jsonl`, re-runs `chooseEntry` and the
  ladder mapping with the code you have now, and prints the steps whose model or effort would change; `--config` replays a
  pool you are considering, `--since` / `--until` narrow the window, `--json` is machine readable and
  `--fail-on-change` exits 1. `/router replay [n]` still prints what was recorded; this re-derives what would happen now.
  Classification and presets are out of reach on purpose: both need the prompt text, which telemetry never stores.
- **Panel.** One line naming a tier the model cannot take verbatim (`data-mr-effort`), and nothing at all when the tier
  is exact, when the host sends no `effort` block, or when the block is malformed.
- **Tests.** 382 tests (368 in 0.16.1): `effort` 7, `replay` 5, `client` 51 (the effort line, its silence, English),
  `telemetry` 15 (the mapped counters), `observation` 18.
- **Upgrade note:** no state migration and no config change. The new decision field, the `/state` block and the two
  `/stats` counters are additive, and the shipped DeepSeek routes take low / high / max verbatim, so the panel stays quiet.
- **Deferred on purpose:** `costAware` still defaults to `false` (G3/G4 want ≥7 days and ≥300 shadow steps, and the
  desktop only loads the shadow from the next restart); the feedback loop, the classifier v2 and ε-greedy move to 0.17.1
  together with the L2 experiment that decides the flip.

## 0.16.1

**A stability release that stays inert by default: channels are scored by health and can fail over on a 429, a
5xx or a timeout, a spend guard can refuse a synthetic step, and the peak window is named. `channels.failover` is
off, `budget.mode` is `off` and `peakPolicy` is `inform`, so the golden snapshots are unchanged.**

- **Channel health (`lib/channels.js`, new).** `classifyFailure({status, code, timeout})` maps 429 / `RATE_LIMIT` to
  `rotate` and 5xx / `TIMEOUT` / `TRANSPORT` / `EMPTY_RESPONSE` to `failover`; `ChannelHealth` keeps a rolling window (20)
  per channel with a TTFT EWMA, benches a channel after `failThreshold` (3) consecutive failures for `cooldownMs` (60 s),
  clears it on the first success, and `cool(channel, at, ms)` benches a channel that just failed without recording a
  failure. `orderChannels` / `channelRanks` are stable and never drop an entry: a benched entry sinks below healthy
  ones and keeps its score, so an all-benched pool still routes.
- **Channels in the score and in the pool.** A pool entry may set `channel` (two accounts on one provider are two
  channels). `chooseEntry` compares channel rank before entry cost, and a channel-blocked entry sinks; `decide()` passes
  `channelRank` / `channelBlocked` through `signals`, so a cooling pool is ordered, never emptied.
- **Failover.** `channels.failover: true` answers `agent/request-error` with `{kind: 'retry'}`, at most
  `maxFailoversPerStep` (1) per (turn, step), and benches the failed channel first so the retry cannot land back on it.
  When every channel of the current brand is benched, the router crosses to the best entry the catalog can price and
  records `failoverFrom` in the decision (counted by `/stats.failoverSteps`). `crossProvider: 'never'` still wins. With the
  flag off a failure is only recorded (`state.lastError`) and the route is left alone.
- **Fingerprint and quarantine.** `fingerprint(observed, expected)` refuses `model_mismatch`, `usage_missing`,
  `reasoning_missing` and `ttft_outlier`; a channel that keeps failing a verification is quarantined for
  `channels.quarantineMs` (24 h), published in `/state.channels.quarantined` and named by `lastVerify` in the panel. A
  relay whose price is unknown is never entered automatically.
- **Spend guard (`lib/budget.js`, new).** `budget.mode: 'inform' | 'block'` with `sessionTokens`, `sessionUsd`,
  `dayUsd`, `monthUsd` and `softRatio` (0.8). `budgetReport` returns one row per active limit (a zero limit is
  not a limit) with `ratio` / `soft` / `over`, and `/state.budget` publishes it. `block` refuses only a synthetic step -
  one carrying no fresh user message - through `agent/pre-step` `{kind: 'reject'}`, so a step the user is waiting on
  always runs; `POST /model-router/budget` (`/router budget [once]`) releases exactly one step.
- **Peak policy.** `peakPolicy: off | inform | shift`, default `inform`: the panel and `/stats` name the window
  (`peakSteps`, `peakCostUsd`, `peakShare`) and `shift` demotes peak-priced entries for delegated steps only, never for
  the step a user is sitting in front of.
- **Cross-brand proposals need a reason.** A switch must beat the best same-brand entry by `crossCost.scoreMargin` (5)
  points or be `crossCost.maxMultiple` (3x) cheaper, or no same-brand entry may be left; the proposal carries
  `savingMultiple` and its `why`, and every cross-brand step is still written to telemetry.
- **Panel.** A budget dot (`data-budget`), a spend block with one row and one bar per active limit, a peak note,
  a line naming benched and quarantined channels, and a reason on the route line that lists every rule that
  applied. A host that sends none of those blocks renders none of them.
- **Tests.** 368 tests (333 in 0.16.0): `channels` 18, `routing` 26 (channel ordering), `telemetry` 15 (the peak and failover
  counters), `observation` 18 (the spend guard, the failover, the proposal thresholds), `client` 49 (the dot, the bar, the
  peak note and the channel line).
- **Upgrade note:** no state-file migration and no config change. `channels.failover`, `budget.mode` and `crossCost`
  default to inert values, so a 0.16.0 profile routes exactly as before; `peakPolicy` defaults to `inform` and only prints.

## 0.16.0

**A cost release that changes no route by default: every pool entry is priced at the catalog's own rate for the
instant of the step, a cost term can join the score, and with the flag off each step also records what a cost-aware
router would have picked. The golden snapshots are byte-identical to 0.15.1.**

- **Token-level cost basis (`lib/pricing2.js`, new subpath export `./pricing2`).** `blendedUsdPerMTok(model, at,
  mix)` returns one USD-per-million-token rate blended over a token mix; `DEFAULT_MIX` is 50% fresh input / 35% cache
  read / 15% output, and `mixFromSplit(split)` derives the mix a real session produced (a DeepSeek session reads cache
  for ~97% of its tokens, so the shipped default would overstate its rate ~2x). `longContextRates(model, promptTokens,
  at)` returns the long-context tier in force (`whole_request` or `excess`, largest matching threshold wins,
  `effectiveFrom` respected), `stepCost(model, split, at)` prices one split and matches `catalog-pricing`'s
  `tokenCost` bit for bit whenever no long-context tier applies, and `perCallCost(model, counts, at)` prices
  per-1000-call rows such as DeepSeek Search/Fetch on their own `effectiveFrom`. An unknown price is `null`, never
  zero.
- **Cost-aware scoring, off by default.** `scoring.costWeight` (0.15) subtracts `costWeight * 10 * (rate/floor - 1)`
  capped at `costGuard.maxMultiple - 1` (8x), so at most 10.5 points against `hardBonus` 15 and `engineeringBonus` 8:
  cost tilts same-tier choices and breaks ties, it does not outvote the task class. `costGuard.unknownPricing:
  'exclude'` (default) drops an entry the catalog cannot price instead of guessing; `hard` steps are exempt from the
  multiple. A guard that empties the pool retries once with cost awareness off and reports `costFallback`, so cost can
  never leave a session unrouted. Turned on with `costAware: true` in the row config (the panel does not expose it
  yet).
- **The shadow.** With `costAware` off, every routed step also computes the cost-aware choice and records it in
  `router.decision/1`: `{current, candidate, agree, currentUsdPerMTok, candidateUsdPerMTok, savedRatio,
  currentStepUsd, candidateStepUsd, costFallback}`. `GET /state.costAware` publishes `{enabled, costWeight, guard,
  mix, floorUsdPerMTok, entries[{id, tier, priced, usdPerMTok, currency, peak}], shadow}`.
- **`/stats.shadow`.** `{steps, agreeSteps, divergedSteps, agreementRate, pricedSteps, currentUsd, candidateUsd,
  savedUsd, savedRatio}` over the same window as the rest of the summary. A shadow step with no priced pair still
  counts as a step but contributes no money, and a malformed `shadow` is ignored rather than throwing.
- **Panel line.** The composer panel prints one caption under the price note: `cost shadow (off) · cost routing
  would pick X over Y · ~N% cheaper`, or the agreement form, or `cost shadow (on)` once the flag is on. A host that
  sends no `costAware` block renders nothing.
- **Tests.** 333 tests (305 in 0.15.1): `pricing2` 15 (mix, blended rate, long-context tiers, `stepCost` parity with
  the catalog price, per-call rows), `routing` 23 (the cost term, the guard's four refusals, the flip and the
  fallback), `observation` 11 (the shadow end to end and the flag actually moving the route), `telemetry` 14 (the
  shadow ledger), `client` 43 (the shadow line, agreement, enabled, English).
- **Upgrade note:** no state-file migration and no config change. `costAware` defaults to `false`, so a 0.15.1
  profile routes exactly as before and starts collecting shadow evidence instead.
## 0.15.1

**A data release: the shipped catalog now prices every routed step, the panel names the hard dates coming up, and a weekly drift report tells maintainers what changed upstream. No routing decision changes - the golden snapshots are byte-identical to 0.15.0.**

- **Dated prices become numbers (`lib/catalog-pricing.js`, new subpath export `./catalog-pricing`).** Pure and dependency-free: `pricesAt(model, at)` returns the rate in force at an instant (a `pricing.next` block takes over on its `effectiveFrom` day; DeepSeek's weekday 09:00-12:00 and 14:00-18:00 Asia/Shanghai windows bill at peak, every other hour at half), `tokenSplit(before, after)` turns two cumulative token projections into one step's input/output/cacheRead/cacheWrite/reasoning split, `tokenCost`/`usdCost` price that split in the catalog's currency and convert with the catalog's `fxRate`, `upcomingAlerts(at, {withinDays})` lists the hard dates, and `modelMeta` describes the entry. An unknown price is `null`, never zero: a missing cache-write price falls back to the fresh-input price (that is how implicit caching bills), and a missing input or output price makes the cost `null` instead of inventing a number.
- **Every decision is priced.** `router.decision/1` gains `usage.split`, `usage.costUsd` and a `usage.price` snapshot (currency, unit, effectiveFrom, peak, source and the four rates in force) taken at the step's own timestamp, so a replayed step is priced at the rate that was actually charged.
- **The cost ledger in `/stats`.** `totals` and every `by*` row now carry `tokens`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`, `costUsd`, `pricedSteps` and `unpricedSteps`; a window that mixes old and new events reports both, so an event the catalog could not price is visible instead of counted as free.
- **A watchlist for models outside the pool.** `catalog/model-catalog.yaml` gains a top-level `watchlist:` for hard dates of models that are not (yet) pool members - the first entry is the 2026-12-31 end of GLM-4.5. `schema/model-catalog.schema.json`, `scripts/check-catalog.mjs` and `scripts/build-catalog.py` all validate it, a watchlist id may not shadow a known model id, and the build prints how many entries it kept.
- **`GET /state.catalog`.** `{evidenceDate, withinDays, alerts[{date, description, daysUntil}]}` for the next 30 days. The composer panel puts a warning dot on the trigger and in the panel head and lists at most three dates under the price note; a host that sends no `catalog` block renders nothing at all.
- **`/stats` rows name their catalog entry.** Every `byModel` row carries `catalog` (the entry from `findModel`, so a model that left the pool still explains itself) and `summary.catalog` carries the same alert block as `/state`.
- **Weekly drift report (`scripts/catalog-diff.mjs`, advisory).** One dependency-free CLI compares the committed projection with the live OpenRouter models API (`--out`, `--now`, `--days`, `--offline <snapshot.json>`, `--json`, `--quiet`, `--fail-on-drift`) and never edits the catalog. `.github/workflows/catalog-diff.yml` runs it every Monday at 03:00 UTC and uploads the markdown; exit 0 by default, so a red badge never blocks a release.
- **Tests.** 305 tests (267 in 0.15.0): catalog 21 (the watchlist cases), catalog-pricing 18, catalog-diff 15, telemetry 13 (the ledger case) and client 41 (the dot, the silent host and the English copy).
- **Upgrade note:** no state-file migration. Events written by 0.15.0 stay valid and count as `unpricedSteps`.

## 0.15.0

**An observation release: every routed step now persists one decision event, `/stats` aggregates them, `/router replay`
prints them, the panel polls conditionally on an ETag, `routes.<class>.effort` accepts the full nine-word vocabulary, the
LLM classifier returns a structured type + confidence, and the host contracts are checked at boot. Routing results are
unchanged — the golden snapshots are byte-identical to 0.14.4.**

- **Decision telemetry (`lib/telemetry.js`).** Every routed step appends one `router.decision/1` event to
  `<DSH_HOME>/storages/model-router/telemetry/decisions-YYYY-MM.jsonl`: month files, rotated past 8 MB, writes batched on
  `setImmediate` (never on the request path), a corrupt line isolated instead of breaking the file. The event carries
  turn/step, `stepClass`, `score` and its `scoreParts` breakdown, the top-5 candidate scores, the actual `chosen`
  provider/model/effort/tier/cost, `reason`, the `cross` outcome, the step's token delta and `costUnits`, and the
  classifier's `{used,type,confidence}`. No prompt text, no message text, no absolute paths; the session id is hashed to
  `sha256:` plus 16 hex characters. The first write failure is reported once and disables telemetry rather than throwing.
  `DSH_MODEL_ROUTER_TELEMETRY=0` turns it off.
- **`GET /model-router/stats?since=&until=&limit=`.** Aggregates the JSONL into a fixed shape —
  `window{since,until,steps}`, `byClass`, `byModel`, `byEffort`, `totals{costUnits,strongSteps,overrideRate,failedEscalations}` —
  from disk, so it survives a restart and covers sessions that are no longer open.
- **Cost units in `/state.cost`.** `costUnits = token delta × the model's pool cost / 1e6`, accumulated per session and
  per task. This is the plugin's own comparison unit, not a billed amount; 0.16 will replace the pool's relative `cost` with
  prices from the shipped catalog.
- **`/router replay [n]`.** Prints the last n persisted decisions (default 10, max 50), one line each:
  time/turn/step/model/effort/class/score/tokens/costUnits/reason. `/router` without `replay` still prints the live plan.
- **Conditional polling (ETag + 304).** `GET /state` now returns an `ETag` and honours `If-None-Match` with a bodyless
  304; `stateVersion` is a monotonic counter. The panel polls every 1200 ms (was 700), sends `if-none-match` and skips
  the state update on 304, and on a host without ETag falls back to unconditional polling (0.14 behaviour).
  `DSH_MODEL_ROUTER_NO_ETAG=1` disables the ETag for debugging.
- **Nine-word effort vocabulary.** `routes.<class>.effort` accepts `off`, `none`, `minimal`, `low`, `medium`, `high`,
  `xhigh`, `max` and `ultra`; `mapEffort` picks the nearest tier a target advertises and breaks ties upward, so a
  mid-ladder word never silently collapses downward. The `off` and max-class words still pass rule 5 and `allowMax`
  unchanged. The classifier now asks for `{"type":...,"confidence":...}`, falls back to the old prose matching, and
  `classifierMinConfidence` (default 0) ignores a low-confidence answer in favour of the keyword rules.
- **Host self-check.** At boot the router verifies its contracts: `sessionProjections` is required; `webServer`,
  `commands` and `llm` only degrade features. Missing pieces are logged once and exposed as `/state.compat`
  (`missing`, `optional`, `checkedAt`), so an incomplete host is visible instead of mysterious.
- **Golden snapshots and a local gate.** `test/golden.test.js` freezes ten representative routing outcomes (trivial,
  cheap intent, engineering brief, clamped hard, image step, poisoned history, frugal subagent, strong pool pick,
  hysteresis and cross-brand confirm); rewrites only with `GOLDEN_UPDATE=1`. `scripts/gate.mjs` (`npm run test:gate`) runs
  the suite plus the release and catalog checks, and `scripts/smoke.md` lists five checks against a real `dsh web`.
- **Tests.** 267 tests (222 in 0.14.4): telemetry 12, observation 7, golden 11 new; policy 40, routing 17, routes 10 and
  client 38 after their additions.
- **Upgrade note:** no state-file migration is needed. `state.json` keeps its version 2 shape; the telemetry directory is
  created on first write. `DSH_MODEL_ROUTER_TELEMETRY=0` and `DSH_MODEL_ROUTER_NO_ETAG=1` are the two new escape hatches.

## 0.14.4

**A release-engineering release: the version, the tag, the CHANGELOG and the tarball are now checked against each
other by a script, CI runs the suite on Node 20, 22 and 24, the model catalog gets a schema and a generated module,
and the smoke script can tell a live panel from a dead port. Routing results are unchanged — no router code was
touched.**

- **Release gate (`scripts/check-release.mjs`).** One script checks that the package version, the newest CHANGELOG
  heading and `GITHUB_REF` agree, then packs the tarball and compares its file list with the `files` whitelist:
  missing promised files, stray test sources and a version/tag mismatch all fail. It runs locally as
  `npm run release:gate` and in CI for every tag, so a release cannot ship a version that the tag or the notes
  disagree with.
- **CI matrix.** The test job runs on Node 20, 22 and 24 (fail-fast off), syntax-checks every shipped file first,
  and on failure re-runs each test file and emits `::error file=...::` annotations with the tail of the failing
  output. A tag run publishes through npm trusted publishing with a provenance attestation, and an E409 from a
  staging race is tolerated.
- **The model catalog is now a checked artifact.** `catalog/model-catalog.yaml` (19 models, 15 channels, evidence date 2026-10-26) documents price, effort
  vocabulary, context window, channels and scheduled changes per model, with
  `unknown` kept explicit instead of guessed. `schema/model-catalog.schema.json` validates it,
  `scripts/build-catalog.py` compiles it into the committed `lib/catalog.js`, and `scripts/check-catalog.mjs`
  validates the source and the generated module without Python. `lib/catalog.js` exports a frozen list plus
  `findModel`, which accepts an id, a canonical id, an official model id, an OpenRouter id or a qualified id.
  The router does not read the catalog yet; 0.15 adds telemetry and 0.16 turns its prices into cost estimates.
- **Smoke script and fixtures.** `scripts/smoke.mjs` checks a live panel (/state shape, decisions appearing after
  a request, control -> resume round trip) and exits PASS/WARN/SKIP/FAIL; `--check` probes a port without touching
  a running session. `test/fixtures/` adds a documented 108-line decision sample, 18 host-event samples and a fake
  panel host for tests that must not need a real DSH.
- **Docs.** `PUBLISHING.md` gains a release checklist and rollback steps (`npm dist-tag add` the previous version,
  restore the profile backup, fix forward instead of re-tagging); README covers the catalog workflow and the release
  gate in both languages; `EXECUTION.md` records the baseline recovery, every 0.14.3/0.14.4 commit, the CI
  diagnosis and the release evidence.
- **Upgrade note:** no profile or state migration is needed. Stored `settings.json`/state files from 0.14.3 load
  unchanged.
- 222 tests (`test/release.test.js` 8 new, `test/catalog.test.js` 20 new, `test/smoke.test.js` 11 new; 182 in
  0.14.3). Routing-result golden snapshots are unchanged.
## 0.14.3

**A hardening release: the panel no longer trusts any page that can reach the port, a conversation whose history is
already poisoned is repaired on the same step instead of two steps later, the state file recovers instead of being
silently rewritten, and the last dead config key starts working. Routing results are unchanged except where a bug
fix applies.**

- **Panel mutations carry a per-process token (D12).** `GET /model-router/state` hands out `clientToken`, and every
  POST must echo it in `x-model-router-token`; a stale token (after a plugin reload) is refreshed once and the
  request replayed. Reads are now same-origin checked too, because the state payload contains the user's plan.
  `stateFile` and `prices.file` are reduced to bare file names, and every response carries `cache-control: no-store`.
  `DSH_MODEL_ROUTER_NO_TOKEN=1` disables the token for a panel build or a local script that has not been updated;
  the same-origin check stays on. This stops a cross-site page, not a local process — local code can call the host
  API anyway.
- **A poisoned history now pins effort `off` immediately (D7/S1).** The downgrade hysteresis (two quiet steps) used
  to sit between the poison detector and the request, so the very step that detected a thinking-less tool call still
  sent `high`/`max` and DeepSeek answered 400. The forced `off` bypasses `stabilize` and resets its streak.
- **State file recovery and health (D13).** `state.json` is now version 2; version 1 files migrate on load. A corrupt
  file is renamed to `state.json.corrupt-<ISO>` instead of being silently overwritten, and a newer version is served
  read-only rather than downgraded. Write failures surface through a one-time warning, `storeHealth` in `/state`
  (`ok`, `lastErrorAt`, `lastErrorCode`, `corruptBackup`, `readOnly`, `version`), and the session map is capped at
  200 entries by least-recently-seen.
- **`maxPerTask.strong` in the row config now applies (D9).** It is a default ceiling for strong pool entries that do
  not set their own `maxPerTask`; an entry-level value still wins and the default stays "unlimited".
- **`imagePolicy: "flash"` is retired (D15).** The value was documented in one place and treated as "keep" by the
  decision engine. Stored settings migrate to `vision` with a warning; only `keep` | `vision` are accepted.
- **Compatibility declared (D8).** `engines.dsh` and `dsh.compat.dsh` are `>=0.1.7-rc.2 <0.2.0`. No
  `@deepseek-ai/*` peer dependency is declared: the host boot gate reads peers only and silently skips a plugin it
  cannot resolve, which is exactly what a mistyped peer would cause (see dsh-better-sidebar 0.24.1). `engines.dsh`
  feeds dshmarket's install check; the runtime self-check lands in 0.15.
- **Upgrade note:** since 0.14.2 the shipped route table already sends `trivial` to `low`, so a profile override that
  was added to cancel the old `trivial -> off` default can be deleted. The profile patch file is rewritten on a
  plugin reinstall, so the workaround was only ever temporary.
- 181 tests (`test/routes.test.js` 7 new; `test/store.test.js` 6 new; +1 each in policy, routing, plugin and modes).
  Routing-result golden snapshots are unchanged for everything except the D7 fix.
## 0.14.2

**The composer readout now tracks the host almost live: a shorter poll plus an immediate refresh the moment the window comes back.**

- The trigger/badge readout is driven by `GET /model-router/state`, which the panel polls. The interval dropped
  from 2500 ms to 700 ms, so the model and effort of the current step appear within well under a second.
- `visibilitychange` (becoming visible) and window `focus` now call the same refresh at once, instead of waiting
  for the next tick — the common "switch back to DSH and the label is stale" case is gone. A hidden window still
  polls nothing.
- Unchanged by design: the cell itself shows the official session model + reasoning effort (the plugin never
  writes `modelSelection`), while the router's own per-step choice appears in the readout, the panel and the
  per-call route rows.
- 161 tests (`test/client.test.js` 1 new: the poll is armed while visible, does nothing while hidden, and a
  returning window refreshes immediately).
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
