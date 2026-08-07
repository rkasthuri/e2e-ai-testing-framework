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
 * TD-132 — proof tests (AI naming budget sizing + FlowDetector reserve).
 *
 * node:test + node:assert/strict under tsx. T1-T7 exercise the pure budget
 * functions (production code, not re-implementations). T8 constructs a real
 * Crawler and inspects its two trackers to prove naming can't starve flow.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_AI_BUDGET, FLOW_DETECTOR_RESERVE, DEFAULT_CLASSIFICATION_BUDGET, MIN_AI_BUDGET,
  namingBudget, flowBudget, effectiveAiBudget, makeBudgetTracker,
} from '../src/core/config/budgetDefaults'
import { Crawler } from '../src/core/onboarding/Crawler'

// ── T1-T5: constants + pure budget split ──────────────────────────────────────

test('T1 DEFAULT_AI_BUDGET === 150', () => {
  assert.equal(DEFAULT_AI_BUDGET, 150)
})

test('T2 FLOW_DETECTOR_RESERVE === 10', () => {
  assert.equal(FLOW_DETECTOR_RESERVE, 10)
})

test('T3 namingBudget(150) === 140 (total − reserve)', () => {
  assert.equal(namingBudget(150), 140)
})

test('T4 flowBudget(150) === 10 (the reserve, independent of total)', () => {
  assert.equal(flowBudget(150), 10)
  assert.equal(flowBudget(999), 10)
})

test('T5 namingBudget(0) === 0 (never negative)', () => {
  assert.equal(namingBudget(0), 0)
  assert.equal(namingBudget(5), 0)   // 5 − 10 floored at 0
})

// ── T6-T7: dynamic sizing formula (extracted, production code) ────────────────

test('T6 effectiveAiBudget: min(userBudget, max(MIN, maxPages×2)) — the formula', () => {
  // maxPages=43, userBudget=150 → min(150, max(50, 86)) = 86
  assert.equal(effectiveAiBudget(150, 43), 86)
  // tiny crawl floored at MIN_AI_BUDGET
  assert.equal(effectiveAiBudget(150, 5), MIN_AI_BUDGET)   // min(150, max(50, 10)) = 50
  // large crawl capped at userBudget
  assert.equal(effectiveAiBudget(150, 100), 150)           // min(150, max(50, 200)) = 150
})

test('T7 --ai-budget override raises the ceiling above the default', () => {
  // 100-page app: default caps at 150; --ai-budget=200 lifts it to 200.
  assert.equal(effectiveAiBudget(DEFAULT_AI_BUDGET, 100), 150)
  assert.equal(effectiveAiBudget(200, 100), 200)
  assert.ok(effectiveAiBudget(200, 100) > effectiveAiBudget(DEFAULT_AI_BUDGET, 100),
    'raising userBudget must raise the effective budget when pages demand it')
})

// ── T8: Crawler builds SEPARATE naming + flow trackers ────────────────────────

test('T8 Crawler: naming and flow are separate trackers — exhausting naming leaves flow intact', () => {
  const cfg = {
    app:   { name: 'x', baseUrl: 'https://x.com', appType: 'web-ui' },
    roles: [],
    budgets: { aiCalls: 20, maxPages: 10, maxDepth: 5 },   // naming=10, flow=10
  } as any
  const crawler = new Crawler(cfg)
  const naming = (crawler as any).namingTracker
  const flow   = (crawler as any).flowTracker

  assert.equal(naming.remaining, namingBudget(20))   // 10
  assert.equal(flow.remaining, flowBudget(20))        // 10

  // Drain naming completely.
  while (!naming.isExhausted()) naming.consume(1)
  assert.equal(naming.isExhausted(), true)

  // Flow is untouched — naming can no longer starve it (TD-132 defect #2).
  assert.equal(flow.isExhausted(), false)
  assert.equal(flow.remaining, 10)
})

// ── bonus: Pool B constant is decoupled + factory sanity ──────────────────────

test('T9 DEFAULT_CLASSIFICATION_BUDGET stays 50 (Pool B untouched) + factory works', () => {
  assert.equal(DEFAULT_CLASSIFICATION_BUDGET, 50)
  const t = makeBudgetTracker(3, 'run1', 'appX')
  assert.equal(t.remaining, 3)
  assert.equal(t.runId, 'run1')
  assert.equal(t.consume(3), true)
  assert.equal(t.isExhausted(), true)
  assert.equal(t.consume(1), false)   // exhausted → refuses
})
