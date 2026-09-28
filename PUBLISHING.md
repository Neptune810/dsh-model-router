# Publishing

How to get this plugin listed in the DSH plugin market.

## What the market requires

The catalog is [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin): one
YAML file per plugin under `data/plugins/`, merged by pull request. The two READMEs over there are
generated from those files — you never edit them by hand.

An entry qualifies when:

- the repo declares a `dsh.bundle` manifest in `package.json` (this repo does);
- the repo contains real, working code;
- the repo is **at least 1 day old** — enforced by CI, and there is no commit-count bar;
- the repo carries the `dsh-plugin` GitHub topic;
- the description states what the plugin does, carries no superlatives, and matches the code;
- the category matches what the plugin actually does.

## The submission file

Add `data/plugins/Neptune810__dsh-model-router.yml` to a fork of
`awesome-dsh-plugin/awesome-dsh-plugin`. That single file is the whole submission.

```yaml
url: https://github.com/Neptune810/dsh-model-router
name: Neptune810/dsh-model-router
category: model
description:
  en: Sets the DeepSeek flash model's reasoning effort per step — low for a cheap or plain request, high for engineering work and agent tool loops — and raises it only on repeated tool failures. Thinking stays on, because DeepSeek rejects a thinking-enabled request whose history contains a tool call made with thinking off. The model itself never changes; effort max is opt-in.
  zh: 按步骤设置 DeepSeek flash 模型的思考等级：廉价或普通请求用 low，工程类工作与 agent 工具循环用 high，只有反复出现工具失败才继续升档。思考始终保持开启——DeepSeek 会拒绝「历史里存在关闭思考时产生的工具调用」的思考模式请求。模型本身不会改变，max 档需手动开启。
```

`description.zh` is optional — a maintainer will add it if you leave it out. `description.en` is
required and must be quoted when it contains `: `.

## Checklist

- [x] `dsh.bundle.patch` declared in `package.json`
- [x] `cordis.patch.yml` present at the repo root
- [x] real code with tests (`node --test`)
- [x] repo created on GitHub, public — <https://github.com/Neptune810/dsh-model-router>
- [x] `dsh-plugin` topic added
- [x] repo is at least 1 day old (created 2026-09-13)
- [x] PR opened — [awesome-dsh-plugin#5137](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5137)

Both submission gates were green: the `check` workflow (entry naming and location, `awesome-lint`,
README regeneration, site build) and the `Submission gate` (`dsh.bundle` read from the repository's
`package.json`, repository age, per-PR entry cap). Merging is the maintainer's call; the two READMEs
over there are regenerated on `main` after merge and must not be edited by hand.

## The client half

0.5.0 ships a browser half, so the package now declares both halves:

```json
"exports": { "./client": "./client/client.js" },
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-conversation"]
  }
}
```

`client/client.js` is committed, not built — it is written in the same lazy-CJS bundle shape every
third-party client plugin uses (`window.__ModuleLoader__.load({ id, factory })`), so the package
still installs without a build step. It registers one contribution into the
`conversation.input.right` list slot, which the composer renders immediately left of the manual
model seat.

## npm

Published: **`@neptune810/dsh-model-router@0.6.4`** (2026-09-29). Earlier releases: 0.6.3, 0.6.2, 0.6.1, 0.6.0, 0.5.0, 0.4.0, 0.3.0 (2026-09-15).
Listing does not depend on it —
the market installs from the repository — but a registry package gives storefronts a download count
and lets people install without the `github:` spec.

**The package is scoped, and it has to be.** The unscoped name `dsh-model-router` was published on
2026-08-21 by an unrelated author (`thedeveloper256`) and still is. The market links an npm package
to a listed repository by reading this repository's `package.json` `name` and then requiring that
registry package's own `repository` field to point back at this repo — the other author's package
declares no `repository`, so it is ignored rather than mis-attributed. Being listed is unaffected
either way.

```sh
npm login     # the scope has to be yours on npm
npm publish   # publishConfig.access: public is already set in package.json
```

### The publish needs a 2FA-capable credential

This account is set to auth-and-writes, so a plain `npm login` session is not enough — the PUT is
refused with

```
403 Forbidden ... Two-factor authentication or granular access token with bypass 2fa enabled is
required to publish packages.
```

`npm publish` from an interactive terminal prompts for an OTP and works. For anything
non-interactive, create an **Access Token** on npmjs.com with *Packages and scopes* = `@neptune810`
(Read and write) and **Bypass 2FA** enabled, then

```sh
npm config set //registry.npmjs.org/:_authToken=<token>
```

That stores the token in plaintext in `~/.npmrc`: treat that file as a secret, and revoke tokens you
are done with.

### Releasing

Bump `version` in `package.json`, add the CHANGELOG section, commit, then `npm publish`. The
`repository` field already points back at this repo, so the market picks up a new version on its own
— nothing to change in the entry.

### Refreshing the catalog description

A version bump never needs a catalog change: the market reads this repository (and the registry
package) on its own. The *description* does need one when the behaviour it describes changes — 0.4.0
stopped disabling thinking for cheap steps, so the entry's `description.en` / `description.zh` are
refreshed in a follow-up PR to `awesome-dsh-plugin`. Copy the block above into
`data/plugins/Neptune810__dsh-model-router.yml`.

One wrinkle worth knowing: right after a *first* publish the packument can keep returning 404 for a
few minutes, because the CDN cached the earlier not-found lookup — the availability check you ran
before publishing is enough to seed it. The publish itself has landed: the log shows `PUT ... 200`,
and the tarball URL answers `200` while the packument still 404s. Add a cache-busting query or wait.
