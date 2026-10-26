# Host compatibility

The plugin runs inside the DeepSeek Harness host. This table is the contract it relies on, what happens
when a piece is missing, and the evidence for each claim. It mirrors `compat-matrix.md` in the plan,
re-measured against host 0.1.7-rc.2.

| Contract | Kind | Behaviour when missing |
| --- | --- | --- |
| `sessionProjections` service | required | Degraded: listed in `/state.compat.missing`, the panel shows a yellow note, routing passes steps through untouched. |
| `agent/request` (prepend listener) | required | No routing at all; the plugin would not be useful, so this is a hard requirement. |
| `agent/pre-step` | optional | Budget hard-gate disabled; the step runs. |
| `agent/request-error` | optional | Channel health still records successes; failover retries are not offered. |
| `agent/inbox/claimed` | optional | Reserved for session binding; routing works without it. |
| `webServer` service | optional | No HTTP surface; the panel shows the state it can read and every control is disabled. |
| `commands` service | optional | The `/router` command is not registered. |
| `llm` service | optional | The semantic classifier falls back to keywords. |
| effort vocabulary (`none`/`low`/`high`/`max`) | optional | Unknown words are mapped onto the nearest tier and the mapping is reported as `nearest` or `alias` in the decision event. |
| decision projections (`tokenUsage`, `contextPressure`, `modelSelection`) | optional | The corresponding signal is skipped; scoring uses the rest. |
| `engines.dsh` | declaration | Affects `dshmarket` installs only; the runtime does not read it. |
| `peerDependencies` on `@deepseek-ai/*` | forbidden | The host startup gate silently skips the whole package. The plugin never declares one. |

## Degraded mode

The self-check runs when the plugin applies and is published on `/state.compat`:

```json
{ "missing": ["sessionProjections"], "optional": ["webServer"], "checkedAt": 1761436800000 }
```

- `missing` is never swallowed: a missing required service logs a warning and the panel (v1.0.0)
  shows `missing host capability: sessionProjections` instead of pretending everything is fine.
- `optional` simply lists what the host did not provide; each optional piece has a documented fallback.

## Verified against

- Host `@deepseek-ai/dsh 0.1.7-rc.2` (the version the plugin was audited against).
- Node 20, 22 and 24 in CI (see `.github/workflows/publish.yml`).
- The contract test (`test/contract.test.js`) fails if a registered host event stops being documented here,
  or if a documented route stops being registered.
