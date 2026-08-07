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
 * TD-065 — unit proof test (pure logic; no browser, no network, no live app).
 *
 * Guards the heal-correctness derivation + forgeExpect dispatch by-construction:
 *   PART 1 — deriveHealConfidence: evidence-tier from verified + strategy tier / vision confidence.
 *   PART 2 — deriveCorrectnessSignal: assertion-verified | resolvability-only | unverified.
 *   PART 3 — forgeExpect dispatch: SmartLocator (branded) -> heal facade; Page/raw Locator -> pass-through.
 *
 * The live end-to-end proof (real heal on SauceDemo) lives in
 * experiments/td-065-healing/harness.ts; this is the fast, browser-free guard that
 * runs in the CI test:unit gate. Framework: node:test + node:assert/strict under tsx.
 * Run: npx tsx --test scripts/verify-td065.test.ts
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Importing SmartLocator loads the healStore singleton, which reads its store file
// at module-load — point it at a throwaway path so this test never touches the real
// reports/heal-store.json. Set BEFORE any dynamic import below.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'td065-unit-'));
process.env.HEAL_STORE_PATH = path.join(TMP, 'heal-store.json');

const loadDerive = () => import('../src/core/healing/SmartLocator');
const loadForge  = () => import('../src/core/healing/forgeExpect');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// ══ PART 1 — deriveHealConfidence ═════════════════════════════════════════════

test('P1.1 verified + high-tier (data-test) -> observed', async () => {
  const { deriveHealConfidence } = await loadDerive();
  assert.equal(deriveHealConfidence(true, 'data-test'), 'observed');
  // vacuity: old behavior had no tier distinction (numeric 1.0) — a 'partial'
  // here would be caught: assert.equal('partial','observed') throws.
});

test('P1.2 verified + low-tier (text) -> partial', async () => {
  const { deriveHealConfidence } = await loadDerive();
  assert.equal(deriveHealConfidence(true, 'text'), 'partial');
});

test('P1.3 resolved but NOT verified -> unknown (no fake green)', async () => {
  const { deriveHealConfidence } = await loadDerive();
  assert.equal(deriveHealConfidence(false, 'id'), 'unknown');
  // vacuity: old fake-green returned success for any resolve — an 'observed'
  // here would be caught: assert.equal('observed','unknown') throws.
});

test('P1.4 vision 0.92 + verified -> observed', async () => {
  const { deriveHealConfidence } = await loadDerive();
  assert.equal(deriveHealConfidence(true, 'css', 0.92), 'observed');
});

test('P1.5 vision 0.92 + NOT verified -> partial', async () => {
  const { deriveHealConfidence } = await loadDerive();
  assert.equal(deriveHealConfidence(false, 'css', 0.92), 'partial');
});

test('P1.6 vision 0.5 (below 0.8 threshold) -> unknown', async () => {
  const { deriveHealConfidence } = await loadDerive();
  assert.equal(deriveHealConfidence(true, 'css', 0.5), 'unknown');
});

// ══ PART 2 — deriveCorrectnessSignal ══════════════════════════════════════════

test('P2.1 verified -> assertion-verified', async () => {
  const { deriveCorrectnessSignal } = await loadDerive();
  assert.equal(deriveCorrectnessSignal(true, { assertionType: 'toBeVisible' }), 'assertion-verified');
});

test('P2.2 context present + NOT verified -> resolvability-only', async () => {
  const { deriveCorrectnessSignal } = await loadDerive();
  assert.equal(deriveCorrectnessSignal(false, { assertionType: 'toHaveText', expectedValue: 'Add to cart' }), 'resolvability-only');
  // vacuity: the S3 fake-green case — old behavior would call this success;
  // an 'assertion-verified' here would be caught: assert.equal('assertion-verified','resolvability-only') throws.
});

test('P2.3 context absent -> unverified', async () => {
  const { deriveCorrectnessSignal } = await loadDerive();
  assert.equal(deriveCorrectnessSignal(false, undefined), 'unverified');
});

// ══ PART 3 — forgeExpect dispatch ═════════════════════════════════════════════

test('P3.1 raw Locator -> pass-through (not the heal facade)', async () => {
  const { forgeExpect } = await loadForge();
  const rawLocator: any = { locator: () => rawLocator };   // no __isSmartLocator brand
  const r = forgeExpect(rawLocator);
  assert.notEqual(r?.constructor?.name, 'ForgeLocatorAssertion');
});

test('P3.2 branded SmartLocator -> ForgeLocatorAssertion (heal path)', async () => {
  const { forgeExpect } = await loadForge();
  const smart: any = { __isSmartLocator: true, resolve: async () => ({}) };
  const r = forgeExpect(smart);
  assert.equal(r?.constructor?.name, 'ForgeLocatorAssertion');
  assert.equal(typeof r.toBeVisible, 'function');
});

test('P3.3 Page -> pass-through (not the heal facade)', async () => {
  const { forgeExpect } = await loadForge();
  const pageMock: any = { goto: () => {}, url: () => 'x' };   // no brand
  const r = forgeExpect(pageMock);
  assert.notEqual(r?.constructor?.name, 'ForgeLocatorAssertion');
});
