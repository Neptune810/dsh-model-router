# Execution log

What was actually done to this repository and to the local DSH profile, with the evidence that
proves it. Written while executing the 2026-10 roadmap
(C:\DSH\routing-plan-2026-10\PLAN.md); this file is the running record, PLAN.md is the plan.

Last updated: 2026-11-05.

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

## 0.17.0 — effort economics, part one: the ladder becomes auditable (2026-10-26)

**Goal.** Turn "the thinking tier did something, but what?" into a recorded, countable, replayable fact — without
flipping any default. Part one of the 0.17.0 scope in `PLAN.md` §5.7; the feedback loop, classifier v2, ε-greedy
and the L2 economics run moved to 0.17.1 because their gates need shadow samples and labels that cannot exist yet.

**What landed.**
1. `lib/effort.js` — the eight-step ladder (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`)
   with points matching `policy`, `ladderRank` (unknown words land on `high`, never `off`), and deterministic
   `DEFAULT_BUDGETS` (low 2048 … max 32768) that a model can override through `effort.budgets` in the catalog;
   `budgetForTier` clamps to `maxOutput`.
2. `explainMapping(tier, applied, meta)` returns `{from, to, why}` with `why` in `exact | alias | nearest | none`.
   The four outcomes are the contract: a request is either taken verbatim, aliased onto a shorter vocabulary,
   moved to the nearest tier, or the model does not take tiers at all. Nothing collapses silently.
3. Every decision event carries `effortMapped`; `/state.effort` publishes the ladder, the points and the last
   mapping; a non-`exact` outcome is appended to the route `reason`.
4. `/stats` counts it: `totals.mappedSteps`, `totals.mappedShare`, `effort.byClass` and `effort.top`
   (the `from->to:why` pairs).
5. `lib/replay.js` (npm script `replay`, bin `dsh-model-router-replay`) reads `decisions*.jsonl`, re-runs
   `chooseEntry` and the ladder mapping with the code and pool you have now, and reports which routes or efforts
   would move. It ships inside the package; keeping it out of `scripts/` keeps the release gate's rule intact
   (no test or CI scaffold in the tarball).
6. The client adds one line (`data-mr-effort`) only when the last tier was not taken verbatim — silent on
   `exact`, on hosts predating the field, and on a malformed block.

**Freeze evidence.** `node --test` 382/382 pass (368 in 0.16.1: +7 effort, +5 replay, +2 client), `node --check`
clean on every touched file, `scripts/check-release.mjs --pack` green (29 packed files, up from 27) and
`scripts/check-catalog.mjs` unchanged (19 models / 15 channels / 4 calendar entries / 1 watchlist entry).
Routing behaviour is untouched: `costAware` stays `false` and `peakPolicy` stays where 0.16.1 left it.

**Commits.** `2c9827e` the ladder, replay, telemetry, client and tests; `c76ced3` `chore(release): 0.17.0`.

### Publish evidence (2026-10-26)

| step | evidence |
| --- | --- |
| branch | `release/0.17.0` from `34aaade` (the 0.16.1 evidence commit), two commits |
| push to main | `git push origin release/0.17.0:main` -> `34aaade..c76ced3` (fast-forward) |
| tag | annotated `v0.17.0` -> commit `c76ced3` |
| CI (tag) | Actions publish run [40292108050](https://github.com/Neptune810/dsh-model-router/actions/runs/40292108050) success: test node 20/22/24, release gate `--pack`, catalog regeneration, catalog validator, then the OIDC publish job |
| CI (main) | Actions publish run 40292086066 success (tests + gate, publish job skipped: not a tag) |
| drift workflow | catalog-diff run 40292108061 success, report uploaded as an artifact |
| npm | `dist-tags.latest = 0.17.0`, tarball shasum `3296e8b04355aabc46ba2551aecab63a7de6c2ae`, integrity `sha512-oDDOiLOfiTTjRhdjh90MjgCzAMegYcP2WkY4cf0Wx97Bn9ZGveq97TD38nbIeWUsNu82SR4RSNxSg6lJB2YikQ==`, 29 files, published with provenance from the tag run |
| profile | `C:\Users\97161\.dsh\profiles\web`: `pnpm add @neptune810/dsh-model-router@0.17.0 --save-exact`, dependency pinned to `0.17.0` (the desktop app must be restarted to load it) |

Rollback if needed: `npm dist-tag add @neptune810/dsh-model-router@0.16.1 latest` and `pnpm add` 0.16.1 in
the profile; 0.17.0 adds fields rather than changing state, so 0.16.1 reads the same store without migration.

## 0.17.1 — feedback, classifier v2, exploration (2026-10-26)

**Goal.** Take the deferred half of the effort-economics scope and ship it as signals, not as a default flip:
the user can tell the router whether a step was worth it, the classifier can admit doubt instead of guessing,
and exploration exists but only as a shadow. `costAware` stays `false`.

**What landed.**
1. `lib/feedback.js` + `lib/feedback-store.js` — three labels (`too-expensive`, `too-weak`, `just-right`) posted
   from the panel to `POST /model-router/feedback`, appended to
   `<storages>/model-router/telemetry/feedback.v1.jsonl` (local only, never uploaded). The next routed step
   answers the verdict: the same route records `stayed`, a different one records `moved`.
2. `/state.feedback` publishes the labels, the last verdict (with its outcome) and whether one is pending;
   `/stats.feedback` aggregates the file by label, by class and by outcome (`changedShare`).
3. `lib/classifier2.js` — `parseVerdict` pulls `{class, confidence, family, evidence, signals}` out of prose,
   `decideVerdict` keeps the source, and a confidence below `classifierMinConfidence` (0.6) **raises a tier
   instead of guessing**. Calls are bounded (2 attempts, 2 s) and `CircuitBreaker` opens for ten minutes after
   three consecutive failures, during which routing is rules-only.
4. `lib/experiments.js` — ε-greedy over the allowed pool, off by default, never drawn on `hard` or `engineering`
   steps. `apply: false` (the default) records the draw without changing the route; `seed` makes a draw
   reproducible. An applied draw resets the hysteresis streak.
5. Decision events carry `experiment`; `/state.experiments` and `/stats.totals.experiments` report steps,
   explored share, applied count and per-arm counts.
6. The client adds three lines: the feedback row (three buttons, the recorded one highlighted, and the outcome
   the next step produced), the exploration line (shadow vs applied wording) and the classifier line (low
   confidence escalation or open breaker). Both languages; silent on hosts without the blocks.

**Freeze evidence.** `node --test` 413/413 pass (382 in 0.17.0: +8 feedback, +7 experiments, +6 classifier2,
+5 client, +5 observation), `node --check` clean on every touched file, `scripts/check-release.mjs --pack` green
(33 packed files, up from 29). Golden snapshots untouched: every new behaviour sits behind a switch that
defaults to off.

**Deferred on purpose.** The 24-task L2 economics run and the `costAware` flip. The flip gate (G3/G4: at least
7 days and 300 priced shadow steps) cannot be met by a release published the same day the shadow landed; the
repo records the unmet threshold rather than fabricating a pass. Catalog refresh and the telemetry-size audit
also stay in 1.0.0 scope.

**Commits.** `d5fe62b` the feedback loop, classifier v2, experiments, telemetry, client and tests;
`5a3ea74` `chore(release): 0.17.1`.

### Publish evidence (2026-10-26)

| step | evidence |
| --- | --- |
| branch | `release/0.17.1` from `44b2547` (the 0.17.0 evidence commit), two commits |
| push to main | `git push origin release/0.17.1:main` -> `44b2547..5a3ea74` (fast-forward) |
| tag | annotated `v0.17.1` -> commit `5a3ea74` |
| CI (tag) | Actions publish run [40295285548](https://github.com/Neptune810/dsh-model-router/actions/runs/40295285548) success: test node 20/22/24, release gate `--pack`, catalog regeneration, catalog validator, then the OIDC publish job (`Publish` step success) |
| CI (main) | Actions publish run 40295281320 success (tests + gate, publish job skipped: not a tag) |
| drift workflow | catalog-diff run 40295285633 success, report uploaded as an artifact |
| npm | `dist-tags.latest = 0.17.1`, tarball shasum `908e9747b67bce4f8f7239fd9727b3182b34353b`, integrity `sha512-4KNIKIRjfoeul/8SeK023PzvwriXbKK3NwEC8omu7B9c7ZMwokroIC1Xdrzwu6xQqblnSPYZ6g/j7N0qWW/ztw==`, 33 files, published with provenance from the tag run |
| profile | `C:\Users\97161\.dsh\profiles\web`: `pnpm add @neptune810/dsh-model-router@0.17.1 --save-exact`, dependency pinned to `0.17.1` (the desktop app must be restarted to load it) |

Rollback if needed: `npm dist-tag add @neptune810/dsh-model-router@0.17.0 latest` and `pnpm add` 0.17.0 in
the profile; 0.17.1 adds fields and a new log file rather than changing state, so 0.17.0 reads the same store
without migration (the feedback log is simply absent until the first label).

## 1.0.0 — commitable stability, shipped as an honest slice (2026-10-26)

**Goal.** Make the surface the panel (and any other client) talks to versioned, documented and tested
against the code — and name a degraded host instead of looking fine. No routing decision changes.

**What landed.**

- `API_SCHEMA_VERSION = 1` and `withSchemaVersion` in `lib/routes.js`, stamped inside `sendJson` so the
  transport's own 400/403/405/500 answers carry it as well, and stamped before the `/state` ETag is
  computed so the version is inside the hash the response advertises.
- `test/contract.test.js` (7 cases): the routes in `docs/api.md` are exactly the registered ones (and no
  registered path is undocumented); every `agent/*` event the plugin listens to appears in
  `docs/compat.md`; every `package.json#exports` target resolves and lives in a published directory;
  `engines.node` / `engines.dsh` are declared and `peerDependencies` stays undeclared; the 1.0
  documentation set exists; both panel languages still render the compat note.
- The panel renders `/state.compat.missing` as a `data-mr-compat` note in the chat language, silent when
  the list is empty or the block is malformed.
- Documentation that ships: `docs/api.md`, `docs/compat.md`, `docs/migration-0.14-to-1.0.md`,
  `CONTRIBUTING.md`, `SECURITY.md` — all added to `package.json` `files` (packed files 33 → 38).

**Freeze evidence.** `node --test` 421/421 pass (413 in 0.17.1: +7 contract, +1 client);
`scripts/check-release.mjs --pack` green (38 packed files); golden snapshots untouched, because nothing in
the routing path changed.

**Deferred on purpose.** Splitting `client/client.js` into `client/src/*` behind a build step (it
conflicts with the "the repo commits the built artifact, DSH builds nothing" constraint) and a CI matrix
against a second host version (there is no second installable host yet; the contract test plus
`docs/compat.md` cover the same ground for the version that exists). Both are recorded in `PLAN.md` §5.9
and `ROADMAP.en.md` instead of being implied by the version number. The `costAware` flip remains a 1.x
decision: the shadow gate (G3/G4: ≥7 days and ≥300 priced steps) is still unmet.

**Commits.** `dce2c1b` the envelope, the contract test, the compat note and the documentation set;
`f0ee45c` `chore(release): 1.0.0`.

### Publish evidence (2026-10-26)

| step | evidence |
| --- | --- |
| branch | `release/1.0.0` from `e46cd21` (the 0.17.1 evidence commit), two commits |
| push to main | `git push origin release/1.0.0:main` -> `e46cd21..f0ee45c` (fast-forward) |
| tag | annotated `v1.0.0` (object `23f482b`) -> commit `f0ee45c` |
| CI (tag) | Actions publish run [40297361418](https://github.com/Neptune810/dsh-model-router/actions/runs/40297361418) success: test node 20/22/24, node 24 release gate `--pack`, catalog regeneration and validator, then the OIDC publish job (`Publish` step success) |
| CI (main) | Actions publish run 40297356379 success (tests + gate, publish job skipped: not a tag) |
| drift workflow | catalog-diff run 40297361450 success, report uploaded as an artifact |
| npm | `dist-tags.latest = 1.0.0`, tarball shasum `80bbe1e9f2455d38b544a4ba5201036249ac0e1a`, integrity `sha512-Nk18zsT3f53YlwioLhCRoiunFfa6fc4Vub+B62FdvNLvYNewAqMfl2HmJUvyHvAeAzAHqdSV+LrjvPLhI8r6Uw==`, 38 files (up from 33), provenance attestation `https://registry.npmjs.org/-/npm/v1/attestations/@neptune810%2fdsh-model-router@1.0.0`, published from the tag run with `engines.node >=20` / `engines.dsh >=0.1.7-rc.2 <0.2.0` |
| profile | `C:\Users\97161\.dsh\profiles\web`: `pnpm add @neptune810/dsh-model-router@1.0.0 --save-exact` — dependency now `1.0.0` (dsh-better-sidebar 0.24.1, dsh-cost-meter 1.7.45, dshmarket ^1.66.5 unchanged); pnpm added the version to `minimumReleaseAgeExclude`; the desktop app must be restarted to load it |

Rollback if needed: `npm dist-tag add `neptune810/dsh-model-router`0.17.1 latest` and `pnpm add` 0.17.1 in
the profile; 1.0.0 changes no state shape, so 0.17.1 reads the same store, and a 1.0.0 client simply loses
the `schemaVersion` field it was already told to tolerate.

## 1.0.1 — one clock, and a catalog re-verified (2026-11-01)

**Goal.** A test must not depend on what time it is, and every catalog fact must be re-read from its
source on the review day rather than inherited. No routing decision changes.

**Why it had to be a release.** The 2026-11-01 monthly review started with `node --test` and found
421 tests / 420 pass / 1 fail: `test/observation.test.js` asserted a 9.6x cross-brand saving for a
`deepseek-v4-pro` switch, and the run said 4.8x. Both numbers are right. `blendedUsdPerMTok`
(`lib/pricing2.js:115`) applies DeepSeek's peak/off-peak multiplier (peak Mon-Fri 09:00-12:00 and
14:00-18:00 Asia/Shanghai, off-peak everywhere else including weekends): 1.236429 USD/MTok at
2026-10-26 10:00 Monday against 0.1285 for Haiku is 9.62x, and 0.618214 at 2026-11-01 09:30 Sunday is
4.81x. The suite had only ever passed because CI happened to run inside the CST peak window. A test
whose expectation is a function of the wall clock is a test that will fail for the next person.

**What landed.**

- `lib/clock.js`: `now()`, `freeze(atMs)` and `isFrozen()`. `now()` returns a frozen instant when one
  is set, else `DSH_MODEL_ROUTER_NOW` when it parses to a positive number, else `Date.now()`. Every
  `Date.now()` in the plugin now goes through it: `lib/index.js` (24 call sites), `lib/pricing2.js` (4),
  `lib/catalog-pricing.js` (4), `lib/budget.js` (2), `lib/feedback-store.js` (1), `lib/replay.js` (1).
  `package.json` exports `./clock` (the sixteenth subpath).
- The two call sites that made the failure possible: `lib/index.js:1043` passes the clock into
  `parseOpenRouter(...)` (so `lib/pricing.js` stays import-free) and `lib/index.js:1411` sets
  `eventAt = clockNow()`, which `pricesAt(catalogModel, eventAt)` uses to pick the peak or off-peak row.
- `test/clock.test.js` (5 cases): wall clock fallback, freeze/release, `NaN` refused, the env hook and its
  invalid values, and freeze winning over the env hook.
- `test/observation.test.js` pins both sides: `PEAK_MS = Date.UTC(2026, 9, 26, 2, 0, 0)` keeps the 9.6x
  case, and a new off-peak case pins `savingMultiple === 4.8` at `OFFPEAK_MS = Date.UTC(2026, 10, 1, 1,
  30, 0)` — still above `cfg.crossCost.maxMultiple` (default 3), i.e. the switch is still worth reviewing.
- `scripts/gate.mjs` runs the suite three times (real clock, pinned peak, pinned off-peak) and prints the
  pinned instant; `.github/workflows/publish.yml` adds `Clock-independent suite (peak / off-peak; node 24)`
  before the release gate, so a clock-dependent assertion can no longer reach `main` unnoticed.
- Catalog re-verified against sources on 2026-11-01: Artificial Analysis moved from v4.3.2 to
  **Intelligence Index v5.0** (nine different evaluations, so scores are not comparable across versions),
  14 of 19 models now carry a score, `deepseek-v4-pro` gets its first (23) and lands *below*
  `deepseek-flash` (32) — recorded as a 1.1.0 tier question, not acted on here. `evidenceDate` is
  2026-11-01, all 19 `aaVersion` fields say `v5.0`.
- DeepSeek's price page re-read: the two ids, the four peak/off-peak rows and the 50% off-peak rule are
  unchanged; Search/Fetch became billable at CNY 5 per 1000 successful requests on 2026-11-01, which the
  catalog calendar already said. OpenRouter cross-check kept both hard dates (`glm-4.5` expires
  2026-12-31, `gemini-4-argon` still on promo, `gemini-3.8-flash` still on promo until 2027-01-01).
- One listing is marked unusable instead of trusted: OpenRouter serves `deepseek/deepseek-v4-pro` at
  $1.60/$3.20, which matches neither the official peak ($1.29/$3.86) nor the official off-peak
  ($0.64/$1.93). The official page wins for pricing; the quirk says so. (`deepseek-v4.1-flash-1017` is
  listed at the off-peak rate, because OpenRouter's listing follows DeepSeek's peak/off-peak clock while
  the catalog stores the peak row — also recorded as a quirk.)
- The one standing completeness warning is gone: `claude-sonnet-5-5` gained its `aaVariant`
  (`max with fallback`), so `check-catalog.mjs` now prints zero warnings.
- `test/fixtures/replay-l1.json` + `test/replay-l1.test.js`: twenty reviewed routes, five pools × four
  step classes, labelled from the scoring rules first and then replayed through
  `lib/replay.js --fail-on-change`, so a catalog or scoring change that moves one of them fails in the
  suite instead of on the bill. The fixture says `cheap` or `strong` only — see the commit below.

**Freeze evidence.** `node --test` 431/431 pass (1.0.0: 421; +5 clock, +1 off-peak observation, +4
replay-l1). `node scripts/gate.mjs` exit 0 in 20.6 s: 431/431 at the real clock, 431/431 at
`DSH_MODEL_ROUTER_NOW=1792980000000` (2026-10-26 10:00 +08:00, peak) and 431/431 at
`1793496600000` (2026-11-01 09:30 +08:00, off-peak), then `check-release` (version 1.0.1, changelog
1.0.1, packed files 39) and `check-catalog` (19 models / 15 channels / 4 calendar / 1 watchlist, zero
warnings, and the honest 11 null price fields, 6 empty effort vocabularies, 57 relay entries with
`billingMode: unknown`).

**Commits.** `664ee05` the clock and the three-clock gate; `d0d0392` the catalog re-verified against
v5.0; `df42844` the twenty reviewed routes; `a73f368` `chore(release): 1.0.1`; `5ad3069` the fixture
tier vocabulary fix (post-tag; it changes no product code).

### Publish evidence (2026-11-01)

| step | evidence |
| --- | --- |
| branch | `release/1.0.1` from `dbccd1f` (the 1.0.0 evidence commit) |
| push to main | `git push origin release/1.0.1:main` -> `dbccd1f..a73f368` |
| tag | annotated `v1.0.1` -> commit `a73f368` |
| CI (tag) | Actions publish run [41263414047](https://github.com/Neptune810/dsh-model-router/actions/runs/41263414047) success: test node 20/22/24, the node 24 clock-independent suite (two pinned instants), release gate `--pack`, catalog regeneration and validator, then the OIDC publish job (`Publish` step success) |
| CI (main) | Actions publish run 41263410400 success (tests + gate, publish job skipped: not a tag) |
| drift workflow | catalog-diff run 41263414104 success |
| npm | `dist-tags.latest = 1.0.1`, tarball shasum `e65caa9416b498830c0256f6b1df874206af292b`, integrity `sha512-i7fzdo/9GeyUFWqy5sJ4A8mgRhbmFZKN7qrZgqZeFcwr73w2SBag8xZe+gaDjb9A+KdzzmaaByadULwtSratUw==`, 39 files (up from 38: `lib/clock.js`), provenance attestation `https://registry.npmjs.org/-/npm/v1/attestations/@neptune810%2fdsh-model-router@1.0.1`; published from the tag run with `engines.node >=20` / `engines.dsh >=0.1.7-rc.2 <0.2.0` |
| profile | `C:\Users\97161\.dsh\profiles\web`: `pnpm add @neptune810/dsh-model-router@1.0.1 --save-exact` — dependency now `1.0.1`, 16 exports present, `lib/clock.js` installed (dsh-better-sidebar 0.24.1, dsh-cost-meter 1.7.45, dshmarket ^1.66.5, dsh-image-generation ^0.1.3 unchanged); pnpm added the version to `minimumReleaseAgeExclude`; the desktop app must be restarted to load it |

Rollback if needed: `npm dist-tag add @neptune810/dsh-model-router 1.0.0 latest` and `pnpm add` 1.0.0 in
the profile; 1.0.1 adds a module and an internal clock, changes no state shape and no route, so 1.0.0
reads the same store and the panel loses nothing it was promised.

**Review record.** The whole 2026-11-01 review (catalog diff table, tool limitations, the two
judgement calls, the L1 method, the grooming decision that set 1.1.0 for 2026-12-01) is written up in
`C:\DSH\routing-plan-2026-10\review-2026-11-01.md`; `PLAN.md` §3.1 and §5.10 and
`release-calendar.csv` rows 14-16 were updated at the same time.

## Shadow gate recheck — 2026-11-03

The scheduled check asked whether `costAware` can be flipped by default: G3 cost at `<= 0.85x`, G4 quality not
worse, on at least seven days and 300 priced shadow steps. The answer today is no, and the reason is upstream of the
threshold.

**What the environment says (all read on 2026-11-03, 09:30 +08:00).**

| check | result |
| --- | --- |
| app profile | `DSH_PROFILE=desktop`, `DSH_PROFILE_DIR=C:\Users\97161\.dsh\profiles\desktop` |
| plugin in that profile | `@neptune810/dsh-model-router` **0.14.2**, and `cordis.patch.yml:112` still has `- id: model-router` / `disabled: true` |
| `/model-router/state`, `/model-router/stats` | HTTP 404 (nothing mounts the routes) |
| `C:\Users\97161\.dsh\storages\model-router` | absent — no `decisions-YYYY-MM.jsonl`, so no decisions, no shadow, no outcomes |
| `1.0.1` install target | `profiles\web`, a profile this app instance does not run (and it has no `storages\model-router` either) |

**Gate reading.** `daysCovered 0 / 7`, `pricedSteps 0 / 300`, `G3 unknown` (nothing priced), `G4 not measurable`
(no labelled runs). So: **not met — record it, change no default, re-check at the next monthly review.** Nothing in the
routing code or the shipped defaults moved in this pass.

**What landed instead.** `scripts/shadow-gate.mjs` (plus `npm run shadow-gate`), so the same question is one command
and the answer carries its own evidence: it reads `decisions-*.jsonl` (including rotations) from
`<DSH_HOME>/storages/model-router`, folds the `shadow` block the way `lib/telemetry.js` does, and prints days,
shadow steps, priced steps, agree/diverged, current vs candidate USD, saved ratio and the G3 verdict. It exits 0 when
the ledger is missing and says `missing` in words; `--require-pass` is what turns "not yet" into exit 1 for a CI job
someone may add later. `test/shadow-gate.test.js` (9 cases) covers the gate opening on seven cheap days, staying shut
at a 5% saving, unpriced steps counting as evidence but never as priced, rotated files, malformed lines and the CLI
exit codes. Suite: **447/447**.

**A real bug the pinned clock found.** Running the gate right after the shadow-gate work turned
`tests at a pinned peak instant` red: four observation tests wrote their events (`state.telemetry.written >= 2`) but
`/model-router/stats` reported zero steps. `readDecisions` in `lib/telemetry.js` treats `until` as exclusive, and a
pinned clock stamps every event at exactly `now()`, so the default `[now - 7d, now]` window excluded the very events it
had just written; the wall clock hides this because a real event is always a few milliseconds old. `lib/telemetry.js`
and `lib/store.js` also defaulted to `Date.now` instead of the plugin clock, so the default window never followed
`DSH_MODEL_ROUTER_NOW` — the peak step had in fact been rotting since 2026-11-02, when the pinned instant fell out of
the rolling seven-day window. Both modules now read `lib/clock.js`, the default upper bound is inclusive (an explicit
`until` stays exclusive), and `test/telemetry.test.js` pins the boundary with a step stamped at exactly `now()`:
counted by the default window, excluded by an explicit one. Real, peak and off-peak clocks are all green at **447/447**.

**Commits.** `b7d7fdc` the weekly review tooling (drift report) — see `review-2026-11-02-weekly.md`; `dbef084` the
shadow-gate tool, the clock-window fix and its regression test; both merged to `main` in `6fce628` and shipped by CI
(publish run [41561650151](https://github.com/Neptune810/dsh-model-router/actions/runs/41561650151): test node
20/22/24 green, publish skipped — not a tag). They ship to npm with the next patch (1.0.2, 2026-11-15).

**Open.** The flip stays blocked until the plugin is actually loaded in the profile the app runs — a decision only the
user can make (asked on 2026-11-02, still open). Until then every monthly recheck will print the same zeros, which the
script now says out loud instead of leaving it to be discovered.

## 1.1.0 — the mode pool and a pinned relay effort (2026-11-05)

**Goal.** Two things the person paying the bill asked for directly: let the router pick the *host's*
agent preset (标准模式 / PTC / 极简 / 创造) from a pool the same way it picks model and effort, and stop
pretending a relay model has a thinking ladder — pin one effort per pool entry and say so.

**Why the mode pool is a recommendation and not an automatic switch.** The host locks the preset the
moment a session starts a turn: `agentPresets.select()` (`dsh-agent-preset-registry`, the `select`
method) throws `RemoteError("agent-preset/locked", "This session has already started")` as soon as
`turnBoundary.openTurnStartSeq !== null || turnBoundary.lastTurn > 0`. The only window that precedes a
turn is `agent/inbox/inserted`, which `dsh-agent-loop` emits *synchronously* from `send()` before it
calls `wakeDriver()`; `wakeDriver -> withInitiator -> kick -> turn()` then appends `turn/start` with no
await in between, while `select()` is a microtask chain. Racing it is not a design, it is a coin toss
that loses into the user's first message as a RemoteError. So the plugin **classifies the first message,
records a recommendation, and stops**; the panel shows it and one click applies it for a session that
has not started yet. `modeSetDefault` is the opt-in that also writes `selectedDefault` into
`agent-preset-registry`, so the *next* session opens in the recommended mode — which is the honest way
to influence a preset the host only lets you choose before turn one.

**What landed.**

- `lib/mode-pool.js` (new, zero imports): `MODE_IDS` (`standard`, `ptc`, `minimal`, `cordis`, in UI
  order), `MODE_HINTS`, `normalizeModes` (unknown ids dropped, trimmed, de-duplicated, order kept,
  frozen), `scoreMode`, `classifyMode` (returns `null` rather than guessing: empty pool, one mode, or
  zero evidence; otherwise score-descending with a fixed tie order), `describeModes`.
- `lib/routing.js`: `normalizePool` keeps a new `fixedEffort` per entry (`isKnownEffort` or dropped —
  never silently coerced), on both the normal path and the empty-pool fallback.
- `lib/config.js`: `modes`, `modeAuto` (default true), `modeSetDefault` (default false), `withModes`,
  and the three keys added to the `withSettings` whitelist — a settings write that is not whitelisted
  is dropped without an error, so this line is load-bearing.
- `lib/index.js`: `currentAgentPreset(sessionId)` reads the `agentPreset` projection (header value plus
  every `agent-preset/selected` event, so a manual UI switch is seen), `sessionStarted(agent)` reads
  `turnBoundary`, `noteModeRecommendation` classifies once per session, `onInboxInserted` is the
  listener, `applyMode` is the route handler; `api.state` now projects the ten pool fields and a
  `modes` block; `/router modes` prints the pool, the session's mode and the last refusal.
- **The dead code that made pinning impossible.** `supportedEfforts` called `llm().resolveModel(...)`,
  which exists on the *adapter*, not on the service: every non-DeepSeek entry therefore advertised an
  empty vocabulary and every relay model silently routed with no effort change at all. It now calls
  `resolveModelInfo(provider, model)` and reads `info.reasoning.efforts[].id`. `manages()` also had its
  pool check after the family regex, so a non-family entry in the pool on the default provider was
  never managed; pool membership now wins.
- The pin is applied *after* `mapEffort` and is overridden by nothing except the poisoned-history
  guard: a route pinned to `high` still sends `off` when the history already contains a tool call
  without thinking, because sending thinking there is a 400, not a preference.
- `lib/routes.js`: the seventeenth route, `POST /model-router/modes` (`{ sessionId, mode, pool, auto,
  setDefault }`).
- Panel: a mode-pool section (each mode a row, the recommendation marked, a "locked" note once the
  session has started, toggles for automatic recommendations and for writing the next session's
  default) and a per-entry effort control `auto | off | low | high | max` next to the tier and cost
  controls, in both render paths.

**Freeze evidence.** `node --test` **471 / 471 pass, 0 fail** (1.0.1: 421; +18 `test/mode-pool.test.js`,
+6 `test/fixed-effort.test.js`, +26 the work merged after 1.0.1). `node scripts/gate.mjs` exit 0 in
23.6 s: 471/471 at the real clock, 471/471 at `DSH_MODEL_ROUTER_NOW=1792980000000` (peak) and 471/471
at `1793496600000` (off-peak), then `check-release` (version 1.1.0, changelog 1.1.0, packed files 40)
and `check-catalog` (19 models / 15 channels / 4 calendar / 1 watchlist, evidence 2026-11-01).
`test/contract.test.js` green: the documented route table and `routeTable` agree at seventeen entries,
the new `agent/inbox/inserted` listener is in `docs/compat.md`, and `./mode-pool` resolves and ships.

**Commits.** `c19a7f9` feat(modes): recommend a host agent preset and pin a relay effort (v1.1.0);
`e6eb960` chore(release): 1.1.0.

### Publish evidence (2026-11-05)

| step | evidence |
| --- | --- |
| branch | `release/1.1.0` from `a4f2cab` |
| push to main | the git transport was down this morning (`github.com:443` refused connections; every alternate IP handshook TLS and then hung, no local proxy listening), so the three commits were replayed through the GitHub REST API — `POST /git/blobs`, `/git/trees`, `/git/commits` — and every replayed commit came back **byte-identical** (`a4f2cab`, `c19a7f9`, `e6eb960`), then `PATCH /git/refs/heads/main` fast-forwarded `6fce628..e6eb960` |
| tag | annotated `v1.1.0` -> commit `e6eb960`, recreated through `POST /git/tags` + `POST /git/refs` (identical tag object `28969cd`) |
| CI (tag) | Actions publish run [41964397463](https://github.com/Neptune810/dsh-model-router/actions/runs/41964397463) success: test node 20/22/24, the node 24 clock-independent suite at two pinned instants, release gate `--pack`, catalog regeneration and validator, then the OIDC publish job |
| CI (main) | run [41964309305](https://github.com/Neptune810/dsh-model-router/actions/runs/41964309305) success (publish skipped, not a tag); drift run 41964397455 success |
| evidence commit | `3b2fdaa` docs: record the 1.1.0 release evidence, pushed the same way (replayed through the API, byte-identical); run [41971325740](https://github.com/Neptune810/dsh-model-router/actions/runs/41971325740) success on node 20/22/24 with the publish job skipped |
| npm | `dist-tags.latest = 1.1.0`, tarball shasum `43fad068fa10d9ff51aa8493347355d3959024c7`, integrity `sha512-4gWug5nW7g5wbFtGl4/0huB36JmRVbnE9iAaE5AdRrZzZ9xWxapYiYNpc8KxREkosgUq7N2OZHsdPtE+IwkZoA==`, **40 files** (1.0.1: 39; the newcomer is `lib/mode-pool.js`), provenance attestation present |
| profile | `C:\Users\97161\.dsh\profiles\web`: `pnpm add @neptune810/dsh-model-router@1.1.0 --save-exact` — dependency pinned to `1.1.0`, 17 exports, `lib/mode-pool.js` installed; the desktop app must be restarted to load it |

Rollback if needed: `npm dist-tag add @neptune810/dsh-model-router 1.0.1 latest` and `pnpm add` 1.0.1 in
the profile. 1.1.0 adds a field to pool entries (`fixedEffort`) and three optional settings
(`modes`/`modeAuto`/`modeSetDefault`); a 1.0.1 process reading that store ignores all four, so the
downgrade is lossless apart from the pins.

**Honest limits.** The mode pool cannot switch mid-task — the host forbids it — so "automatically uses
the most suitable mode in a task" is delivered as *recommendation + one-click apply before the first
turn*, plus an opt-in that makes the next session open in the recommended mode. The classifier is the
same evidence-scoring approach as the task-type classifier (keyword weights, fixed tie order), not a
model call; `modeAuto` off, or no clear evidence, means no recommendation at all rather than a guess.

## 1.1.1 — a pin picker that only offers the words a route declares, and a catalog sync you can audit (2026-11-05)

**Goal.** Nothing new to route; two things that were wrong. The fixed-effort picker offered the same nine
words to every entry, including entries whose provider declares three, so a click could pin a value that
would be rejected at request time. And `catalog-diff` compared only fields *both* sides priced, so a
catalog `null` against a live upstream quote was invisible — a model missing a price looked exactly like a
model with nothing to report.

**What landed.**

- `GET /model-router/catalog` now returns a per-model `efforts` array: the DeepSeek family keeps the
  four-word vocabulary, every other model gets whatever `resolveModelInfo(provider, model)` declares
  (`info.reasoning.efforts[].id`). The panel's `fixedEffort` control renders that list instead of the
  global nine (`EFFORTS` in `lib/policy.js` is unchanged and still the coercion table).
- The picker narrows but never silently rewrites: an existing pin the route no longer declares stays
  visible and selected (so a stale pin is a thing you can see and fix, not a value that vanishes), and a
  route that declares no vocabulary at all falls back to the nine words rather than an empty control.
- `catalog-diff` grew an `## Unpriced fields` section plus `summary.gaps`: a field the catalog leaves
  `null` while upstream quotes a number is reported there and **counted separately from drift**, so
  `--fail-on-drift` still only fires on a real disagreement, and `summary.unpriced` is 0 when nothing is
  missing.
- Three price facts re-read from the upstream catalogue on 2026-11-05 and written into
  `catalog/model-catalog.yaml` (`evidenceDate: 2026-11-05`): `glm-5.3-flashx` `cacheRead` 0.09 → 0.075,
  `gemini-3.8-flash` `cacheWrite` filled in at 0.0416667, `qwen3.8-flash` given its OpenRouter projection
  (0.15 in / 0.47 out / 0.016 cacheRead). `lib/catalog.js` regenerated from the source YAML.

**Why it shipped early (2026-12-15 → 2026-11-05).** Neither item needs elapsed usage to be worth shipping:
one is a UI that offers invalid values, the other is a blind spot in the tool built to prevent blind
spots. The two calendar points that 1.1.1 was originally scheduled around — Gemini 4 Argon's 2026-12-01
increase and GLM-4.5's 2026-12-31 retirement — were re-checked and are both still armed in the watchlist
and `calendar`; there was nothing to sync for them yet.

**Freeze evidence.** `node --test` **474 / 474 pass, 0 fail** (1.1.0: 471; +1 `test/catalog-diff.test.js` for the unpriced section and +2 `test/client.test.js` for the narrowed picker; `test/modes.test.js` and `test/catalog.test.js` keep their 34 and 21). `node scripts/gate.mjs` exit 0 in 22.1 s: 474/474 at the real clock,
474/474 at `DSH_MODEL_ROUTER_NOW=1792980000000` (peak) and 474/474 at `1793496600000` (off-peak), then
`check-release` (`version=1.1.1 changelog=1.1.1`, packed files 40) and `check-catalog` (19 models / 15
channels / 4 calendar / 1 watchlist, evidence 2026-11-05; one standing warning, `claude-sonnet-5-5`
`quality.aaVariant` missing next to `aaIndex: 56`).

**Commits.** `46027d5` feat(catalog): sync three price facts and narrow the pin picker to the route's own
words (v1.1.1) — README.md, README.zh.md, catalog/model-catalog.yaml, client/client.js, docs/api.md,
lib/catalog.js, lib/index.js, scripts/catalog-diff.mjs, test/catalog-diff.test.js, test/catalog.test.js,
test/client.test.js, test/modes.test.js (12 files, +321/−42); `ebed5e9` chore(release): 1.1.1 —
CHANGELOG.md, package.json.

### Publish evidence (2026-11-05)

| step | evidence |
| --- | --- |
| branch | `release/1.1.1` from `dbccd1f`; `main` had drifted five commits behind `release/1.1.0` since the transport outage, so the push landed both |
| push to main | the git transport failed three times in a row (`Recv failure: Connection was reset`, then `Failed to connect to github.com:443 after 21047 ms`) while HTTPS to github.com and `api.github.com` answered 200, DNS resolved to 20.205.243.166, `Test-NetConnection` reached 443 *and* 22, no proxy was configured, and there was no SSH key to fall back on — a fourth plain `git push` succeeded with no change, which is the difference between this outage and the 1.1.0 one (that one never recovered and needed the REST replay). `main` fast-forwarded `6fce628..46027d5` |
| tag | annotated `v1.1.1` -> commit `ebed5e9` (tag object `ebed5e9e4d36033f50cc5650140c3cd69a82cf05`) |
| CI (tag) | Actions publish run [41993235461](https://github.com/Neptune810/dsh-model-router/actions/runs/41993235461) success: test node 20/22/24, the node 24 clock-independent suite at two pinned instants, release gate `--pack`, catalog regeneration and validator, then the OIDC publish job; drift run [41993235506](https://github.com/Neptune810/dsh-model-router/actions/runs/41993235506) success |
| CI (main) | run [41993183266](https://github.com/Neptune810/dsh-model-router/actions/runs/41993183266) success (publish skipped, not a tag); drift run 41993183285 success |
| npm | `dist-tags.latest = 1.1.1`, tarball shasum `875b1fac1d69b82f2dcc6083f14ae88766d62705`, integrity `sha512-yGNmnZZVn+dcQC5GUwqSU89CAt+9M0CJWK/Jlycc/aVuCboaeq0bCrmJXHhJHsRlrxRIeWUjXT5SQW6DB1JC6g==`, **40 files** (unchanged: no new module), provenance attestation present |
| profile | `C:\Users\97161\.dsh\profiles\web`: `pnpm add @neptune810/dsh-model-router@1.1.1 --save-exact` — dependency pinned to `1.1.1`; the desktop app must be restarted to load it |

Rollback if needed: `npm dist-tag add @neptune810/dsh-model-router 1.1.0 latest` and `pnpm add` 1.1.0 in
the profile. 1.1.1 changes no store shape: the catalog is data, `GET /catalog` only *adds* `efforts`, and
the `fixedEffort` values already stored are exactly the values 1.1.0 wrote, so the downgrade is lossless.

**Honest limits.** The narrowed picker is only as good as `resolveModelInfo`: a provider that declares no
reasoning vocabulary still shows the nine words, because the fallback has to be *something* and hiding the
control entirely would remove a working pin from an entry that is still routing. The unpriced section is
advisory by construction — it will keep listing the same 11 null price fields until someone fills them in,
which is the point: it is a to-do list, not a failure. `catalog-diff` still cannot tell "upstream has no
price" from "upstream's page changed shape"; both read as no number, and no number is never drift.
