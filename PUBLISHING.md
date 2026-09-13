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
  en: Sets the DeepSeek flash model's reasoning effort per step, from thinking off for short cheap prompts up to high for engineering work, and raises it further only on repeated tool failures — effort max remains opt-in.
  zh: 按步骤形态设置 DeepSeek flash 的思考等级：短小的廉价请求关闭思考，工程类工作用 high，只有反复出现工具失败才继续升档，max 档保持手动开启。
```

`description.zh` is optional — a maintainer will add it if you leave it out. `description.en` is
required and must be quoted when it contains `: `.

## Checklist

- [x] `dsh.bundle.patch` declared in `package.json`
- [x] `cordis.patch.yml` present at the repo root
- [x] real code with tests (`node --test`)
- [ ] repo created on GitHub, public
- [ ] `dsh-plugin` topic added
- [ ] repo is at least 1 day old
- [ ] PR opened against `awesome-dsh-plugin/awesome-dsh-plugin`

## Optional: npm

Listing does not require an npm release — the market installs from the repository. Publishing to npm
as well lets people run `dsh plugin --profile web add dsh-model-router` without the `github:` spec:

```sh
npm publish --access public
```

This needs an npm account that is logged in locally.
