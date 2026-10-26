# Manual smoke checklist — model-router 0.15.0

Run this on a real dsh web profile after installing the packed tarball — the
unit suite cannot see the composer, the host event stream or a restart. The
HTTP half is automated by `scripts/smoke.mjs`; this list covers what a script
cannot see. Every item below says what to do, what you should see, and what a
failure means.

> **Restart the host first.** A page refresh is not enough to load a new plugin
> version: quit DeepSeek Harness completely and relaunch it so the loader picks
> up the new bundle. All five items assume a freshly restarted host.

## 1. One router cell in the composer

**What to do:** open a session and open the model picker in the composer.

**What you should see:** exactly one model-router cell in the composer (no
duplicated or stacked copies of the panel), and the official model picker still
opens and lists the host models normally.

**What a failure means:** duplicated cells mean the client entry was mounted
twice (double registration or a stale bundle from the previous version); a
picker that no longer opens means the router entry is shadowing the host one.
Do not ship either way.

## 2. One routed step leaves one decision row

**What to do:** send one ordinary message (for example
`hello, can you help me with this?`), then open the router panel and look at
GET /model-router/state for the session.

**What you should see:** exactly one new `decisions[]` entry for that turn and
step with provider, model, effort and step class; the panel shows the model it
routed to; when the 0.15 telemetry change is in the build, one new telemetry
line is logged for the step.

**What a failure means:** no entry means the request never reached the router
listener (event wiring or listener order); two entries for one step mean the
listener is registered twice; a panel model different from the decision means
the projection and the applied request drift apart.

## 3. A manual pick yields, /router resume takes it back

**What to do:** pick another model by hand in the composer, send a message, look
at the panel, then run `/router resume` and send the next step.

**What you should see:** after the manual pick the panel goes amber and shows
that routing has yielded for the session; after `/router resume` routing
resumes on the next step and that step gets a new decision row again.

**What a failure means:** no amber means the manual pick was not detected (the
override policy never fired); no resume means the control command is not
registered, or the session stayed disengaged. Either breaks the "manual pick
wins, resume returns" contract.

## 4. A host restart keeps the confirmed plan and history

**What to do:** confirm a plan (pool plus any cross-provider setting), route a
few steps, quit the host completely, relaunch it, and reopen the same session.

**What you should see:** the panel shows the confirmed plan and the decision
history from before the restart; the session is not asked to confirm the plan
again.

**What a failure means:** a lost plan or empty history means the store did not
round-trip the state (write or reload bug); a new confirmation prompt means the
plan was stored incompletely.

## 5. An old profile state still loads after the upgrade

**What to do:** start with a profile written by 0.14.x (keep
`<profile>/.model-router/state.json` around), upgrade to 0.15.0, restart the
host, and open a session.

**What you should see:** the panel loads the existing pool, presets and settings
without errors or warnings about the state file; known values survive and only
new keys fall back to their defaults.

**What a failure means:** a load error or a reset to defaults means a state
migration regression — the old file must stay readable, so this blocks the
release.
