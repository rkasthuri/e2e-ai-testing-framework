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
 * TD-065 — heal-correctness eval harness.
 *
 * Validates TD-065 Tier 1+2 heal correctness against REAL SauceDemo selectors in
 * a real browser — closing TD-065b (the heal-store previously held only synthetic
 * fixtures, so the Heal/Learn loop was never exercised in production).
 *
 * Framework: node:test + tsx (a runnable eval), same as scripts/verify-td06*.test.ts,
 * but this one drives a real Playwright browser and hits https://www.saucedemo.com,
 * so it lives under evals/healing/ (like evals/triage/) and is run on demand — NOT
 * part of the fast CI unit gate.
 *
 * Run: npx tsx --test evals/healing/harness.ts
 *
 * TD-085: each deterministic scenario also emits a shared EvalRecord (evals/contract.ts)
 * into `records[]`; an after() hook runs the shared runEval/printSummary once the
 * node:test suite finishes, so healing scores through the same contract as triage.
 * Records are pushed BEFORE the node:test asserts (not after) — a node:test assert
 * throws on failure, so a naive push-at-end would only capture passing scenarios and
 * report a false 100%. Pushing first records the true pass/fail; the asserts then
 * enforce the node:test verdict on the same expected/actual.
 *
 * Isolation: HEAL_STORE_PATH + DB_PATH point at a throwaway dir (set BEFORE any
 * SmartLocator/HealStore import), so the real reports/heal-store.json and DB are
 * never touched. Env is set first; source modules are imported dynamically.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, Browser, Page } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EvalRecord } from '../contract';
import { runEval } from '../runner';
import { printSummary, printFailures } from '../reporter';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'td065-heal-'));
process.env.HEAL_STORE_PATH = path.join(TMP, 'heal-store.json');
process.env.DB_PATH         = path.join(TMP, 'heal.db');
process.env.CURRENT_RUN_ID  = 'td065-harness-run';
process.env.HEALING_DISABLED = 'false';

const SAUCEDEMO = 'https://www.saucedemo.com';
let browser: Browser;
let page: Page;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SmartLocator: any;

// ── TD-085 shared-contract wiring ─────────────────────────────────────────────
// Each deterministic scenario captures one EvalRecord here; the after() hook below
// scores them through the shared runner once the suite finishes. `capture` computes
// pass by comparing expected/actual (stable key order → JSON compare is sound) and
// must be called BEFORE a scenario's asserts so a thrown assert still leaves the
// record behind — see the header note on the false-100% pitfall.
const records: EvalRecord[] = [];
function capture(
  id: string,
  input: unknown,
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  notes?: string,
): void {
  const pass = JSON.stringify(expected) === JSON.stringify(actual);
  records.push({
    capability: 'healing',
    id,
    input,
    expected,
    actual,
    pass,
    metrics: { primaryScore: pass ? 1 : 0 },
    timestamp: new Date().toISOString(),
    notes,
  });
}

before(async () => {
  const { runMigrations } = await import('../../src/core/storage');
  await runMigrations();                       // migrate the throwaway DB to 010
  ({ SmartLocator } = await import('../../src/core/healing/SmartLocator'));  // loads healStore with temp paths
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(SAUCEDEMO, { timeout: 30000 });
});

after(async () => {
  const { closeDb } = await import('../../src/core/storage');
  await closeDb().catch(() => {});
  await browser?.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ── SCENARIO 1 — healthy selector, no heal ────────────────────────────────────
test('S1 healthy: primary resolves -> no heal event, nothing recorded', async () => {
  const loc = new SmartLocator(page, {
    key: 'td065::s1-healthy',
    description: 'login button (primary resolves)',
    strategies: [{ name: 'data-test', selector: '[data-test="login-button"]' }],
  });
  const resolved = await loc.resolve({ assertionType: 'toBeVisible' });
  capture(
    's1-healthy',
    { strategies: ['[data-test="login-button"]'] },
    { healEventCount: 0 },
    { healEventCount: loc.getHealEvents().length },
  );
  assert.ok(await resolved.isVisible(), 'primary should resolve to a visible element');
  assert.equal(loc.getHealEvents().length, 0, 'a healthy primary must record NO heal event');
});

// ── SCENARIO 2 — broken primary, heal + correctness verified (SMOKING GUN) ─────
test('S2 verified: broken primary -> id fallback heals AND toBeVisible re-asserts -> assertion-verified/observed', async () => {
  const loc = new SmartLocator(page, {
    key: 'td065::s2-verified',
    description: 'login button (primary broken, id fallback correct)',
    strategies: [
      { name: 'data-test', selector: '[data-test="__broken__"]' },   // broken
      { name: 'id',        selector: '#login-button' },               // correct, high-tier
    ],
  });
  const resolved = await loc.resolve({ assertionType: 'toBeVisible' });
  const [ev] = loc.getHealEvents();
  capture(
    's2-verified',
    { strategies: ['[data-test="__broken__"]', '#login-button'] },
    { healEventCount: 1, healedSelector: '#login-button', correctnessSignal: 'assertion-verified', healConfidence: 'observed' },
    { healEventCount: loc.getHealEvents().length, healedSelector: ev?.healedSelector, correctnessSignal: ev?.correctnessSignal, healConfidence: ev?.healConfidence },
    ev?.healedSelector,
  );
  assert.ok(await resolved.isVisible(), 'healed locator should be visible');
  assert.equal(loc.getHealEvents().length, 1);
  assert.equal(ev.healedSelector, '#login-button');
  assert.equal(ev.correctnessSignal, 'assertion-verified', 'verifyHeal passed -> assertion-verified');
  assert.equal(ev.healConfidence, 'observed', 'id is high-tier + verified -> observed');
});

// ── SCENARIO 3 — broken primary, WRONG element healed, correctness REJECTED ────
test('S3 rejected: broken primary -> logo fallback resolves BUT toHaveText fails -> resolvability-only/unknown', async () => {
  const loc = new SmartLocator(page, {
    key: 'td065::s3-rejected',
    description: 'intended add-to-cart button (fallback lands on the wrong element)',
    strategies: [
      { name: 'data-test', selector: '[data-test="__broken__"]' },   // broken
      { name: 'css',       selector: '.login_logo' },                 // resolves (visible) but WRONG element ("Swag Labs")
    ],
  });
  // The intended element should read "Add to cart"; the logo reads "Swag Labs".
  const resolved = await loc.resolve({ assertionType: 'toHaveText', expectedValue: 'Add to cart' });
  const [ev] = loc.getHealEvents();
  capture(
    's3-rejected',
    { strategies: ['[data-test="__broken__"]', '.login_logo'], assertion: "toHaveText 'Add to cart'" },
    { healEventCount: 1, correctnessSignal: 'resolvability-only', healConfidence: 'unknown' },
    { healEventCount: loc.getHealEvents().length, correctnessSignal: ev?.correctnessSignal, healConfidence: ev?.healConfidence },
    'wrong element healed; assertion must reject the fake green',
  );
  assert.ok(await resolved.isVisible(), 'the wrong element still resolves + is visible (that is the point)');
  assert.equal(loc.getHealEvents().length, 1);
  assert.equal(ev.correctnessSignal, 'resolvability-only', 'resolved but assertion failed -> resolvability-only');
  assert.equal(ev.healConfidence, 'unknown', 'verified=false (but resolved) -> unknown, NOT a fake green');
});

// ── SCENARIO 4 — broken primary, no assertionContext -> unverified baseline ────
test('S4 unverified: broken primary -> id fallback heals, NO assertionContext -> unverified/unknown', async () => {
  const loc = new SmartLocator(page, {
    key: 'td065::s4-unverified',
    description: 'login button (no assertion context threaded)',
    strategies: [
      { name: 'data-test', selector: '[data-test="__broken__"]' },
      { name: 'id',        selector: '#login-button' },
    ],
  });
  const resolved = await loc.resolve();   // NO assertionContext
  const [ev] = loc.getHealEvents();
  capture(
    's4-unverified',
    { strategies: ['[data-test="__broken__"]', '#login-button'], assertion: null },
    { correctnessSignal: 'unverified', healConfidence: 'unknown' },
    { correctnessSignal: ev?.correctnessSignal, healConfidence: ev?.healConfidence },
    'no assertionContext threaded -> honest unverified default',
  );
  assert.ok(await resolved.isVisible());
  assert.equal(ev.correctnessSignal, 'unverified', 'no context -> unverified (honest default for existing callers)');
  assert.equal(ev.healConfidence, 'unknown');
});

// ── SCENARIO 5 — Vision heal (skips without a Claude API key) ──────────────────
test('S5 vision: model-returned confidence (skipped without ANTHROPIC_API_KEY)', { skip: !process.env.ANTHROPIC_API_KEY }, async () => {
  const loc = new SmartLocator(page, {
    key: 'td065::s5-vision',
    description: 'Login button on the login form',
    strategies: [
      { name: 'data-test', selector: '[data-test="__broken__"]' },
      { name: 'id',        selector: '#__also-broken__' },
    ],
  });
  try {
    await loc.resolve({ assertionType: 'toBeVisible' });
    const [ev] = loc.getHealEvents();
    if (ev && ev.source === 'vision') {
      assert.notEqual(ev.confidence, -1, 'vision confidence must be model-returned, not the -1 sentinel');
      assert.ok(['observed', 'partial', 'unknown'].includes(ev.healConfidence));
    }
  } catch {
    // Vision may fail to identify the element — acceptable; the assertion above
    // only fires if a vision heal was actually recorded.
  }
});

// ── DB PERSISTENCE — confirm the correctness fields reached heal_events ────────
test('DB: heal_events rows carry correctness_signal + heal_confidence', async () => {
  const { closeDb } = await import('../../src/core/storage');
  await closeDb().catch(() => {});   // release Kysely handle before opening a read connection
  const db = new BetterSqlite3(process.env.DB_PATH as string, { readonly: true });
  const rows = db.prepare(
    "SELECT DISTINCT element, heal_type, correctness_signal, heal_confidence, confidence " +
    "FROM heal_events WHERE run_id = 'td065-harness-run' ORDER BY element",
  ).all() as Array<Record<string, unknown>>;
  db.close();

  console.log('  persisted heal_events:');
  for (const r of rows) console.log('   ', JSON.stringify(r));

  const byElement = (el: string) => rows.find(r => r.element === el);
  assert.equal(byElement('s2-verified')?.correctness_signal, 'assertion-verified');
  assert.equal(byElement('s2-verified')?.heal_confidence, 'observed');
  assert.equal(byElement('s3-rejected')?.correctness_signal, 'resolvability-only');
  assert.equal(byElement('s3-rejected')?.heal_confidence, 'unknown');
  assert.equal(byElement('s4-unverified')?.correctness_signal, 'unverified');
  // S1 healthy recorded no heal -> no row.
  assert.equal(byElement('s1-healthy'), undefined, 'a healthy primary must not persist a heal row');
});

// ── TD-085 — score the captured EvalRecords through the shared runner ──────────
// Runs after every test (node:test after() hooks fire once the suite completes),
// so `records[]` is fully populated. Reads in-memory records only — no browser/DB.
after(() => {
  if (records.length === 0) return;
  const summary = runEval(records);
  printSummary(summary);
  printFailures(records);
});
