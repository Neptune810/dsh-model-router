# The model-router HTTP API

The browser panel is a client plugin with no RPC surface of its own, so it talks to the host over
same-origin HTTP. This document is the contract: 1.x keeps every route and every documented field
additive, and a field is only removed in a major version.

## Envelope

- Prefix: `/model-router`.
- Every response is a JSON object and carries `schemaVersion` (`1` today) plus `ok`.
  A rejection is `{ ok: false, error, schemaVersion }` with HTTP 400 (or 403/405/500 for the transport-level cases).
- `cache-control: no-store` on everything.
- Reads are same-origin too: the state payload contains the routing plan.
- A missing `Origin` is allowed (the Desktop proxy strips it); a present `Origin` that is not the request's
  `Host`, and any `sec-fetch-site: cross-site`, get 403 `same-origin only`.
- Every POST additionally carries `x-model-router-token`, the per-process nonce handed out in the `/state` response.
- Bodies are JSON, at most 64 KiB.
- `GET /state` returns a weak `ETag` and answers 304 to a matching `If-None-Match`.

## Routes

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | /model-router/state | — (`?sessionId=` optional) | The whole panel state: control, plan, presets, pool, decisions, live route, cost shadow, channels, budget, peak, catalog, effort, classifier, experiments, feedback, compat, telemetry. Absolute paths are redacted to bare file names. |
| GET | /model-router/catalog | — | The bundled model catalog and its watchlist. |
| GET | /model-router/stats | — (`?since&until&limit`) | Aggregated telemetry over a window: `byClass`, `byModel`, `byEffort`, `totals` (tokens, priced steps, cost, peak, failover, effort mapping, experiments), `shadow`, `feedback`, `catalog`. |
| POST | /model-router/control | `{ sessionId, control }` | `full` / `effort` / `model` / `null` (null resumes routing). |
| POST | /model-router/resume | `{ sessionId }` | Drops a manual override. |
| POST | /model-router/effort-model | `{ sessionId, model }` | Binds (or unbinds, `null`) the one model the effort scope may use. |
| POST | /model-router/task-type | `{ sessionId, preset }` | Pins the task type for the next turn, or `null` for automatic. |
| POST | /model-router/confirm | `{ sessionId, plan }` | Confirms the plan signature the state route reported. |
| POST | /model-router/pool | `{ pool }` | Replaces the pool (strings or `{ id, tier, cost, channel, tags, weights, efforts }` entries). |
| POST | /model-router/pool/auto-price | `{ fetch }` | Fills relative cost levels from the built-in rules, optionally from a fresh OpenRouter snapshot. |
| POST | /model-router/prices | — | Re-reads the catalog price file. |
| POST | /model-router/cross | `{ sessionId, action }` | Answers a cross-provider proposal: `allow` / `once` / `never`. |
| POST | /model-router/presets | `{ presets }` | Replaces task presets. |
| POST | /model-router/settings | `{ settings }` | Updates one settings block (control, image policy, classifier, panel background, signals, subagent, effort model). |
| POST | /model-router/budget | `{ sessionId, action }` | `once` lets the next step through a hard budget stop and re-arms; `rearm` clears the stop immediately. |
| POST | /model-router/feedback | `{ sessionId, label }` | Records `too-expensive` / `too-weak` / `just-right` for that session's last route, locally only. |

## Module exports

| Subpath | File | Surface |
| --- | --- | --- |
| @neptune810/dsh-model-router | lib/index.js | The Cordis plugin itself. |
| ./policy | lib/policy.js | Config normalisation, scoring constants, effort points. |
| ./routing | lib/routing.js | Pool normalisation, `chooseEntry`, effort mapping, hysteresis, `ROUTING_DEFAULTS`. |
| ./config | lib/config.js | `normalizeRuntimeConfig` and its defaults. |
| ./client | client/client.js | The browser half. |
| ./catalog-pricing | lib/catalog-pricing.js | Catalog rates: `pricesAt`, `tokenCost`, `upcomingAlerts`. |
| ./effort | lib/effort.js | The ladder, budget tables and `explainMapping`. |
| ./channels | lib/channels.js | Failure classification, `ChannelHealth`, fingerprints. |
| ./budget | lib/budget.js | Budget rows and reporting. |
| ./classifier2 | lib/classifier2.js | The verdict parser, the confidence gate, the circuit breaker. |
| ./experiments | lib/experiments.js | ε-greedy planning and reporting. |
| ./feedback | lib/feedback.js | Label normalisation and aggregation. |
| ./feedback-store | lib/feedback-store.js | The local JSONL feedback log. |
| ./replay | lib/replay.js | The offline replay CLI (`dsh-model-router-replay`). |

## Stability promise

- New fields, routes and exports may be added in any 1.x release; they default to off or empty so an older
  panel keeps working.
- A documented field is never renamed or removed before 2.0; a replacement is introduced alongside and the
  old one keeps working for at least one minor.
- `schemaVersion` is bumped only for a breaking change to a documented shape.
