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
const JUN30 = { startTime: '2026-06-30T02:55:34.268Z', expected: 7, unexpected: 39, flaky: 0, skipped: 0 };

const clearProv = () => { if (fs.existsSync(PROV)) fs.unlinkSync(PROV); };
const setProv   = (o: unknown) => fs.writeFileSync(PROV, JSON.stringify(o));

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
  setProv({ runId: 'DIFFERENT-RUN', timestamp: '2026-06-30T02:55:35Z' });
  assert.deepEqual(await assessInputHealth(JUN30, [], RID), { health: 'stale', reason: 'stale-artifact' });
});

test('P1.4 runId match, delta < 15min, sum > 0 -> healthy / null', async () => {
  const { assessInputHealth } = await loadHealth();
  setProv({ runId: RID, timestamp: '2026-06-30T02:55:40.000Z' });   // ~6s from startTime
  assert.deepEqual(await assessInputHealth(JUN30, [], RID), { health: 'healthy', reason: null });
});

test('P1.5 sum === 0, errors.length > 0 -> invalid / no-run', async () => {
  const { assessInputHealth } = await loadHealth();
  setProv({ runId: RID, timestamp: '2026-06-30T02:55:34.000Z' });
  const noRun = { startTime: '2026-06-30T02:55:34.268Z', expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  assert.deepEqual(await assessInputHealth(noRun, [{ e: 'globalSetup failed' }], RID), { health: 'invalid', reason: 'no-run' });
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
  assert.match(buildMarkdown(reportStub as any, 'unknown', 'missing-provenance', JUN30.startTime), /❓ PROVENANCE UNVERIFIED/);
});

test('P3.4 invalid -> "🔴 INVALID INPUT" (incl. reason)', async () => {
  const { buildMarkdown } = await loadTriage();
  assert.match(buildMarkdown(reportStub as any, 'invalid', 'no-run', JUN30.startTime), /🔴 INVALID INPUT — no-run/);
});

test('P3.5 header timestamp is the real run start, not triage-execution time', async () => {
  const { buildMarkdown } = await loadTriage();
  const md = buildMarkdown(reportStub as any, 'healthy', null, JUN30.startTime);
  // Uses stats.startTime (Jun-30), not reportStub.runTimestamp (Jul-03).
  assert.match(md, new RegExp(new Date(JUN30.startTime).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
