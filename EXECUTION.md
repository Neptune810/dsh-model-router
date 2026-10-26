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
| Branch used for the release train | baseline/0.14.2, tracking main |
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

## 0.15.0 — not started

Theme: make the router observable before making it cleverer (PLAN.md section 5.3, T1-T12:
telemetry v1 JSONL, /stats, /router replay, usage -> costUnits, incremental /state, effort
vocabulary, classifier confidence, startup self-check, golden decisions).
