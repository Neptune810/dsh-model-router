# Security

## What this plugin is

A local plugin: it runs inside the DeepSeek Harness host process, on your machine, and talks to model
providers with the credentials that host already holds. It has no server, no account and no telemetry
endpoint of its own.

## The HTTP surface

- `/model-router/*` is served on the host's own loopback web server.
- Reads are same-origin checked, because `/state` contains your routing plan.
- Every mutation (`POST`) additionally requires `x-model-router-token`, a per-process nonce handed out only in
  the `/state` response. This stops a browser CSRF, not a local process: a local program can call the
  routes directly, exactly as it can call the host's own API.
- `/state` redacts absolute paths to bare file names.
- Request bodies are capped at 64 KiB.

## What is stored, and where

| File | Contents |
| --- | --- |
| `.model-router/state.json` | Pool, presets, settings, last decisions. Corrupt files are backed up, never silently overwritten. |
| `telemetry/decisions*.jsonl` | One line per decision: task class, chosen model and tier, scores, cost. **No prompt text.** |
| `telemetry/feedback.v1.jsonl` | Your three labels, the route they judged, and whether the next step stayed. Local only. |

Nothing in that list is uploaded. Feedback labels never leave the machine.

## Credentials

The plugin never reads, logs or stores provider keys: the host resolves them at request time and hands the
plugin only provider and model identifiers.

## Reporting a problem

Open a GitHub issue at https://github.com/Neptune810/dsh-model-router/issues with the version, the host
version, and the smallest reproduction you can manage. Please do not paste keys, prompts or full telemetry
files; a decision line with the fields you consider relevant is enough.
