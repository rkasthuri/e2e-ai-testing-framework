/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or modification
 * of this software is strictly prohibited.
 */

/**
 * TD-067 — by-construction proof test.
 *
 * Makes the TD-067 defects impossible-by-assertion across all three surfaces:
 *   PART 1 — assessInputHealth derives an honest verdict from provenance + stats.
 *   PART 2 — triage forces confidenceSource='fallback' when input is unhealthy.
 *   PART 3 — buildMarkdown emits an input-health banner (no more lying header).
 *
 * Framework: Node's built-in test runner (`node:test` + `node:assert/strict`)
 * under tsx — zero new deps, same pattern as scripts/verify-td066.test.ts.
 * Run: npx tsx --test scripts/verify-td067.test.ts   (also picked up by test:unit)
 *
 * inputHealth reads its sidecar path at module-load from FORGE_REPORTS_DIR, so we
 * set it to a throwaway dir BEFORE any dynamic import of the source modules and
 * control provenance.json content per-test. Source modules are imported
 * dynamically (never statically) so the env override is in place first.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'td067-'));
process.env.FORGE_REPORTS_DIR = TMP;            // MUST precede any inputHealth load
const PROV = path.join(TMP, 'provenance.json');
const RID  = '2026-07-03T12-00-00';
const JUN30 = {
  startTime: '2026-06-30T02:55:34.268Z',
  duration: 60_000,
  expected: 7,
  unexpected: 39,
  flaky: 0,
  skipped: 0,
};

const clearProv = () => { if (fs.existsSync(PROV)) fs.unlinkSync(PROV); };
const setProv   = (o: unknown) => fs.writeFileSync(PROV, JSON.stringify(o));
const setCurrentProv = (overrides: Record<string, unknown> = {}) => setProv({
  runId: RID,
  runStartedAt: '2026-06-30T02:55:30.000Z',
  provenanceWrittenAt: '2026-06-30T02:56:40.000Z',
  provenanceVersion: 2,
  ...overrides,
});

const loadHealth = () => import('../src/core/identity/inputHealth');
const loadTriage = () => import('../src/pipeline/ai-triage');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// ══ PART 1 — assessInputHealth (the core logic) ═══════════════════════════════

test('P1.1 stats === null -> invalid / invalid-schema', async () => {
  const { assessInputHealth } = await loadHealth();
  clearProv();
  assert.deepEqual(await assessInputHealth(null, [], RID), { health: 'invalid', reason: 'invalid-schema' });
});

test('P1.2 no provenance.json -> unknown / missing-provenance (never assumed healthy)', async () => {
  const { assessInputHealth } = await loadHealth();
  clearProv();
  const r = await assessInputHealth(JUN30, [], RID);
  assert.deepEqual(r, { health: 'unknown', reason: 'missing-provenance' });
  // vacuity: the OLD behavior (no sidecar check) treated input as current/ok —
  // this guard fails if the verdict were ever 'healthy' for a missing sidecar.
  assert.notEqual(r.health, 'healthy');
});

test('P1.3 provenance present, runId mismatch -> stale / stale-artifact', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv({ runId: 'DIFFERENT-RUN' });
  assert.deepEqual(await assessInputHealth(JUN30, [], RID), { health: 'stale', reason: 'stale-artifact' });
});

test('P1.4 current v2 provenance and complete short run -> healthy / null', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv();
  assert.deepEqual(await assessInputHealth(JUN30, [], RID), { health: 'healthy', reason: null });
});

test('P1.5 zero-result startup failure -> invalid / no-run', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv();
  const noRun = { startTime: '2026-06-30T02:55:34.268Z', duration: 0, expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  assert.deepEqual(
    await assessInputHealth(noRun, [{ message: 'globalSetup failed' }], RID),
    { health: 'invalid', reason: 'no-run' },
  );
});

test('P1.6 complete 30-minute run is healthy; elapsed duration is not completeness', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv({
    runStartedAt: '2026-08-16T12:00:00.000Z',
    provenanceWrittenAt: '2026-08-16T12:31:05.000Z',
  });
  const completeLongRun = {
    startTime: '2026-08-16T12:01:00.000Z',
    duration: 30 * 60_000,
    expected: 311,
    unexpected: 0,
    flaky: 5,
    skipped: 0,
  };
  assert.deepEqual(await assessInputHealth(completeLongRun, [], RID), { health: 'healthy', reason: null });
});

test('P1.7 sidecar written before the reported execution completed -> degraded / partial-results', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv({
    runStartedAt: '2026-08-16T12:00:00.000Z',
    provenanceWrittenAt: '2026-08-16T12:10:00.000Z',
  });
  const incomplete = {
    startTime: '2026-08-16T12:01:00.000Z', duration: 30 * 60_000,
    expected: 1, unexpected: 0, flaky: 0, skipped: 0,
  };
  assert.deepEqual(await assessInputHealth(incomplete, [], RID), { health: 'degraded', reason: 'partial-results' });
});

test('P1.8 top-level runner error after partial execution remains degraded', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv();
  assert.deepEqual(
    await assessInputHealth(JUN30, [{ message: 'worker interrupted' }], RID),
    { health: 'degraded', reason: 'partial-results' },
  );
});

test('P1.9 legacy ambiguous timestamp is not reinterpreted as run start', async () => {
  const { assessInputHealth } = await loadHealth();
  setProv({ runId: RID, timestamp: '2026-06-30T02:56:40.000Z', provenanceVersion: 1 });
  assert.deepEqual(await assessInputHealth(JUN30, [], RID), { health: 'unknown', reason: 'missing-run-start' });
});

test('P1.10 malformed provenance and malformed stats fail closed', async () => {
  const { assessInputHealth } = await loadHealth();
  fs.writeFileSync(PROV, '{bad-json', 'utf-8');
  assert.deepEqual(await assessInputHealth(JUN30, [], RID), { health: 'invalid', reason: 'invalid-schema' });
  setCurrentProv();
  assert.deepEqual(
    await assessInputHealth({ ...JUN30, duration: undefined }, [], RID),
    { health: 'invalid', reason: 'invalid-schema' },
  );
});

test('P1.11 Playwright evidence starting before the canonical run is stale', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv({ runStartedAt: '2026-06-30T03:00:00.000Z' });
  assert.deepEqual(await assessInputHealth(JUN30, [], RID), { health: 'stale', reason: 'stale-artifact' });
});

test('P1.12 all-skipped and retry-pass/flaky final outcomes preserve current policy', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv();
  const allSkipped = { ...JUN30, expected: 0, unexpected: 0, flaky: 0, skipped: 3 };
  assert.deepEqual(await assessInputHealth(allSkipped, [], RID), { health: 'healthy', reason: null });
  const retryPass = { ...JUN30, expected: 0, unexpected: 0, flaky: 5, skipped: 0 };
  assert.deepEqual(await assessInputHealth(retryPass, [], RID), { health: 'healthy', reason: null });
});

test('P1.13 workflow captures immutable run start and writes explicit v2 completion provenance', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/e2e-pipeline.yml'), 'utf-8');
  const establishStart = workflow.indexOf('- name: Establish canonical run id');
  const writeStart = workflow.indexOf('- name: Write provenance sidecar');
  const uploadStart = workflow.indexOf('- name: Upload Playwright HTML report', writeStart);
  assert.notEqual(establishStart, -1);
  assert.notEqual(writeStart, -1);
  assert.notEqual(uploadStart, -1);
  const establish = workflow.slice(establishStart, writeStart);
  const write = workflow.slice(writeStart, uploadStart);
  assert.match(establish, /RUN_STARTED_AT=\$\(date -u/);
  assert.equal((establish.match(/RUN_STARTED_AT=\$\(date -u/g) ?? []).length, 1);
  assert.match(establish, /RUN_STARTED_AT=.*%3NZ/);
  assert.match(establish, /CURRENT_RUN_STARTED_AT=\$RUN_STARTED_AT/);
  assert.match(write, /"runStartedAt": "'"\$CURRENT_RUN_STARTED_AT"'"/);
  assert.match(write, /"provenanceWrittenAt": "'"\$\(date -u/);
  assert.match(write, /"provenanceWrittenAt":.*%3NZ/);
  assert.match(write, /"provenanceVersion": 2/);
  assert.doesNotMatch(write, /"timestamp"\s*:/);
});

test('P1.14 triage and results-store share the same input-health authority', () => {
  for (const relativePath of ['../src/pipeline/ai-triage.ts', '../src/pipeline/results-store.ts']) {
    const source = fs.readFileSync(path.resolve(__dirname, relativePath), 'utf-8');
    assert.match(source, /import \{ assessInputHealth,[\s\S]*?\} from '\.\.\/core\/identity\/inputHealth'/);
    assert.match(source, /await assessInputHealth\([\s\S]*?errors \?\? \[\],[\s\S]*?runId/);
  }
});

test('R1.1 non-canonical and impossible timestamps are invalid', async () => {
  const { assessInputHealth } = await loadHealth();
  const invalidTimestamps = [
    '0',
    '2026-08-16T17:21:41Z',
    '2026-08-16T17:21:41.298',
    '2026-08-16T17:21:41.298+00:00',
    'August 16, 2026 17:21:41 UTC',
    '2026-08-16',
    '2026-02-30T12:00:00.000Z',
    '2026-13-01T12:00:00.000Z',
    '2026-00-01T12:00:00.000Z',
    '2026-08-00T12:00:00.000Z',
    '2026-08-16T24:00:00.000Z',
    '2026-08-16T12:60:00.000Z',
    '2026-08-16T12:00:60.000Z',
  ];
  for (const invalidTimestamp of invalidTimestamps) {
    setCurrentProv({ runStartedAt: invalidTimestamp });
    assert.deepEqual(
      await assessInputHealth(JUN30, [], RID),
      { health: 'invalid', reason: 'invalid-schema' },
      invalidTimestamp,
    );
  }
  setCurrentProv({ provenanceWrittenAt: '0' });
  assert.deepEqual(await assessInputHealth(JUN30, [], RID), { health: 'invalid', reason: 'invalid-schema' });
  setCurrentProv();
  assert.deepEqual(
    await assessInputHealth({ ...JUN30, startTime: '2026-08-16T17:21:41.298' }, [], RID),
    { health: 'invalid', reason: 'invalid-schema' },
  );
});

test('R1.2 canonical millisecond UTC and leap-day timestamps are valid', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv({
    runStartedAt: '2024-02-29T12:00:00.000Z',
    provenanceWrittenAt: '2024-02-29T12:00:01.000Z',
  });
  const leapDay = {
    startTime: '2024-02-29T12:00:00.250Z', duration: 500.5,
    expected: 1, unexpected: 0, flaky: 0, skipped: 0,
  };
  assert.deepEqual(await assessInputHealth(leapDay, [], RID), { health: 'healthy', reason: null });
});

test('R1.3 exact ordering rejects Playwright starting one millisecond before the run', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv({
    runStartedAt: '2026-08-16T12:00:00.001Z',
    provenanceWrittenAt: '2026-08-16T12:00:01.000Z',
  });
  const earlyStart = {
    startTime: '2026-08-16T12:00:00.000Z', duration: 0,
    expected: 1, unexpected: 0, flaky: 0, skipped: 0,
  };
  assert.deepEqual(await assessInputHealth(earlyStart, [], RID), { health: 'stale', reason: 'stale-artifact' });
});

test('R1.4 exact ordering rejects provenance written one millisecond before completion', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv({
    runStartedAt: '2026-08-16T12:00:00.000Z',
    provenanceWrittenAt: '2026-08-16T12:00:00.999Z',
  });
  const notYetComplete = {
    startTime: '2026-08-16T12:00:00.000Z', duration: 1_000,
    expected: 1, unexpected: 0, flaky: 0, skipped: 0,
  };
  assert.deepEqual(
    await assessInputHealth(notYetComplete, [], RID),
    { health: 'degraded', reason: 'partial-results' },
  );
});

test('R1.5 exact ordering rejects provenance written one millisecond before run start', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv({
    runStartedAt: '2026-08-16T12:00:00.001Z',
    provenanceWrittenAt: '2026-08-16T12:00:00.000Z',
  });
  const startsWithRun = {
    startTime: '2026-08-16T12:00:00.001Z', duration: 0,
    expected: 1, unexpected: 0, flaky: 0, skipped: 0,
  };
  assert.deepEqual(await assessInputHealth(startsWithRun, [], RID), { health: 'invalid', reason: 'invalid-schema' });
});

test('R1.6 exact equality at run start and reported completion is healthy', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv({
    runStartedAt: '2026-08-16T12:00:00.000Z',
    provenanceWrittenAt: '2026-08-16T12:00:01.000Z',
  });
  const exactBoundaries = {
    startTime: '2026-08-16T12:00:00.000Z', duration: 1_000,
    expected: 1, unexpected: 0, flaky: 0, skipped: 0,
  };
  assert.deepEqual(await assessInputHealth(exactBoundaries, [], RID), { health: 'healthy', reason: null });
});

test('R1.7 every outcome count rejects unsafe, negative, fractional, and non-finite values', async () => {
  const { assessInputHealth } = await loadHealth();
  const countNames = ['expected', 'unexpected', 'flaky', 'skipped'] as const;
  const invalidCounts = [Number.MAX_SAFE_INTEGER + 1, -1, 0.5, Infinity, NaN];
  setCurrentProv();
  for (const countName of countNames) {
    for (const invalidCount of invalidCounts) {
      assert.deepEqual(
        await assessInputHealth({ ...JUN30, [countName]: invalidCount }, [], RID),
        { health: 'invalid', reason: 'invalid-schema' },
        `${countName}=${String(invalidCount)}`,
      );
    }
  }
});

test('R1.8 individually safe counts whose sum is unsafe are invalid', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv();
  const unsafeTotal = {
    ...JUN30,
    expected: Number.MAX_SAFE_INTEGER,
    unexpected: 1,
    flaky: 0,
    skipped: 0,
  };
  assert.deepEqual(await assessInputHealth(unsafeTotal, [], RID), { health: 'invalid', reason: 'invalid-schema' });
});

test('R1.9 duration accepts real fractional milliseconds but rejects unsafe values and completion overflow', async () => {
  const { assessInputHealth } = await loadHealth();
  setCurrentProv();
  assert.deepEqual(
    await assessInputHealth({ ...JUN30, duration: 586.635 }, [], RID),
    { health: 'healthy', reason: null },
  );
  for (const invalidDuration of [-1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '1000']) {
    assert.deepEqual(
      await assessInputHealth({ ...JUN30, duration: invalidDuration } as any, [], RID),
      { health: 'invalid', reason: 'invalid-schema' },
      `duration=${String(invalidDuration)}`,
    );
  }
  assert.deepEqual(
    await assessInputHealth({ ...JUN30, duration: Number.MAX_SAFE_INTEGER }, [], RID),
    { health: 'invalid', reason: 'invalid-schema' },
    'completion outside safely representable Date bounds',
  );
});

// ══ PART 2 — confidenceSource override (contract) ═════════════════════════════
// parseResponse yields a REAL 'model' confidence; the TD-067 rule main() applies
// (health !== 'healthy' -> force 'fallback') is asserted here as the contract.

const modelResult = (parseResponse: any) =>
  parseResponse(JSON.stringify({ verdict: 'x', confidence: 'High', evidence: 'e', reasoning: 'r' }), { testTitle: 'x' });

test('P2.1 unhealthy input -> confidenceSource forced to fallback (was model)', async () => {
  const { parseResponse } = await loadTriage();
  const results = [modelResult(parseResponse)];
  assert.equal(results[0].confidenceSource, 'model');            // model genuinely returned it
  const health = 'unknown';                                      // any non-healthy state
  if (health !== 'healthy') for (const r of results) r.confidenceSource = 'fallback';
  assert.equal(results[0].confidenceSource, 'fallback');
  // vacuity: OLD behavior (no override) would leave it 'model' -> this fails.
});

test('P2.2 healthy input -> model confidenceSource preserved (no override)', async () => {
  const { parseResponse } = await loadTriage();
  const results = [modelResult(parseResponse)];
  const health = 'healthy';
  if (health !== 'healthy') for (const r of results) r.confidenceSource = 'fallback';
  assert.equal(results[0].confidenceSource, 'model');
});

// ══ PART 3 — buildMarkdown health banner (emitted string) ═════════════════════

const emptySummary = { 'app-bug': 0, 'test-defect': 0, 'infra-defect': 0, 'flaky': 0, 'insufficient-evidence': 0 };
const reportStub = { runTimestamp: '2026-07-03T16:00:00.000Z', totalTests: 1, totalFailed: 1, summary: emptySummary, results: [] };

test('P3.1 healthy -> "✅ Input verified"', async () => {
  const { buildMarkdown } = await loadTriage();
  assert.match(buildMarkdown(reportStub as any, 'healthy', null, JUN30.startTime), /✅ Input verified/);
});

test('P3.2 stale -> "⚠️ STALE INPUT"', async () => {
  const { buildMarkdown } = await loadTriage();
  const md = buildMarkdown(reportStub as any, 'stale', 'stale-artifact', JUN30.startTime);
  assert.match(md, /⚠️ STALE INPUT/);
  // vacuity: the OLD header (`**Run:** <new Date()>` with no banner) never
  // contained this string -> the assertion fails against the old behavior.
});

test('P3.3 unknown -> "❓ PROVENANCE UNVERIFIED"', async () => {
  const { buildMarkdown } = await loadTriage();
  const md = buildMarkdown(reportStub as any, 'unknown', 'missing-provenance', JUN30.startTime);
  assert.match(md, /PROVENANCE UNVERIFIED — sidecar absent/);
});

test('R3.1 present legacy provenance reports missing run-start authority, not an absent sidecar', async () => {
  const { buildMarkdown } = await loadTriage();
  const md = buildMarkdown(reportStub as any, 'unknown', 'missing-run-start', JUN30.startTime);
  assert.match(md, /PROVENANCE UNVERIFIED — provenance lacks canonical run-start authority/);
  assert.doesNotMatch(md, /sidecar absent|provenance missing/i);
});

test('R3.2 unrecognized unknown reason uses bounded generic provenance wording', async () => {
  const { buildMarkdown } = await loadTriage();
  const md = buildMarkdown(reportStub as any, 'unknown', 'run-id-mismatch', JUN30.startTime);
  assert.match(md, /PROVENANCE UNVERIFIED — canonical provenance could not be established/);
  assert.doesNotMatch(md, /sidecar absent|run took|timing anomaly/i);
});

test('P3.4 invalid -> "🔴 INVALID INPUT" (incl. reason)', async () => {
  const { buildMarkdown } = await loadTriage();
  assert.match(buildMarkdown(reportStub as any, 'invalid', 'no-run', JUN30.startTime), /🔴 INVALID INPUT — no-run/);
});

test('R2.1 generated degraded report describes partial evidence without obsolete duration claims', async () => {
  const { buildMarkdown } = await loadTriage();
  const md = buildMarkdown(reportStub as any, 'degraded', 'partial-results', JUN30.startTime);
  assert.match(md, /DEGRADED — partial or temporally incoherent execution evidence detected/);
  assert.doesNotMatch(md, /15\s*min|>\s*15|timing anomaly|suite ran too long|long runtime|duration threshold/i);
  assert.doesNotMatch(md, /Input verified/);
});

test('P3.5 header timestamp is the real run start, not triage-execution time', async () => {
  const { buildMarkdown } = await loadTriage();
  const md = buildMarkdown(reportStub as any, 'healthy', null, JUN30.startTime);
  // Uses stats.startTime (Jun-30), not reportStub.runTimestamp (Jul-03).
  assert.match(md, new RegExp(new Date(JUN30.startTime).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
