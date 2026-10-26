# Migrating from 0.14 to 1.0

1.0.0 is additive: no `state.json` migration is needed, and a 0.14 profile reads the 1.0 store without
conversion. This page lists what each release added, so an older configuration can be read against the new
defaults.

## Nothing to do, usually

- `state.json` has been at schema v2 since 0.14.3 (corrupt files are backed up, not overwritten). 1.0 does
  not change it.
- Every new key defaults to the behaviour you already had: `costAware: false`, `channels.failover: false`,
  `budget.mode: off`, `experiments.enabled: false`, `classifier: rules`.
- The one default that changed is `peakPolicy`, which became `inform` in 0.16.1. It only prints and shows a
  note; it never delays or reroutes anything.

## What each release added

| Release | Keys | Notes |
| --- | --- | --- |
| 0.14.3 | — | Bug fixes only: poisoned-history hysteresis, store v2, `maxPerTask.strong`, `imagePolicy=flash` retired, panel token, `engines.dsh`. |
| 0.14.4 | — | Release gate, catalog schema and generator, smoke fixtures. |
| 0.15.0 | `telemetry` | Decision and outcome events under `<storages>/model-router/telemetry/`, `/stats`. |
| 0.15.1 | `catalog.watchlist` | Catalog prices drive `usage.costUsd`; the panel shows hard dates. |
| 0.16.0 | `costAware`, `costGuard` | Token-level price basis (`lib/pricing2.js`), the cost term in scoring (off), the shadow. |
| 0.16.1 | `channels`, `budget`, `peakPolicy`, `crossCost` | Health, failover, fingerprints, spend limits, the peak window, the cross-brand guard. |
| 0.17.0 | — | `lib/effort.js` ladder, `effortMapped` on every decision, replay CLI. No new config key. |
| 0.17.1 | `classifierMinConfidence`, `classifierTimeoutMs`, `classifierAttempts`, `experiments` | Feedback labels, classifier v2, ε-greedy exploration. |
| 1.0.0 | — | `schemaVersion` on every HTTP response, the compat note in the panel, the API and compat docs, the
  contract test. No new config key. |

## Turning things on

```yaml
# price-aware routing, once you trust the shadow
costAware: true
costGuard: { maxMultiple: 8, unknownPricing: exclude }

# channel health and one retry per failed step
channels: { failover: true, failThreshold: 3, cooldownMs: 60000, fingerprint: true }

# spend limits: only ever refuse a synthetic step, never a step with new user input
budget: { mode: block, sessionUsd: 2, dayUsd: 12, monthUsd: 200, softRatio: 0.8 }

# semantic classification, with the 0.6 confidence gate and the breaker
classifier: llm
classifierMinConfidence: 0.6
experiments: { enabled: true, apply: false, epsilon: 0.1, seed: 7 }
```

## Rolling back

```sh
npm dist-tag add @neptune810/dsh-model-router@0.17.1 latest   # move the tag
pnpm add @neptune810/dsh-model-router@0.17.1 --save-exact      # pin the profile
```

Nothing in 1.0 writes a field that 0.17 cannot read: the feedback log is a separate file that an older
version simply ignores, and `schemaVersion` is additive.
