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
 * TD-066 — by-construction proof test.
 *
 * Makes the three TD-066 defects impossible-by-assertion (the "class is closed"
 * proof, like the FC representative tests):
 *   PART 1 — FlowConfidence is DERIVED from evidence, never a source-type constant.
 *   PART 2 — dedup ranks on real evidence, decoupled from the confidence label.
 *   PART 3 — triage confidenceSource + HealStore unverified sentinel (honesty markers).
 *
 * Framework: Node's built-in test runner (`node:test` + `node:assert/strict`),
 * run under tsx — zero new deps. The repo has no unit-test framework; its proof
 * convention is standalone `scripts/verify-*.ts`. This keeps the `verify-` prefix
 * and adds `.test.ts` so the runner picks it up.
 *
 * Run: npx tsx --test scripts/verify-td066.test.ts
 */
import { test } from 'node:test';
import assert   from 'node:assert/strict';
import * as os  from 'os';
import * as path from 'path';
import * as fs  from 'fs';
import { FlowDetector } from '../src/core/onboarding/FlowDetector';
import { parseResponse } from '../src/pipeline/ai-triage';
import type { FlowStep, FlowDefinition } from '../src/core/onboarding/types';

// deriveFlowConfidence / deduplicateFlows are private (TS-only) — reach them at
// runtime via a cast. deriveFlowConfidence uses only its args, not instance state.
const det = new FlowDetector(
  { nodes: new Map(), edges: [] } as any, [], [], {} as any, {} as any,
) as any;

// ── step builders ────────────────────────────────────────────────────────────
const observed = (i: number): FlowStep =>
  ({ stepIndex: i, pageId: `p${i}`, action: 'click', elementId: 'e', targetPageId: `t${i}`, value: null, grounding: 'observed' });
const inferred = (i: number): FlowStep =>
  ({ ...observed(i), grounding: 'inferred' });
const ungrounded = (i: number): FlowStep =>   // inferred-nav: no grounding field at all
  ({ stepIndex: i, pageId: `p${i}`, action: 'click', elementId: 'e', targetPageId: `t${i}`, value: null });
const apiStep = (i: number): FlowStep =>
  ({ stepIndex: i, pageId: `GET /x${i}`, action: 'api-call', elementId: null, targetPageId: null, value: `GET /x${i}` });

// ══ PART 1 — FlowConfidence derivation ════════════════════════════════════════

test('P1.1 SMOKING GUN: a 0-step flow never resolves above "unknown" (any path)', () => {
  // This is the exact old 0.99 defect (config-seeded checkout-happy-path, steps:[]).
  for (const p of ['config-seeded', 'agent-proposed', 'inferred-nav', 'api'] as const) {
    assert.equal(det.deriveFlowConfidence([], [], p), 'unknown', `0-step ${p} must be unknown`);
  }
});

test('P1.2 per-path derivation table (mirrors the migration-proven results)', () => {
  // agent-proposed: observed ONLY when every step observed AND zero warnings
  assert.equal(det.deriveFlowConfidence([observed(1), observed(2)], [], 'agent-proposed'), 'observed');
  // agent-proposed: ANY inferred step drops it out of observed
  assert.equal(det.deriveFlowConfidence([observed(1), inferred(2)], [], 'agent-proposed'), 'partial');
  // agent-proposed: >=1 warning drops it out of observed even if all steps observed
  assert.equal(det.deriveFlowConfidence([observed(1), observed(2)], ['w'], 'agent-proposed'), 'partial');
  // inferred-nav: steps exist but carry no grounding -> partial is the honest ceiling
  assert.equal(det.deriveFlowConfidence([ungrounded(1), ungrounded(2)], [], 'inferred-nav'), 'partial');
  // API: no detect-time verification signal -> unknown
  assert.equal(det.deriveFlowConfidence([apiStep(1)], [], 'api'), 'unknown');
  // config-seeded: no crawl evidence -> unknown (even hypothetical steps>0)
  assert.equal(det.deriveFlowConfidence([ungrounded(1)], [], 'config-seeded'), 'unknown');
});

test('P1.3 source-type alone never yields "observed" — only real evidence does', () => {
  // config-seeded / api can never be observed regardless of how good the steps look
  assert.notEqual(det.deriveFlowConfidence([observed(1), observed(2)], [], 'config-seeded'), 'observed');
  assert.notEqual(det.deriveFlowConfidence([observed(1), observed(2)], [], 'api'), 'observed');
  // inferred-nav (no grounding data) can never be observed either
  assert.notEqual(det.deriveFlowConfidence([ungrounded(1), ungrounded(2)], [], 'inferred-nav'), 'observed');
});

// ══ PART 2 — evidence dedup (ranking decoupled from the label) ═════════════════

// dedup collides flows whose id reduces to the same key (id.replace(/-\d+$/,'')).
const flow = (id: string, steps: FlowStep[], confidence: FlowDefinition['confidence']): FlowDefinition =>
  ({ id, displayName: id, confidence, source: 'agent-proposed', roleId: 'r', steps, linkedApiEndpointIds: [] });

test('P2.4 dedup ranks a grounded flow ABOVE a 0-step flow on a collision (reverse of old 0.99-wins)', () => {
  const zeroStep = flow('dup-1', [], 'unknown');
  const grounded = flow('dup-2', [observed(1), observed(2)], 'observed');
  // both ids reduce to key "dup" -> collision; grounded must win regardless of input order
  for (const input of [[zeroStep, grounded], [grounded, zeroStep]]) {
    const kept = det.deduplicateFlows(input) as FlowDefinition[];
    assert.equal(kept.length, 1);
    assert.equal(kept[0].id, 'dup-2', 'the grounded flow must win the collision');
  }
});

test('P2.5 dedup uses EVIDENCE, not the confidence label — a mislabelled flow cannot win on its label', () => {
  // Deliberately inconsistent labels vs evidence:
  //   z-1: label "observed" but steps all inferred (observedRatio 0)
  //   z-2: label "unknown"  but steps all observed  (observedRatio 1)
  const labelObservedButUngrounded = flow('z-1', [inferred(1), inferred(2)], 'observed');
  const labelUnknownButGrounded    = flow('z-2', [observed(1), observed(2)], 'unknown');
  const kept = det.deduplicateFlows([labelObservedButUngrounded, labelUnknownButGrounded]) as FlowDefinition[];
  assert.equal(kept.length, 1);
  // If dedup keyed on the enum, "observed"-labelled z-1 would win. Evidence-based
  // ranking keeps z-2 (real observed grounding) — proving decoupling.
  assert.equal(kept[0].id, 'z-2', 'the actually-grounded flow wins, not the "observed"-labelled one');
});

// ══ PART 3 — triage confidenceSource + heal sentinel ══════════════════════════

test('P3.6 triage confidenceSource: model vs fallback vs error path', () => {
  const t: any = { testTitle: 'x' };
  // model returned a confidence -> 'model'
  const modelR = parseResponse(JSON.stringify({ verdict: 'x', confidence: 'High', evidence: 'e', reasoning: 'r' }), t);
  assert.equal(modelR.confidence, 'High');
  assert.equal(modelR.confidenceSource, 'model');
  // model OMITTED confidence -> fallback 'Medium', source 'fallback'
  const omitR = parseResponse(JSON.stringify({ verdict: 'x', evidence: 'e', reasoning: 'r' }), t);
  assert.equal(omitR.confidence, 'Medium');
  assert.equal(omitR.confidenceSource, 'fallback');
  // ERROR path (parse failure) -> fallback 'Low', source 'fallback'
  const errR = parseResponse('not-json{{', t);
  assert.equal(errR.confidence, 'Low');
  assert.equal(errR.confidenceSource, 'fallback');
  // (The API-error path returns the identical literal `confidenceSource: 'fallback'`
  //  — same honesty marker, covered by this error-path proof + code inspection.)
});

test('P3.7 heal sentinel: strategy-chain -> -1 (not 1.0); vision -> real confidence (not 1.0)', async () => {
  // Isolated throwaway DB + store file — never touches prod (reports/heal-store.json).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'td066-heal-'));
  const tmpDb    = path.join(tmp, 'heal.db');
  const tmpStore = path.join(tmp, 'heal-store.json');
  process.env.DB_PATH          = tmpDb;
  process.env.HEAL_STORE_PATH  = tmpStore;         // must be set BEFORE HealStore loads
  process.env.CURRENT_RUN_ID   = 'td066-heal-run';

  // Dynamic import AFTER env is set (HealStore reads HEAL_STORE_PATH at module-load).
  const { runMigrations, closeDb } = await import('../src/core/storage');
  const { HealStoreManager }       = await import('../src/core/healing/HealStore');
  const BetterSqlite3              = (await import('better-sqlite3')).default;

  await runMigrations();
  const mgr = new HealStoreManager();
  const now = new Date().toISOString();
  // strategy-chain heal: NO real confidence
  mgr.recordHeal({ key: 'pageA::chainEl', timestamp: now, originalStrategy: 'id', healedStrategy: 'css', healedSelector: '.a', source: 'strategy-chain' });
  // vision heal: real confidence from the VisionHealer
  mgr.recordHeal({ key: 'pageA::visionEl', timestamp: now, originalStrategy: 'id', healedStrategy: 'css', healedSelector: '.b', source: 'vision', confidence: 0.95 });
  await mgr.save();
  await closeDb();

  // Read the ACTUAL persisted values straight from the throwaway DB.
  const raw = new BetterSqlite3(tmpDb, { readonly: true });
  const rows = raw.prepare("SELECT element, confidence FROM heal_events WHERE element IN ('chainEl','visionEl')").all() as Array<{ element: string; confidence: number }>;
  raw.close();

  const chain  = rows.find(r => r.element === 'chainEl')!;
  const vision = rows.find(r => r.element === 'visionEl')!;

  assert.equal(chain.confidence, -1,   'strategy-chain heal must persist the -1 unverified sentinel');
  assert.equal(vision.confidence, 0.95, 'vision heal must persist the real confidence');
  assert.notEqual(chain.confidence, 1.0,  'must NOT be the fabricated 1.0');
  assert.notEqual(vision.confidence, 1.0, 'must NOT be the fabricated 1.0');

  fs.rmSync(tmp, { recursive: true, force: true });
});
