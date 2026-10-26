# Contributing

Thanks for looking. This repository is a plugin for the DeepSeek Harness host, written as plain ESM with no
runtime dependencies — please keep it that way unless there is no alternative.

## Layout

| Path | What lives there |
| --- | --- |
| `lib/` | The host half. `index.js` is the plugin, `routes.js` the HTTP surface, the rest are pure-function modules. |
| `client/` | The browser half: one file, no build step, rendered with the host's `h`. |
| `catalog/` | `model-catalog.yaml` (hand-edited) and `lib/catalog.js` (generated — never edit by hand). |
| `schema/` | JSON Schema for the catalog. |
| `test/` | `node --test` suites plus fixtures. |
| `docs/` | `api.md`, `compat.md`, `migration-0.14-to-1.0.md`. |

## Before you open a pull request

```sh
node --test                      # the whole suite
node scripts/check-release.mjs   # version, CHANGELOG, tarball contents
node scripts/check-catalog.mjs   # catalog schema, prices, watchlist
node scripts/build-catalog.py    # only when you edited the YAML (needs PyYAML)
```

- Every behaviour change needs a test that fails without it.
- A new HTTP field or export is documented in `docs/api.md`; a new host event in `docs/compat.md`.
  `test/contract.test.js` fails when documentation and code drift apart.
- CHANGELOG entries describe what shipped, not what was attempted. One `## x.y.z` section per release.
- Do not touch `lib/catalog.js`: regenerate it from the YAML.

## Style

- ESM, no dependencies, no classes unless state is involved.
- Comments explain why a rule exists; the code already says what it does.
- Pure functions in their own module (`lib/pricing2.js`, `lib/effort.js`, `lib/channels.js`) so they can be
  tested without a host.
- The suite counts tests per file in the README; update the numbers when you add a file.

## Releases

See `PUBLISHING.md`. Short version: bump `package.json`, add the CHANGELOG section, tag `vX.Y.Z`,
push the tag, let the workflow publish with provenance, then confirm `dist-tags.latest`.
