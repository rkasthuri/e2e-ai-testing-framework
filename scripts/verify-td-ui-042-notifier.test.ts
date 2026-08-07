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
 * TD-UI-042 (CRITICAL) — the notifier must never tell a human "no failures" on a
 * run that failed. RunFailure is reconstructed from the ai_triage rows already
 * held (test_id + failure_category); a failed run with no enumerable detail says
 * so + carries the remedy; and the two lie-strings ("No failures detected" /
 * "• None") are asserted ABSENT on a failing run in BOTH renderers — so the build
 * fails if the lie is ever reintroduced. node:test (pure render helpers; no send).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSlackBlocks, emailHtml, reconstructFailures, parseTestId } from '../src/pipeline/notifier'

const RF = (over: Record<string, unknown> = {}) =>
  ({ testTitle: 't', file: 'f', browser: 'chromium', verdict: 'app-bug', errorMessage: 'e', ...over })

const mk = (over: Record<string, unknown> = {}): any => ({
  level: 'critical', passRate: '80.0%', totalTests: 10, passed: 8, failed: 2, flaky: 0,
  bugs: 0, testDefects: 0, flakyCount: 0, needsReview: 0,
  failures: [], failuresUnavailable: false, runId: 'run-1', branch: 'main',
  durationMs: 1000, healthScore: 80, trend: 'Stable', ...over,
})

const both = (p: any) => [emailHtml(p), JSON.stringify(buildSlackBlocks(p))]

test('N1 reconstruct + enumerate — test_id + failure_category → title/browser/verdict, in BOTH renderers', () => {
  const rebuilt = reconstructFailures([
    { test_id: 'tests/cart.spec.ts::adds item to cart::chromium', failure_category: 'app-bug', root_cause: 'HTTP 500' },
  ])
  assert.equal(rebuilt[0].testTitle, 'adds item to cart')
  assert.equal(rebuilt[0].browser, 'chromium')
  assert.equal(rebuilt[0].verdict, 'app-bug')

  const p = mk({ level: 'critical', failed: 1, bugs: 1, failures: rebuilt })
  for (const out of both(p)) {
    assert.ok(out.includes('adds item to cart'), 'title must render')
    assert.ok(out.includes('app-bug'), 'verdict must render')
  }
})

test('N2 clean run (failed 0, bugs 0) → "No failures detected" is honest and preserved (email)', () => {
  const p = mk({ level: 'info', failed: 0, passed: 10, bugs: 0, failures: [], failuresUnavailable: false })
  assert.ok(emailHtml(p).includes('No failures detected'), 'the true case must be kept')
})

test('N2b warning-but-not-failed (flaky>0, failed 0) → Slack "• None" is honest — the gate leaves it alone', () => {
  const p = mk({ level: 'warning', failed: 0, passed: 10, flakyCount: 2, failures: [], failuresUnavailable: false })
  assert.ok(JSON.stringify(buildSlackBlocks(p)).includes('• None'), 'no test failures ⇒ • None is truthful')
})

test('N3 failed>0 but NO detail → cannot-enumerate; "No failures detected" AND "• None" ABSENT in both (anti-regression)', () => {
  const p = mk({ level: 'critical', failed: 3, bugs: 0, failures: [], failuresUnavailable: true, runId: 'run-xyz' })
  for (const out of both(p)) {
    assert.equal(out.includes('No failures detected'), false, 'the lie must never render on a failed run')
    assert.equal(out.includes('• None'), false, 'the lie must never render on a failed run')
    assert.ok(out.includes('detail unavailable'), 'must say it cannot enumerate')
    assert.ok(out.includes('reports/triage-report.json'), 'must carry the remedy')
    assert.ok(out.includes('3 failure'), 'must state the count')
  }
})

test('N4 bugs>0 but NO detail → cannot-enumerate; both lies ABSENT in both renderers', () => {
  const p = mk({ level: 'critical', failed: 0, bugs: 2, failures: [], failuresUnavailable: true })
  for (const out of both(p)) {
    assert.equal(out.includes('No failures detected'), false)
    assert.equal(out.includes('• None'), false)
    assert.ok(out.includes('detail unavailable'))
    assert.ok(out.includes('2 failure'))
  }
})

test('N-more truncation says "…and N more" instead of silently dropping (both renderers)', () => {
  const p = mk({ level: 'critical', failed: 8, failures: Array.from({ length: 8 }, (_, i) => RF({ testTitle: `t${i}` })) })
  for (const out of both(p)) assert.ok(out.includes('and 3 more'), '8 − 5 shown = 3 more')  // eslint-disable-line
})

test('N-parse parseTestId — 3-part, 2-part, and a "::" inside the title', () => {
  assert.deepEqual(parseTestId('a/b.spec.ts::my test::firefox'), { file: 'a/b.spec.ts', testTitle: 'my test', browser: 'firefox' })
  assert.deepEqual(parseTestId('a/b.spec.ts::my test'),          { file: 'a/b.spec.ts', testTitle: 'my test', browser: '' })
  assert.deepEqual(parseTestId('a.spec.ts::has :: colons::chromium'), { file: 'a.spec.ts', testTitle: 'has :: colons', browser: 'chromium' })
})
