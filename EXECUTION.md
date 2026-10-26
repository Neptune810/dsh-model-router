# Execution log

What was actually done to this repository and to the local DSH profile, with the evidence that
proves it. Written while executing the 2026-10 roadmap
(C:\DSH\routing-plan-2026-10\PLAN.md); this file is the running record, PLAN.md is the plan.

Last updated: 2026-10-26.

## Environment

| | |
| --- | --- |
| Repository | C:\DSH\dsh-model-router |
| Remote | https://github.com/Neptune810/dsh-model-router |
| Branch used for the release train | one @@release/<version>@@ branch per milestone (@@baseline/0.14.2@@ for 0.14.3/0.14.4); each pushed to main |
| Profile upgraded | C:\Users\97161\.dsh\profiles\web |
| Node used locally | v24.21.0 (Windows) |
| Python used locally | C:\Users\97161\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe (PyYAML 6.0.3) |
| pnpm | 12.5.1, nodeLinker hoisted, autoInstallPeers false |
| npm publishing | GitHub Actions OIDC trusted publishing; no usable token on disk (npm whoami is E401) |

## M0 — baseline restore (2026-10-26)

The checkout was 12 published versions behind: the working tree was 0.6.10 while npm served
0.14.2, and the tags for 0.7.0-0.10.1 were never pushed. 0.14.2 is the single baseline.

1. Backed up the profile before touching it:
   C:\DSH\routing-plan-2026-10\backup\profile-0.6.10\ holds package.json, pnpm-lock.yaml,
   cordis.yml, cordis.patch.yml and .model-router\state.json.
2. Restored the tagged source: tag v0.14.2 -> commit 1d1968a0e101d561c9b086b7de2e72260ebd8dc1.
   The files were fetched through the GitHub web API (the git transport was blocked by the proxy at
   that moment) and committed as b15f658 "chore: restore v0.14.2 source from GitHub tag v0.14.2".
   The old tree is preserved on branch legacy-0.6.10 (points at b7702c2).
3. Provenance of the restored tree: 25 text files, and 'node --test' gives 161 tests / 161 pass /
   0 fail. docs/*.png and docs/ui-preview.html were not restored through the API; they are still in
   the working tree and are required by the "files" whitelist, so the first release built here
   ships them unchanged.
4. Upgraded the running profile: 'pnpm add @neptune810/dsh-model-router@0.14.2 --save-exact'.
5. A desktop DSH process cannot be restarted from inside this session (it would kill the session),
   so the loaded plugin stays at 0.6.10 until the app is restarted. Every profile upgrade below has
   the same caveat.

## 0.14.3 — released 2026-10-26

Theme: the S1/S2 correctness and safety debt (D7, D9, D12, D13, D15) plus the DSH compatibility
declaration (D8). Runtime routing results are unchanged on purpose: a patch release must be safe to
install blindly.

### Commits on baseline/0.14.2

| commit | subject |
| --- | --- |
| d2a9142 | fix(index): keep thinking off for a poisoned history, bypassing hysteresis (D7) |
| 7e15027 | fix(store): recover from a corrupt state file, cap sessions, surface write failures (D13) |
| ec8f0e9 | fix(routing): honour the config-level maxPerTask.strong (D9) |
| 416acc2 | fix(policy): retire imagePolicy "flash" (D15) |
| a2a3bdc | fix(routes): same-origin reads, panel token on writes, redact absolute paths (D12) |
| 0699b8d | chore(release): 0.14.3 |
| 385c5b6 | test(routes): make the cross-platform fixture pass on Linux |
| fe59105 | ci: surface test failures as public check-run annotations |
| de0b847 | test(store): accept the ENOTDIR read error Linux reports before the write failure |

Details worth keeping:

- D7: a poisoned history now pins effort to off before the hysteresis gate instead of going through
  it. Before this, a step that climbed to high/max could keep thinking enabled for the downgrade
  window (downAfter = 2 steps) and DeepSeek answered 400.
- D13: state file gains version 2, a 200-session cap with LRU trimming, a corrupt file is renamed to
  state.json.corrupt-<ISO> instead of being overwritten, a version > 2 file is opened read-only, and
  flush failures are recorded in store.health() instead of vanishing.
- D9: the config-level maxPerTask.strong is now the default cap for strong entries; entry-level
  values still win.
- D12: GET requests are same-origin checked too, writes need the per-process x-model-router-token,
  /state returns clientToken, and absolute paths are redacted to basenames.
- D8: package.json now declares engines.dsh and dsh.compat.dsh as ">=0.1.7-rc.2 <0.2.0". It is
  deliberately NOT a peerDependency: the DSH boot gate silently skips a bundle whose
  @deepseek-ai peer ranges do not match, which would disable the plugin without a message.

### CI: two failures, both found from public annotations

The first tag run (40272590633, commit 385c5b6) failed on ubuntu-latest while the same tree was green
on Windows. Raw Actions logs need admin rights, but check-run annotations are publicly readable, so
the Test step was rewritten (fe59105) to re-run each failing test file alone and emit its tail as an
::error annotation. That turned the second run (40272859181) into a one-line diagnosis: the store
flush test expected one recorded error, Linux reported two, because reading a file whose parent was
replaced by a regular file throws ENOTDIR on Linux and ENOENT on Windows. de0b847 accepts both and
asserts the last error is the write failure. 182/182 tests pass locally afterwards.

### Publish evidence

- Run 40273010984: test job (6 steps) and publish job (6 steps) all success.
- Annotated tag v0.14.3 object 0b21de8 -> commit de0b847; the tag was force-moved twice while the
  CI fixes went in, and npm published the final commit.
- registry: 0.14.3 published 2026-10-26T05:14:12Z, 19 files, shasum
  20275a7baef5cdf0cbad18ef87583b3900ba13a7, SLSA provenance attestation v1
  (/npm/v1/attestations/@neptune810%2fdsh-model-router@0.14.3), _npmUser GitHub Actions.
- Tarball checked by unpacking to C:\DSH\routing-plan-2026-10\npm-0.14.3\package: version 0.14.3,
  engines.node >=20, engines.dsh and dsh.compat.dsh declared, the "files" whitelist intact, CHANGELOG
  first section = 0.14.3.

### Profile

'pnpm add @neptune810/dsh-model-router@0.14.3 --save-exact' in profiles\web (12.5 s). Verified from
the profile directory: require(package.json).version is 0.14.3, 'import lib/index.js' exposes
apply/inject/name, and node_modules\@neptune810\dsh-model-router\lib has all 9 files. pnpm added
0.14.3 to minimumReleaseAgeExclude by itself.

Action needed outside this session: restart the desktop app so the new version is loaded.

## 0.14.4 — released 2026-10-26

Theme: the release train itself. No runtime routing change; the deliverable is that a version can be
produced and verified mechanically. PLAN.md section 5.2, six PRs at 0.5-1 person-day each.

| PR | scope | state |
| --- | --- | --- |
| PR-144-1 | CI on Node 20/22/24, one job per concern | done in .github/workflows/publish.yml (matrix + test/publish split) |
| PR-144-2 | version/tag/CHANGELOG/pack gate | done in scripts/check-release.mjs + test/release.test.js (8 tests) |
| PR-144-3 | three zero-dependency smoke checks | done: scripts/smoke.mjs (S1 /state shape, S2 decisions appear, S3 control/resume; --check exits SKIP on a dead port), test/smoke.test.js 11 tests |
| PR-144-4 | catalog schema skeleton and generator | done: catalog/model-catalog.yaml (19 models, 15 channels, 4 calendar entries, evidence 2026-10-26), schema/model-catalog.schema.json (draft-07, 1032 lines), scripts/build-catalog.py, lib/catalog.js 88,194 B sha256 f674741e375050b6 (generated, never hand-edited), scripts/check-catalog.mjs, test/catalog.test.js 20 tests. One pinned warning: claude-sonnet-5-5 quality.aaVariant has no public source |
| PR-144-5 | PUBLISHING.md release checklist and rollback | done (checklist, post-publish verification, 3-step rollback, 24 h watch) |
| PR-144-6 | test fixtures | done: test/fixtures/ (README, decisions.sample.jsonl 108 lines, host-events.json 18 samples, fake-host.mjs; the fake host only listens with FAKE_HOST_SERVE=1 so a bare `node --test` cannot hang) |

Release gate commands:

    npm test
    npm run release:gate                      # tag + version + CHANGELOG + tarball contents
    python scripts/build-catalog.py --check   # lib/catalog.js matches the YAML

All three must pass before 'git tag v0.14.4'.

### Commits on baseline/0.14.2

| commit | subject |
| --- | --- |
| 7901499 | ci(release): run the suite on node 20/22/24 and gate every tag |
| b548237 | feat(catalog): ship a validated model catalog and its generated module |
| 01968fc | test(smoke): add a panel smoke script, fixtures and a fake host |
| d9a16a2 | docs: catalog workflow, release checks and the execution log |
| 28beedb | chore(release): 0.14.4 |

### Publish evidence

- Pushed baseline/0.14.2 -> main (de0b847..28beedb), annotated tag v0.14.4 object d44c99f -> 28beedb.
- Run 40275700887 (tag): test (node 20/22/24) and publish all success; the node 24 leg ran the release
  gate, the catalog generator check and the catalog validator.
- Run 40275691783 (main): same matrix, success.
- registry: 0.14.4 visible on 2026-10-26T05:42Z after npm's staging window; 22 files, shasum
  130332ac7c677b9f03dbcce143db90326bba5a74, integrity
  sha512-24iRtwsiegYkv5wq715+DLcb51xFXbnQLzqBkwc6Lm/uUm6aZrV0q6h8WRDfgYR+g84M+Z0hatHP8gqKFfUGcQ==,
  publish + SLSA provenance attestations attached, _npmUser GitHub Actions. Note that the npm *document*
  for the whole package can lag a fresh publish ("npm view version" showed 0.14.3 while /-/package/.../dist-tags
  already said 0.14.4); the version document (0.14.4) and the tarball were correct.
- Tarball unpacked to C:\DSH\routing-plan-2026-10\npm-0.14.4\package: 22 files, version 0.14.4, ships
  catalog/model-catalog.yaml and schema/model-catalog.schema.json, docs/*.png and docs/ui-preview.html intact.
- Profile: 'pnpm add @neptune810/dsh-model-router@0.14.4 --save-exact' in profiles\web (12.2 s, 173
  entries checked); dependencies and node_modules both report 0.14.4. A restart of the desktop app is
  required before the running session loads it (same caveat as every upgrade).

Freeze evidence (2026-10-26, local):

| check | result |
| --- | --- |
| node --test | 222 tests / 222 pass / 0 fail (182 in 0.14.3) |
| node scripts/check-release.mjs --pack | ok: version 0.14.4 = changelog 0.14.4, tag (none locally), 22 packed files |
| node scripts/check-catalog.mjs | exit 0: 19 models, 15 channels, 4 calendar entries, 1 pinned warning |
| python scripts/build-catalog.py --check | OK: lib/catalog.js matches the YAML, sha256 f674741e375050b6 |

Docs updated with the release: README + README.zh gain "The model catalog" / "模型目录" and "Release checks" /
"发布检查" sections and the new test counts; CHANGELOG gets the 0.14.4 section; PUBLISHING.md and package.json
were updated with PR-144-2/144-5.

## 0.15.0 — the observation baseline (2026-10-26/27)

Theme: make the router observable before making it cleverer (PLAN.md section 5.3, T1-T12). The routing
result is unchanged; this release records what the router decided, what it cost and why, and closes the
three silent-degradation points the audit found.

Branch: release/0.15.0, forked from 29bf8df (v0.14.4, main). Four isolated worktrees were used so
teammates could work in parallel without touching each other:
wt/telemetry (feat/150-telemetry), wt/client (feat/150-client-etag), wt/vocab (feat/150-effort-vocab)
and wt/golden (feat/150-golden). Lead-owned files (lib/index.js, lib/routes.js, lib/policy.js scoreParts,
README/CHANGELOG/EXECUTION) were changed only in the main worktree; every branch was merged with
--no-ff after its own tests passed.

### What landed, by spec

| PR | theme | result |
| --- | --- | --- |
| 150-1 | decision telemetry | lib/telemetry.js (v1 JSONL, month files, 8 MB rotation, setImmediate batching, corrupt-line isolation, summarize, health, readRecentSync) + test/telemetry.test.js 12 tests |
| 150-2 | /stats route | GET /model-router/stats?since=&until=&limit= aggregates the JSONL into window/byClass/byModel/byEffort/totals |
| 150-3 | /router replay | command parses "replay [n]" and prints the last n persisted decisions; a bare /router still prints the live plan |
| 150-4 | usage -> costUnits | /state.cost {sessionTokens,lastStepCostUnits,sessionCostUnits,taskCostUnits}, token delta x pool cost / 1e6, flushed into each event |
| 150-5 | conditional polling | /state ETag + If-None-Match -> 304, stateVersion counter, panel polls 1200 ms and skips the state update on 304, old-host fallback kept (commit e792547) |
| 150-6 | nine-word vocabulary | routes accept off/none/minimal/low/medium/high/xhigh/max/ultra; mapEffort picks the nearest tier and breaks ties upward; off and max-class still pass rule 5 and allowMax (commit 22d917c) |
| 150-7 | classifier confidence | classifier asks for {"type":...,"confidence":...}, keeps prose fallback, classifierMinConfidence filters low-confidence answers |
| 150-8 | startup self-check | /state.compat {missing,optional,checkedAt}; sessionProjections required, webServer/commands/llm optional; one warn at boot |
| 150-9 | golden + gate | test/golden.test.js 11 tests (10 scenarios + fixture integrity), scripts/gate.mjs (npm run test:gate), scripts/smoke.md (commit e34e118) |

Lead-side additions not in a spec file: scoreParts breakdown in lib/policy.js scoreOf (the same score,
itemized), hashSessionId/parseClassifierAnswer/normalizeWindow/commandArgs helpers, telemetryStatus()
that never leaks the absolute directory, and a boot-time warn for cfg.effortWarnings.

### Commits on release/0.15.0 (before the release commit)

| commit | subject |
| --- | --- |
| c082fa4 | feat(telemetry): persist routing decisions to JSONL |
| e792547 | feat(panel): conditional /state polling with ETag and a 1200 ms cadence |
| 22d917c | feat(effort): accept the full 9-word effort vocabulary in route config |
| 9e668ee | Merge branch 'feat/150-effort-vocab' |
| 6e34206 | Merge branch 'feat/150-client-etag' |
| e34e118 | test(golden): freeze routing decisions and add the local release gate |
| fb720c7 | merge: 0.15.0 golden snapshots and local release gate (150-9) |

### Freeze evidence (local, before the tag)

| check | result |
| --- | --- |
| node --test | 267 tests / 267 pass / 0 fail (222 in 0.14.4) |
| node scripts/gate.mjs | PASS: tests 6.0 s, release checks 0.0 s, catalog checks 0.1 s |
| node scripts/check-release.mjs --pack | ok: version 0.15.0 = changelog 0.15.0, tarball contents match the whitelist |
| node scripts/check-catalog.mjs | exit 0: 19 models, 15 channels, 4 calendar entries, 1 pinned warning |
| py -3 scripts/build-catalog.py --check | OK: lib/catalog.js matches the YAML, sha256 f674741e375050b6 |

Docs updated with the release: README + README.zh gain the "observation baseline" section (telemetry,
cost units, /stats, /router replay, ETag, self-check), the nine-word route note, classifierMinConfidence,
updated test counts and the catalog note; CHANGELOG gets the 0.15.0 section; package.json is 0.15.0.

### Publish evidence

| step | evidence |
| --- | --- |
| push | `29bf8df..c9ea180 release/0.15.0 -> main`; tag `v0.15.0` (annotated object `3d326865b398e2aea5054ec7c333d7a12444e535`) -> `c9ea180` |
| CI (tag) | run [40277432896](https://github.com/Neptune810/dsh-model-router/actions/runs/40277432896) success: test node 20/22/24, release gate, catalog generator check and validator all success; publish job `121423133217` success |
| CI (main) | run [40277428519](https://github.com/Neptune810/dsh-model-router/actions/runs/40277428519) success |
| npm | `dist-tags {"latest":"0.15.0"}`; version doc: `_npmUser` GitHub Actions, `dist.fileCount` 23, shasum `d17e5be8074f12c51b79ef9066ea3623ef4958d8`, integrity `sha512-lRXSZHxYsDqKc+3SgcHwVY+WyYKKdgwm2xRXVbu6Ipl+WhBQL7e6n+njXFaPu4hszIVBtEY27iZjPCap6NUFfg==`, provenance attestation on registry.npmjs.org |
| tarball | 23 files unpacked to `C:\DSH\routing-plan-2026-10\npm-0.15.0\package`; `lib/telemetry.js`, `catalog/model-catalog.yaml`, `schema/model-catalog.schema.json` all present |
| profile | `C:\Users\97161\.dsh\profiles\web`: `pnpm add @neptune810/dsh-model-router@0.15.0 --save-exact` ok in 10.4 s, installed 0.15.0, `node_modules/.../lib` includes `telemetry.js`; desktop DSH needs a restart to load it (peer-dependency WARNs are pre-existing) |

Registry propagation lagged about a minute (dist-tags briefly showed `latest: 0.14.4` right after the publish job went green); the tag object differs from the commit SHA as expected for an annotated tag.


## 0.15.1 - priced decisions, watchlist and drift (2026-10-26)

A data release on top of 0.15.0: the catalog's dated prices become the number on every decision, the
watchlist advertises hard dates for models outside the pool, and a weekly drift report tells a maintainer what
moved upstream. Routing is untouched - the golden snapshots are the 0.15.0 bytes.

**How it was built.** Two delegations (task-17 cost ledger, task-18 panel dot) were dispatched into isolated
worktrees (`wt/cost-ledger` on `feat/151-cost-ledger`, `wt/catalog-panel` on `feat/151-catalog-panel`), but both
teammates failed twice with no closing message, so the Lead implemented both in the main worktree
(`release/0.15.1`, base `fa3ed0e`) instead of waiting. Lead-owned files - `lib/index.js`, `lib/telemetry.js`,
`client/client.js`, `package.json`, README/README.zh/CHANGELOG/EXECUTION - were never edited from a worktree.

### What landed

| area | result |
| --- | --- |
| catalog watchlist | top-level `watchlist:` in catalog/model-catalog.yaml (first entry: GLM-4.5 retires 2026-12-31), validated by schema + check-catalog + build-catalog, a watchlist id may not shadow a known model id (commit bcfb81e) |
| catalog pricing | lib/catalog-pricing.js: pricesAt / tokenCost / usdCost / tokenSplit / upcomingAlerts / modelMeta, pricing.next takeover, peak and off-peak windows in Asia/Shanghai, fxRate conversion; unknown price stays null; 18 tests (commit 7813fbf) |
| drift pipeline | scripts/catalog-diff.mjs (zero dependencies, advisory, never edits the catalog) + test/catalog-diff.test.js (15 tests) + .github/workflows/catalog-diff.yml (Monday 03:00 UTC, report uploaded) (commit 3193ecf, merged fa3ed0e) |
| priced decisions | every `router.decision/1` now carries `usage.split`, `usage.costUsd` and a `usage.price` snapshot taken at the step timestamp; /state gains `catalog`; /stats gains the ledger and a per-row `catalog`; new export `./catalog-pricing` (commit c8abd5a) |
| telemetry ledger | rows and totals carry tokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, costUsd, pricedSteps, unpricedSteps; a 0.15.0 event has no split and counts as unpriced |
| client | warning dot on the trigger and in the panel head plus a three-line note under the price note, bilingual copy, and complete silence when the host sends no `catalog` block (+3 tests, 41 in the file) |

### Commits on release/0.15.1

| commit | subject |
| --- | --- |
| bcfb81e | feat(catalog): keep a watchlist of hard dates for models outside the pool |
| 7813fbf | feat(pricing): price decisions and alerts at the catalog rates |
| 3193ecf | feat(catalog): add read-only catalog drift pipeline |
| fa3ed0e | merge: 0.15.1 weekly catalog drift pipeline (151-1) |
| c8abd5a | feat(telemetry): price every decision at catalog rates and surface hard dates |

### Freeze evidence (local, before the tag)

| check | result |
| --- | --- |
| node --test | 305 tests / 305 pass / 0 fail (267 in 0.15.0) |
| per file | policy 40, routing 17, plugin 19, modes 34, pricing 11, effort-model 10, route-projection 12, client 41, store 6, routes 10, release 8, catalog 21, catalog-pricing 18, catalog-diff 15, smoke 11, telemetry 13, observation 7, golden 11 |
| node scripts/gate.mjs | PASS: tests 7.4 s, release checks 0.1 s, catalog checks 0.1 s |
| node scripts/check-release.mjs --pack | ok: version 0.15.1 = changelog 0.15.1, tarball contents match the whitelist, packed files 24 (23 in 0.15.0: +lib/catalog-pricing.js) |
| node scripts/check-catalog.mjs | exit 0: 19 models, 15 channels, 4 calendar entries, 1 watchlist entry, schemaVersion 1.0.0, evidence 2026-10-26, 1 pinned warning |
| py -3 scripts/build-catalog.py --check | OK: lib/catalog.js matches the YAML, 19 models, 88865 bytes, sha256 7f018f7cf4e86c5b |
| golden | test/fixtures/golden untouched since 0.15.0; only ROUTER_POLICY (0.15.1) and the usage block changed, and routing assertions still pass |

Docs updated with the release: README and README.zh gain the "prices, hard dates and catalog drift" section, the
cost-units caveat, the real test counts and the corrected catalog paragraph (the router now reads the catalog for
money and dates, but still scores by pool-relative `cost`); CHANGELOG gets the 0.15.1 section; package.json is
0.15.1 with the new `./catalog-pricing` export.

### Publish evidence (2026-10-26)

| step | evidence |
| --- | --- |
| branch | `release/0.15.1` from `e6382ef` (the 0.15.0 evidence commit), five commits, one merge |
| push to main | `git push origin release/0.15.1:main` -> `e6382ef..92331bc` (fast-forward) |
| tag | annotated `v0.15.1` (object `60fdc63922207501407bad75b3bb432b2fdb0ca1`) -> commit `92331bc` |
| CI (tag) | Actions publish run [40280584353](https://github.com/Neptune810/dsh-model-router/actions/runs/40280584353) success: test node 20/22/24, release gate `--pack`, catalog regeneration, catalog validator, then the OIDC publish job |
| CI (main) | Actions publish run 40280560596 success (tests + gate, publish job skipped: not a tag) |
| drift workflow | catalog-diff run 40280584393 (tag) and 40280560603 (main) success, report uploaded as an artifact |
| npm | `dist-tags.latest = 0.15.1`, tarball shasum `fed6bd56942032968d7c5533a377cd3cee1f7dcd`, published with provenance from the tag run |
| staging window | npm held the first upload in its staging window for a few minutes (`version not found` right after the run); visible at 06:39Z, handled by the workflow's E409 branch, no re-publish needed |
| profile | `C:\Users\97161\.dsh\profiles\web`: `pnpm add @neptune810/dsh-model-router@0.15.1 --save-exact`, dependency pinned to `0.15.1` (the desktop app must be restarted to load it) |

Rollback if needed: `npm dist-tag add @neptune810/dsh-model-router@0.15.0 latest` and `pnpm add` 0.15.0 in the
profile; 0.15.1 reads 0.15.0 state without migration, so a downgrade is safe.

## 0.16.0 — the cost-aware shadow (2026-10-26)

**Goal.** Price the decision, not just the bill: give every pool entry one blended USD-per-million-token rate
from the shipped catalog at the step's own instant, let a cost term join the score, and ship both **dark**. The
route must not move until the shadow shows what moving would save, so the ten golden snapshots stay
byte-identical to 0.15.1.

**What landed.**
- `lib/pricing2.js` (new, 19 KB, pure, zero dependency, subpath export `./pricing2`): `DEFAULT_MIX`,
  `mixFromSplit`, `blendedUsdPerMTok`, `promptTokensOf`, `longContextRates`, `stepCost`, `perCallCost`.
  Peak/off-peak windows, long-context tiers (`whole_request` and `excess`, largest matching threshold, own
  `effectiveFrom`) and per-1000-call rows (DeepSeek Search/Fetch from 2026-11-01) all come from the catalog;
  an unknown price is `null`, never zero.
- `lib/routing.js`: `scoring.costWeight` 0.15, `costGuard {maxMultiple: 8, unknownPricing: 'exclude'}`,
  `routing.costAware: false`, `costAllows()` and the `costFallback` retry - a guard that empties the pool
  re-runs the choice with cost awareness off, so cost can never leave a session unrouted.
- `lib/index.js`: `costBasis()` builds the per-entry rates and the floor once per decision, the cost signals
  feed both `chooseEntry` calls (cross-brand proposal and main choice), the shadow block records the nine
  fields when `costAware` is off, and `GET /state.costAware` publishes `{enabled, costWeight, guard, mix,
  floorUsdPerMTok, entries, shadow}`.
- `lib/telemetry.js`: the `router.decision/1` event carries the shadow, and `summarize` adds `shadow:
  {steps, agreeSteps, divergedSteps, agreementRate, pricedSteps, currentUsd, candidateUsd, savedUsd,
  savedRatio}` (a malformed shadow is skipped; a step with no priced pair counts but costs nothing).
- `client/client.js`: one caption under the price note - divergence with the saved ratio, the agreement form,
  `(on)` once the flag is on, English, and nothing at all on a host that sends no `costAware` block.
- Docs: CHANGELOG 0.16.0, both READMEs (a new cost section plus the real test counts), PLAN §3.1/§5.5/§5.6
  re-baselined (channels deferred to 0.16.1, the default flip to 0.17.0), ROADMAP.en.md and
  release-calendar.csv marked up to 0.16.0.

**Freeze evidence.** `node --test` 333/333 pass (305 in 0.15.1: +15 pricing2, +6 routing, +4 observation,
+1 telemetry, +2 client), `node --check` clean, golden snapshots untouched, `scripts/check-release.mjs --pack`
green locally before the tag.

**Deferred on purpose.** C4 budget gate, C5 peak policy, C6 channel health/failover and C7 cross-brand cost
guard moved to 0.16.1 as a whole: they change routing behaviour or stability, which is a different risk class
from "let the cost data speak first", and a separate minor lets them carry a full mock-failover suite and a
budget drill as their gate.

**Commits.** `d57c464` the pricing basis, `5340121` the wiring (scoring, shadow, telemetry, client, tests),
`0193c7b` `chore(release): 0.16.0` (version, CHANGELOG, both READMEs).

### Publish evidence (2026-10-26)

| step | evidence |
| --- | --- |
| branch | `release/0.16.0` from `ec0e67c` (the 0.15.1 evidence commit), three commits |
| push to main | `git push origin release/0.16.0:main` -> `ec0e67c..0193c7b` (fast-forward) |
| tag | annotated `v0.16.0` -> commit `0193c7b` |
| CI (tag) | Actions publish run [40282986365](https://github.com/Neptune810/dsh-model-router/actions/runs/40282986365) success: test node 20/22/24, release gate `--pack`, catalog regeneration, catalog validator, then the OIDC publish job |
| CI (main) | Actions publish run 40282982504 success (tests + gate, publish job skipped: not a tag) |
| drift workflow | catalog-diff run 40282986335 success, report uploaded as an artifact |
| npm | `dist-tags.latest = 0.16.0`, tarball shasum `12ae33b51ec586c32cdc2b4816791057536c8817`, published with provenance from the tag run |
| profile | `C:\Users\97161\.dsh\profiles\web`: `pnpm add @neptune810/dsh-model-router@0.16.0 --save-exact`, dependency pinned to `0.16.0` (the desktop app must be restarted to load it) |

Rollback if needed: `npm dist-tag add @neptune810/dsh-model-router@0.15.1 latest` and `pnpm add` 0.15.1 in the
profile; 0.16.0 reads 0.15.1 state without migration and its routing is byte-identical with `costAware` off, so
a downgrade changes nothing but the shadow fields.

## 0.16.1 — channel health, failover, spend guard, the peak window (2026-10-26)

**Goal.** Make official + account pool + relay + cross-brand first class without touching the quality
policy: failover only on 429/5xx/timeout, and golden snapshots that stay byte-identical while
`channels.failover` is off. Flipping `costAware` stays in 0.17.0 — the shadow needs more days, and
adding channels and flipping the flag are two different risk classes.

**What landed.**
- `lib/channels.js` (new, 13.5 KB, pure, zero dependency): `classifyFailure` (status/code to rotate,
  failover or none), `ChannelHealth` (rolling window, TTFT EWMA, success streak, cooldown, `cool()` to bench
  a channel the moment a request fails), `orderChannels` / `channelRanks` (stable and lossless: benched
  channels sink, they are never removed) and `fingerprint` (model mismatch, missing usage, missing
  reasoning, TTFT outlier).
- `lib/budget.js` (new, pure): session/day/month rows in tokens and USD, `softRatio` 0.8, `exceeded`,
  `formatBudgetRow` / `budgetLine`, local day and month starts.
- `lib/routing.js`: `crossCost` (scoreMargin 5, maxMultiple 3x), the `channels` block (failover off,
  failThreshold 3, cooldownMs 60000, ewmaAlpha 0.3, maxTtftMs 30000, maxFailoversPerStep 1), `budget`,
  `peakPolicy` defaulting to `inform`, `entry.channel` in `normalizePool`, and channel rank plus blocked
  state in the `chooseEntry` ordering. Cost can still never leave a session unrouted (`costFallback`).
- `lib/index.js`: `agent/request-error` records the failure on the channel ledger, benches the channel, and
  asks for one `{kind:"retry"}` per `(turn, step)` only when a healthy alternative exists and the failure is
  not the user doing; a brand whose every channel is benched fails over cross-brand, but only to a
  catalog-priced entry, and `crossProvider: "never"` still wins. `agent/pre-step` refuses only a synthetic step
  once a hard limit is crossed, and one release (`POST /model-router/budget` or `/router budget [once]`) lets the
  next step through. `/state` gains `channels`, `budget`, `peak`, `lastError`, `lastVerify` and
  `cross.costMultiple`; the decision reason list is published in full (cross-brand vetoes, failovers,
  not-worth-a-review notes).
- `lib/telemetry.js`: `router.decision/1` carries `peak` and `failoverFrom`, and `summarize` adds
  `peakSteps` / `peakCostUsd` / `peakShare` / `failoverSteps` to `totals`.
- `client/client.js`: a budget dot (near/over) on the trigger, a spend block with one bar per active row,
  a peak note and a benched/quarantined channel line — bilingual, and absent on a host that sends no
  such block.
- Docs: CHANGELOG 0.16.1, both READMEs (the channel/spend/peak section plus the real test counts),
  PLAN §3.1 and §5.6 marked delivered (catalog sync and the shadow review deferred to 0.17.0).

**Freeze evidence.** `node --test` 368/368 pass (333 in 0.16.0: +18 channels, +3 routing, +1 telemetry,
+7 observation, +6 client), `node --check` clean on every touched file, golden snapshots byte-identical
with `channels.failover` off, `scripts/check-release.mjs --pack` green (27 packed files, up from 25) and
`scripts/check-catalog.mjs` OK (19 models / 15 channels / 4 calendar entries / 1 watchlist entry).

**Deferred on purpose.** Catalog sync (the 2026-12-01 Gemini 4 Argon price and the GLM-4.5 retirement)
rides with the 2027-01-01 price sync in 0.17.0, and the shadow mid-term review needs more than seven
days of data.

**Commits.** `f8d7b1d` the channels, budget, wiring, telemetry, client and tests work; `102415e`
`chore(release): 0.16.1`.

### Publish evidence (2026-10-26)

| step | evidence |
| --- | --- |
| branch | `release/0.16.1` from `d78f1ca` (the 0.16.0 evidence commit), two commits |
| push to main | `git push origin release/0.16.1:main` -> `d78f1ca..102415e` (fast-forward) |
| tag | annotated `v0.16.1` -> commit `102415e` |
| CI (tag) | Actions publish run [40289447786](https://github.com/Neptune810/dsh-model-router/actions/runs/40289447786) success: test node 20/22/24, release gate `--pack`, catalog regeneration, catalog validator, then the OIDC publish job |
| CI (main) | Actions publish run 40289443252 success (tests + gate, publish job skipped: not a tag) |
| drift workflow | catalog-diff run 40289447819 success, report uploaded as an artifact |
| npm | `dist-tags.latest = 0.16.1`, tarball shasum `8efd2f5b9a478f89fbc8061637b2d393e3e17bdb`, integrity `sha512-c4mzZ9ZJkzyD67rLKPov8wgn0TGZU8lP9uKoJgGU2ss3een+dQehKEoRmx4r5pBin8BFeIyOpWVLVUOhtZ+1PQ==`, published with provenance from the tag run |
| profile | `C:\Users\97161\.dsh\profiles\web`: `pnpm add @neptune810/dsh-model-router@0.16.1 --save-exact`, dependency pinned to `0.16.1` (the desktop app must be restarted to load it) |

Rollback if needed: `npm dist-tag add @neptune810/dsh-model-router@0.16.0 latest` and `pnpm add` 0.16.0 in
the profile; 0.16.1 reads 0.16.0 state without migration, and with `channels.failover`, `budget.mode` and
`crossProvider` left at their defaults the routing is byte-identical to 0.16.0.
