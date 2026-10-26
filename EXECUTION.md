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
| Branch used for the release train | baseline/0.14.2 (0.14.3, 0.14.4), release/0.15.0 (0.15.0); each merged to main |
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
