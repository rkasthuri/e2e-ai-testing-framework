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
 * TD-166 auth-settling package — BOUNDED THRESHOLD MITIGATION ONLY.
 * This raises the observation ceiling to 10s, records the auth-surface observation, flags when it
 * exceeds a PROVISIONAL 3s expectation, and floors a bounded non-observation to 'unknown' (never a
 * false 'none'). It does NOT resolve the multi-writer authType ownership defect — M7 (containment)
 * deliberately demonstrates the divergence path STILL EXISTS so the unresolved defect stays visible.
 * Run: npx tsx --test scripts/verify-td166-auth-settling.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectAuthType, applyAuthTypeObservation, BootstrapDetection, DetectedField,
} from '../src/core/onboarding/Bootstrap'
import {
  SPA_AUTH_SETTLING_POLICY, ObservationSettlingPolicy, SettleObservation,
} from '../src/core/onboarding/ObservationSettlingPolicy'

const mockPage = (pwCount: number) => ({
  locator: (sel: string) => ({ count: async () => (sel.includes('password') ? pwCount : 0) }),
}) as any

// A policy that REPORTS a chosen observation, to drive ms/ceiling/timedOut deterministically.
const reporting = (o: Partial<SettleObservation>): ObservationSettlingPolicy => ({
  settle: async () => ({
    observedMs: 0, ceilingMs: 10000, selector: 'input[type="password"]', timedOut: false,
    mechanism: 'waited up to 10000ms for the input[type="password"] selector', ...o,
  }),
})

const authField = (value: string, confidence: any, source: string): BootstrapDetection => ({
  appName:       { value: 'x', confidence: 'medium', source: 's' },
  renderingModel:{ value: 'unknown', confidence: 'unknown', source: 's' },
  crawlStrategy: { value: 'bfs', confidence: 'low', source: 's' },
  authType:      { value, confidence, source } as DetectedField<string>,
  loginUrl:      { value: null, confidence, source: 's' },
  baseUrl:       { value: 'https://x', confidence: 'high', source: 'user-supplied' },
})

// ── #1 ceiling raised to 10s; method label is a TIMER, never "settled" (Nova R2) ──
test('M1 SPA_AUTH_SETTLING_POLICY ceiling is 10000ms; mechanism reads as a timer, never "settled"', async () => {
  const fastPage = { waitForSelector: async () => {} } as any   // selector present → returns fast, no 10s wait
  const obs = await SPA_AUTH_SETTLING_POLICY.settle(fastPage)
  assert.equal(obs.ceilingMs, 10000)
  assert.equal(obs.selector, 'input[type="password"]')
  assert.match(obs.mechanism, /waited up to 10000ms for the input\[type="password"\] selector/)
  assert.doesNotMatch(obs.mechanism, /settl/i)   // a timer is not settlement
})

// ── #2 the observation is recorded in signals (authoritative artifact) ──
test('M2 detectAuthType records the auth-surface observation in signals', async () => {
  const r = await detectAuthType(mockPage(1), reporting({ observedMs: 1500 }))
  assert.equal(r.value, 'form-login')
  assert.equal(r.signals?.authSurfaceObservationMs, 1500)
  assert.equal(r.signals?.authSurfaceObservationCeilingMs, 10000)
  assert.equal(r.signals?.authSurfaceObservationThresholdMs, 3000)   // provisional expectation
  assert.equal(r.signals?.authSurfaceObservationExceededExpectation, 0)   // 1500 <= 3000
  assert.match(r.reason ?? '', /observed after 1500ms/)
})

// ── #3 exceeded flag fires above the provisional 3s expectation ──
test('M3 observation past the 3s provisional expectation → exceeded flag = 1 (flagged, not a failure)', async () => {
  const r = await detectAuthType(mockPage(1), reporting({ observedMs: 5000 }))
  assert.equal(r.signals?.authSurfaceObservationExceededExpectation, 1)   // 5000 > 3000
  assert.equal(r.value, 'form-login')                                     // still a valid detection, not a failure
  assert.match(r.reason ?? '', /EXCEEDED the 3000ms provisional expectation/)
})

// ── #4 timeout → 'unknown', never 'none' (TD-173 asymmetry) ──
test('M4 no password field within the ceiling → unknown/unknown, never none; label is a timer', async () => {
  const r = await detectAuthType(mockPage(0), reporting({ observedMs: 10000, timedOut: true }))
  assert.equal(r.value, 'unknown')
  assert.equal(r.confidence, 'unknown')
  assert.notEqual(r.value, 'none')
  assert.match(r.reason ?? '', /not evidence of 'no auth'/i)
  assert.match(r.reason ?? '', /waited up to 10000ms/)
  assert.doesNotMatch(r.reason ?? '', /settl/i)
})

// ── The guard fix: correct from BOTH 'none' and 'unknown' (TD-110 containment) ──
test('M5 applyAuthTypeObservation corrects from BOTH none AND unknown; never touches form-login', () => {
  const fromNone = authField('none', 'low', 'default-fallback')
  assert.equal(applyAuthTypeObservation(fromNone, true), true)
  assert.equal(fromNone.authType.value, 'form-login')

  const fromUnknown = authField('unknown', 'unknown', 'default-fallback')   // the NEW floor
  assert.equal(applyAuthTypeObservation(fromUnknown, true), true, 'TD-110 correction must fire for the unknown floor')
  assert.equal(fromUnknown.authType.value, 'form-login')

  const positive = authField('form-login', 'high', 'password-field-count')
  assert.equal(applyAuthTypeObservation(positive, true), false, 'a positive detection is never downgraded')
  assert.equal(positive.authType.value, 'form-login')
})

// ── #7 CONTAINMENT — the multi-writer divergence is UNRESOLVED and must stay visible ──
test('M7 CONTAINMENT (TD-166 stays OPEN): the same non-observation yields DIFFERENT persisted authType by path', async () => {
  // Static path (no agent correction): a bounded non-observation floors to 'unknown'.
  const staticOnly = await detectAuthType(mockPage(0), reporting({ observedMs: 10000, timedOut: true }))
  assert.equal(staticOnly.value, 'unknown')

  // Agent path (correction fires when a login control was observed): SAME input, DIFFERENT value.
  const agentPath = authField(staticOnly.value, staticOnly.confidence, staticOnly.source)
  applyAuthTypeObservation(agentPath, true)
  assert.equal(agentPath.authType.value, 'form-login')

  // The persisted authType therefore still depends on WHETHER the agent ran — the multi-writer
  // ownership defect TD-166 describes. This mitigation bounds the timing window; it does NOT make
  // the value single-source. If this ever asserts equal, TD-166's divergence was silently closed.
  assert.notEqual(staticOnly.value, agentPath.authType.value)
})
