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
 * TD-110 — proof tests (ObservationSettlingPolicy, hydration-aware
 * detectAuthType, observation-driven authType correction).
 *
 * node:test + node:assert/strict under tsx. Pure in-memory — the Playwright
 * Page is faked with minimal structural mocks (only the methods each policy/
 * detector actually calls); the full live path is Step 6's E2E proof.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ObservationSettlingPolicy, DomcontentloadedPolicy, WaitForSelectorPolicy,
  NetworkIdlePolicy, ComposedPolicy,
} from '../src/core/onboarding/ObservationSettlingPolicy'
import { detectAuthType, applyAuthTypeObservation, BootstrapDetection } from '../src/core/onboarding/Bootstrap'
import { DEFAULT_SETTLING_POLICY } from '../src/core/onboarding/ObservationSettlingPolicy'

// ── fake pages (structural — only what each consumer calls) ───────────────────

/** A page whose password field exists from the start (static HTML app). */
function staticPage(passwordFields: number) {
  return {
    waitForSelector: async () => ({}),
    waitForLoadState: async () => {},
    locator: (_sel: string) => ({ count: async () => passwordFields }),
  } as any
}

/** A page that "hydrates" its password field only when settle() awaits it. */
function hydratingPage() {
  let hydrated = false
  return {
    waitForSelector: async () => { hydrated = true; return {} },   // evidence appears on wait
    locator: (_sel: string) => ({ count: async () => (hydrated ? 1 : 0) }),
  } as any
}

/** A page that never grows the selector — waitForSelector times out (rejects). */
function barePage() {
  return {
    waitForSelector: async () => { throw new Error('Timeout 3000ms exceeded') },
    waitForLoadState: async () => { throw new Error('Timeout exceeded') },
    locator: (_sel: string) => ({ count: async () => 0 }),
  } as any
}

function detectionWith(authType: BootstrapDetection['authType']): BootstrapDetection {
  const f = (v: string) => ({ value: v, confidence: 'high' as const, source: 'test' })
  return { appName: f('app'), renderingModel: f('framework-rendered'), crawlStrategy: f('auto'), authType, loginUrl: { value: null, confidence: 'medium', source: 'test' }, baseUrl: f('https://x') }
}

// ── T1-T5: settling policies ──────────────────────────────────────────────────

test('T1 DomcontentloadedPolicy: no-op, resolves immediately (never touches the page)', async () => {
  const trap = new Proxy({}, { get() { throw new Error('page must not be touched') } })
  await new DomcontentloadedPolicy().settle(trap as any)   // would throw if it touched anything
})

test('T2 WaitForSelectorPolicy: settles when the selector appears', async () => {
  let waited = false
  const page = { waitForSelector: async (sel: string) => { waited = true; assert.equal(sel, 'input[type="password"]'); return {} } } as any
  await new WaitForSelectorPolicy('input[type="password"]', 3000).settle(page)
  assert.equal(waited, true)
})

test('T3 WaitForSelectorPolicy: timeout logs and does NOT throw', async () => {
  const logs: string[] = []
  const origLog = console.log
  console.log = (...a: any[]) => { logs.push(a.join(' ')) }
  try {
    await new WaitForSelectorPolicy('input[type="password"]', 10).settle(barePage())   // must not throw
    assert.ok(logs.some(l => l.includes('not found within')), `timeout warning not logged: ${JSON.stringify(logs)}`)
  } finally { console.log = origLog }
})

test('T4 NetworkIdlePolicy: resolves on networkidle (and tolerates timeout without throwing)', async () => {
  let state = ''
  const page = { waitForLoadState: async (s: string) => { state = s } } as any
  await new NetworkIdlePolicy(5000).settle(page)
  assert.equal(state, 'networkidle')
  await new NetworkIdlePolicy(10).settle(barePage())   // timeout path — must not throw
})

test('T5 ComposedPolicy: runs all policies in sequence', async () => {
  const order: string[] = []
  const mk = (name: string): ObservationSettlingPolicy => ({ settle: async () => { order.push(name); return { observedMs: 0, ceilingMs: null, selector: null, timedOut: false, mechanism: name } } })
  await new ComposedPolicy([mk('one'), mk('two'), mk('three')]).settle({} as any)
  assert.deepEqual(order, ['one', 'two', 'three'])
})

// ── T6-T8: hydration-aware detectAuthType ─────────────────────────────────────

test('T6 DEFAULT policy + static password field → form-login, derived MEDIUM (ADR-020 §4)', async () => {
  const r = await detectAuthType(staticPage(1), DEFAULT_SETTLING_POLICY)
  assert.equal(r.value, 'form-login')
  assert.equal(r.confidence, 'medium')           // ADR-020 §4: single pre-auth sample caps at medium (was 'high')
  assert.equal(r.source, 'evidence-matched')     // a positive signal was observed (was free-string 'password-field-count')
  assert.match(r.reason ?? '', /password field/i)      // reason names the specific evidence…
  assert.match(r.reason ?? '', /domcontentloaded/i)    // …and the method label (DEFAULT policy → no-wait mechanism)
})

test('T7 THE FIX: field appears only after settling → form-login (was misdetected none)', async () => {
  // Contrast on fresh hydrating pages: the pre-fix path (no settling) reads
  // the unhydrated 0 → none; the settled path waits for evidence → form-login.
  const unsettled = await detectAuthType(hydratingPage(), DEFAULT_SETTLING_POLICY)
  assert.equal(unsettled.value, 'unknown', 'pre-fix path reads the unhydrated 0 → unknown floor (TD-166), not none')
  const settled = await detectAuthType(hydratingPage(), new WaitForSelectorPolicy('input[type="password"]', 3000))
  assert.equal(settled.value, 'form-login')
  assert.equal(settled.confidence, 'medium')   // ADR-020 §4: single pre-auth sample caps at medium (was 'high')
})

test('T8 no password field within the ceiling → unknown at the FLOOR (TD-166/TD-173: a bounded non-observation is not "no auth")', async () => {
  const r = await detectAuthType(barePage(), new WaitForSelectorPolicy('input[type="password"]', 10))
  // TD-166 auth-settling package: an absence WITHIN A BOUNDED WINDOW is not evidence of 'no
  // auth' — the selector simply wasn't seen in time (slow-hydrating SPA / SSO read zero here).
  // The floor is now 'unknown'/'unknown' + 'default-fallback', NEVER a false 'none' (TD-173
  // asymmetry). generateConfig maps 'unknown' → operational 'none' for the config only.
  assert.equal(r.value, 'unknown')
  assert.equal(r.confidence, 'unknown')
  assert.equal(r.source, 'default-fallback')
  assert.match(r.reason ?? '', /not evidence of 'no auth'/i)
})

// ── T9-T10: Fix 2 — observation corrects authType; outcome stays independent ──

test('T9 observed login control corrects authType none → form-login/medium (source evidence-matched)', () => {
  const d = detectionWith({ value: 'none', confidence: 'low', source: 'default-fallback' })   // input reflects the new 'none' floor
  const corrected = applyAuthTypeObservation(d, true)
  assert.equal(corrected, true)
  assert.equal(d.authType.value, 'form-login')
  assert.equal(d.authType.confidence, 'medium')        // observed, not verified → medium (unchanged)
  assert.equal(d.authType.source, 'evidence-matched')  // was the free-string 'agent-observation:login-control-seen'
  assert.match(d.authType.reason ?? '', /observed, not directly verified/i)
})

test('T9b no observation → no correction; existing form-login/high → never touched (no downgrade)', () => {
  const none = detectionWith({ value: 'none', confidence: 'medium', source: 'password-field-count' })
  assert.equal(applyAuthTypeObservation(none, false), false)
  assert.equal(none.authType.value, 'none')

  const high = detectionWith({ value: 'form-login', confidence: 'high', source: 'password-field-count' })
  assert.equal(applyAuthTypeObservation(high, true), false)
  assert.deepEqual(high.authType, { value: 'form-login', confidence: 'high', source: 'password-field-count' })
})

test('T10 independence: observation grants MEDIUM only — high still requires goal achievement', () => {
  // The observation path (authType fact) must not manufacture the result-level
  // confidence: a corrected detection sits at medium; 'high' comes only from
  // the achieved-goal upgrade in runAgentPhase (authOutcome's side of the wall).
  const d = detectionWith({ value: 'none', confidence: 'medium', source: 'password-field-count' })
  applyAuthTypeObservation(d, true)
  assert.equal(d.authType.confidence, 'medium')
  assert.notEqual(d.authType.confidence, 'high')
})
