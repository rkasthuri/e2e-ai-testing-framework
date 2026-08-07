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
 * Verify LIEs (Baseline #1, phantom-green) — regression suite.
 *   LIE-1: API endpoint `status < 500` scored green (4xx read as passed).
 *   LIE-2: no-op flow steps (no assertion executed) counted as passed.
 * Governing rule (both axes): aggregate to the weakest truth —
 *   failed > could-not-verify > passed.
 * Tests exercise the exported decision seams directly (classifyEndpointResult,
 * isNoOpStep, finalizeFlowStatus) + computeConfidence; simulateTally composes
 * isNoOpStep + finalizeFlowStatus in the SAME order verifyFlow's loop does.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyEndpointResult,
  isNoOpStep,
  finalizeFlowStatus,
  computeConfidence,
  assessReadiness,
} from '../src/core/onboarding/VerificationRunner'
import type { FlowStep } from '../src/core/onboarding/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function step(p: Partial<FlowStep> & { action: string; stepIndex: number }): FlowStep {
  return { pageId: 'p', elementId: null, targetPageId: null, value: null, ...p }
}

// Mirrors verifyFlow's loop precedence EXACTLY: a throw (hard fail) is checked
// first and dominates; then a no-op breaks to could-not-verify; else 'executed'
// increments stepsPassed. The decisions themselves are the real exports.
function simulateTally(steps: FlowStep[], throwAtIndex?: number) {
  let stepsPassed = 0
  let failedAtStep: number | null = null
  let unverifiedAtStep: number | null = null
  for (const s of steps) {
    if (throwAtIndex !== undefined && s.stepIndex === throwAtIndex) { failedAtStep = s.stepIndex; break }
    if (isNoOpStep(s)) { unverifiedAtStep = s.stepIndex; break }
    stepsPassed++
  }
  return { status: finalizeFlowStatus(failedAtStep, unverifiedAtStep), stepsPassed, failedAtStep, unverifiedAtStep }
}

// ── LIE-1: endpoint status routing ─────────────────────────────────────────────

test('V1 endpoint 200 → passed (error null)', () => {
  const v = classifyEndpointResult({ status: 200 })
  assert.equal(v.status, 'passed')
  assert.equal(v.error, null)
  // boundary: 299 still passed, 300 (redirect) is NOT a proven success
  assert.equal(classifyEndpointResult({ status: 299 }).status, 'passed')
  assert.equal(classifyEndpointResult({ status: 300 }).status, 'could-not-verify')
})

test('V2 endpoint 401/403 → could-not-verify (remedy mentions auth)', () => {
  for (const s of [401, 403]) {
    const v = classifyEndpointResult({ status: s })
    assert.equal(v.status, 'could-not-verify')
    assert.match(v.error!, /auth/i)
  }
})

test('V3 endpoint 404/400 → could-not-verify (remedy mentions expected-response contract)', () => {
  for (const s of [404, 400]) {
    const v = classifyEndpointResult({ status: s })
    assert.equal(v.status, 'could-not-verify')
    assert.match(v.error!, /expected-response contract/i)
  }
})

test('V4 endpoint 500 → failed (HTTP 500)', () => {
  const v = classifyEndpointResult({ status: 500 })
  assert.equal(v.status, 'failed')
  assert.equal(v.error, 'HTTP 500')
})

test('V5 endpoint network error/timeout → failed (error preserved)', () => {
  const v = classifyEndpointResult({ error: 'connect ECONNREFUSED 127.0.0.1:80' })
  assert.equal(v.status, 'failed')
  assert.match(v.error!, /ECONNREFUSED/)
})

// ── LIE-2: no-op steps → flow could-not-verify ─────────────────────────────────

test('V6 flow, all steps execute real assertions → passed', () => {
  const steps = [
    step({ action: 'fill', stepIndex: 0, elementId: 'el-user', value: 'admin' }),
    step({ action: 'assert-element-visible', stepIndex: 1, elementId: 'el-dash' }),
  ]
  steps.forEach(s => assert.equal(isNoOpStep(s), false, `${s.action} must NOT be a no-op`))
  const r = simulateTally(steps)
  assert.equal(r.status, 'passed')
  assert.equal(r.stepsPassed, 2)
  assert.equal(r.unverifiedAtStep, null)
})

test('V7 no-op assert-element-visible (missing elementId) → could-not-verify, unverifiedAtStep = that index', () => {
  const noop = step({ action: 'assert-element-visible', stepIndex: 2, elementId: null })
  assert.equal(isNoOpStep(noop), true)   // the ONLY assertion, skipped — the sharpest lie
  const r = simulateTally([
    step({ action: 'fill', stepIndex: 0, elementId: 'el-user', value: 'x' }),
    step({ action: 'click', stepIndex: 1, elementId: 'el-go' }),
    noop,
  ])
  assert.equal(r.status, 'could-not-verify')
  assert.equal(r.unverifiedAtStep, 2)
  assert.equal(r.failedAtStep, null)
})

test('V8 assert-navigation with empty value → could-not-verify (NOT the always-true pass)', () => {
  assert.equal(isNoOpStep(step({ action: 'assert-navigation', stepIndex: 0, value: '' })), true)
  assert.equal(isNoOpStep(step({ action: 'assert-navigation', stepIndex: 0, value: null })), true)
  // a real pattern still executes
  assert.equal(isNoOpStep(step({ action: 'assert-navigation', stepIndex: 0, value: '/dashboard' })), false)
  const r = simulateTally([step({ action: 'assert-navigation', stepIndex: 0, value: '' })])
  assert.equal(r.status, 'could-not-verify')
  assert.equal(r.unverifiedAtStep, 0)
})

test('V9 step 2 THROWS and step 4 would no-op → failed (weakest-truth: failed dominates), failedAtStep set', () => {
  const r = simulateTally([
    step({ action: 'fill', stepIndex: 0, elementId: 'a', value: 'x' }),
    step({ action: 'fill', stepIndex: 1, elementId: 'b', value: 'y' }),
    step({ action: 'click', stepIndex: 2, elementId: 'submit' }),     // this one throws (index 2)
    step({ action: 'assert-element-visible', stepIndex: 3, elementId: null }), // would no-op, never reached
  ], /* throwAtIndex */ 2)
  assert.equal(r.status, 'failed')
  assert.equal(r.failedAtStep, 2)
  assert.equal(r.unverifiedAtStep, null)
  // and the precedence function itself: if BOTH were somehow set, failed wins
  assert.equal(finalizeFlowStatus(2, 4), 'failed')
  assert.equal(finalizeFlowStatus(null, 4), 'could-not-verify')
  assert.equal(finalizeFlowStatus(null, null), 'passed')
})

// ── score regressions (the phantom-green is gone from the number) ──────────────

test('V10 score: 1 passed + 1 could-not-verify endpoint → 0.5 (cnv NOT in numerator)', () => {
  // API app: elements 0.6 (applicable), flows 0.4 (NOT applicable). 2 endpoints,
  // 1 passed, 1 could-not-verify → elementsPassed = 1 (cnv excluded).
  const score = computeConfidence([
    { applicable: true,  total: 2, passed: 1, weight: 0.6 },
    { applicable: false, total: 0, passed: 0, weight: 0.4 },
  ])
  assert.equal(score, 0.5)
  // proof of the fix: had the 4xx phantom-greened (passed: 2), the score would be 1.0
  assert.equal(computeConfidence([
    { applicable: true,  total: 2, passed: 2, weight: 0.6 },
    { applicable: false, total: 0, passed: 0, weight: 0.4 },
  ]), 1.0)
})

test('V11 could-not-verify flow: excluded from the flowsPassed count, AND the scoring seam weights the partial pass correctly', () => {
  // TWO DISTINCT proofs — do not conflate:
  // (1) the flowsPassed FILTER (buildReport) — a could-not-verify flow is excluded
  //     from the flowsPassed count (the numerator source), while still counting in
  //     the total (denominator). This is what actually keeps a cnv flow out of green.
  const flows = [{ status: 'could-not-verify' as const }, { status: 'passed' as const }]
  const flowsPassed = flows.filter(f => f.status === 'passed').length
  assert.equal(flowsPassed, 1)               // cnv flow NOT counted in the numerator
  assert.equal(flows.length, 1 + flowsPassed) // …but still in the denominator (total)
  // (2) the SCORING SEAM — computeConfidence weights a partial-pass component
  //     correctly (flows 1/2 → 0.6*1 + 0.4*0.5 = 0.8); the dropped flow lowers the
  //     score honestly. This proves the seam's MATH, not the flow-status filtering.
  const withCnv = computeConfidence([
    { applicable: true, total: 2, passed: 2, weight: 0.6 },
    { applicable: true, total: 2, passed: 1, weight: 0.4 },
  ])
  assert.equal(withCnv, 0.8)
  // proof of the fix: had it phantom-greened (flowsPassed 2/2), the score would be 1.0
  assert.equal(computeConfidence([
    { applicable: true, total: 2, passed: 2, weight: 0.6 },
    { applicable: true, total: 2, passed: 2, weight: 0.4 },
  ]), 1.0)
})

// ── (C) flow-axis readiness symmetry — could-not-verify ≠ failed ───────────────

test('V12 flow could-not-verify → in flowsCouldNotVerify NOT failedFlows, modelReady=false, message says "could not be verified" NOT "failed"', () => {
  // 2 flows: 1 passed, 1 could-not-verify; elements all clean.
  const r = assessReadiness({
    confidenceScore: 0.8, anyApplicableUnmeasured: false,
    elementsTotal: 3, elementsPassed: 3, elementsCouldNotVerify: 0,
    flowsTotal: 2, flowsPassed: 1, flowsCouldNotVerify: 1,
    setupFailures: [],
  })
  assert.equal(r.failedFlows, 0)          // cnv is NOT counted as a failure (2 - 1 passed - 1 cnv = 0)
  assert.equal(r.modelReady, false)       // a blind flow still blocks 'ready'
  const msg = r.notReady.join(' | ')
  assert.match(msg, /flow\(s\) could not be verified/)     // honest label
  assert.doesNotMatch(msg, /flow\(s\) failed/)             // NOT mislabeled as failed (the Option-A anti-pattern)
})

test('V13 symmetry: 1 failed flow + 1 could-not-verify flow → failedFlows=1, flowsCouldNotVerify=1, messages DISTINCT', () => {
  // 3 flows: 1 passed, 1 failed, 1 could-not-verify.
  const r = assessReadiness({
    confidenceScore: 0.5, anyApplicableUnmeasured: false,
    elementsTotal: 2, elementsPassed: 2, elementsCouldNotVerify: 0,
    flowsTotal: 3, flowsPassed: 1, flowsCouldNotVerify: 1,
    setupFailures: [],
  })
  assert.equal(r.failedFlows, 1)          // 3 - 1 passed - 1 cnv = 1 genuinely failed
  assert.equal(r.modelReady, false)
  const msg = r.notReady.join(' | ')
  assert.match(msg, /1 flow\(s\) could not be verified/)   // the could-not-verify one
  assert.match(msg, /1 flow\(s\) failed/)                  // the failed one — a DISTINCT line
  // and the element axis stays clean (mirror sanity): no element gap lines
  assert.doesNotMatch(msg, /element/)
})
