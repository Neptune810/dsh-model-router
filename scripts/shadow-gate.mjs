#!/usr/bin/env node
/**
 * Shadow gate — can cost-aware routing be turned on by default yet?
 *
 * The flip is gated on evidence, not on a date: at least seven days of telemetry
 * and at least 300 priced shadow steps, one restart on a build that records the
 * shadow, plus G3 (cost <= baseline x 0.85) and G4 (success not worse). This
 * script answers the first half mechanically from the JSONL the plugin already
 * writes, so a monthly review is one command instead of a manual file hunt.
 *
 * It never writes anything and never changes a default. With no telemetry on
 * disk it says so and exits 0 (exit 1 only with --require-pass).
 *
 * Usage:
 *   node scripts/shadow-gate.mjs [--dir <storageDir> | --file <a.jsonl>]
 *                                [--days 7] [--now <ISO|epoch-ms>]
 *                                [--json] [--require-pass]
 *
 * Storage directory defaults to <DSH_HOME>/storages/model-router (the plugin's
 * ledger location). Files are the monthly decisions-YYYY-MM.jsonl plus the
 * decisions-YYYY-MM-<seq>.jsonl rotations.
 *
 * G4 cannot be read from the shadow ledger: the shadow records what would have
 * been bought, never whether the step went well. Quality needs the labelled L2
 * replay (see docs and telemetry-and-eval.md), and this script says so rather
 * than guessing.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FILE_RE = /^decisions-(\d{4})-(\d{2})(?:-(\d+))?\.jsonl$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export const SHADOW_GATE = {
  minDays: 7,
  minPricedSteps: 300,
  // G3: the candidate pool has to be at least 15% cheaper than what the current
  // policy actually bought, over the same steps.
  maxCostRatio: 0.85,
};

function defaultDir () {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh');
  return join(home, 'storages', 'model-router');
}

function toMs (value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Local calendar day in the plugin's zone (+08:00, no DST). */
export function dayKey (ts) {
  return new Date(ts + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function collectFiles (target) {
  if (!existsSync(target)) return { files: [], reason: 'missing' };
  const stat = statSync(target);
  if (stat.isFile()) return { files: [target], reason: null };
  const files = readdirSync(target)
    .filter((name) => FILE_RE.test(name))
    .sort()
    .map((name) => join(target, name));
  return { files, reason: files.length === 0 ? 'no-ledger' : null };
}

/** One shadow reading, or null for an event without one. Mirrors lib/telemetry.js. */
function shadowOf (event) {
  const shadow = event && typeof event === 'object' && !Array.isArray(event) && event.shadow &&
    typeof event.shadow === 'object' && !Array.isArray(event.shadow)
    ? event.shadow
    : null;
  if (!shadow) return null;
  const current = typeof shadow.currentStepUsd === 'number' && Number.isFinite(shadow.currentStepUsd)
    ? shadow.currentStepUsd
    : null;
  const candidate = typeof shadow.candidateStepUsd === 'number' && Number.isFinite(shadow.candidateStepUsd)
    ? shadow.candidateStepUsd
    : null;
  return {
    agree: shadow.agree === true,
    current,
    candidate,
    currentId: typeof shadow.current === 'string' ? shadow.current : null,
    candidateId: typeof shadow.candidate === 'string' ? shadow.candidate : null,
  };
}

function round (value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Fold the ledger into the flip evidence. Pure: files in, verdict out.
 */
export function evaluateShadow ({ files = [], now, days = SHADOW_GATE.minDays, read = (file) => readFileSync(file, 'utf8') } = {}) {
  const until = Number.isFinite(now) ? now : Date.now();
  const since = until - days * DAY_MS;
  const totals = {
    events: 0,
    eventsInWindow: 0,
    shadowSteps: 0,
    pricedSteps: 0,
    agreeSteps: 0,
    divergedSteps: 0,
    currentUsd: 0,
    candidateUsd: 0,
    malformedLines: 0,
    policyVersions: [],
    channels: [],
  };
  const dayKeys = new Set();
  const policies = new Set();
  const channels = new Set();
  let firstEventTs = null;
  let lastEventTs = null;

  for (const file of files) {
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        totals.malformedLines += 1;
        continue;
      }
      totals.events += 1;
      const ts = toMs(event && event.ts);
      if (ts === undefined || ts < since || ts > until) continue;
      totals.eventsInWindow += 1;
      if (firstEventTs === null || ts < firstEventTs) firstEventTs = ts;
      if (lastEventTs === null || ts > lastEventTs) lastEventTs = ts;
      dayKeys.add(dayKey(ts));
      if (typeof event.policy === 'string' && event.policy !== '') policies.add(event.policy);
      if (typeof event.channel === 'string' && event.channel !== '') channels.add(event.channel);
      const shadow = shadowOf(event);
      if (!shadow) continue;
      totals.shadowSteps += 1;
      if (shadow.agree) totals.agreeSteps += 1;
      else totals.divergedSteps += 1;
      if (shadow.current !== null && shadow.candidate !== null) {
        totals.pricedSteps += 1;
        totals.currentUsd += shadow.current;
        totals.candidateUsd += shadow.candidate;
      }
    }
  }

  const daysCovered = dayKeys.size;
  const savedUsd = Math.max(0, totals.currentUsd - totals.candidateUsd);
  const costRatio = totals.currentUsd > 0 ? totals.candidateUsd / totals.currentUsd : null;
  const savedRatio = costRatio === null ? null : Math.max(0, 1 - costRatio);
  const enoughDays = daysCovered >= SHADOW_GATE.minDays;
  const enoughSteps = totals.pricedSteps >= SHADOW_GATE.minPricedSteps;
  const g3 = costRatio === null
    ? 'unknown'
    : costRatio <= SHADOW_GATE.maxCostRatio ? 'pass' : 'fail';
  return {
    window: { since, until, days },
    files: files.length,
    daysCovered,
    events: totals.events,
    eventsInWindow: totals.eventsInWindow,
    shadowSteps: totals.shadowSteps,
    pricedSteps: totals.pricedSteps,
    unpricedShadowSteps: totals.shadowSteps - totals.pricedSteps,
    agreeSteps: totals.agreeSteps,
    divergedSteps: totals.divergedSteps,
    agreementRate: totals.shadowSteps > 0 ? round(totals.agreeSteps / totals.shadowSteps, 4) : null,
    currentUsd: round(totals.currentUsd, 6),
    candidateUsd: round(totals.candidateUsd, 6),
    savedUsd: round(savedUsd, 6),
    costRatio: costRatio === null ? null : round(costRatio, 4),
    savedRatio: savedRatio === null ? null : round(savedRatio, 4),
    malformedLines: totals.malformedLines,
    policyVersions: [...policies].sort(),
    channels: [...channels].sort(),
    firstEventAt: firstEventTs === null ? null : new Date(firstEventTs).toISOString(),
    lastEventAt: lastEventTs === null ? null : new Date(lastEventTs).toISOString(),
    gate: {
      minDays: SHADOW_GATE.minDays,
      minPricedSteps: SHADOW_GATE.minPricedSteps,
      enoughDays,
      enoughSteps,
      shadowRecording: totals.shadowSteps > 0,
      g3Cost: g3,
      // Not a measurement: the ledger has no quality signal. Recorded as an open
      // requirement so nobody reads "g3 pass" as "flip is safe".
      g4Quality: 'not-measurable-from-shadow-ledger',
      flipReady: enoughDays && enoughSteps && g3 === 'pass',
    },
  };
}

function renderText (report, { dir, reason } = {}) {
  const lines = [];
  lines.push('shadow gate — cost-aware flip evidence');
  lines.push('');
  lines.push('  ledger: ' + (dir || '(none)') + (reason ? ' (' + reason + ')' : ''));
  lines.push('  window: ' + report.window.days + ' day(s) ending ' + new Date(report.window.until).toISOString());
  lines.push('  files read: ' + report.files + '; events in window: ' + report.eventsInWindow + '; malformed lines: ' + report.malformedLines);
  lines.push('');
  lines.push('  days covered            ' + report.daysCovered + ' / ' + report.gate.minDays);
  lines.push('  shadow steps            ' + report.shadowSteps);
  lines.push('  priced shadow steps     ' + report.pricedSteps + ' / ' + report.gate.minPricedSteps + (report.unpricedShadowSteps > 0 ? ' (' + report.unpricedShadowSteps + ' unpriced)' : ''));
  lines.push('  agree / diverged        ' + report.agreeSteps + ' / ' + report.divergedSteps + (report.agreementRate === null ? '' : '  agreement ' + report.agreementRate));
  lines.push('  current vs candidate    $' + report.currentUsd + ' vs $' + report.candidateUsd + '  saved $' + report.savedUsd + (report.savedRatio === null ? '' : ' (' + round(report.savedRatio * 100, 1) + '%)'));
  lines.push('');
  lines.push('  G3 cost ratio           ' + report.gate.g3Cost + (report.costRatio === null ? ' (nothing priced yet)' : ' (ratio ' + report.costRatio + ', needs <= ' + SHADOW_GATE.maxCostRatio + ')'));
  lines.push('  G4 quality non-inferior ' + report.gate.g4Quality + ' — run the labelled L2 replay for this half');
  lines.push('  flip ready              ' + report.gate.flipReady);
  lines.push('');
  if (!report.gate.flipReady) {
    const why = [];
    if (!report.gate.enoughDays) why.push('needs ' + SHADOW_GATE.minDays + ' days with telemetry (has ' + report.daysCovered + ')');
    if (!report.gate.enoughSteps) why.push('needs ' + SHADOW_GATE.minPricedSteps + ' priced shadow steps (has ' + report.pricedSteps + ')');
    if (!report.gate.shadowRecording) why.push('no shadow step has ever been recorded: is the plugin loaded in the profile that runs?');
    if (report.gate.g3Cost === 'fail') why.push('the candidate pool is not 15% cheaper yet');
    lines.push('  verdict: not yet — ' + why.join('; '));
    lines.push('  costAware stays false; the evidence is recorded, not assumed.');
  } else {
    lines.push('  verdict: flip gate met — open a minor, flip the default, update golden snapshots explicitly.');
  }
  return lines.join('\n');
}

function parseArgs (argv) {
  const options = { days: SHADOW_GATE.minDays, json: false, requirePass: false, dir: null, file: null, now: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--require-pass') options.requirePass = true;
    else if (arg === '--dir') { i += 1; options.dir = argv[i]; }
    else if (arg === '--file') { i += 1; options.file = argv[i]; }
    else if (arg === '--days') { i += 1; options.days = Number(argv[i]); }
    else if (arg === '--now') { i += 1; options.now = toMs(argv[i]); }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error('unknown argument: ' + arg);
  }
  if (options.days !== undefined && (!Number.isFinite(options.days) || options.days <= 0)) {
    throw new Error('--days expects a positive number');
  }
  if (options.dir !== null && options.file !== null) throw new Error('use either --dir or --file, not both');
  if (options.now !== undefined && options.now === undefined) throw new Error('--now expects an ISO date or epoch milliseconds');
  return options;
}

export function main (argv = process.argv.slice(2), write = (text) => process.stdout.write(text)) {
  const options = parseArgs(argv);
  if (options.help) {
    write('usage: node scripts/shadow-gate.mjs [--dir <dir>|--file <jsonl>] [--days N] [--now <ISO|epoch-ms>] [--json] [--require-pass]\n');
    return 0;
  }
  const target = options.file !== null ? resolve(options.file) : resolve(options.dir !== null ? options.dir : defaultDir());
  const { files, reason } = collectFiles(target);
  const report = evaluateShadow({ files, now: options.now === undefined ? Date.now() : options.now, days: options.days });
  if (options.json) write(JSON.stringify({ target, reason, ...report }, null, 2) + '\n');
  else write(renderText(report, { dir: target, reason }) + '\n');
  if (options.requirePass && !report.gate.flipReady) return 1;
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write('shadow-gate: ' + (error && error.message ? error.message : String(error)) + '\n');
    process.exitCode = 2;
  }
}
