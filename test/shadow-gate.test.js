import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFiles, dayKey, evaluateShadow, SHADOW_GATE } from '../scripts/shadow-gate.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/shadow-gate.mjs', import.meta.url));
const DAY = 24 * 60 * 60 * 1000;

/** A ledger line shaped like the plugin writes it (lib/index.js record()). */
function shadowEvent (ts, { agree = true, current = 0.002, candidate = 0.0014, currentId = 'deepseek-official:deepseek-flash', candidateId = 'qiyue:deepseek-flash' } = {}) {
  return JSON.stringify({
    ts,
    session: 'abc123',
    turn: 1,
    step: 1,
    policy: 'router-1',
    stepClass: 'standard',
    channel: 'deepseek-official:deepseek-flash',
    costAware: false,
    shadow: {
      current: currentId,
      candidate: candidateId,
      agree,
      currentStepUsd: current,
      candidateStepUsd: candidate,
    },
    usage: { tokens: 1000, costUsd: current, split: { input: 500, output: 200, cacheRead: 300, cacheWrite: 0, reasoning: 0 } },
  });
}

function ledgerDir (linesByFile) {
  const dir = mkdtempSync(join(tmpdir(), 'mr-shadow-'));
  for (const [name, lines] of Object.entries(linesByFile)) {
    writeFileSync(join(dir, name), lines.join('\n') + '\n');
  }
  return dir;
}

function daysBack (now, days, perDay, options) {
  const lines = [];
  for (let day = 0; day < days; day += 1) {
    for (let i = 0; i < perDay; i += 1) {
      lines.push(shadowEvent(now - day * DAY - i * 1000, options));
    }
  }
  return lines;
}

test('dayKey uses the plugin zone, so a late-UTC event lands on the next day in Shanghai', () => {
  assert.equal(dayKey(Date.UTC(2026, 10, 2, 17, 0, 0)), '2026-11-03');
  assert.equal(dayKey(Date.UTC(2026, 10, 2, 1, 0, 0)), '2026-11-02');
});

test('evaluateShadow clears the flip gate on seven days of cheap shadow steps', () => {
  const now = Date.UTC(2026, 10, 2, 3, 0, 0);
  const dir = ledgerDir({ 'decisions-2026-11.jsonl': daysBack(now, SHADOW_GATE.minDays, 45) });
  const { files, reason } = collectFiles(dir);
  assert.equal(reason, null);
  const report = evaluateShadow({ files, now, days: SHADOW_GATE.minDays });
  assert.equal(report.daysCovered, 7);
  assert.equal(report.shadowSteps, 315);
  assert.equal(report.pricedSteps, 315);
  assert.equal(report.agreeSteps, 315);
  assert.equal(report.costRatio, 0.7);
  assert.equal(report.savedRatio, 0.3);
  assert.equal(report.gate.g3Cost, 'pass');
  assert.equal(report.gate.enoughDays, true);
  assert.equal(report.gate.enoughSteps, true);
  assert.equal(report.gate.g4Quality, 'not-measurable-from-shadow-ledger');
  assert.equal(report.gate.flipReady, true);
  assert.deepEqual(report.policyVersions, ['router-1']);
});

test('evaluateShadow refuses the flip when the candidate pool is not 15% cheaper', () => {
  const now = Date.UTC(2026, 10, 2, 3, 0, 0);
  const dir = ledgerDir({ 'decisions-2026-11.jsonl': daysBack(now, SHADOW_GATE.minDays, 45, { current: 0.002, candidate: 0.0019 }) });
  const report = evaluateShadow({ files: collectFiles(dir).files, now });
  assert.equal(report.costRatio, 0.95);
  assert.equal(report.gate.g3Cost, 'fail');
  assert.equal(report.gate.flipReady, false);
});

test('evaluateShadow keeps the gate closed on too few days or too few priced steps', () => {
  const now = Date.UTC(2026, 10, 2, 3, 0, 0);
  const fewDays = ledgerDir({ 'decisions-2026-11.jsonl': daysBack(now, 3, 200) });
  const thin = evaluateShadow({ files: collectFiles(fewDays).files, now });
  assert.equal(thin.daysCovered, 3);
  assert.equal(thin.gate.enoughDays, false);
  assert.equal(thin.gate.flipReady, false);
  const fewSteps = ledgerDir({ 'decisions-2026-11.jsonl': daysBack(now, SHADOW_GATE.minDays, 10) });
  const shallow = evaluateShadow({ files: collectFiles(fewSteps).files, now });
  assert.equal(shallow.pricedSteps, 70);
  assert.equal(shallow.gate.enoughSteps, false);
  assert.equal(shallow.gate.flipReady, false);
});

test('unpriced shadow steps count as shadow evidence but never as priced ones', () => {
  const now = Date.UTC(2026, 10, 2, 3, 0, 0);
  const lines = [];
  for (let day = 0; day < SHADOW_GATE.minDays; day += 1) {
    for (let i = 0; i < 20; i += 1) lines.push(shadowEvent(now - day * DAY - i * 1000));
    for (let i = 0; i < 20; i += 1) {
      lines.push(JSON.stringify({
        ts: now - day * DAY - 500_000 - i,
        policy: 'router-1',
        shadow: { current: 'relay:a', candidate: 'relay:b', agree: false },
      }));
    }
  }
  const dir = ledgerDir({ 'decisions-2026-11.jsonl': lines });
  const report = evaluateShadow({ files: collectFiles(dir).files, now });
  assert.equal(report.shadowSteps, 280);
  assert.equal(report.pricedSteps, 140);
  assert.equal(report.unpricedShadowSteps, 140);
  assert.equal(report.divergedSteps, 140);
  assert.equal(report.agreementRate, 0.5);
  assert.equal(report.gate.enoughSteps, false);
});

test('evaluateShadow counts malformed lines and reads rotated files', () => {
  const now = Date.UTC(2026, 10, 2, 3, 0, 0);
  const dir = ledgerDir({
    'decisions-2026-10-3.jsonl': ['not json at all', ''].concat(daysBack(now, 1, 5)),
    'decisions-2026-11.jsonl': daysBack(now, 1, 5),
    'notes.txt': ['ignore me'],
  });
  const { files } = collectFiles(dir);
  assert.deepEqual(files.map((file) => file.split(/[\\/]/).pop()).sort(), ['decisions-2026-10-3.jsonl', 'decisions-2026-11.jsonl']);
  const report = evaluateShadow({ files, now });
  assert.equal(report.malformedLines, 1);
  assert.equal(report.shadowSteps, 10);
  assert.equal(report.eventsInWindow, 10);
});

test('evaluateShadow ignores events outside the window and says so when the ledger is missing', () => {
  const now = Date.UTC(2026, 10, 2, 3, 0, 0);
  const dir = ledgerDir({ 'decisions-2026-11.jsonl': [shadowEvent(now - 30 * DAY), shadowEvent(now)] });
  const report = evaluateShadow({ files: collectFiles(dir).files, now });
  assert.equal(report.eventsInWindow, 1);
  assert.equal(report.shadowSteps, 1);
  const missing = collectFiles(join(tmpdir(), 'mr-shadow-does-not-exist-' + Date.now()));
  assert.deepEqual(missing.files, []);
  assert.equal(missing.reason, 'missing');
  const empty = collectFiles(mkdtempSync(join(tmpdir(), 'mr-shadow-empty-')));
  assert.deepEqual(empty.files, []);
  assert.equal(empty.reason, 'no-ledger');
});

test('the CLI prints a verdict, honours --json and exits 1 only with --require-pass', () => {
  const now = Date.UTC(2026, 10, 2, 3, 0, 0);
  const dir = ledgerDir({ 'decisions-2026-11.jsonl': daysBack(now, SHADOW_GATE.minDays, 45) });
  const json = spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--now', new Date(now).toISOString(), '--json'], { encoding: 'utf8' });
  assert.equal(json.status, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.gate.flipReady, true);
  assert.equal(parsed.daysCovered, 7);
  const text = spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--now', new Date(now).toISOString()], { encoding: 'utf8' });
  assert.equal(text.status, 0);
  assert.match(text.stdout, /flip ready\s+true/);
  const empty = mkdtempSync(join(tmpdir(), 'mr-shadow-empty-'));
  const strict = spawnSync(process.execPath, [SCRIPT, '--dir', empty, '--now', new Date(now).toISOString(), '--require-pass'], { encoding: 'utf8' });
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /costAware stays false/);
  const bad = spawnSync(process.execPath, [SCRIPT, '--nonsense'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown argument/);
});

test('the gate constants match the documented threshold', () => {
  assert.deepEqual(SHADOW_GATE, { minDays: 7, minPricedSteps: 300, maxCostRatio: 0.85 });
});
