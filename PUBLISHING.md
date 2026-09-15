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
  en: Sets the DeepSeek flash model's reasoning effort per step — thinking off for short cheap prompts, low for a plain request, high for engineering work — and raises it only on repeated tool failures. The model itself never changes; effort max is opt-in.
  zh: 按步骤设置 DeepSeek flash 模型的思考等级：短小的廉价请求关闭思考，普通请求用 low，工程类工作用 high，只有反复出现工具失败才继续升档。模型本身不会改变，max 档需要手动开启。
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

## Optional: npm

Listing does not require an npm release — the market installs from the repository. Publishing to npm
as well lets people run `dsh plugin --profile web add @neptune810/dsh-model-router` without the
`github:` spec, and it is what lets the market show a download count.

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

Two prerequisites this machine cannot satisfy on its own:

- **The npm account must own the scope.** A scoped name resolves only when its scope is your npm
  username or an organization you belong to; npm usernames and GitHub logins are separate
  namespaces. `@neptune810/dsh-model-router` is currently unregistered, which means only an npm
  account or org named `neptune810` can publish it.
- **`npm login` has not been run here** — `npm whoami` reports `ENEEDAUTH`. Publishing from this
  machine needs a logged-in account or an `NPM_TOKEN`.

Once the package is on the registry, the install line in both READMEs can be switched to the npm
spec. Until then they keep the `github:` spec, which is the one that actually resolves.
